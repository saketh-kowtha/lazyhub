#!/usr/bin/env node
/**
 * Build script — transpiles JSX and resolves imports into dist/lazyhub.js
 * using esbuild. node_modules are kept as external (not bundled).
 */
import * as esbuild from 'esbuild'
import { mkdir, copyFile, rm } from 'fs/promises'

// Chunk filenames are content-hashed; drop stale ones so they never ship in the package.
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

// Non-JS assets read at runtime via fs (not bundled by esbuild) must be copied
// into dist/ so they ship in the package (package.json "files" includes dist/).
// loader.js resolves defaultConfig.toml relative to its own module dir.
await copyFile('src/config/defaultConfig.toml', 'dist/defaultConfig.toml')

const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['bin/lazyhub.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  // Code splitting: bin/lazyhub.js dynamic-imports each command, so non-TUI
  // commands never load the ink/react/highlight.js chunks (#302).
  outdir: 'dist',
  splitting: true,
  // Chunks sit beside the entry: loader.js resolves dist/defaultConfig.toml
  // relative to its own module dir.
  chunkNames: '[name]-[hash]',
  loader: { '.js': 'jsx', '.jsx': 'jsx' },
  packages: 'external',          // leave node_modules as-is
  banner: { js: '#!/usr/bin/env node' },
  logLevel: 'info',
})

if (watch) {
  await ctx.watch()
  console.log('Watching for changes…')
} else {
  await ctx.rebuild()
  await ctx.dispose()
}
