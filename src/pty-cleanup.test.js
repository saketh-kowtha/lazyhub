// #505: the PTY harness must stop writers and wait for them before removing its temp dir.
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isAlive, removeTempDir, stopTerminal } from '../test/pty/cleanup.js'

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
})
