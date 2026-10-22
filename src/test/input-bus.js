// Shared keyboard plumbing for e2e tests that mock ink's useInput (#291).
//
// The mocked useInput registers its handler in a passive effect, so the handler
// set only reflects the current screen once React has committed AND flushed
// effects. Sending the next key on a timer can therefore hit the previous
// screen's handler. `send` runs inside React's act(), which drains scheduled
// renders and passive effects before resolving, so a key is never delivered to a
// stale handler -- no sleeps involved.
import { act } from 'react'

const handlers = new Set()

/**
 * Build a drop-in useInput replacement that registers handlers on the shared bus.
 * @param {object} React the React module (passed in because vi.mock factories import it lazily)
 * @returns {(handler: Function) => void} mocked useInput
 */
export function mockUseInput(React) {
  return (handler) => {
    React.useEffect(() => {
      handlers.add(handler)
      return () => handlers.delete(handler)
    }, [handler])
  }
}

/**
 * Deliver one key to every registered handler, then let React settle.
 * @param {string} [input] character input
 * @param {object} [key] ink key flags
 * @returns {Promise<void>} resolves after render and passive effects flush
 */
export async function sendInput(input = '', key = {}) {
  // Scope the act environment to key delivery so unrelated async updates in a
  // test don't emit "not wrapped in act" warnings.
  globalThis.IS_REACT_ACT_ENVIRONMENT = true
  try {
    await act(async () => {
      for (const handler of [...handlers]) handler(input, key)
    })
  } finally {
    globalThis.IS_REACT_ACT_ENVIRONMENT = false
  }
}
