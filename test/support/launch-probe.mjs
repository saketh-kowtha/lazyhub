// Child process for launch-harness: runs the real bootstrap() and reports what it resolved.
import { bootstrap } from '../../src/bootstrap.js'

const args = JSON.parse(process.env.LAZYHUB_PROBE_ARGS || '{}')
await bootstrap(() => {
  process.stdout.write(`PROBE ${JSON.stringify({ GH_HOST: process.env.GH_HOST ?? null, GHUI_REPO: process.env.GHUI_REPO ?? null })}\n`)
  process.exit(0)
}, args)
process.stdout.write('PROBE-NO-RENDER\n')
