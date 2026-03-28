#!/usr/bin/env node
if (process.argv.includes('--mouse')) {
  process.env.GHUI_MOUSE = '1'
}

import { bootstrap } from '../src/bootstrap.js'
import { renderApp } from '../src/app.jsx'

await bootstrap(renderApp)
