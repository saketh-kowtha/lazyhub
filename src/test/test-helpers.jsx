import React from 'react'
import { render, cleanup } from 'ink-testing-library'
import { AppContext } from '../context.js'
import { ConfigProvider } from '../config/index.js'
import { KeyScopeProvider } from '../keyscope.js'
import { ThemeProvider as LegacyThemeProvider } from '../theme.js'
import { ThemeProvider as SchemeThemeProvider } from '../theme/index.js'

const defaultAppContext = {
  notifyDialog: () => {},
  openHelp: () => {},
  openAI: () => {},
  setMouseEnabled: () => {},
  addToast: () => {},
  paneStateMap: new Map(),
}

export function renderWithProviders(ui, {
  appContext = {},
  config = undefined,
  legacyTheme = 'github-dark',
  schemeTheme = 'lazyhub-dark',
} = {}) {
  return render(
    <ConfigProvider initialConfig={config}>
      <LegacyThemeProvider initialTheme={legacyTheme}>
        <SchemeThemeProvider initialScheme={schemeTheme}>
          <KeyScopeProvider>
            <AppContext.Provider value={{ ...defaultAppContext, ...appContext }}>
              {ui}
            </AppContext.Provider>
          </KeyScopeProvider>
        </SchemeThemeProvider>
      </LegacyThemeProvider>
    </ConfigProvider>
  )
}

export async function flush(ms = 0) {
  await new Promise(resolve => setTimeout(resolve, ms))
}

export async function waitForExpectation(assertion, {
  timeout = 1500,
  interval = 25,
} = {}) {
  const deadline = Date.now() + timeout
  let lastError

  while (Date.now() < deadline) {
    try {
      assertion()
      return
    } catch (error) {
      lastError = error
      await flush(interval)
    }
  }

  throw lastError
}

/**
 * Resolve once Ink's real useInput can see the screen currently on display.
 * Ink re-subscribes its handler in a passive effect after every commit, so a frame
 * being visible does not mean the matching handler is attached. React schedules
 * those effects with setImmediate, so hopping the immediate queue after the frame
 * is observed drains them (FIFO) -- no wall-clock sleep involved.
 * @param {object} view the ink-testing-library render result
 * @returns {Promise<void>} resolves once input handlers match the latest commit
 */
export async function waitForInputReady(view) {
  await waitForExpectation(() => {
    if (view.stdin.listenerCount('readable') === 0) throw new Error('Ink input handler not attached yet')
  })
  for (let i = 0; i < 2; i += 1) await new Promise(resolve => setImmediate(resolve))
}

export { cleanup }
