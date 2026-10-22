#!/usr/bin/env node
/**
 * Build script — transpiles JSX and resolves imports into dist/lazyhub.js
 * using esbuild. Runtime dependencies are bundled into dist/ so the published
 * package has no `dependencies` and users run exactly the audited build (#282).
 */
import * as esbuild from 'esbuild'
import { mkdir, copyFile, rm, readFile, writeFile, readdir } from 'fs/promises'
import { join } from 'path'

// Chunk filenames are content-hashed; drop stale ones so they never ship in the package.
await rm('dist', { recursive: true, force: true })
await mkdir('dist', { recursive: true })

// Non-JS assets read at runtime via fs (not bundled by esbuild) must be copied
// into dist/ so they ship in the package (package.json "files" includes dist/).
// loader.js resolves defaultConfig.toml relative to its own module dir.
await copyFile('src/config/defaultConfig.toml', 'dist/defaultConfig.toml')
// Ink's layout engine loads yoga.wasm via createRequire(import.meta.url).resolve('./yoga.wasm'),
// i.e. beside the bundled chunk that contains yoga-wasm-web/dist/node.js (all chunks sit in dist/).
await copyFile('node_modules/yoga-wasm-web/dist/yoga.wasm', 'dist/yoga.wasm')

// ink only loads build/devtools.js (and its optional react-devtools-core peer,
// plus the ws stack) when DEV=true. The peer is not installed, so replace that
// file with a stub that fails like a missing module; ink's catch then prints its
// own "install react-devtools-core" hint instead of bundling dead weight.
const stubInkDevtools = {
  name: 'stub-ink-devtools',
  setup(build) {
    build.onLoad({ filter: /node_modules[\\/]ink[\\/]build[\\/]devtools\.js$/ }, () => ({
      contents: `throw Object.assign(new Error("Cannot find module 'react-devtools-core'"), { code: 'MODULE_NOT_FOUND' })`,
      loader: 'js',
    }))
  },
}

/**
 * Bundled dependency code is redistributed in dist/, so ship each package's
 * license text with it (MIT/ISC/BSD require the notice to travel with the code).
 * @param {import('esbuild').Metafile} metafile
 */
async function writeThirdPartyLicenses(metafile) {
  const roots = new Set()
  for (const input of Object.keys(metafile.inputs)) {
    const m = input.match(/^(.*node_modules\/(?:@[^/]+\/)?[^/]+)\//)
    if (m) roots.add(m[1])
  }
  const entries = []
  for (const root of [...roots].sort()) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const files = await readdir(root)
    const licenseFile = files.find(f => /^(licen[sc]e|copying)(\.|$)/i.test(f))
    const text = licenseFile ? (await readFile(join(root, licenseFile), 'utf8')).trim() : `License: ${pkg.license ?? 'UNKNOWN'} (no license file shipped by the package)`
    entries.push(`${pkg.name}@${pkg.version} (${pkg.license ?? 'UNKNOWN'})\n\n${text}`)
  }
  const header = 'Third-party software bundled into lazyhub (dist/*.js).\n'
  await writeFile(join('dist', 'THIRD_PARTY_LICENSES'), `${header}\n${entries.join('\n\n' + '-'.repeat(72) + '\n\n')}\n`)
}

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
  plugins: [stubInkDevtools],
  // Bundled CommonJS dependencies (ws-style `require('fs')`) go through esbuild's
  // __require shim, which needs a real `require` in ESM output.
  banner: {
    js: "#!/usr/bin/env node\nimport { createRequire as __lazyhubCreateRequire } from 'node:module'\nconst require = __lazyhubCreateRequire(import.meta.url)",
  },
  metafile: true,
  logLevel: 'info',
})

if (watch) {
  await ctx.watch()
  console.log('Watching for changes…')
} else {
  const { metafile } = await ctx.rebuild()
  await ctx.dispose()
  await writeThirdPartyLicenses(metafile)
}
