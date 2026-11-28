import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { CONFIG_PATH, loadState, saveState } from '../../config.js'
import { validateConfig } from '../../config/schema.js'
import {
  buildScopes, chooseScope, currentScope, initialScope, launchRepoFromEnv, loadScopes, nextScope,
  rememberedQueueScope, resetQueueScope,
} from './scope.js'

const CWD = { repo: 'acme/platform', source: 'cwd' }
const ids = scopes => scopes.map(s => s.id)

beforeEach(() => { resetQueueScope(); saveState({ queueScope: '' }) })
afterEach(() => { rmSync(CONFIG_PATH, { force: true }) })

describe('launchRepoFromEnv: where the user launched', () => {
  it('a clone (cwd) or --repo is the launch repo', () => {
    expect(launchRepoFromEnv({ GHUI_REPO: 'acme/platform', GHUI_REPO_SOURCE: 'cwd' })).toEqual({ repo: 'acme/platform', source: 'cwd' })
    expect(launchRepoFromEnv({ GHUI_REPO: 'acme/platform', GHUI_REPO_SOURCE: 'flag' })).toEqual({ repo: 'acme/platform', source: 'flag' })
  })

  it('the saved default, the picker, a reference or an in-app switch is not', () => {
    for (const source of ['saved', 'picker', 'onboarding', 'reference', 'switch', undefined]) {
      expect(launchRepoFromEnv({ GHUI_REPO: 'acme/platform', GHUI_REPO_SOURCE: source })).toBeNull()
    }
  })

  it('no repository, or a malformed one, is not a launch repo', () => {
    expect(launchRepoFromEnv({ GHUI_REPO_SOURCE: 'cwd' })).toBeNull()
    expect(launchRepoFromEnv({ GHUI_REPO: '--flag/x y', GHUI_REPO_SOURCE: 'cwd' })).toBeNull()
  })
})

describe('buildScopes', () => {
  it('outside a repo: account, then configured orgs and sets', () => {
    const scopes = buildScopes({ orgs: ['acme'], sets: { work: ['acme/api', 'acme/web'] } })
    expect(ids(scopes)).toEqual(['account', 'org:acme', 'set:work'])
    expect(scopes[0].fetch).toBeUndefined()
    expect(scopes[1].fetch).toEqual({ org: 'acme' })
    expect(scopes[2].fetch).toEqual({ repos: ['acme/api', 'acme/web'] })
    expect(scopes[2].note).toBe('2 repos')
  })

  it('inside a repo: the repo first, its owner as an org, no duplicate with the configured org', () => {
    const scopes = buildScopes({ launch: CWD, orgs: ['ACME', 'other'] })
    expect(ids(scopes)).toEqual(['repo:acme/platform', 'account', 'org:acme', 'org:other'])
    expect(scopes[0].fetch).toEqual({ repos: ['acme/platform'] })
    expect(scopes[0].note).toBe('from this directory')
  })

  it('with nothing configured and no repo there is only the account', () => {
    expect(ids(buildScopes())).toEqual(['account'])
  })
})

describe('starting scope and cycling', () => {
  const scopes = buildScopes({ launch: CWD, orgs: ['acme'], sets: { work: ['acme/api'] } })
  const outside = buildScopes({ orgs: ['acme'], sets: { work: ['acme/api'] } })

  it('inside a repo it starts on that repo even when something else was remembered', () => {
    expect(initialScope(scopes, 'set:work').id).toBe('repo:acme/platform')
  })

  it('outside a repo it starts on the remembered scope, else the account', () => {
    expect(initialScope(outside, 'set:work').id).toBe('set:work')
    expect(initialScope(outside, null).id).toBe('account')
    expect(initialScope(outside, 'org:gone').id).toBe('account')
  })

  it('s walks repo -> account -> org -> set and wraps', () => {
    const walk = []
    let at = scopes[0]
    for (let i = 0; i < 5; i += 1) { walk.push(at.id); at = nextScope(scopes, at.id) }
    expect(walk).toEqual(['repo:acme/platform', 'account', 'org:acme', 'set:work', 'repo:acme/platform'])
  })
})

describe('remembered scope (#314 pattern, [state] queueScope)', () => {
  const outside = buildScopes({ orgs: ['acme'] })

  it('an org choice is saved and starts the next launch', () => {
    chooseScope(outside[1])
    expect(rememberedQueueScope()).toBe('org:acme')
    expect(loadState().queueScope).toBe('org:acme')
    resetQueueScope() // a new process
    expect(currentScope(outside).id).toBe('org:acme')
  })

  it('a repo scope is where you are, not a preference, so it is not saved', () => {
    const inRepo = buildScopes({ launch: CWD })
    chooseScope(inRepo[0])
    expect(rememberedQueueScope()).toBeNull()
  })

  it('within a session the choice survives re-mounting the queue', () => {
    const inRepo = buildScopes({ launch: CWD })
    expect(currentScope(inRepo).id).toBe('repo:acme/platform')
    chooseScope(inRepo[1])
    expect(currentScope(inRepo).id).toBe('account')
  })
})

describe('[queue] config', () => {
  it('loadScopes reads orgs and sets from lazyhub.toml', () => {
    mkdirSync(dirname(CONFIG_PATH), { recursive: true })
    writeFileSync(CONFIG_PATH, '[queue]\norgs = ["acme"]\n[queue.sets]\nwork = ["acme/api", "acme/web"]\n')
    const scopes = loadScopes({})
    expect(ids(scopes)).toEqual(['account', 'org:acme', 'set:work'])
  })

  it('the validator drops anything that is not an owner or owner/name', () => {
    const { config, warnings } = validateConfig({ queue: { orgs: ['acme', 'bad org', '-x'], sets: { work: ['acme/api', 'org:evil is:pr', 'x'], '': ['a/b'], empty: [] }, extra: 1 } })
    expect(config.queue.orgs).toEqual(['acme'])
    expect(config.queue.sets).toEqual({ work: ['acme/api'] })
    expect(warnings.join('\n')).toMatch(/bad org/)
    expect(warnings.join('\n')).toMatch(/unknown key "extra" in \[queue\]/)
  })

  it('stale_days (Start here) is a whole number of days from 1 to 365, else ignored with a warning', () => {
    expect(validateConfig({ queue: { stale_days: 30 } }).config.queue.stale_days).toBe(30)
    for (const bad of [0, -1, 2.5, 'ten', 400]) {
      const { config, warnings } = validateConfig({ queue: { stale_days: bad } })
      expect(config.queue.stale_days).toBeUndefined() // the default (14) applies
      expect(warnings.join('\n')).toMatch(/stale_days expected a whole number of days/)
    }
  })

  it('caps a set so the search text stays short', () => {
    const repos = Array.from({ length: 25 }, (_, i) => `acme/r${i}`)
    const { config, warnings } = validateConfig({ queue: { sets: { big: repos } } })
    expect(config.queue.sets.big).toHaveLength(20)
    expect(warnings.join('\n')).toMatch(/only the first 20/)
  })
})
