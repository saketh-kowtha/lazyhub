/**
 * #472: the Homebrew formula comes from one tested template, `--version` is expected to exit 0,
 * the promotion cannot skip the tap, and a tap that differs from npm is a failure.
 */
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
