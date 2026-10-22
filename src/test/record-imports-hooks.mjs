import { appendFileSync } from 'node:fs'

// Records each specifier and its resolved URL: after bundling (#282) the TUI
// stack is no longer a bare specifier, only a chunk file that contains it.
export async function resolve(specifier, context, nextResolve) {
  const result = await nextResolve(specifier, context)
  const out = process.env.LAZYHUB_RECORD_IMPORTS
  if (out) appendFileSync(out, `${specifier}\n${result.url}\n`)
  return result
}
