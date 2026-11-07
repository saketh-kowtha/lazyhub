import { chmodSync, fsyncSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { createServer } from 'net'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { appendPrivateFile, assertPrivateDir, ensurePrivateDir, prepareSocketPath, writePrivateFile } from './secure-fs.js'

vi.mock('fs', async importOriginal => {
  const actual = await importOriginal()
  return { ...actual, fsyncSync: vi.fn(actual.fsyncSync) }
})

const posix = process.platform !== 'win32'
const dirs = []

function tmp() {
  // Short root keeps Unix socket paths under the ~104 byte sun_path limit.
  const dir = mkdtempSync(join(posix ? '/tmp' : tmpdir(), 'lh-sfs-'))
  dirs.push(dir)
  return dir
}

const mode = path => lstatSync(path).mode & 0o777

afterEach(() => {
  vi.restoreAllMocks()
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true })
})

describe.skipIf(!posix)('secure-fs modes', () => {
  it('creates 0700 dirs and 0600 files under a permissive umask and tightens existing ones', () => {
    const root = tmp()
    const old = process.umask(0o000)
    try {
      const dir = join(root, 'cfg')
      mkdirSync(dir, { mode: 0o777 })
      writeFileSync(join(dir, 'legacy.log'), 'x', { mode: 0o666 })
      chmodSync(dir, 0o777)
      chmodSync(join(dir, 'legacy.log'), 0o666)

      ensurePrivateDir(dir)
      writePrivateFile(join(dir, 'a.json'), '{}')
      appendPrivateFile(join(dir, 'legacy.log'), 'y')
      appendPrivateFile(join(dir, 'new.log'), 'y')

      expect(mode(dir)).toBe(0o700)
      expect(mode(join(dir, 'a.json'))).toBe(0o600)
      expect(mode(join(dir, 'legacy.log'))).toBe(0o600)
      expect(mode(join(dir, 'new.log'))).toBe(0o600)
      expect(readdirSync(dir).filter(f => f.endsWith('.tmp'))).toEqual([])
    } finally {
      process.umask(old)
    }
  })

  it('replaces a planted symlink instead of writing through it', () => {
    const root = tmp()
    const victim = join(root, 'victim')
    writeFileSync(victim, 'untouched')
    symlinkSync(victim, join(root, 'out.json'))
    writePrivateFile(join(root, 'out.json'), 'new')
    expect(readFileSync(victim, 'utf8')).toBe('untouched')
    expect(readFileSync(join(root, 'out.json'), 'utf8')).toBe('new')

    symlinkSync(victim, join(root, 'app.log'))
    expect(() => appendPrivateFile(join(root, 'app.log'), 'z')).toThrow()
    expect(readFileSync(victim, 'utf8')).toBe('untouched')
  })
})

describe.skipIf(!posix)('secure-fs ownership and squatting', () => {
  it('rejects a symlinked or foreign-owned directory and tightens a loose owned one', () => {
    const root = tmp()
    const real = join(root, 'real')
    mkdirSync(real, { mode: 0o755 })
    chmodSync(real, 0o755)
    symlinkSync(real, join(root, 'link'))
    expect(() => assertPrivateDir(join(root, 'link'))).toThrow(/symlink/)

    assertPrivateDir(real)
    expect(mode(real)).toBe(0o700)

    vi.spyOn(process, 'getuid').mockReturnValue(process.getuid() + 1)
    expect(() => assertPrivateDir(real)).toThrow(/not owned/)
  })

  it('refuses symlink, non-socket and foreign-owned entries at a socket path', () => {
    const root = tmp()
    const target = join(root, 'target')
    writeFileSync(target, 'keep')
    symlinkSync(target, join(root, 'link.sock'))
    expect(() => prepareSocketPath(join(root, 'link.sock'))).toThrow(/symlink/)

    writeFileSync(join(root, 'file.sock'), 'squat')
    expect(() => prepareSocketPath(join(root, 'file.sock'))).toThrow(/not a socket/)
    expect(readFileSync(join(root, 'file.sock'), 'utf8')).toBe('squat')
    expect(readFileSync(target, 'utf8')).toBe('keep')
    expect(() => prepareSocketPath(join(root, 'absent.sock'))).not.toThrow()
  })

  it('removes a stale socket we own but not one owned by someone else', async () => {
    const root = tmp()
    const path = join(root, 'stale.sock')
    const server = createServer()
    await new Promise(resolve => server.listen(path, resolve))
    try {
      vi.spyOn(process, 'getuid').mockReturnValue(process.getuid() + 1)
      expect(() => prepareSocketPath(path)).toThrow(/another user/)
      vi.restoreAllMocks()
      prepareSocketPath(path)
      expect(() => lstatSync(path)).toThrow()
    } finally {
      server.close()
    }
  })
})


describe('appendPrivateFile fsync option (#235)', () => {
  it('does not fsync by default, so existing callers are unchanged', () => {
    const root = tmp()
    fsyncSync.mockClear()
    appendPrivateFile(join(root, 'a.log'), 'one\n')
    appendPrivateFile(join(root, 'a.log'), 'two\n', {})
    appendPrivateFile(join(root, 'a.log'), 'three\n', { fsync: false })
    expect(fsyncSync).not.toHaveBeenCalled()
    expect(readFileSync(join(root, 'a.log'), 'utf8')).toBe('one\ntwo\nthree\n')
  })

  it('fsyncs the written descriptor once when asked, and still appends at 0600', () => {
    const root = tmp()
    fsyncSync.mockClear()
    appendPrivateFile(join(root, 'j.ndjson'), 'a\n', { fsync: true })
    appendPrivateFile(join(root, 'j.ndjson'), 'b\n', { fsync: true })
    expect(fsyncSync).toHaveBeenCalledTimes(2)
    expect(readFileSync(join(root, 'j.ndjson'), 'utf8')).toBe('a\nb\n')
    if (posix) expect(mode(join(root, 'j.ndjson'))).toBe(0o600)
  })

  it('still refuses a symlink when fsync is requested', () => {
    if (!posix) return
    const root = tmp()
    const victim = join(root, 'victim')
    writeFileSync(victim, 'untouched')
    symlinkSync(victim, join(root, 'j.ndjson'))
    expect(() => appendPrivateFile(join(root, 'j.ndjson'), 'z', { fsync: true })).toThrow()
    expect(readFileSync(victim, 'utf8')).toBe('untouched')
  })
})
