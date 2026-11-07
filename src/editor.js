/**
 * src/editor.js — compatibility entry for the editor launcher (#479).
 *
 * The implementation, and its process spawning, lives in src/services/editor.js so that no
 * spawn site exists outside src/services/, src/executor/, src/bootstrap.js, src/daemon/ and
 * src/ai/providers/. Existing imports (and the tests that mock this path) keep working.
 */

export * from './services/editor.js'
