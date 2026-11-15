/**
 * #472: the Homebrew formula comes from one tested template, `--version` is expected to exit 0,
 * the promotion cannot skip the tap, and a tap that differs from npm is a failure.
 */
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { compareTap, formulaVersion, renderFormula } from '../scripts/homebrew-formula.mjs'

const read = rel => readFileSync(new URL(rel, import.meta.url), 'utf8')
const SHA = 'a'.repeat(64)
const URL_ = 'https://registry.npmjs.org/lazyhub/-/lazyhub-26.6.2.tgz'

describe('formula template', () => {
  const formula = renderFormula({ url: URL_, sha256: SHA, version: '26.6.2' })

  it('fills every placeholder', () => {
    expect(formula).not.toMatch(/@[A-Z0-9]+@/)
    expect(formula).toContain(`url "${URL_}"`)
    expect(formula).toContain(`sha256 "${SHA}"`)
    expect(formula).toContain('version "26.6.2"')
  })

  it('tests --version for exit 0 and for the package version, not exit 1', () => {
    const test = formula.slice(formula.indexOf('test do'))
    expect(test).toMatch(/shell_output\("#\{bin\}\/lazyhub --version"\)/)
    expect(test).not.toMatch(/shell_output\([^)]*,\s*1\)/)
    expect(test).toContain('version.to_s')
  })

  it('the CLI render command prints a formula whose test expects exit 0 and the version (#472)', () => {
    const script = new URL('../scripts/homebrew-formula.mjs', import.meta.url).pathname
    const out = execFileSync(process.execPath, [script, 'render', URL_, SHA, '26.6.2'], { encoding: 'utf8' })
    expect(out).toContain('version "26.6.2"')
    expect(out).toMatch(/assert_match version\.to_s, shell_output\("#\{bin\}\/lazyhub --version"\)/)
    expect(out).not.toMatch(/shell_output\([^)]*,\s*[1-9]\)/)
  })

  it('refuses values that do not look like an npm tarball, a digest or a version', () => {
    expect(() => renderFormula({ url: 'https://evil.example/x.tgz', sha256: SHA, version: '1.0.0' })).toThrow(/tarball/)
    expect(() => renderFormula({ url: URL_, sha256: 'xyz', version: '1.0.0' })).toThrow(/sha256/)
    expect(() => renderFormula({ url: URL_, sha256: SHA, version: '1.0.0"\nsystem "x' })).toThrow(/version/)
  })
})

describe('tap versus npm', () => {
  it('reads the version from the formula', () => {
    expect(formulaVersion('  url "https://registry.npmjs.org/lazyhub/-/lazyhub-26.5.4.tgz"\n  version "26.5.4"')).toBe('26.5.4')
    expect(formulaVersion('  url "https://registry.npmjs.org/lazyhub/-/lazyhub-26.5.4.tgz"')).toBe('26.5.4')
    expect(formulaVersion('nothing here')).toBeNull()
  })

  it('passes only when they agree, and says what to do when they do not', () => {
    expect(compareTap({ npm: '26.6.2', tap: '26.6.2' }).ok).toBe(true)
    const stale = compareTap({ npm: '26.6.2', tap: '26.5.4' })
    expect(stale.ok).toBe(false)
    expect(stale.message).toMatch(/26\.5\.4.*26\.6\.2.*Promote/)
    expect(compareTap({ npm: null, tap: '1.0.0' }).ok).toBe(false)
    expect(compareTap({ npm: '1.0.0', tap: null }).ok).toBe(false)
  })
})

