// @ts-nocheck
// TODO(#197): IPC handler registry needs explicit protocol typedefs.
/**
 * src/ipc.js — IPC Unix-socket server for IDE integrations
 *
 * Starts a Unix domain socket server at:
 *   $LAZYHUB_SOCKET  (if set)
 *   <private dir>/ipc-<pid>.sock  (default; Windows: random named pipe)
 *
 * The private dir is $XDG_RUNTIME_DIR/lazyhub or ~/.config/lazyhub/run (never a
 * shared /tmp path another user could pre-create): it is
 * created 0700 and verified (real directory, owned by us, not group/world
 * accessible) before bind; the socket is chmod 0600; pre-existing symlinks or
 * foreign/non-socket entries at the path are rejected (#253).
 *
 * Also writes the socket path to ~/.lazyhub-socket (0600) so clients can
 * discover the most recent instance without knowing the PID.
 *
 * Authentication (#491): the same session-token model the daemon uses. Each run
 * writes a random secret to `<socket path>.token` (0600, next to the socket; on
 * Windows in the private run dir) and removes it on exit. Every request must carry
 * the protocol version `v` and the secret as `auth`; anything else is answered with
 * { id, ok: false, code, error } and no handler runs. Connections only receive
 * pushed events after their first authenticated request.
 *
 * Protocol: newline-delimited JSON (NDJSON)
 *
 * Requests  → { id, v: 1, auth, type, ...params }
 * Responses → { id, type, ...result }
 * Events    → { type: "event", event, data }   (pushed to authenticated clients)
 *
 * Request types:
 *   ping                           → { pong: true }
 *   state                          → current lazyhub state snapshot
 *   navigate  { view, prNumber, issueNumber }  → navigate the TUI
 *   open-file { file, line }       → open file in editor from IDE side
 *   pr-for-branch { branch, repo? }
 *                                  → { prNumber, prState?, ciStatus? }
 *                                     or { prNumber: null } if no PR for the branch
 *   review-comments { prNumber }   → { comments: [{ id, threadId, path, line, body, user, resolved }] }
 *   reply-thread { threadId, body } → { ok: true, commentId }
 *   resolve-thread { threadId }    → { ok: true }
 *     — both are GitHub writes and are refused with
 *       { ok: false, error: 'writes-disabled', message } unless [ipc].allow_writes
 *       is true (local opt-in; default off). Allowed writes go through runGh().
 *   subscribe { event }             → subscribe this client to an event stream
 *   invalidate { repo? }            → request cache invalidation
 *   watch { event? }                → alias for subscribe, used by daemon clients
 *
 * Events emitted to all clients (via emitIPC):
 *   cursor-changed    { view, prNumber, file, line }
 *   view-changed      { view }
 *   pr-merged         { prNumber }
 *   pr-state-changed  { branch, prNumber, ciStatus }
 *     — broadcast helper provided; triggers (CI refresh, merge) ship in later phases.
 *       Call emitIPC('pr-state-changed', payload) from any refresh path.
 *   review-comment-added   { prNumber, comment }
 *   review-thread-resolved { prNumber, threadId }
 */

import { createServer } from 'net'
import { join } from 'path'
import { homedir } from 'os'
import { randomBytes } from 'crypto'
import { chmodSync, mkdirSync, readFileSync, unlinkSync } from 'fs'
import { assertPrivateDir, prepareSocketPath, writePrivateFile } from './secure-fs.js'
import { logger } from './utils-core.js'
import { ERR, issueSession } from './daemon/protocol.js'
import { attachLineReader, authorize, currentSession, deny, parseRequest, send } from './daemon/wire.js'
import {
  getPRStateForBranch as _defaultGetPRStateForBranch,
  getPRReviewCommentsPage as _defaultGetPRReviewComments,
  addPRReviewThreadReply as _defaultAddPRReviewThreadReply,
  resolvePRReviewThread as _defaultResolvePRReviewThread,
} from './executor.js'

const SOCKET_POINTER = join(homedir(), '.lazyhub-socket')

