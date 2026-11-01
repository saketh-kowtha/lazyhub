// #505: the PTY harness must stop writers and wait for them before removing its temp dir.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAlive, removeTempDir, startTimeOf, stopTerminal } from '../test/pty/cleanup.js'

// A child that keeps creating new files in `dir`, like the app writing under HOME.
function startWriter(dir) {
  const script = "const fs=require('fs');let i=0;setInterval(()=>{for(let n=0;n<50;n++){try{fs.mkdirSync(process.argv[1]+'/d'+(i%7),{recursive:true});fs.writeFileSync(process.argv[1]+'/d'+(i%7)+'/f'+(i++),'x')}catch{}}},1)"
  const child = spawn(process.execPath, ['-e', script, dir], { stdio: 'ignore' })
  const exited = new Promise(resolve => child.once('exit', resolve))
  return { pid: child.pid, kill: () => child.kill('SIGHUP'), exited }
}

describe('PTY harness cleanup (#505)', () => {
  it('stopTerminal waits for an active writer to die, so the temp dir then removes cleanly', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-pty-cleanuptest-'))
    writeFileSync(join(dir, 'seed'), '')
    const writer = startWriter(dir)
    await new Promise(resolve => setTimeout(resolve, 150))
    await stopTerminal(writer)
    expect(isAlive(writer.pid)).toBe(false)
    expect(() => removeTempDir(dir)).not.toThrow()
    expect(existsSync(dir)).toBe(false)
  })

  it('escalates to SIGKILL when the process ignores the polite signal', async () => {
    const child = spawn(process.execPath, ['-e', "process.on('SIGHUP',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' })
    const exited = new Promise(resolve => child.once('exit', resolve))
    await new Promise(resolve => setTimeout(resolve, 150))
    await stopTerminal({ pid: child.pid, kill: () => child.kill('SIGHUP'), exited })
    expect(isAlive(child.pid)).toBe(false)
  }, 15000)

  it('tracks a child spawned while it waits and reports no survivors', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'lazyhub-pty-cleanuptest-'))
    const pidFile = join(dir, 'child.pid')
    const script = `const {spawn}=require('child_process');const fs=require('fs');process.on('SIGHUP',()=>{const c=spawn(process.execPath,['-e','setTimeout(()=>{},30000)'],{stdio:'ignore'});fs.writeFileSync(process.argv[1],String(c.pid));setTimeout(()=>process.exit(0),400)});setInterval(()=>{},1000)`
    const child = spawn(process.execPath, ['-e', script, pidFile], { stdio: 'ignore' })
    const exited = new Promise(resolve => child.once('exit', resolve))
    await new Promise(resolve => setTimeout(resolve, 200))
    const survivors = await stopTerminal({ pid: child.pid, kill: () => child.kill('SIGHUP'), exited })
    expect(survivors).toEqual([])
    const grandchild = Number(readFileSync(pidFile, 'utf8'))
    expect(grandchild).toBeGreaterThan(0)
    expect(isAlive(grandchild)).toBe(false)
    removeTempDir(dir)
  }, 15000)

  it('identifies a process by pid plus start time (so a recycled pid is never SIGKILLed)', () => {
    expect(startTimeOf(process.pid)).not.toBe('')
    expect(startTimeOf(process.pid)).toBe(startTimeOf(process.pid))
    expect(startTimeOf(2 ** 22 + 12345)).toBe('')
  })

  it('every flow in test/pty/run.js stops processes with the helpers and never removes a dir itself', () => {
    const run = readFileSync(new URL('../test/pty/run.js', import.meta.url), 'utf8')
    expect(run).toMatch(/from '\.\/cleanup\.js'/)
    expect(run).not.toMatch(/\brmSync\(/)
    expect(run).not.toMatch(/try \{ \w+\?\.kill\(\) \}/)
    const flows = run.match(/mkdtempSync\(/g).length
    expect(run.match(/removeTempDir\(temp\)/g).length).toBe(flows)
    expect(run.match(/await stop(Terminal|TmuxSession)\(/g).length).toBeGreaterThanOrEqual(flows)
  })
})
