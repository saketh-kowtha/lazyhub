import { bootstrap } from '../bootstrap.js'
import { runMCPServer } from '../mcp.js'

/**
 * Run lazyhub MCP server mode.
 */
export async function runMcpServer() {
  await bootstrap(null)
  await runMCPServer()
  return 0
}
