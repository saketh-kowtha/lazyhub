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
    include: ['src/**/*.{test,spec}.{jsx,js}'],
  },
})
