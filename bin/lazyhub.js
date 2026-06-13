if (process.argv.includes('--mouse')) {
  process.env.LAZYHUB_MOUSE = '1'
}

if (process.argv.includes('--debug-state')) {
  const { printDebugState } = await import('../src/debug-state.js')
  const dump = printDebugState()
  process.stdout.write(`${JSON.stringify(dump, null, 2)}\n`)
  process.exit(0)
}

// MCP server mode: lazyhub --mcp
// Speaks Model Context Protocol over stdio so AI assistants can query/act on GitHub data.
if (process.argv.includes('--mcp')) {
  const { bootstrap } = await import('../src/bootstrap.js')
  const { runMCPServer } = await import('../src/mcp.js')
  // Detect repo context (needed for executor calls) but skip Ink rendering
  await bootstrap(null)
  await runMCPServer()
  process.exit(0)
}

if (process.argv[2] === 'doctor') {
  const { runDoctor } = await import('../src/cli/doctor/index.js')
  process.exit(await runDoctor(process.argv.slice(3)))
}

const { bootstrap } = await import('../src/bootstrap.js')
const { renderApp } = await import('../src/app.jsx')
const { loadConfig } = await import('../src/config.js')
const { startIPC } = await import('../src/ipc.js')

const cfg = loadConfig()

// Start IPC server for IDE integrations (unless disabled in config)
if (cfg.ipc?.enabled !== false) {
  const socketPath = startIPC()
  process.env.LAZYHUB_SOCKET = socketPath
}

await bootstrap(renderApp)
