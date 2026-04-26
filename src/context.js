/**
 * src/context.js — shared React contexts
 * Kept separate from app.jsx so feature components don't create
 * circular imports by reaching back into the root layout module.
 */

import { createContext } from 'react'

export const AppContext = createContext({
  notifyDialog: () => {},
  openHelp: () => {},
  openAI: () => {},
  setMouseEnabled: () => {},
  addToast: null,       // (opts) => {} — adds a toast to the notification stack
  paneStateMap: null,   // Map<paneId, stateObject> — set by App
})
