import { headlessPreflight } from '../bootstrap.js'
import { runMCPServer } from '../mcp.js'

/**
 * Run lazyhub MCP server mode. Headless: stdout is reserved for JSON-RPC, so
 * setup problems go to stderr as one line and a non-zero exit, never a prompt.
 */
export async function runMcpServer() {
  const pre = await headlessPreflight()
  if (!pre.ok) {
    process.stderr.write(`${pre.message}\n`)
    return 1
  }
  await runMCPServer()
  return 0
}
