// Hermetic launch-path harness (onboarding journeys, group C): real throwaway git
// repos under a temp dir, a temp HOME, a stub `gh`, and a child process that runs the
// real bootstrap() from this checkout. Nothing here touches the real ~/.config/lazyhub,
// the installed binary or the network.
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { execFileSync, spawnSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
export const PROBE = join(here, 'launch-probe.mjs')
const STUB = join(here, 'launch-gh.mjs')
const GIT_ENV = { GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_SYSTEM: '/dev/null' }

export function makeSandbox() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'lazyhub-launch-')))
  const home = join(root, 'home')
  const bin = join(root, 'bin')
  mkdirSync(join(home, '.ssh'), { recursive: true })
  mkdirSync(bin, { recursive: true })
  // Stubs: the launch path must never open a browser or touch the clipboard.
  for (const name of ['open', 'xdg-open', 'pbcopy']) {
    writeFileSync(join(bin, name), '#!/bin/sh\nexit 0\n')
    chmodSync(join(bin, name), 0o755)
  }
  // ssh reads ~/.ssh/config from the passwd home, not $HOME: pin it to the sandbox so
  // `ssh -G <alias>` (offline, never connects) resolves the aliases a test writes.
  // The child process (bootstrap + the gh stub) also needs real git, but only inside sandbox dirs.
  writeFileSync(join(bin, 'git'), `#!/bin/sh\nexec '${REAL_GIT}' "$@"\n`)
  chmodSync(join(bin, 'git'), 0o755)
  let realSsh = '/usr/bin/ssh'
  try { realSsh = execFileSync('which', ['ssh'], { encoding: 'utf8' }).trim() || realSsh } catch { /* keep default */ }
  writeFileSync(join(bin, 'ssh'), `#!/bin/sh\nexec '${realSsh}' -F "$HOME/.ssh/config" "$@"\n`)
  chmodSync(join(bin, 'ssh'), 0o755)
  writeFileSync(join(bin, 'gh'), `#!/bin/sh\nexec '${process.execPath}' '${STUB}' "$@"\n`)
  chmodSync(join(bin, 'gh'), 0o755)
  return { root, home, bin, specFile: join(root, 'spec.json'), log: join(root, 'gh.log') }
}

// The vitest guard shims `git` on PATH; throwaway repos under the sandbox use the genuine binary.
const REAL_GIT = process.env.LAZYHUB_REAL_GIT || execFileSync('which', ['git'], { encoding: 'utf8' }).trim()

export function git(cwd, ...args) {
  return execFileSync(REAL_GIT, ['-c', 'user.email=t@t', '-c', 'user.name=t', '-c', 'protocol.file.allow=always', ...args], {
    cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], env: { ...process.env, ...GIT_ENV },
  })
}

/** git init (+ one commit) with the given remotes ({name: url}). */
export function makeRepo(dir, remotes = {}) {
  mkdirSync(dir, { recursive: true })
  git(dir, 'init', '-q', '-b', 'main')
  git(dir, 'commit', '-q', '--allow-empty', '-m', 'init')
  for (const [name, url] of Object.entries(remotes)) git(dir, 'remote', 'add', name, url)
  return dir
}

/**
 * Run bootstrap() for real in `cwd`.
 * @returns {{status: number|null, out: string, err: string, env: {GH_HOST: string|null, GHUI_REPO: string|null}|null, ghCalls: string}}
 */
export function launch(sb, { cwd, hosts = ['github.com'], repos = {}, args = {}, env = {}, saved } = {}) {
  writeFileSync(sb.specFile, JSON.stringify({ hosts, repos, log: sb.log }))
  writeFileSync(sb.log, '')
  rmSync(join(sb.home, '.config'), { recursive: true, force: true }) // each launch is a fresh first run
  if (saved) {
    mkdirSync(join(sb.home, '.config', 'lazyhub'), { recursive: true })
    writeFileSync(join(sb.home, '.config', 'lazyhub', 'lazyhub.toml'), `[defaults]\nrepo = "${saved}"\n`)
  }
  const clean = { ...process.env }
  for (const k of ['GH_HOST', 'GHUI_REPO', 'GH_TOKEN', 'GITHUB_TOKEN', 'GHUI_PR', 'GHUI_ISSUE']) delete clean[k]
  const res = spawnSync(process.execPath, [PROBE], {
    cwd, encoding: 'utf8', timeout: 20000, input: '',
    env: {
      ...clean, ...GIT_ENV, HOME: sb.home, XDG_CONFIG_HOME: join(sb.home, '.config'), PATH: `${sb.bin}:${process.env.PATH}`,
      LAZYHUB_LAUNCH_SPEC: sb.specFile, LAZYHUB_PROBE_ARGS: JSON.stringify(args), ...env,
    },
  })
  const m = (res.stdout || '').match(/PROBE (\{.*\})/)
  return { status: res.status, out: res.stdout || '', err: res.stderr || '', env: m ? JSON.parse(m[1]) : null, ghCalls: readFileSync(sb.log, 'utf8') }
}
