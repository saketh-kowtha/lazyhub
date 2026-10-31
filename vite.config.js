import { defineConfig } from 'vitest/config'
import { transformWithOxc } from 'vite'
import react from '@vitejs/plugin-react'

// Vite 8 (used by vitest 4) uses oxc which doesn't handle JSX in .js files by default.
// This pre-plugin transforms JSX in src/*.js files before oxc sees them.
const jsxInJsPlugin = {
  name: 'jsx-in-js',
  enforce: 'pre',
  transform(code, id) {
    if (id.endsWith('.js') && /src\//.test(id) && /<[A-Z/]|<[a-z]+[\s/>]/.test(code)) {
      return transformWithOxc(code, id, { lang: 'jsx', jsx: { runtime: 'automatic' } })
    }
  },
}

export default defineConfig({
  plugins: [jsxInJsPlugin, react()],
  test: {
    environment: 'node',
    globalSetup: ['src/test/global-guard.js', 'src/test/global-build.js'],
    setupFiles: ['src/test/setup-hermetic.js'],
    include: ['src/**/*.{test,spec}.{jsx,js}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'json', 'html'],
      reportsDirectory: 'coverage',
      reportOnFailure: true,
      all: true,
      include: ['src/**/*.{js,jsx}'],
      exclude: [
        'src/**/*.{test,spec}.{js,jsx}',
        'src/test/**',
        'src/features/prs/list-view.jsx',
        'node_modules/**',
        'bin/**',
        'integrations/nvim/**',
      ],
      // #283: src/cli/** and src/daemon/server.js are measured (no blanket exclusions).
      // Floors sit under the measured baseline with CI/platform margin (CI measured cli branches 81.7 vs 84.8 locally) (72.2/73.8/72.1/72.2 overall;
      // cli 89.5/84.8/88.5/89.5; daemon 86.1/84.6/86.2/86.1). Never lower them.
      thresholds: {
        statements: 69,
        branches: 70,
        functions: 69,
        lines: 69,
        'src/cli/**': { statements: 85, branches: 78, functions: 84, lines: 85 },
        'src/daemon/**': { statements: 82, branches: 78, functions: 82, lines: 82 },
      },
    },
  },
})
