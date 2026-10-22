/**
 * Onboarding.jsx — zero-configuration watch-only first run (#70, mockup variant A:
 * docs/mockups/onboarding-first-run-a-stepper.md).
 *
 * Two steps (repository, report) in one bordered panel. Read-only end to end:
 * it uses the user's existing gh login, never logs in, installs, creates or
 * writes anything. Quitting at any point leaves nothing behind.
 */

import React, { useState, useEffect, useMemo, useRef } from 'react'
import { Box, Text, render, useApp, useInput, useStdout } from 'ink'
import { ThemeProvider, useTheme, readRawThemeCfg } from '../../theme.js'
import { FooterKeys } from '../../components/FooterKeys.jsx'
import { Spinner } from '../../components/Spinner.jsx'
import { sanitize } from '../../utils.js'
import { selectGhHost } from '../../bootstrap.js'
import { classifyFailure, explainGap, isOwnerName, listWindowSize, lookupRepo, loadOnboardingReport, loadSession, repoKey, windowStart } from './flow.js'

const ERROR_COPY = {
  no_gh: ['GitHub CLI (gh) was not found.', 'Install it from https://cli.github.com, run `gh auth login`, then start lazyhub again.'],
  auth: ['Not signed in to GitHub through gh.', 'Run `gh auth login` (add `--hostname <host>` for Enterprise), then start lazyhub again. lazyhub did not log in for you.'],
  rate_limit: ['GitHub API rate limit reached.', 'Nothing was lost. Wait for the limit to reset, then retry.'],
  permission: ['Your gh login cannot read what lazyhub needs.', 'Check the account and token scopes with `gh auth status`, then retry.'],
  error: ['GitHub could not be reached.', 'Check your network and `gh auth status`, then retry.'],
}

const LOOKUP_KEY = 'lookup:'
const MAX_QUERY = 140

const LOOKUP_ERROR_COPY = {
  no_gh: 'GitHub CLI (gh) was not found.',
  auth: 'Not signed in to GitHub through gh.',
  rate_limit: 'GitHub API rate limit reached; try again later.',
  permission: 'was not found, or your gh login cannot read it.',
  error: 'could not be checked; check your network and `gh auth status`.',
}

const SLICE2_NOTE = [
  'Enforcement (coming, not available yet; #245): optional approval-only setup, a separate step.',
  'Expect solo/pilot limits: you approve your own agents\' merges, on repos you administer.',
]

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

function coverageColor(t, coverage) {
  return coverage === 'advisory' ? t.ci.pending : t.ci.fail
}

function Report({ data }) {
  const { t } = useTheme()
  const { coverage, activity } = data
  const gaps = [...new Set(coverage.observation.gap_codes)]
  const explained = gaps.map(explainGap).filter(Boolean)
  const a = activity?.by_attribution
  return (
    <Box flexDirection="column">
      <Line>
        {activity
          ? `Observed ${activity.pull_requests} PR(s) in ${activity.pages} page(s). Nothing was enforced, installed or written.`
          : 'Activity could not be read. Nothing was enforced, installed or written.'}
      </Line>
      <Line>{`identity: ${coverage.identity.status}${coverage.identity.reason ? ` (${sanitize(coverage.identity.reason)})` : ''} · rulesets: ${coverage.rulesets.status}${coverage.rulesets.count === null ? '' : ` (${coverage.rulesets.count})`}`}</Line>
      <Line bold>{`Coverage (${coverage.coverage_states.join(' | ')})`}</Line>
      {coverage.operations.map(op => (
        <Box key={op.operation}><Text wrap="truncate-end">
          <Text color={t.ui.muted}>{`  ${op.operation.padEnd(28)} `}</Text>
          <Text color={coverageColor(t, op.coverage)}>{op.coverage}</Text>
          <Text color={t.ui.dim}>{op.downgrade_reasons.length ? ` [downgraded: ${op.downgrade_reasons.map(sanitize).join(', ')}]` : ''}</Text>
        </Text></Box>
      ))}
      {gaps.length > 0 && <Line color={t.ci.pending}>{`Gaps: ${gaps.join(', ')}${explained.length ? ` - ${explained[0]}` : ''}`}</Line>}
      {a && <Line>{`Activity: agent ${a.agent} · automation ${a.automation} · human ${a.human} · shared ${a.shared} · unknown ${a.unknown}`}</Line>}
      {a && a.unknown > 0 && <Line color={t.ci.pending}>{`  ${a.unknown} unattributed event(s): unknown is not safe, and counts as ungoverned.`}</Line>}
      {SLICE2_NOTE.map(line => <Box key={line}><Line color={t.ui.dim}>{line}</Line></Box>)}
    </Box>
  )
}

