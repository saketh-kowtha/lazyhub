#!/usr/bin/env node
/**
 * Build script — transpiles JSX and resolves imports into dist/lazyhub.js
 * using esbuild. node_modules are kept as external (not bundled).
 */
import * as esbuild from 'esbuild'
import { mkdir } from 'fs/promises'

await mkdir('dist', { recursive: true })

const watch = process.argv.includes('--watch')

const ctx = await esbuild.context({
  entryPoints: ['bin/lazyhub.js'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist/lazyhub.js',
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
