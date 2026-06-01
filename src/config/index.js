/**
 * config/index.js — React context for the TOML user-config layer (issue #130).
 *
 * Phase E1 ships the plumbing only: `<ConfigProvider>` loads and exposes the
 * merged config, and `useConfig()` reads it — but no feature consumes it yet
 * (keymaps E3 #132, settings writes E2 #131, custom tabs E4 #66, etc.).
 *
 * The provider loads the local config synchronously for first render. If
 * `[meta].config_url` is set, it fetches the remote config once (HTTPS-only,
 * cached, fallback-on-failure) and merges it on top — "remote wins".
 */

import React, { createContext, useContext, useState, useEffect, useMemo, useCallback } from 'react'
import { loadConfig, fetchRemoteConfig } from './loader.js'
import { writeConfig } from './writer.js'
import { DEFAULT_CONFIG, validateConfig, mergeConfig } from './schema.js'

export const ConfigContext = createContext({ ...DEFAULT_CONFIG, write: () => DEFAULT_CONFIG })

/**
 * Provides the merged user config to the React tree.
 * @param {Object} props
 * @param {import('react').ReactNode} props.children child tree
 * @param {Object} [props.initialConfig] preloaded config (mainly for tests); skips loadConfig()
 * @returns {import('react').ReactElement} provider element
 */
export function ConfigProvider({ children, initialConfig }) {
  const [config, setConfig] = useState(() => initialConfig ?? loadConfig())

  const configUrl = config?.meta?.config_url

  useEffect(() => {
    if (!configUrl) return
    let cancelled = false
    fetchRemoteConfig(configUrl)
      .then((remoteRaw) => {
        if (cancelled || !remoteRaw) return
        const { config: validated } = validateConfig(remoteRaw)
        setConfig((prev) => mergeConfig(prev, validated))
      })
      .catch(() => { /* fetchRemoteConfig already handles + logs failures */ })
    return () => { cancelled = true }
  }, [configUrl])

  const write = useCallback((patch) => {
    writeConfig(patch)
    const next = loadConfig()
    setConfig(next)
    return next
  }, [])

  const value = useMemo(() => ({ ...config, write }), [config, write])

  return React.createElement(ConfigContext.Provider, { value }, children)
}

/**
 * Read the merged user config.
 * @returns {Object} the current config object
 */
export function useConfig() {
  return useContext(ConfigContext)
}
