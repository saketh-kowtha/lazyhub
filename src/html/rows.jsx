/**
 * src/html/rows.jsx - HTML segment -> Ink rows, in the same row shape getMarkdownRows returns.
 *
 * Colours come only from the theme tokens passed in (`t`); style keys from layout.js are mapped here.
 * A render error never blanks a body: callers catch and fall back to plain text.
 */
/* eslint-disable no-unused-vars */
import React from 'react'
import { Box, Text } from 'ink'
/* eslint-enable no-unused-vars */
import { parseSegment } from './parse.js'
import { layout, textWidth } from './layout.js'
import { defaultBase } from './url.js'

/**
 * Cut every line to `width` columns (a last guard for tiny panes; normal layout already fits).
 * @param {Array<{runs: Array<{text: string, st?: object}>}>} lines
 * @param {number} width
 * @returns {Array<{runs: Array<{text: string, st?: object}>}>}
 */
export function clampLines(lines, width) {
  return lines.map(line => {
    let used = 0
    for (const r of line.runs) used += textWidth(r.text)
    if (used <= width) return line
    const runs = []
    let left = width
    for (const r of line.runs) {
      if (left <= 0) break
      let text = ''
      for (const ch of r.text) {
        const cw = textWidth(ch)
        if (cw > left) { left = 0; break }
        text += ch
        left -= cw
      }
      if (text) runs.push({ text, st: r.st })
    }
    return { runs }
  })
}

/**
 * Theme props for a style: keys map to tokens, never to literal colours.
 * @param {object | undefined} st
 * @param {any} t theme
 * @returns {object}
 */
function styleProps(st, t) {
  if (!st) return {}
  const props = { bold: st.b, italic: st.i, underline: st.u, strikethrough: st.s }
  switch (st.c) {
    case 'dim': props.color = t.ui?.dim; break
    case 'muted': props.color = t.ui?.muted; break
    case 'sel': props.color = t.ui?.selected; break
    case 'border': props.color = t.ui?.border ?? t.ui?.dim; break
    case 'code': props.color = t.ci?.pending; props.backgroundColor = t.ui?.headerBg; break
    case 'block': props.backgroundColor = t.ui?.headerBg; break
    case 'mark': props.color = t.ci?.pending; props.inverse = true; break
    default: break
  }
  return props
}

/**
 * @param {Array<{runs: Array<{text: string, st?: object}>}>} lines
 * @param {any} t theme
 * @param {string} key key prefix, unique per segment
 * @returns {Array<import('react').ReactElement>}
 */
export function linesToRows(lines, t, key) {
  return lines.map((line, i) => {
    if (line.runs.length === 0) return <Box key={`${key}-${i}`} height={1} />
    return (
      <Box key={`${key}-${i}`} paddingX={1}>
        <Text wrap="truncate">
          {mergeRuns(line.runs).map((r, j) => <Text key={j} {...styleProps(r.st, t)}>{r.text}</Text>)}
        </Text>
      </Box>
    )
  })
}

/**
 * Join neighbouring runs that share a style (and the plain spaces between words) into one run:
 * far fewer elements per row.
 * @param {Array<{text: string, st?: object}>} runs
 * @returns {Array<{text: string, st?: object}>}
 */
function mergeRuns(runs) {
  const out = []
  for (const r of runs) {
    const last = out[out.length - 1]
    if (last && (r.st === last.st || (r.text === ' ' && !r.st) || sameStyle(r.st, last.st))) last.text += r.text
    else out.push({ text: r.text, st: r.st })
  }
  return out
}

function sameStyle(a, b) {
  if (a === b) return true
  if (!a || !b) return false
  return a.b === b.b && a.i === b.i && a.u === b.u && a.s === b.s && a.c === b.c
}

/**
 * Render one HTML segment (an HTML block or an inline-HTML paragraph line).
 * @param {string} src undecoded segment text
 * @param {{width: number, t: any, key: string, budget: import('./types.js').Budget, md?: boolean, carry?: string[], base?: string, prefix?: object, st0?: object, upper?: boolean}} opts
 * @returns {{rows: Array<import('react').ReactElement>, carryOut: string[]}}
 */
export function renderHtmlSegment(src, opts) {
  const { children, carryOut } = parseSegment(src, { budget: opts.budget, md: opts.md, carry: opts.carry })
  const lead = opts.prefix ? textWidth(opts.prefix.first.map(r => r.text).join('')) : 0
  const width = Math.max(1, opts.width - lead)
  let lines = layout(children, { width, base: opts.base ?? defaultBase(), md: !!opts.md, st0: opts.st0 ?? {} })
  if (opts.upper) lines = lines.map(l => ({ runs: l.runs.map(r => (r.st?.c === 'dim' ? r : { ...r, text: r.text.toUpperCase() })) }))
  if (opts.prefix) {
    lines = lines.map((l, i) => ({ runs: [...(i === 0 ? opts.prefix.first : opts.prefix.rest), ...l.runs] }))
  }
  return { rows: linesToRows(clampLines(lines, opts.width), opts.t, opts.key), carryOut }
}
