/**
 * src/hooks/useSafeInput.js — the app's input hook (#490, #483).
 *
 * `useInput` is what app code imports. Inside a FocusProvider it registers a listener
 * with the focus manager (one root Ink listener, deterministic child-first order, errors
 * contained at dispatch); outside one it falls back to a contained Ink listener.
 * `useRootInput` is the contained Ink listener itself, used by FocusProvider.
 * This is the only file allowed to import Ink's useInput.
 */

import { useInput as inkUseInput } from 'ink'
import { containHandler } from '../contain.js'
import { useFocusEntry } from '../focus/FocusProvider.js'

/**
 * Contained Ink listener (the focus root, and the no-provider fallback).
 * @param {(input: string, key: any) => void} handler
 * @param {{ isActive?: boolean }} [options]
 */
export function useRootInput(handler, options) {
  return inkUseInput(containHandler(handler), options)
}

/**
 * @param {(input: string, key: any) => void} handler
 * @param {{ isActive?: boolean }} [options]
 */
export function useInput(handler, options) {
  useFocusEntry(null, handler, { isActive: options?.isActive })
}
