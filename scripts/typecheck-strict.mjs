// noImplicitAny ratchet (#489): type-checks tsconfig.strict.json but reports only the
// directories that opted in. tsc follows imports into files that have not opted in yet
// (cache.js, contain.js, ...), and their implicit-any errors are not ours to fail on.
// To opt a directory in: add it to tsconfig.strict.json "include" and to STRICT below.
import { spawnSync } from 'node:child_process'

const STRICT = [/^src\/executor\//, /^src\/config\//, /^src\/daemon\/protocol\.js$/]

const run = spawnSync('npx', ['tsc', '--noEmit', '-p', 'tsconfig.strict.json', '--pretty', 'false'], { encoding: 'utf8' })
const errors = `${run.stdout}${run.stderr}`.split('\n').filter(line => /error TS\d+/.test(line))
const ours = errors.filter(line => STRICT.some(re => re.test(line)))
if (ours.length) {
  console.error(ours.join('\n'))
  console.error(`\n${ours.length} noImplicitAny error(s) in directories that opted in (#489).`)
  process.exit(1)
}
