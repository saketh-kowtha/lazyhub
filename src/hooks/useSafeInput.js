/**
 * src/hooks/useSafeInput.js — Ink's useInput with handler errors contained (#490).
 * Exported as `useInput` so call sites keep their shape; import this, not Ink's, in app code.
 */

import { useInput as inkUseInput } from 'ink'
import { containHandler } from '../contain.js'

/**
 * @param {(input: string, key: any) => void} handler
 * @param {{ isActive?: boolean }} [options]
 */
export function useInput(handler, options) {
  return inkUseInput(containHandler(handler), options)
}
