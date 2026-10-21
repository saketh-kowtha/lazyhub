#!/usr/bin/env node
/**
 * scripts/measure-startup.mjs — reproducible startup measurement (#302).
 *
 * Usage: node scripts/measure-startup.mjs [--bin dist/lazyhub.js] [--runs 5] [--repo owner/name]
 *
 * For each non-TUI command (--version, doctor --json, watch-only --json) it runs the
 * binary N times under `/usr/bin/time -l` (macOS) and reports the median wall time and
 * the max peak RSS. For the TUI it spawns the binary in a PTY with a stub `gh`
 * (no network) and reports the median time until the first byte of terminal output
 * (the first render) and the process RSS sampled at that moment via `ps`.
 * No shell strings: every subprocess is execFile with an args array.
 */
import { spawnSync } from 'child_process'
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { delimiter, join, resolve } from 'path'
import pty from 'node-pty'

const argv = process.argv.slice(2)
const opt = (name, def) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : def)
const BIN = resolve(opt('--bin', 'dist/lazyhub.js'))
const RUNS = Number(opt('--runs', '5'))
const REPO = opt('--repo', 'saketh-kowtha/lazyhub')

if (process.platform !== 'darwin') {
  console.error('measure-startup: /usr/bin/time -l parsing is macOS-only')
  process.exit(2)
}

const median = xs => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)]

function timed(args) {
  const r = spawnSync('/usr/bin/time', ['-l', process.execPath, BIN, ...args], { encoding: 'utf8' })
  const real = Number(/([\d.]+)\s+real/.exec(r.stderr)?.[1])
  const rss = Number(/(\d+)\s+maximum resident set size/.exec(r.stderr)?.[1]) / 1048576
  return { real, rss }
}

function measureCli(label, args) {
  timed(args) // warm the fs cache; not counted
  const runs = Array.from({ length: RUNS }, () => timed(args))
  return { label, time: median(runs.map(r => r.real)), rss: Math.max(...runs.map(r => r.rss)) }
}

async function measureTui() {
  const dir = mkdtempSync(join(tmpdir(), 'lazyhub-measure-'))
  const bin = join(dir, 'bin')
  mkdirSync(bin)
  writeFileSync(join(bin, 'gh'), `#!/usr/bin/env node
const a = process.argv.slice(2)
if (a.includes('--version')) { console.log('gh version 2.0.0'); process.exit(0) }
if (a[0] === 'auth') { console.log('stub'); process.exit(0) }
if (a[0] === 'repo' && a[1] === 'view') { console.log(JSON.stringify({ name: 'lazyhub', owner: { login: 'saketh-kowtha' } })); process.exit(0) }
if (a[0] === 'repo' && a[1] === 'list') { console.log(JSON.stringify([{ name: 'lazyhub', nameWithOwner: 'saketh-kowtha/lazyhub' }])); process.exit(0) }
if (a[0] === 'api' && a[1] === 'user') { console.log('octocat'); process.exit(0) }
console.log('[]')
`)
  chmodSync(join(bin, 'gh'), 0o755)
  const env = {
    PATH: `${bin}${delimiter}${process.env.PATH}`, HOME: dir, USER: process.env.USER || 'lazyhub',
    GHUI_REPO: REPO, TERM: 'xterm-256color', NO_COLOR: '1', LAZYHUB_NO_DAEMON: '1',
  }
  const once = () => new Promise(res => {
    const started = process.hrtime.bigint()
    const term = pty.spawn(process.execPath, [BIN], { name: 'xterm-256color', cols: 80, rows: 24, cwd: dir, env })
    let done = false
    term.onData(data => {
      if (done) return
      done = true
      const ms = Number(process.hrtime.bigint() - started) / 1e6
      const ps = spawnSync('ps', ['-o', 'rss=', '-p', String(term.pid)], { encoding: 'utf8' })
      if (!ps.stdout.trim() || Number(ps.stdout) === 0) console.error(`no live process at first output: ${JSON.stringify(data.slice(0, 300))}`)
      const rss = Number(ps.stdout.trim()) / 1024
      term.kill()
      res({ real: ms / 1000, rss })
    })
  })
  try {
    await once() // warm-up
    const runs = []
    for (let i = 0; i < RUNS; i++) runs.push(await once())
    return { label: 'TUI first render', time: median(runs.map(r => r.real)), rss: Math.max(...runs.map(r => r.rss)) }
  } finally { rmSync(dir, { recursive: true, force: true }) }
}

const rows = [
  measureCli('--version', ['--version']),
  measureCli('doctor --json', ['doctor', '--json']),
  measureCli('watch-only --json', ['watch-only', '--json', '--repo', REPO]),
  await measureTui(),
]
console.log(`| command | median real (s) | max RSS (MB) |  [runs=${RUNS}, bin=${BIN}]`)
console.log('|---|---|---|')
for (const r of rows) console.log(`| ${r.label} | ${r.time.toFixed(2)} | ${r.rss.toFixed(0)} |`)
