/**
 * src/ai/providers/_base.js — re-export of the AI CLI spawn primitive.
 *
 * The primitive lives in src/services/ai-cli.js (#364): providers only build
 * argv + auth and never import child_process themselves.
 */
export { runAiCli, spawnAndPipe, pickEnv, cleanupAllIsolated, clampTimeout, LOGIN_ENV_ALLOW } from '../../services/ai-cli.js'
