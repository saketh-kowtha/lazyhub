/**
 * src/utils.js — shared utility functions
 */

/**
 * Strips ANSI escape codes from a string to prevent Terminal Injection.
 */
export function stripAnsi(str) {
  if (typeof str !== 'string') return str
  // eslint-disable-next-line no-control-regex
  return str.replace(/[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g, '')
}

/**
 * Sanitize untrusted text for rendering.
 * Strips ANSI codes and potentially other dangerous characters.
 */
export function sanitize(str) {
  return stripAnsi(str || '')
}
