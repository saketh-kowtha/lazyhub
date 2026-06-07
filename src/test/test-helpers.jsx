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

export function pressEnter(stdin) {
  stdin.write('\r')
}

export function pressEscape(stdin) {
  stdin.write('\u001B')
}

export function pressLeft(stdin) {
  stdin.write('\u001B[D')
}

export { cleanup }
