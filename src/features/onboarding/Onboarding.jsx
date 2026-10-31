/**
 * Onboarding.jsx — zero-configuration watch-only first run (#70, mockup variant A:
 * docs/mockups/onboarding-first-run-a-stepper.md).
 *
 * One step: pick a repository, then straight to Focus (#517). The governance
 * report is not part of first run; `lazyhub watch-only` shows it on demand.
 * Read-only end to end: it uses the user's existing gh login, never logs in,
 * installs, creates or writes anything. Quitting leaves nothing behind.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'
import { ThemeProvider, useTheme, readRawThemeCfg } from '../../theme.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { sanitize } from '../../utils.js'
import { selectGhHost } from '../../bootstrap.js'
import { classifyFailure, isOwnerName, listWindowSize, lookupRepo, loadSession, repoKey, windowStart } from './flow.js'
import { classifyGhFailure } from '../../executor.js'
import { FailureNotice } from '../../components/FailureNotice.jsx'

const LOOKUP_KEY = 'lookup:'
const MAX_QUERY = 140

const LOOKUP_ERROR_COPY = {
  no_gh: 'GitHub CLI (gh) was not found.',
  auth: 'Not signed in to GitHub through gh.',
  rate_limit: 'GitHub API rate limit reached; try again later.',
  permission: 'was not found, or your gh login cannot read it.',
  error: 'could not be checked; check your network and `gh auth status`.',
}

/**
 * One truncated text row.
 *
 * @param {{children?: any, color?: string, bold?: boolean}} props
 * @returns {React.ReactElement}
 */
function Line({ children, color, bold = false }) {
  const { t } = useTheme()
  return <Text color={color ?? t.ui.muted} bold={bold} wrap="truncate-end">{children}</Text>
}