let _server = null
let _cleanup = null
let _clients = new Set()
let _stateGetter = () => ({})
let _navigateHandler = null
let _prForBranchHandler = _defaultGetPRStateForBranch
let _reviewCommentsHandler = _defaultGetPRReviewComments
let _replyThreadHandler = _defaultAddPRReviewThreadReply
let _resolveThreadHandler = _defaultResolvePRReviewThread
let _allowWrites = false
/** @type {{token:string, expiresAt:number, revoked:boolean}|null} */
let _session = null
let _tokenPath = null

const WRITES_DISABLED = {
  ok: false,
  error: 'writes-disabled',
  message: 'Set [ipc] allow_writes = true in lazyhub.toml to reply/resolve from your editor',
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

let _defaultPath = null

/** Private per-user directory that holds the default Unix socket. */
function socketDir() {
  const base = process.env.XDG_RUNTIME_DIR
  if (base) return join(base, 'lazyhub')
  return join(homedir(), '.config', 'lazyhub', 'run')
}

function socketPath() {
  if (process.env.LAZYHUB_SOCKET) return process.env.LAZYHUB_SOCKET
  if (!_defaultPath) {
    _defaultPath = process.platform === 'win32'
      ? `\\\\.\\pipe\\lazyhub-${randomBytes(16).toString('hex')}`
      : join(socketDir(), `ipc-${process.pid}.sock`)
  }
  return _defaultPath
}

/**
 * Validate the bind location before listen(). Throws on any ownership,
 * symlink, type or permission problem; nothing here is best-effort.
 * @param {string} path
 */
function prepareEndpoint(path) {
  if (process.platform === 'win32') return
  if (!process.env.LAZYHUB_SOCKET) {
    // Verify before any chmod so a planted symlink is never followed.
    mkdirSync(socketDir(), { recursive: true, mode: 0o700 })
    assertPrivateDir(socketDir())
  }
  prepareSocketPath(path)
}

/**
 * Where the session secret lives: beside the socket, or in the private run dir for a named pipe.
 * @param {string} path
 */
function tokenPathFor(path) {
  return process.platform === 'win32' ? join(socketDir(), `ipc-${process.pid}.token`) : `${path}.token`
}

function reportIPCError(err, onError) {
  logger.error(`ipc: ${err.message}`)
  if (onError) { try { onError(err) } catch { /* caller bug must not mask the IPC error */ } }
}

function removeIfPresent(path) {
  try { unlinkSync(path) } catch (err) {
    if (err.code !== 'ENOENT') logger.error(`ipc: could not remove ${path}: ${err.message}`)
  }
}

function broadcast(event, data) {
  const msg = JSON.stringify({ type: 'event', event, data }) + '\n'
  for (const client of _clients) {
    try { client.write(msg) } catch { _clients.delete(client) }
  }
}

function sendResponse(socket, id, payload) {
  send(socket, { id, ...payload })
}

function handleMessage(socket, raw) {
  const parsed = parseRequest(raw)
  // The editor socket ignores noise that is not even a JSON object; a wrong version is answered.
  if (parsed.error?.code === ERR.MALFORMED) return
  if (parsed.error) return deny(socket, parsed.id, parsed.error.code, parsed.error.message)
  const { msg, id } = parsed
  // Rotate an expired secret in place so a long-running TUI stays reachable for clients that re-read the file.
  _session = currentSession(_session, _tokenPath)
  const denied = authorize(_session, msg.auth)
  if (denied) return deny(socket, id, denied, 'request denied')
  _clients.add(socket) // only authenticated connections receive pushed events
  const { type } = msg

  switch (type) {
    case 'ping':
      sendResponse(socket, id, { pong: true, pid: process.pid })
      break

    case 'state':
      sendResponse(socket, id, { state: _stateGetter() })
      break

    case 'navigate':
      if (_navigateHandler) {
        try { _navigateHandler(msg) } catch { /* ignore */ }
      }
      sendResponse(socket, id, { ok: true })
      break

    case 'open-file': {
      // IDE asking lazyhub to highlight a file in the diff view
      if (_navigateHandler) {
        try { _navigateHandler({ type: 'highlight-file', file: msg.file, line: msg.line }) } catch { /* ignore */ }
      }
      sendResponse(socket, id, { ok: true })
      break
    }

    case 'pr-for-branch': {
      // nvim statusline / smart :LazyHubPR — look up PR for a branch
      const branch = msg.branch
      if (!branch) {
        sendResponse(socket, id, { prNumber: null })
        break
      }
      // Async handler — respond when the executor call resolves
      ;(_prForBranchHandler(branch, msg.repo || null))
        .then(result => sendResponse(socket, id, result))
        .catch(() => sendResponse(socket, id, { prNumber: null }))
      break
    }

    case 'review-comments': {
      const prNumber = msg.prNumber
      if (!prNumber) {
        sendResponse(socket, id, { comments: [] })
        break
      }
      // Use the current state to find the repo if not provided
      const state = _stateGetter()
      const repo = msg.repo || state.repo || null
      ;(_reviewCommentsHandler(repo, prNumber))
        // A handler returns a plain array or { comments, truncated }; tell the editor when the list is incomplete.
        .then(res => sendResponse(socket, id, { comments: (Array.isArray(res) ? res : res?.comments) || [], truncated: !!(res && !Array.isArray(res) && res.truncated) }))
        .catch(err => sendResponse(socket, id, { comments: [], error: err?.message || 'fetch failed' }))
      break
    }

    case 'reply-thread': {
      if (!_allowWrites) { sendResponse(socket, id, WRITES_DISABLED); break }
      const { threadId, body } = msg
      if (!threadId || !body) {
        sendResponse(socket, id, { error: 'threadId and body are required' })
        break
      }
      ;(_replyThreadHandler(threadId, body))
        .then(result => {
          sendResponse(socket, id, result)
          // Broadcast so other connected clients (e.g. other nvim windows) see the new comment
          const state = _stateGetter()
          broadcast('review-comment-added', {
            prNumber: state.prNumber || null,
            comment: { threadId, body, commentId: result.commentId },
          })
        })
        .catch(err => sendResponse(socket, id, { error: err?.message || 'reply failed' }))
      break
    }

    case 'resolve-thread': {
      if (!_allowWrites) { sendResponse(socket, id, WRITES_DISABLED); break }
      const { threadId: resolveThreadId, prNumber: resolvePrNumber } = msg
      if (!resolveThreadId) {
        sendResponse(socket, id, { error: 'threadId is required' })
        break
      }
      ;(_resolveThreadHandler(resolveThreadId))
        .then(result => {
          sendResponse(socket, id, result)
          // Broadcast so other connected clients see the resolution
          const state = _stateGetter()
          broadcast('review-thread-resolved', {
            prNumber: resolvePrNumber || state.prNumber || null,
            threadId: resolveThreadId,
          })
        })
        .catch(err => sendResponse(socket, id, { error: err?.message || 'resolve failed' }))
      break
    }

    case 'subscribe':
    case 'watch': {
      sendResponse(socket, id, { ok: true, subscribed: msg.event || 'pr-state-changed' })
      break
    }

    case 'invalidate': {
      broadcast('cache-invalidated', { repo: msg.repo || null })
      sendResponse(socket, id, { ok: true })
      break
    }

    default:
      sendResponse(socket, id, { error: `unknown type: ${type}` })
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

/**
 * Start the IPC server.
 *
 * @param {object} opts
 * @param {Function} [opts.getState]         - returns current lazyhub state object
 * @param {Function} [opts.onNavigate]       - called when IDE sends a navigate request
 * @param {Function} [opts.onPRForBranch]    - async (branch, repo) => { prNumber, ... }
 *                                             defaults to executor.getPRStateForBranch
 * @param {Function} [opts.onReviewComments] - async (repo, prNumber) => comments[]
 *                                             defaults to executor.getPRReviewComments
 * @param {Function} [opts.onReplyThread]    - async (threadId, body) => { ok, commentId }
 *                                             defaults to executor.addPRReviewThreadReply
 * @param {Function} [opts.onResolveThread]  - async (threadId) => { ok }
 *                                             defaults to executor.resolvePRReviewThread
 * @param {boolean} [opts.allowWrites]     - permit reply-thread/resolve-thread (default false)
 * @param {Function} [opts.onError]          - called with any bind/chmod/ownership error
 * @returns {string|null} socket path, or null when the endpoint could not be
 *                        secured (the error is logged and passed to onError)
 */
export function startIPC({ getState, onNavigate, onPRForBranch, onReviewComments, onReplyThread, onResolveThread, allowWrites, onError } = {}) {
  if (_server) return socketPath()

  _allowWrites = allowWrites === true

  if (getState)          _stateGetter           = getState
  if (onNavigate)        _navigateHandler       = onNavigate
  if (onPRForBranch)     _prForBranchHandler    = onPRForBranch
  if (onReviewComments)  _reviewCommentsHandler = onReviewComments
  if (onReplyThread)     _replyThreadHandler    = onReplyThread
  if (onResolveThread)   _resolveThreadHandler  = onResolveThread

  const path = socketPath()

  // Reject squatted/symlinked/foreign paths; remove only our own stale socket.
  try {
    prepareEndpoint(path)
  } catch (err) {
    reportIPCError(err, onError)
    process.stderr.write(`lazyhub: IPC disabled: ${err.message}\n`)
    return null
  }

  // Issue the session secret before the socket exists, so a client that finds the socket can read it.
  try {
    _tokenPath = tokenPathFor(path)
    if (process.platform === 'win32') mkdirSync(socketDir(), { recursive: true, mode: 0o700 })
    _session = issueSession(_tokenPath)
  } catch (err) {
    _session = null
    _tokenPath = null
    reportIPCError(err, onError)
    process.stderr.write(`lazyhub: IPC disabled: ${err.message}\n`)
    return null
  }

  _server = createServer((socket) => {
    attachLineReader(socket, line => handleMessage(socket, line))

    socket.on('close', () => _clients.delete(socket))
    socket.on('error', () => _clients.delete(socket))
  })

  const server = _server

  // Cleanup on exit.
  // NOTE: Do NOT call process.exit() here — that is the app's responsibility.
  // Registering process.once('SIGINT') here would conflict with app.jsx's
  // process.on('SIGINT') handler: the first Ctrl+C would consume this once-
  // handler AND app's persistent handler, causing the second Ctrl+C to have no
  // handler at all (raw mode never restored).  Instead, just clean up the
  // socket files on exit and rely on app.jsx to handle the signal exit.
  let bound = false // only unlink a socket this process actually bound
  const sessionFile = _tokenPath
  const cleanup = () => {
    removeIfPresent(sessionFile)
    if (bound && process.platform !== 'win32') removeIfPresent(path)
    // Only drop the pointer if it still names this instance.
    if (!bound) return
    try {
      if (readFileSync(SOCKET_POINTER, 'utf8') === path) removeIfPresent(SOCKET_POINTER)
    } catch (err) {
      if (err.code !== 'ENOENT') logger.error(`ipc: could not read pointer file: ${err.message}`)
    }
  }
  _cleanup = cleanup

  const fail = (err) => {
    reportIPCError(err, onError)
    server.close()
    if (_server === server) stopIPC()
  }

  // EADDRINUSE, EACCES, ... — never swallowed for a privileged endpoint.
  server.on('error', fail)
  server.listen(path, () => {
    bound = true
    try {
      if (process.platform !== 'win32') chmodSync(path, 0o600)
      // Pointer file lets clients find us without knowing the PID.
      writePrivateFile(SOCKET_POINTER, path)
    } catch (err) {
      // Never leave a reachable socket whose mode we could not set.
      fail(err)
    }
  })

  process.on('exit',   cleanup)
  process.once('SIGINT',  cleanup)
  process.once('SIGTERM', cleanup)

  return path
}

/**
 * Stop the IPC server and remove its socket and pointer file.
 */
export function stopIPC() {
  if (!_server) return
  const cleanup = _cleanup
  for (const client of _clients) client.destroy()
  _clients.clear()
  _server.close()
  _server = null
  _cleanup = null
  _defaultPath = null
  _allowWrites = false
  _session = null
  _tokenPath = null
  process.off('exit', cleanup)
  process.off('SIGINT', cleanup)
  process.off('SIGTERM', cleanup)
  cleanup()
}

/**
 * Emit a state-change event to all connected IDE clients.
 *
 * @param {string} event  - event name
 * @param {object} data   - event payload
 */
export function emitIPC(event, data = {}) {
  broadcast(event, data)
}
