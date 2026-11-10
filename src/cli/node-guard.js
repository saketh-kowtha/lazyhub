/**
 * node-guard.js — refuse to start on a Node older than package.json "engines"
 * with one line and the next step, instead of a SyntaxError stack from the
 * bundle (A4). Kept dependency-free and written in syntax any Node can parse;
 * bin/lazyhub.js loads it first, before any other module.
 */

export const MIN_NODE_MAJOR = 20

/**
 * @param {string} [version] e.g. "18.17.0" (default: the running Node)
 * @returns {string|null} the message to print, or null when the version is supported
 */
export function nodeVersionProblem(version = process.versions.node) {
  const major = Number.parseInt(String(version).split('.')[0], 10)
  if (Number.isFinite(major) && major >= MIN_NODE_MAJOR) return null
  return `lazyhub needs Node.js ${MIN_NODE_MAJOR} or newer; this is Node ${version}.\n`
    + `Install a current Node (https://nodejs.org, or: nvm install ${MIN_NODE_MAJOR}), then run lazyhub again.\n`
}
