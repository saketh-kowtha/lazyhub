/**
 * src/theme/index.js — compatibility re-export. There is one theme system: src/theme.js (`t.*`).
 * This file only keeps the old import path alive for callers that have not moved (the PR list dialogs).
 */
export { useTheme, ThemeProvider } from '../theme.js'