describe('promote workflow', () => {
  const promote = read('../.github/workflows/promote.yml')
  const at = name => promote.indexOf(`- name: ${name}`)

  it('can no longer skip the tap: TAP_TOKEN is required, before the dist-tag moves', () => {
    expect(promote).not.toMatch(/skipping Homebrew/)
    expect(promote).not.toMatch(/present == 'true'/)
    expect(at('Require TAP_TOKEN')).toBeGreaterThan(0)
    expect(at('Require TAP_TOKEN')).toBeLessThan(at('Promote npm dist-tag'))
  })

  it('builds the formula from the template and verifies the tap afterwards', () => {
    expect(promote).toContain('scripts/homebrew-formula.mjs render')
    expect(promote).not.toMatch(/shell_output/)
    expect(at('Verify the tap matches npm')).toBeGreaterThan(at('Push Homebrew formula'))
    expect(promote).toMatch(/homebrew-formula\.mjs check/)
  })

  it('a version that is already latest still gets its tap update', () => {
    expect(promote).toContain('already_latest')
    expect(promote).toMatch(/Promote npm dist-tag\n\s+if: steps\.tag\.outputs\.already_latest != 'true'/)
  })

  it('a scheduled, read-only workflow compares the tap with npm', () => {
    const check = read('../.github/workflows/tap-check.yml')
    expect(check).toMatch(/schedule:/)
    expect(check).toContain('homebrew-formula.mjs check')
    expect(check).not.toMatch(/TAP_TOKEN|npm publish|dist-tag|createOrUpdateFileContents/)
  })
})

describe('release workflows (#248)', () => {
  const release = read('../.github/workflows/release.yml')
  const promote = read('../.github/workflows/promote.yml')
  const tapCheck = read('../.github/workflows/tap-check.yml')
  const jobBlock = (text, job) => {
    const start = text.indexOf(`\n  ${job}:`)
    const next = text.slice(start + 1).search(/\n  [a-z-]+:\n/)
    return text.slice(start, next < 0 ? undefined : start + 1 + next)
  }

  it('uses no npm token anywhere', () => {
    for (const wf of [release, promote, tapCheck]) expect(wf.replace(/^\s*#.*$/gm, '')).not.toMatch(/NODE_AUTH_TOKEN|NPM_TOKEN|_authToken/)
  })

  it('denies all permissions by default and grants the least per job', () => {
    for (const wf of [release, promote, tapCheck]) expect(wf).toMatch(/^permissions: \{\}$/m)
    expect(jobBlock(release, 'publish')).toMatch(/permissions:\n\s+contents: read\n\s+id-token: write/)
    expect(jobBlock(release, 'smoke')).not.toContain('id-token')
    expect(jobBlock(release, 'smoke')).not.toContain('environment:')
    expect(jobBlock(release, 'github-release')).toMatch(/permissions:\n\s+contents: write/)
    expect(jobBlock(promote, 'promote')).toMatch(/permissions:\n\s+contents: read\n\s+id-token: write/)
  })

  it('publishes and promotes only through the npm-publish environment', () => {
    expect(jobBlock(release, 'publish')).toContain('environment: npm-publish')
    expect(jobBlock(promote, 'promote')).toContain('environment: npm-publish')
    expect(release).toMatch(/npm publish --access public --tag next --provenance/)
    expect(release).not.toMatch(/--tag latest/)
  })

  it('pins every action to a full commit SHA (docs/CI_SIMPLIFICATION.md)', () => {
    for (const wf of [release, promote, tapCheck]) {
      const uses = [...wf.matchAll(/uses:\s*(\S+)/g)].map(m => m[1])
      expect(uses.length).toBeGreaterThan(0)
      for (const u of uses) expect(u).toMatch(/^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/)
    }
  })

  it('the smoke test checks the exact tarball, its provenance, its inventory and the binary', () => {
    const smoke = read('../scripts/release-smoke.mjs')
    expect(smoke).toContain("'pack', spec")
    expect(smoke).toContain('dist.integrity')
    expect(smoke).toContain('slsa.dev/provenance')
    expect(smoke).toContain('audit')
    expect(smoke).toContain('ALLOWED')
    expect(smoke).toContain("'--version'")
    expect(release).toContain('scripts/release-smoke.mjs')
  })
})
