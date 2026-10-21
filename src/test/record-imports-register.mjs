// Preload (node --import) that records every module specifier the process resolves.
// Used by src/cli/lazy-load.test.js to prove which packages a command really loads.
import { register } from 'node:module'

register('./record-imports-hooks.mjs', import.meta.url)
