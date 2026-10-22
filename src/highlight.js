/**
 * src/highlight.js — lazily-built highlight.js instance (#302).
 *
 * `import hljs from 'highlight.js'` registers all ~190 languages (~70 ms at startup).
 * Instead this module builds a `highlight.js/lib/core` instance with only the
 * languages the diff view maps file extensions to (see getLang in
 * features/prs/diff.jsx), plus `diff` and `ini` for markdown code fences.
 * It loads synchronously on the first highlight call (render code cannot await),
 * so CLI commands and the first frame never pay for it.
 *
 * Trade-off: fenced code blocks in markdown with a language outside this set
 * (e.g. ```lua) now render unhighlighted, and untagged blocks are auto-detected
 * among these languages only.
 */
import loaders from './highlight-loaders.cjs'

/** Every language registered, keyed by highlight.js module name. */
export const HIGHLIGHT_LANGUAGES = [
  'javascript', 'typescript', 'python', 'ruby', 'go', 'rust', 'java', 'kotlin', 'swift',
  'cpp', 'c', 'csharp', 'php', 'bash', 'json', 'yaml', 'xml', 'css', 'scss', 'less',
  'markdown', 'sql', 'graphql',
  // markdown code fences only
  'diff', 'ini',
]

let instance = null

/**
 * Get the shared highlight.js core instance, building it on first use.
 * @returns {import('highlight.js').HLJSApi}
 */
export function getHljs() {
  if (!instance) {
    const hljs = loaders.core()
    for (const name of HIGHLIGHT_LANGUAGES) {
      hljs.registerLanguage(name, loaders.languages[name]())
    }
    instance = hljs
  }
  return instance
}
