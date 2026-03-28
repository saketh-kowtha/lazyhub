#!/usr/bin/env node
import { bootstrap } from '../src/bootstrap.js'
import { renderApp } from '../src/app.jsx'

await bootstrap(renderApp)
