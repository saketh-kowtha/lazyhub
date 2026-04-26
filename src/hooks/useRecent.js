/**
 * useRecent.js — persist recently viewed items to ~/.config/lazyhub/recent.json
 * Max 10 entries per type. Entries: { type: 'pr'|'issue', repo, number, title, updatedAt }
 */

import { useState, useCallback, useEffect } from 'react'
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const RECENT_FILE = join(homedir(), '.config', 'lazyhub', 'recent.json')
const MAX_ENTRIES = 10

function loadRecent() {
  try {
    if (!existsSync(RECENT_FILE)) return []
    return JSON.parse(readFileSync(RECENT_FILE, 'utf8')) || []
  } catch { return [] }
}

function saveRecent(entries) {
  try {
    const dir = join(homedir(), '.config', 'lazyhub')
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
    writeFileSync(RECENT_FILE, JSON.stringify(entries, null, 2), 'utf8')
  } catch {}
}

export function useRecent(type = 'pr') {
  const [entries, setEntries] = useState(() => loadRecent().filter(e => e.type === type))

  const addRecent = useCallback((item) => {
    setEntries(prev => {
      // Remove duplicate, prepend new entry, cap at MAX_ENTRIES
      const deduped = prev.filter(e => !(e.repo === item.repo && e.number === item.number))
      const next = [{ type, ...item }, ...deduped].slice(0, MAX_ENTRIES)
      // Persist all types (not just current type)
      const all = loadRecent().filter(e => e.type !== type)
      saveRecent([...next, ...all])
      return next
    })
  }, [type])

  const clearRecent = useCallback(() => {
    setEntries([])
    const all = loadRecent().filter(e => e.type !== type)
    saveRecent(all)
  }, [type])

  return { entries, addRecent, clearRecent }
}
