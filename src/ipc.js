/**
 * src/ipc.js — IPC Unix-socket server for IDE integrations
 *
 * Starts a Unix domain socket server at:
 *   $LAZYHUB_SOCKET  (if set)
 *   /tmp/lazyhub-<pid>.sock  (default)
 *
 * Also writes the socket path to ~/.lazyhub-socket so clients can
 * discover the most recent instance without knowing the PID.
 *
 * Protocol: newline-delimited JSON (NDJSON)
 *
 * Requests  → { id, type, ...params }
 * Responses → { id, type, ...result }
 * Events    → { type: "event", event, data }   (pushed to all clients)
 *
 * Request types:
 *   ping                           → { pong: true }
 *   state                          → current lazyhub state snapshot
 *   navigate  { view, prNumber, issueNumber }  → navigate the TUI
 *   open-file { file, line }       → open file in editor from IDE side
 *   pr-for-branch { branch, repo? }
 *                                  → { prNumber, prState?, ciStatus?, unresolvedThreads? }
 *                                     or { prNumber: null } if no PR for the branch
 *   review-comments { prNumber }   → { comments: [{ id, threadId, path, line, body, user, resolved }] }
 *   reply-thread { threadId, body } → { ok: true, commentId }
 *   resolve-thread { threadId }    → { ok: true }
 *
 * Events emitted to all clients (via emitIPC):
 *   cursor-changed    { view, prNumber, file, line }
 *   view-changed      { view }
 *   pr-merged         { prNumber }
 *   pr-state-changed  { branch, prNumber, ciStatus, unresolvedThreads }
 *   review-comment-added   { prNumber, comment }
 *   review-thread-resolved { prNumber, threadId }
 */

import { createServer } from 'net'
import { join } from 'path'
import { homedir } from 'os'
import { writeFileSync, unlinkSync, existsSync } from 'fs'
import {
  getPRStateForBranch as _defaultGetPRStateForBranch,
  getPRReviewComments as _defaultGetPRReviewComments,
  addPRReviewThreadReply as _defaultAddPRReviewThreadReply,
  resolvePRReviewThread as _defaultResolvePRReviewThread,
} from './executor.js'

const SOCKET_POINTER = join(homedir(), '.lazyhub-socket')

let _server = null
let _clients = new Set()
let _stateGetter = () => ({})
let _navigateHandler = null
let _prForBranchHandler = _defaultGetPRStateForBranch
let _reviewCommentsHandler = _defaultGetPRReviewComments
let _replyThreadHandler = _defaultAddPRReviewThreadReply
let _resolveThreadHandler = _defaultResolvePRReviewThread

// ─── Helpers ──────────────────────────────────────────────────────────────────

function socketPath() {
  return process.env.LAZYHUB_SOCKET || `/tmp/lazyhub-${process.pid}.sock`
}

function broadcast(event, data) {
  const msg = JSON.stringify({ type: 'event', event, data }) + '\n'
  for (const client of _clients) {
    try { client.write(msg) } catch { _clients.delete(client) }
  }
}

function sendResponse(socket, id, payload) {
  try {
    socket.write(JSON.stringify({ id, ...payload }) + '\n')
  } catch { /* client disconnected */ }
}

function handleMessage(socket, raw) {
  let msg
  try { msg = JSON.parse(raw) } catch { return }
  const { id, type } = msg

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
      const branch = msg.branch
      if (!branch) {
        sendResponse(socket, id, { prNumber: null })
        break
      }
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
        .then(comments => sendResponse(socket, id, { comments: comments || [] }))
        .catch(err => sendResponse(socket, id, { comments: [], error: err?.message || 'fetch failed' }))
      break
    }

    case 'reply-thread': {
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

    default:
      sendResponse(socket, id, { error: `unknown type: ${type}` })
  }
}

// ─── Server ───────────────────────────────────────────────────────────────────

/**
 * Start the IPC server.
 *
 * @param {object} opts
 * @param {Function} opts.getState           - returns current lazyhub state object
 * @param {Function} opts.onNavigate         - called when IDE sends a navigate request
 * @param {Function} [opts.onPRForBranch]    - async (branch, repo) => { prNumber, ... }
 *                                             defaults to executor.getPRStateForBranch
 * @param {Function} [opts.onReviewComments] - async (repo, prNumber) => comments[]
 *                                             defaults to executor.getPRReviewComments
 * @param {Function} [opts.onReplyThread]    - async (threadId, body) => { ok, commentId }
 *                                             defaults to executor.addPRReviewThreadReply
 * @param {Function} [opts.onResolveThread]  - async (threadId) => { ok }
 *                                             defaults to executor.resolvePRReviewThread
 * @returns {string} socket path
 */
export function startIPC({ getState, onNavigate, onPRForBranch, onReviewComments, onReplyThread, onResolveThread } = {}) {
  if (_server) return socketPath()

  if (getState)          _stateGetter           = getState
  if (onNavigate)        _navigateHandler       = onNavigate
  if (onPRForBranch)     _prForBranchHandler    = onPRForBranch
  if (onReviewComments)  _reviewCommentsHandler = onReviewComments
  if (onReplyThread)     _replyThreadHandler    = onReplyThread
  if (onResolveThread)   _resolveThreadHandler  = onResolveThread

  const path = socketPath()

  // Clean up stale socket from a previous crash
  if (existsSync(path)) {
    try { unlinkSync(path) } catch { /* ignore */ }
  }

  _server = createServer((socket) => {
    _clients.add(socket)
    let buf = ''

    socket.on('data', (chunk) => {
      buf += chunk.toString()
      const lines = buf.split('\n')
      buf = lines.pop() // last element may be incomplete
      for (const line of lines) {
        if (line.trim()) handleMessage(socket, line.trim())
      }
    })

    socket.on('close', () => _clients.delete(socket))
    socket.on('error', () => _clients.delete(socket))
  })

  _server.listen(path, () => {
    // Write pointer file so clients can find us without knowing the PID
    try { writeFileSync(SOCKET_POINTER, path, 'utf8') } catch { /* ignore */ }
  })

  _server.on('error', () => { /* ignore EADDRINUSE etc */ })

  // Cleanup on exit
  const cleanup = () => {
    try { unlinkSync(path) } catch { /* ignore */ }
    try { unlinkSync(SOCKET_POINTER) } catch { /* ignore */ }
  }
  process.once('exit',    cleanup)
  process.once('SIGINT',  () => { cleanup(); process.exit(0) })
  process.once('SIGTERM', () => { cleanup(); process.exit(0) })

  return path
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
