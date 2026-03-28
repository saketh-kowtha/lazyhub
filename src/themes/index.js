// Re-exports all built-in themes and the canonical name list.
// Useful for a future theme picker UI or external tooling.
export { default as githubDark }      from './github-dark.js'
export { default as githubLight }     from './github-light.js'
export { default as catppuccinMocha } from './catppuccin-mocha.js'
export { default as catppuccinLatte } from './catppuccin-latte.js'
export { default as tokyoNight }      from './tokyo-night.js'
export const THEME_NAMES = ['github-dark', 'github-light', 'catppuccin-mocha', 'catppuccin-latte', 'tokyo-night']
