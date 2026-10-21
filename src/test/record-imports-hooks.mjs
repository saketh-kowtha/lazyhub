import { appendFileSync } from 'node:fs'

export async function resolve(specifier, context, nextResolve) {
  const out = process.env.LAZYHUB_RECORD_IMPORTS
  if (out) appendFileSync(out, `${specifier}\n`)
  return nextResolve(specifier, context)
}
