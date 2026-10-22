/**
 * Lazy loaders for highlight.js core and languages, used by highlight.js.
 *
 * CommonJS on purpose: esbuild wraps a required module in a lazy initializer, so
 * the bundle keeps highlight.js unevaluated until the first highlight call (#302)
 * while still inlining it. Computed or createRequire-based requires cannot be
 * bundled, hence one literal require per language. Keep in sync with
 * HIGHLIGHT_LANGUAGES (highlight.test.js fails if a language is missing).
 */
module.exports = {
  core: () => /** @type {import('highlight.js').HLJSApi} */ (/** @type {unknown} */ (require('highlight.js/lib/core'))),
  languages: {
    javascript: () => require('highlight.js/lib/languages/javascript'),
    typescript: () => require('highlight.js/lib/languages/typescript'),
    python: () => require('highlight.js/lib/languages/python'),
    ruby: () => require('highlight.js/lib/languages/ruby'),
    go: () => require('highlight.js/lib/languages/go'),
    rust: () => require('highlight.js/lib/languages/rust'),
    java: () => require('highlight.js/lib/languages/java'),
    kotlin: () => require('highlight.js/lib/languages/kotlin'),
    swift: () => require('highlight.js/lib/languages/swift'),
    cpp: () => require('highlight.js/lib/languages/cpp'),
    c: () => require('highlight.js/lib/languages/c'),
    csharp: () => require('highlight.js/lib/languages/csharp'),
    php: () => require('highlight.js/lib/languages/php'),
    bash: () => require('highlight.js/lib/languages/bash'),
    json: () => require('highlight.js/lib/languages/json'),
    yaml: () => require('highlight.js/lib/languages/yaml'),
    xml: () => require('highlight.js/lib/languages/xml'),
    css: () => require('highlight.js/lib/languages/css'),
    scss: () => require('highlight.js/lib/languages/scss'),
    less: () => require('highlight.js/lib/languages/less'),
    markdown: () => require('highlight.js/lib/languages/markdown'),
    sql: () => require('highlight.js/lib/languages/sql'),
    graphql: () => require('highlight.js/lib/languages/graphql'),
    diff: () => require('highlight.js/lib/languages/diff'),
    ini: () => require('highlight.js/lib/languages/ini'),
  },
}
