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
import { noteActivity } from '../shell/activity.js'

/**
 * Contained Ink listener (the focus root, and the no-provider fallback).
 * @param {(input: string, key: any) => void} handler
 * @param {{ isActive?: boolean }} [options]
 */
export function useRootInput(handler, options) {
  // Every key ends the idle state first, so a paused poll or animation resumes on it (#620).
  return inkUseInput(containHandler((input, key) => { noteActivity(); return handler(input, key) }), options)
}

/**
 * @param {(input: string, key: any) => void} handler
 * @param {{ isActive?: boolean, yieldToModal?: boolean }} [options] yieldToModal: stay silent while an overlay, dialog or input owns the keys (#485)
 */
export function useInput(handler, options) {
  useFocusEntry(null, handler, { isActive: options?.isActive, yieldToModal: options?.yieldToModal })
}
