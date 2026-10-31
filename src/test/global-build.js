// Builds dist/ once per run so tests that drive the built entrypoint share it.
// Building inside several test files races: build.js starts with rm -rf dist.
import { execFileSync } from 'node:child_process'

/** vitest globalSetup: build once before any worker starts. */
export default function setup() {
  execFileSync(process.execPath, ['build.js'], { cwd: new URL('../..', import.meta.url).pathname, stdio: 'ignore' })
}