export function Onboarding({ onDone, loadSessionFn = loadSession, loadReportFn = loadOnboardingReport, lookupRepoFn = lookupRepo }) {
  const { t } = useTheme()
  const { exit } = useApp()
  const { stdout } = useStdout()
  const [phase, setPhase] = useState('session') // session | repos | report | error
  const [session, setSession] = useState(null)
  const [selected, setSelected] = useState(null) // stable repoKey, not an index
  const [query, setQuery] = useState('')
  const [searching, setSearching] = useState(false)
  const [lookup, setLookup] = useState(null) // {name, status: 'checking'|'error', failure?}
  const [repo, setRepo] = useState(null)
  const [data, setData] = useState(null)
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
      .catch(err => { if (request.current === id) { setFailure(classifyFailure(err)); setPhase('error') } })
  }, [attempt, loadSessionFn])

  const observe = name => {
    const id = ++request.current
    setRepo(name)
    setLookup(null)
    setData(null)
    setPhase('report')
    loadReportFn(name)
      .then(d => { if (request.current === id) setData(d) })
      .catch(err => { if (request.current === id) { setFailure(classifyFailure(err)); setPhase('error') } })
  }

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
      .then(canonical => { if (request.current === id) observe(canonical) })
      .catch(err => { if (request.current === id) setLookup({ name, status: 'error', failure: classifyFailure(err) }) })
  }
  const choose = () => {
    const row = rows[index]
    if (!row || lookup?.status === 'checking') return
    if (row.lookup) checkLookup(row.name)
    else observe(row.name)
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
      if (repo) observe(repo)
      else setAttempt(n => n + 1)
    } else if (phase === 'repos') {
      if (input === '/') setSearching(true)
      else if (key.downArrow) move(1)
      else if (key.upArrow) move(-1)
      else if (/^[jk]+$/.test(input)) for (const ch of input) move(ch === 'j' ? 1 : -1)
      else if (key.return) choose()
    } else if (phase === 'report') {
      if (key.escape || input === 'b') { request.current += 1; setPhase('repos') }
      else if (key.return && data) finish({ status: 'completed', repo })
    }
  })

  const keys = {
    session: [{ key: 'q', label: 'quit (nothing is written)' }],
    repos: searching
      ? [{ key: 'Up/Down', label: 'move' }, { key: 'Enter', label: 'observe' }, { key: 'Esc', label: lookup?.status === 'checking' ? 'cancel lookup' : 'clear search' }]
      : [{ key: '/', label: 'search' }, { key: 'j/k', label: 'move' }, { key: 'Enter', label: 'observe' }, { key: 'q', label: 'quit (nothing is written)' }],
    report: [{ key: 'Enter', label: 'open lazyhub' }, { key: 'Esc/b', label: 'change repo' }, { key: 'q', label: 'quit (nothing is written)' }],
    error: [{ key: 'r', label: 'retry' }, { key: 'q', label: 'quit (nothing is written)' }],
  }[phase]

  const extraLines = (session?.listError ? 1 : 0) + (lookup ? 1 : 0)
  const size = listWindowSize(stdout?.rows || 24, extraLines)
  const start = windowStart(rows.length, index, size)
  const windowed = rows.slice(start, start + size).map((row, n) => ({ row, i: start + n }))

  const active = phase === 'report' ? 2 : 1
  const step = n => <Text color={n === active ? t.ui.selected : t.ui.dim} bold={n === active}>{n === 1 ? '1 Repository' : '2 Report'}</Text>

  return (
    <Box flexDirection="column" width={Math.min(stdout?.columns || 80, 100)}>
      <Box flexDirection="column" borderStyle="round" borderColor={t.ui.border} paddingX={1}>
        <Box justifyContent="space-between">
          <Text bold color={t.ui.selected} wrap="truncate-end">{`lazyhub · first run${session?.login ? ` · ${sanitize(session.login)}` : ''}${phase === 'report' && repo ? ` · ${sanitize(repo)}` : ''}`}</Text>
          <Text color={t.ui.muted}>watch-only · read-only</Text>
        </Box>
        <Text>{step(1)}<Text color={t.ui.dim}> › </Text>{step(2)}</Text>
        {phase === 'session' && <Spinner label="Checking your gh login..." />}
        {phase === 'error' && (
          <Box flexDirection="column">
            <Text color={t.ci.fail} bold>{ERROR_COPY[failure][0]}</Text>
            <Text color={t.ui.muted}>{ERROR_COPY[failure][1]}</Text>
            <Text color={t.ui.dim}>lazyhub changed nothing on GitHub or on this machine.</Text>
          </Box>
        )}
        {phase === 'repos' && (
          <Box flexDirection="column">
            <Line>lazyhub will only READ through your existing gh login. It installs nothing,</Line>
            <Line>creates no checks, changes no rulesets and writes nothing to GitHub.</Line>
            {session.listError && <Line color={t.ci.pending}>{`Repository list unavailable (${session.listError}); showing the current directory's repository only.`}</Line>}
            <Line bold>Pick a repository to observe:</Line>
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
            {searching
              ? <Line>{`Search: ${sanitize(query)}_`}</Line>
              : <Line color={t.ui.dim}>/ search · type owner/name to look up any repository</Line>}
            {rows.length > 0 && <Line color={t.ui.dim}>{`${start + 1}-${start + windowed.length} of ${rows.length}${text ? ` matching (${repos.length} loaded)` : ''}`}</Line>}
            {lookup?.status === 'checking' && <Line>{`Checking ${sanitize(lookup.name)} (read-only)...`}</Line>}
            {lookup?.status === 'error' && <Line color={t.ci.fail}>{lookup.failure === 'permission' || lookup.failure === 'error' ? `${sanitize(lookup.name)} ${LOOKUP_ERROR_COPY[lookup.failure]}` : LOOKUP_ERROR_COPY[lookup.failure]}</Line>}
          </Box>
        )}
        {phase === 'report' && (data ? <Report data={data} /> : <Spinner label={`Reading ${sanitize(repo)} (read-only)...`} />)}
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