export function Onboarding({ onDone, loadSessionFn = loadSession, lookupRepoFn = lookupRepo }) {
  const { t } = useTheme()
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [phase, setPhase] = useState('session') // session | repos | error
  const [session, setSession] = useState(null)
  const [selected, setSelected] = useState(null) // stable repoKey, not an index
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [lookup, setLookup] = useState(null) // {name, status: 'checking'|'error', failure?}
  const [failure, setFailure] = useState(null)
  const [attempt, setAttempt] = useState(0)
  const request = useRef(0)

  const finish = result => { request.current += 1; onDone(result); exit() }

  useEffect(() => {
    const id = ++request.current
    setPhase('session')
    loadSessionFn()
      .then(s => {
        if (request.current !== id) return
        setSession(s)
        setSelected(prev => prev ?? (s.repos[0] ? repoKey(s.repos[0].name) : null)) // pin identity once; a refresh keeps it
        setPhase('repos')
      })
      .catch(err => { if (request.current === id) { setFailure(classifyGhFailure(err)); setPhase('error') } })
  }, [attempt, loadSessionFn])

  // Choosing a repository completes first run; the app opens on Focus.
  const proceed = name => finish({ status: 'completed', repo: name })

  const repos = session?.repos ?? []
  const text = query.trim().toLowerCase()
  // Rows: loaded repos matching the search, plus one synthetic owner/name lookup
  // row when the text is a valid slug that is not already listed.
  const rows = useMemo(() => {
    const list = repos
      .filter(r => !text || r.name.toLowerCase().includes(text))
      .map(r => ({ key: repoKey(r.name), name: r.name, current: r.current, lookup: false }))
    const slug = query.trim()
    if (isOwnerName(slug) && !repos.some(r => repoKey(r.name) === repoKey(slug))) {
      list.push({ key: LOOKUP_KEY + repoKey(slug), name: slug, current: false, lookup: true })
    }
    return list
  }, [repos, query, text])
  const found = rows.findIndex(r => r.key === selected)
  const index = found === -1 ? 0 : found // selection that vanished falls back to the first row

  const checkLookup = name => {
    const id = ++request.current
    setLookup({ name, status: 'checking' })
    lookupRepoFn(name)
      .then(canonical => { if (request.current === id) proceed(canonical) })
      .catch(err => { if (request.current === id) setLookup({ name, status: 'error', failure: classifyFailure(err) }) })
  }
  const choose = () => {
    const row = rows[index]
    if (!row || lookup?.status === 'checking') return
    if (row.lookup) checkLookup(row.name)
    else proceed(row.name)
  }
  const move = delta => {
    if (rows.length === 0) return
    // Functional on the stable key so a burst of keys in one input event all count.
    setSelected(prev => rows[Math.max(0, Math.min(Math.max(0, rows.findIndex(r => r.key === prev)) + delta, rows.length - 1))].key)
  }
  const edit = next => { setQuery(next.slice(0, MAX_QUERY)); setLookup(null) }

  useInput((input, key) => {
    if (phase === 'repos' && searching) {
      if (key.escape && lookup?.status === 'checking') { request.current += 1; setLookup(null) } // cancel the in-flight lookup
      else if (key.escape) { setSearching(false); edit('') }
      else if (key.return) choose()
      else if (key.downArrow) move(1)
      else if (key.upArrow) move(-1)
      else if (key.backspace || key.delete) edit(query.slice(0, -1))
      else if (input && !key.ctrl && !key.meta && /^[A-Za-z0-9._/-]+$/.test(input)) edit(query + input)
      return
    }
    if (input === 'q') return finish({ status: 'cancelled' })
    if (phase === 'error' && input === 'r') {
      setAttempt(n => n + 1)
    } else if (phase === 'repos') {
      if (input === '/') setSearching(true)
      else if (key.downArrow) move(1)
      else if (key.upArrow) move(-1)
      else if (/^[jk]+$/.test(input)) for (const ch of input) move(ch === 'j' ? 1 : -1)
      else if (key.return) choose()
    }
  })

  const keys = {
    session: [{ key: 'q', label: 'quit (nothing is written)' }],
    repos: searching
      ? [{ key: 'Up/Down', label: 'move' }, { key: 'Enter', label: 'open' }, { key: 'Esc', label: lookup?.status === 'checking' ? 'cancel lookup' : 'clear search' }]
      : [{ key: '/', label: 'search' }, { key: 'j/k', label: 'move' }, { key: 'Enter', label: 'open' }, { key: 'q', label: 'quit (nothing is written)' }],
    error: [{ key: 'r', label: 'retry' }, { key: 'q', label: 'quit (nothing is written)' }],
  }[phase]

  const extraLines = (session?.listError ? 1 : 0) + (lookup ? 1 : 0)
  const size = listWindowSize(stdout?.rows || 24, extraLines)
  const start = windowStart(rows.length, index, size)
  const windowed = rows.slice(start, start + size).map((row, n) => ({ row, i: start + n }))

  return (
    <Box flexDirection="column" width={Math.min(stdout?.columns || 80, 100)}>
      <Box flexDirection="column" borderStyle="round" borderColor={t.ui.border} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={t.ui.selected} wrap="truncate-end">{`lazyhub · first run${session?.login ? ` · ${sanitize(session.login)}` : ''}`}</Text>
          <Text color={t.ui.muted}>watch-only · read-only</Text>
        </Box>
        {phase === 'session' && <Spinner label="Checking your gh login..." />}
        {phase === 'error' && (
          <Box flexDirection="column">
            <FailureNotice failure={failure} />
            <Text color={t.ui.dim}>lazyhub changed nothing on GitHub or on this machine.</Text>
          </Box>
        )}
        {phase === 'repos' && (
          <Box flexDirection="column">
            <Line>lazyhub will only READ through your existing gh login. It installs nothing,</Line>
            <Line>creates no checks, changes no rulesets and writes nothing to GitHub.</Line>
            {session.listError && <Line color={t.ci.pending}>{`Repository list unavailable (${session.listError}); showing the current directory's repository only.`}</Line>}
            <Line bold>Pick a repository to open:</Line>
            {windowed.map(({ row, i }) => (
              <Box key={row.key}>
                <Text color={i === index ? t.ui.selected : t.ui.muted} bold={i === index} wrap="truncate-end">
                  {row.lookup
                    ? `${i === index ? '▶' : ' '} look up ${sanitize(row.name)} on GitHub (read-only)`
                    : `${i === index ? '▶' : ' '} ${sanitize(row.name)}${row.current ? '  (current directory)' : ''}`}
                </Text>
              </Box>
            ))}
            {!text && repos.length === 0 && <Line color={t.ui.dim}>No repositories found for this account.</Line>}
            {text && rows.length === 0 && <Line color={t.ui.dim}>{`No loaded repository matches "${sanitize(query.trim())}". Try owner/name to look one up.`}</Line>}
            <Line color={t.ui.dim}>Tip: run `lazyhub watch-only` any time for the review-coverage report.</Line>
            {searching
              ? <Line>{`Search: ${sanitize(query)}_`}</Line>
              : <Line color={t.ui.dim}>/ search · type owner/name to look up any repository</Line>}
            {rows.length > 0 && <Line color={t.ui.dim}>{`${start + 1}-${start + windowed.length} of ${rows.length}${text ? ` matching (${repos.length} loaded)` : ''}`}</Line>}
            {lookup?.status === 'checking' && <Line>{`Checking ${sanitize(lookup.name)} (read-only)...`}</Line>}
            {lookup?.status === 'error' && <Line color={t.ci.fail}>{lookup.failure === 'permission' || lookup.failure === 'error' ? `${sanitize(lookup.name)} ${LOOKUP_ERROR_COPY[lookup.failure]}` : LOOKUP_ERROR_COPY[lookup.failure]}</Line>}
          </Box>
        )}
      </Box>
      <FooterKeys keys={keys} />
    </Box>
  )
}

/**
 * Show the first-run flow before the main app starts.
 *
 * @returns {Promise<{status: 'completed', repo: string}|{status: 'cancelled'}>}
 */
export async function runOnboarding() {
  /** @type {{status: 'completed', repo: string}|{status: 'cancelled'}} */
  let result = { status: 'cancelled' }
  // Same Enterprise-host selection as bootstrap; bootstrap reports failures.
  if (!process.env.GH_HOST) {
    const { host } = await selectGhHost()
    if (host) process.env.GH_HOST = host
  }
  process.stdout.write('\x1b[?1049h\x1b[H')
  try {
    const app = render(
      <ThemeProvider initialTheme={/** @type {any} */ (readRawThemeCfg())}>
        <Onboarding onDone={r => { result = r }} />
      </ThemeProvider>,
    )
    await app.waitUntilExit()
  } finally {
    process.stdout.write('\x1b[?1049l')
  }
  return result
}
