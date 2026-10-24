#!/usr/bin/env node
// Fixture-only stand-in for the GitHub CLI, shared by the PTY E2E harness
// (test/pty/run.js) and the demo recorder (scripts/demo.mjs). One engine, one
// data set per consumer: LAZYHUB_GH_FIXTURE selects ./<name>.mjs, whose default
// export is `(args, out) => void` and calls out(value) for commands it handles.
// Unhandled commands print `[]`. The fixture name is baked into the wrapper
// written by installShim() because the app hands gh a curated env.
import { chmodSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

export const SHIM_PATH = fileURLToPath(import.meta.url)

const shq = s => `'${String(s).replace(/'/g, `'\\''`)}'`

/** Write a `gh` executable into `binDir` that runs this shim with the named fixture set. */
export function installShim(binDir, fixture) {
  mkdirSync(binDir, { recursive: true })
  const file = join(binDir, 'gh')
  writeFileSync(file, `#!/bin/sh\nLAZYHUB_GH_FIXTURE=${shq(fixture)} exec ${shq(process.execPath)} ${shq(SHIM_PATH)} "$@"\n`)
  chmodSync(file, 0o755)
  return file
}

async function main() {
  const fixture = process.env.LAZYHUB_GH_FIXTURE
  if (!/^[a-z-]+$/.test(fixture || '')) {
    process.stderr.write('gh shim: LAZYHUB_GH_FIXTURE must name a fixture set\n')
    process.exit(2)
  }
  const { default: handle } = await import(new URL(`./${fixture}.mjs`, import.meta.url).href)
  const out = value => { process.stdout.write(typeof value === 'string' ? value : JSON.stringify(value)); process.exit(0) }
  handle(process.argv.slice(2), out)
  out([])
}

if (process.argv[1] === SHIM_PATH) await main()
