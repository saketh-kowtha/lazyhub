/**
 * src/context.js — shared React contexts
 * Kept separate from app.jsx so feature components don't create
 * circular imports by reaching back into the root layout module.
 */

import { createContext, useContext } from 'react'

export const AppContext = createContext({ notifyDialog: () => {}, openHelp: () => {} })

export function useAppContext() {
  return useContext(AppContext)
}
