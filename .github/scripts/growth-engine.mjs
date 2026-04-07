/**
 * growth-engine.mjs
 * Generates README.md and docs/index.html for lazyhub.
 *
 * Architecture:
 *   - ALL factual content (keybindings, features, config, themes) is LOCKED
 *     in this script, derived directly from the source code. It never varies.
 *   - Gemini ONLY writes marketing/creative copy: taglines, hero text,
 *     feature descriptions, why-section prose. Pure text, no structure.
 *   - This guarantees a stunning, detailed, consistent page every run.
 *
 * Env vars: GEMINI_API_KEY, REPO
 */

import { GoogleGenerativeAI } from "@google/generative-ai"
import { writeFileSync } from 'fs'

const { GEMINI_API_KEY, REPO } = process.env

// ─── LOCKED FACTUAL DATA (from source) ────────────────────────────────────────
// These never change unless the source code changes.

const KEYBINDINGS = {
  navigation: [
    { key: 'j / ↓',        action: 'Move cursor down' },
    { key: 'k / ↑',        action: 'Move cursor up' },
    { key: 'gg',           action: 'Jump to top' },
    { key: 'G',            action: 'Jump to bottom' },
    { key: 'Tab',          action: 'Next pane' },
    { key: 'Shift+Tab',    action: 'Previous pane' },
    { key: 'r',            action: 'Refresh current pane' },
    { key: '?',            action: 'Toggle help overlay' },
    { key: 'q / Esc',      action: 'Go back / quit' },
    { key: 'S',            action: 'Open settings' },
    { key: 'L',            action: 'Open logs viewer' },
  ],
  pullRequests: [
    { key: 'Enter',        action: 'Open PR detail' },
    { key: 'd',            action: 'Open diff viewer' },
    { key: 'm',            action: 'Merge PR' },
    { key: 'M',            action: 'Toggle auto-merge' },
    { key: 'l',            action: 'Manage labels' },
    { key: 'A',            action: 'Manage assignees' },
    { key: '/',            action: 'Fuzzy search PRs' },
    { key: 'O',            action: 'Filter: open' },
    { key: 'C',            action: 'Filter: closed' },
    { key: 'n',            action: 'Create new PR' },
  ],
  issues: [
    { key: 'Enter',        action: 'Open issue detail' },
    { key: 'n',            action: 'Create new issue' },
    { key: 'x',            action: 'Close issue' },
    { key: 'y',            action: 'Copy issue URL' },
    { key: 'f',            action: 'Cycle filter (open → closed)' },
    { key: '/',            action: 'Fuzzy search issues' },
  ],
  diff: [
    { key: 'j / k',        action: 'Scroll down / up' },
    { key: '] / [',        action: 'Next / previous changed file' },
    { key: 't',            action: 'Toggle file tree' },
    { key: '/',            action: 'Find in diff' },
    { key: 'n / N',        action: 'Next / previous match' },
    { key: 'c',            action: 'Add inline comment' },
    { key: 'e',            action: 'Edit comment' },
    { key: 'A',            action: 'Approve PR' },
    { key: 'o',            action: 'Open file on GitHub' },
    { key: 'r',            action: 'Request changes' },
  ],
  branches: [
    { key: 'Enter / Space', action: 'Checkout branch' },
    { key: 'D',            action: 'Delete branch' },
    { key: 'p',            action: 'Push current branch' },
    { key: '/',            action: 'Fuzzy search branches' },
  ],
  actions: [
    { key: 'Enter / l',    action: 'View workflow logs' },
    { key: 'R',            action: 'Re-run failed jobs' },
    { key: 'X',            action: 'Cancel workflow run' },
  ],
  notifications: [
    { key: 'Enter',        action: 'Open notification target' },
    { key: 'm',            action: 'Mark as read' },
    { key: 'M',            action: 'Mark all as read' },
    { key: '/',            action: 'Fuzzy search' },
  ],
}

const FEATURES = [
  {
    icon: '⚡',
    title: 'Keyboard-Driven Workflow',
    description: 'Every action is one keystroke away. Navigate PRs, issues, branches, and CI runs without ever touching the mouse. vim-style j/k movement, fuzzy search, and instant filters.',
  },
  {
    icon: '🤖',
    title: 'AI Code Review',
    description: 'Built-in AI reviewer analyses diffs and surfaces issues, suggestions, and security concerns inline — powered by Anthropic Claude. No context switching, no copy-pasting.',
  },
  {
    icon: '🔀',
    title: 'Pull Request Management',
    description: 'Full PR lifecycle in the terminal: merge (merge/squash/rebase), auto-merge, labels, assignees, reviewers, inline comments, and approval — all without leaving your shell.',
  },
  {
    icon: '📊',
    title: 'Live CI/CD Dashboard',
    description: 'Watch GitHub Actions runs in real time. Stream logs, re-run failed jobs, and cancel stuck runs. The same view you get in the browser, at terminal speed.',
  },
  {
    icon: '🌿',
    title: 'Branch Operations',
    description: 'List, search, checkout, push, and delete branches in seconds. See which branches have open PRs, stale status, and more — all in one scrollable list.',
  },
  {
    icon: '🔍',
    title: 'Fuzzy Search Everywhere',
    description: 'Instant fuzzy search on every pane — PRs, issues, branches, notifications. Type to filter, arrow to select. No waiting, no page reloads.',
  },
  {
    icon: '🎨',
    title: '5 Built-in Themes',
    description: 'Ships with GitHub Dark, GitHub Light, Catppuccin Mocha, Catppuccin Latte, and Tokyo Night. Or bring your own theme via a JSON file with deep per-key overrides.',
  },
  {
    icon: '🧩',
    title: 'Custom Panes',
    description: 'Define your own panes in config.json using any `gh api` command. Deployments, releases, discussions, environment status — if the GitHub API returns it, you can pane it.',
  },
  {
    icon: '📬',
    title: 'Notifications Center',
    description: 'Triage GitHub notifications without leaving the terminal. Jump directly to the referenced PR or issue, mark read, mark all read, and filter by type.',
  },
  {
    icon: '📝',
    title: 'Inline Diff Commenting',
    description: 'Read diffs with syntax highlighting, jump between changed files, search within a diff, and leave inline review comments — all from a single keystroke-driven view.',
  },
]

const THEMES = [
  { name: 'github-dark',       label: 'GitHub Dark',       default: true,  palette: ['#0d1117', '#161b22', '#58a6ff', '#3fb950', '#e6edf3'] },
  { name: 'github-light',      label: 'GitHub Light',      default: false, palette: ['#ffffff', '#f6f8fa', '#0969da', '#1a7f37', '#24292f'] },
  { name: 'catppuccin-mocha',  label: 'Catppuccin Mocha',  default: false, palette: ['#1e1e2e', '#313244', '#89b4fa', '#a6e3a1', '#cdd6f4'] },
  { name: 'catppuccin-latte',  label: 'Catppuccin Latte',  default: false, palette: ['#eff1f5', '#e6e9ef', '#1e66f5', '#40a02b', '#4c4f69'] },
  { name: 'tokyo-night',       label: 'Tokyo Night',       default: false, palette: ['#1a1b26', '#24283b', '#7aa2f7', '#9ece6a', '#c0caf5'] },
]

const CONFIG_FIELDS = [
  { field: 'panes',          type: 'string[]',  default: '["prs","issues","branches","actions","notifications"]', desc: 'Which panes to show and in what order' },
  { field: 'defaultPane',    type: 'string',    default: '"prs"',           desc: 'Pane to open on launch' },
  { field: 'theme',          type: 'string',    default: '"github-dark"',   desc: 'Built-in theme name, path to JSON, or override object' },
  { field: 'pr.defaultFilter',  type: 'string', default: '"open"',          desc: '"open" | "closed" | "merged"' },
  { field: 'pr.defaultScope',   type: 'string', default: '"all"',           desc: '"all" | "own" | "reviewing"' },
  { field: 'pr.pageSize',       type: 'number', default: '100',             desc: 'Max PRs to fetch per load' },
  { field: 'issues.pageSize',   type: 'number', default: '50',              desc: 'Max issues to fetch per load' },
  { field: 'diff.defaultView',  type: 'string', default: '"unified"',       desc: '"unified" | "split"' },
  { field: 'diff.syntaxHighlight', type: 'boolean', default: 'true',        desc: 'Syntax highlighting in diff viewer' },
  { field: 'diff.maxLines',     type: 'number', default: '2000',            desc: 'Max diff lines before truncation warning' },
  { field: 'customPanes',    type: 'object',    default: '{}',              desc: 'Define custom panes with any gh api command' },
  { field: 'aiReviewEnabled', type: 'boolean',  default: 'true',            desc: 'Enable/disable AI code review pane' },
]

// ─── HTML template ─────────────────────────────────────────────────────────────

function buildHtml(copy) {
  const kbSections = Object.entries(KEYBINDINGS)

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>lazyhub — ${copy.tagline}</title>
  <meta name="description" content="${copy.meta_description}" />
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    :root {
      --bg:        #0d1117;
      --surface:   #161b22;
      --surface2:  #1c2128;
      --border:    #30363d;
      --accent:    #58a6ff;
      --green:     #3fb950;
      --orange:    #e3b341;
      --purple:    #bc8cff;
      --red:       #f85149;
      --text:      #e6edf3;
      --muted:     #8b949e;
      --font:      'Segoe UI', system-ui, -apple-system, sans-serif;
      --mono:      'Cascadia Code', 'Fira Code', 'JetBrains Mono', monospace;
      --radius:    10px;
      --glow:      0 0 20px rgba(88,166,255,0.15);
    }
    html { scroll-behavior: smooth; }
    body { background: var(--bg); color: var(--text); font-family: var(--font); line-height: 1.6; overflow-x: hidden; }
    a { color: var(--accent); text-decoration: none; }
    a:hover { text-decoration: underline; }

    /* ── Nav ── */
    nav {
      display: flex; align-items: center; justify-content: space-between;
      padding: 0.9rem 2rem; border-bottom: 1px solid var(--border);
      position: sticky; top: 0; background: rgba(13,17,23,0.92);
      backdrop-filter: blur(12px); z-index: 100;
    }
    .nav-logo { font-weight: 800; font-size: 1.05rem; color: var(--text); letter-spacing: -0.01em; }
    .nav-logo span { color: var(--accent); }
    .nav-links { display: flex; gap: 1.8rem; font-size: 0.88rem; }
    .nav-links a { color: var(--muted); transition: color .15s; }
    .nav-links a:hover { color: var(--text); text-decoration: none; }
    .nav-badge {
      background: var(--surface); border: 1px solid var(--border); border-radius: 20px;
      padding: 0.25rem 0.8rem; font-size: 0.78rem; color: var(--muted);
    }

    /* ── Hero ── */
    .hero {
      text-align: center; padding: 6rem 2rem 5rem; max-width: 860px;
      margin: 0 auto; position: relative;
    }
    .hero::before {
      content: ''; position: absolute; top: 0; left: 50%; transform: translateX(-50%);
      width: 600px; height: 300px;
      background: radial-gradient(ellipse at center, rgba(88,166,255,0.08) 0%, transparent 70%);
      pointer-events: none;
    }
    .hero-badges { display: flex; gap: 0.5rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2rem; }
    .badge {
      display: inline-flex; align-items: center; gap: 0.4rem;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: 20px; padding: 0.25rem 0.75rem; font-size: 0.78rem; color: var(--muted);
    }
    .badge-dot { width: 6px; height: 6px; border-radius: 50%; background: var(--green); }
    .hero h1 {
      font-size: clamp(2.4rem, 5.5vw, 4rem); font-weight: 800; line-height: 1.1;
      margin-bottom: 1.4rem; letter-spacing: -0.03em;
    }
    .hero h1 .accent { color: var(--accent); }
    .hero h1 .dim { color: var(--muted); }
    .hero-sub {
      font-size: 1.2rem; color: var(--muted); max-width: 640px;
      margin: 0 auto 0.75rem; line-height: 1.7;
    }
    .hero-sub2 {
      font-size: 1rem; color: var(--muted); max-width: 560px;
      margin: 0 auto 2.5rem; opacity: 0.7;
    }
    .cta-group { display: flex; gap: 0.8rem; justify-content: center; flex-wrap: wrap; margin-bottom: 2.5rem; }
    .btn {
      padding: 0.7rem 1.6rem; border-radius: var(--radius); font-size: 0.95rem;
      font-weight: 600; cursor: pointer; border: none; transition: all .15s; display: inline-flex; align-items: center; gap: 0.4rem;
    }
    .btn-primary { background: var(--accent); color: #000; box-shadow: 0 0 20px rgba(88,166,255,0.25); }
    .btn-primary:hover { opacity: 0.9; box-shadow: 0 0 30px rgba(88,166,255,0.4); text-decoration: none; }
    .btn-secondary { background: var(--surface); color: var(--text); border: 1px solid var(--border); }
    .btn-secondary:hover { border-color: var(--muted); text-decoration: none; }
    .install-strip {
      display: inline-flex; align-items: center; gap: 1rem;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 0.7rem 1.2rem;
      font-family: var(--mono); font-size: 0.9rem; color: var(--green);
    }
    .install-strip .label { font-family: var(--font); font-size: 0.75rem; color: var(--muted); }

    /* ── Terminal demo ── */
    .terminal-wrap { max-width: 860px; margin: 3rem auto 0; padding: 0 2rem; }
    .terminal {
      background: #010409; border: 1px solid var(--border); border-radius: 12px;
      overflow: hidden; box-shadow: 0 24px 64px rgba(0,0,0,0.6), var(--glow);
    }
    .terminal-bar {
      background: var(--surface); padding: 0.6rem 1rem;
      display: flex; align-items: center; gap: 0.5rem; border-bottom: 1px solid var(--border);
    }
    .dot { width: 12px; height: 12px; border-radius: 50%; }
    .dot-red { background: #ff5f57; } .dot-yellow { background: #febc2e; } .dot-green { background: #28c840; }
    .terminal-title { font-size: 0.8rem; color: var(--muted); margin: 0 auto; }
    .terminal-body { padding: 0; font-family: var(--mono); font-size: 0.82rem; line-height: 1.5; }
    .terminal-body pre { padding: 1.2rem 1.4rem; overflow-x: auto; color: #e6edf3; }
    .t-dim    { color: #484f58; }
    .t-green  { color: #3fb950; }
    .t-blue   { color: #58a6ff; }
    .t-purple { color: #bc8cff; }
    .t-orange { color: #e3b341; }
    .t-red    { color: #f85149; }
    .t-bold   { font-weight: 700; }

    /* ── Sections ── */
    .section { max-width: 1080px; margin: 0 auto; padding: 5rem 2rem; }
    .section-header { margin-bottom: 3rem; }
    .section-header h2 { font-size: 2rem; font-weight: 800; letter-spacing: -0.02em; margin-bottom: 0.5rem; }
    .section-header p { color: var(--muted); font-size: 1.05rem; max-width: 560px; }
    .section-label {
      display: inline-block; font-size: 0.75rem; font-weight: 600; letter-spacing: 0.08em;
      text-transform: uppercase; color: var(--accent); margin-bottom: 0.75rem;
    }

    /* ── Features grid ── */
    .features-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1rem; }
    .feature-card {
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 1.5rem; transition: border-color .2s, box-shadow .2s;
    }
    .feature-card:hover { border-color: rgba(88,166,255,0.4); box-shadow: var(--glow); }
    .feature-icon { font-size: 1.6rem; margin-bottom: 0.75rem; }
    .feature-card h3 { font-size: 0.95rem; font-weight: 700; margin-bottom: 0.5rem; }
    .feature-card p { font-size: 0.88rem; color: var(--muted); line-height: 1.6; }

    /* ── Keybindings ── */
    .kb-section { background: var(--surface2); border-top: 1px solid var(--border); border-bottom: 1px solid var(--border); }
    .kb-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(300px, 1fr)); gap: 1.5rem; }
    .kb-group h3 {
      font-size: 0.72rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.1em;
      color: var(--muted); margin-bottom: 0.75rem; padding-bottom: 0.4rem;
      border-bottom: 1px solid var(--border);
    }
    .kb-row { display: flex; align-items: baseline; justify-content: space-between; padding: 0.3rem 0; gap: 1rem; }
    .kb-row:not(:last-child) { border-bottom: 1px solid rgba(48,54,61,0.5); }
    kbd {
      background: var(--bg); border: 1px solid var(--border); border-bottom: 2px solid var(--border);
      border-radius: 5px; padding: 0.15rem 0.5rem; font-family: var(--mono); font-size: 0.78rem;
      color: var(--accent); white-space: nowrap; flex-shrink: 0;
    }
    .kb-desc { font-size: 0.83rem; color: var(--muted); text-align: right; }

    /* ── Themes ── */
    .themes-grid { display: flex; gap: 1rem; flex-wrap: wrap; }
    .theme-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 1.2rem; flex: 1; min-width: 160px; transition: border-color .2s;
    }
    .theme-card.active { border-color: var(--accent); }
    .theme-palette { display: flex; gap: 4px; margin-bottom: 0.75rem; }
    .swatch { width: 18px; height: 18px; border-radius: 50%; border: 1px solid rgba(255,255,255,0.1); }
    .theme-card h4 { font-size: 0.85rem; font-weight: 600; margin-bottom: 0.2rem; }
    .theme-card code { font-family: var(--mono); font-size: 0.75rem; color: var(--muted); }

    /* ── Config table ── */
    .config-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; }
    .config-table th {
      text-align: left; padding: 0.6rem 1rem; background: var(--surface2);
      border-bottom: 2px solid var(--border); color: var(--muted);
      font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em;
    }
    .config-table td { padding: 0.7rem 1rem; border-bottom: 1px solid var(--border); vertical-align: top; }
    .config-table tr:last-child td { border-bottom: none; }
    .config-table tr:hover td { background: rgba(255,255,255,0.02); }
    .config-table .field { font-family: var(--mono); color: var(--accent); font-size: 0.82rem; }
    .config-table .type  { font-family: var(--mono); color: var(--purple); font-size: 0.8rem; }
    .config-table .def   { font-family: var(--mono); color: var(--green);  font-size: 0.8rem; }
    .config-table .desc  { color: var(--muted); }
    .table-wrap { border: 1px solid var(--border); border-radius: var(--radius); overflow: hidden; }

    /* ── Custom pane example ── */
    .code-block {
      background: #010409; border: 1px solid var(--border); border-radius: var(--radius);
      padding: 1.4rem; font-family: var(--mono); font-size: 0.83rem; line-height: 1.7;
      overflow-x: auto;
    }
    .code-block .k { color: var(--purple); }
    .code-block .s { color: var(--orange); }
    .code-block .c { color: #484f58; }

    /* ── Install steps ── */
    .install-section { text-align: center; }
    .install-steps { display: flex; flex-direction: column; gap: 0.8rem; max-width: 520px; margin: 2.5rem auto 0; }
    .step {
      display: flex; align-items: center; gap: 1rem;
      background: var(--surface); border: 1px solid var(--border);
      border-radius: var(--radius); padding: 0.9rem 1.2rem; text-align: left;
    }
    .step-num {
      background: var(--accent); color: #000; border-radius: 50%;
      width: 26px; height: 26px; display: flex; align-items: center;
      justify-content: center; font-size: 0.75rem; font-weight: 800; flex-shrink: 0;
    }
    .step-body { flex: 1; }
    .step code { font-family: var(--mono); font-size: 0.88rem; color: var(--green); }
    .step span { font-size: 0.85rem; color: var(--muted); }
    .step small { display: block; font-size: 0.75rem; color: var(--muted); margin-top: 0.2rem; }

    /* ── Why section ── */
    .why-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 3rem; align-items: start; }
    .why-prose p { color: var(--muted); line-height: 1.8; margin-bottom: 1rem; }
    .why-prose p:last-child { margin-bottom: 0; }
    .stat-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .stat-card {
      background: var(--surface); border: 1px solid var(--border); border-radius: var(--radius);
      padding: 1.2rem; text-align: center;
    }
    .stat-num { font-size: 2rem; font-weight: 800; color: var(--accent); letter-spacing: -0.03em; }
    .stat-label { font-size: 0.8rem; color: var(--muted); margin-top: 0.2rem; }

    /* ── Footer ── */
    footer {
      text-align: center; padding: 3rem 2rem; border-top: 1px solid var(--border);
      font-size: 0.85rem; color: var(--muted);
    }
    footer .footer-links { display: flex; gap: 1.5rem; justify-content: center; margin-top: 0.75rem; }
    footer .footer-links a { color: var(--muted); font-size: 0.83rem; }
    footer .footer-links a:hover { color: var(--text); text-decoration: none; }

    /* ── Divider ── */
    .divider { border: none; border-top: 1px solid var(--border); margin: 0; }

    @media (max-width: 768px) {
      .hero h1 { font-size: 2.2rem; }
      .nav-links { display: none; }
      .why-grid { grid-template-columns: 1fr; }
      .kb-grid { grid-template-columns: 1fr; }
      .features-grid { grid-template-columns: 1fr; }
    }
  </style>
</head>
<body>

<!-- ── Nav ────────────────────────────────────────────────────────────────── -->
<nav>
  <span class="nav-logo">⚡ <span>lazyhub</span></span>
  <div class="nav-links">
    <a href="#features">Features</a>
    <a href="#demo">Demo</a>
    <a href="#keybindings">Keybindings</a>
    <a href="#themes">Themes</a>
    <a href="#config">Config</a>
    <a href="#install">Install</a>
    <a href="https://github.com/${REPO}" target="_blank">GitHub ↗</a>
  </div>
  <span class="nav-badge">MIT · Open Source</span>
</nav>

<!-- ── Hero ───────────────────────────────────────────────────────────────── -->
<div class="hero">
  <div class="hero-badges">
    <span class="badge"><span class="badge-dot"></span> Active Development</span>
    <span class="badge">Node.js · React · Ink</span>
    <span class="badge">GitHub CLI powered</span>
  </div>
  <h1>${copy.hero_headline_html}</h1>
  <p class="hero-sub">${copy.hero_sub}</p>
  <p class="hero-sub2">${copy.hero_sub2}</p>
  <div class="cta-group">
    <a class="btn btn-primary" href="#install">Get Started →</a>
    <a class="btn btn-secondary" href="https://github.com/${REPO}" target="_blank">⭐ Star on GitHub</a>
    <a class="btn btn-secondary" href="#demo">See It In Action</a>
  </div>
  <div class="install-strip">
    <span class="label">QUICK INSTALL</span>
    <span>npm install -g lazyhub</span>
  </div>
</div>

<!-- ── Terminal demo ──────────────────────────────────────────────────────── -->
<div class="terminal-wrap" id="demo">
  <div class="terminal">
    <div class="terminal-bar">
      <div class="dot dot-red"></div>
      <div class="dot dot-yellow"></div>
      <div class="dot dot-green"></div>
      <span class="terminal-title">lazyhub — saketh-kowtha/lazyhub</span>
    </div>
    <div class="terminal-body"><pre>
<span class="t-dim">┌─────────────────────────────────────────────────────────────────────────────┐</span>
<span class="t-dim">│</span> <span class="t-blue t-bold">⚡ lazyhub</span>  <span class="t-dim">saketh-kowtha/lazyhub</span>                    <span class="t-dim">[?] help  [q] quit</span>    <span class="t-dim">│</span>
<span class="t-dim">├──────────┬──────────┬──────────┬──────────┬──────────────────────────────────┤</span>
<span class="t-dim">│</span> <span class="t-blue t-bold">● PRs</span>    <span class="t-dim">│ Issues   │ Branches │ Actions  │ Notifications</span>                    <span class="t-dim">│</span>
<span class="t-dim">├──────────┴──────────┴──────────┴──────────┴──────────────────────────────────┤</span>
<span class="t-dim">│</span>                                                                              <span class="t-dim">│</span>
<span class="t-dim">│</span>  <span class="t-green">▶</span> <span class="t-bold">#42  feat: AI code review pane with inline comments</span>    <span class="t-orange">• review</span>  <span class="t-dim">2h ago</span>  <span class="t-dim">│</span>
<span class="t-dim">│</span>    <span class="t-bold">#41  fix: fuzzy search debounce on large repos</span>          <span class="t-green">✓ clean</span>  <span class="t-dim">4h ago</span>  <span class="t-dim">│</span>
<span class="t-dim">│</span>    <span class="t-bold">#40  feat: custom pane support + config schema</span>          <span class="t-green">✓ clean</span>  <span class="t-dim">1d ago</span>  <span class="t-dim">│</span>
<span class="t-dim">│</span>    <span class="t-bold">#39  chore: catppuccin theme variants</span>                   <span class="t-green">✓ clean</span>  <span class="t-dim">2d ago</span>  <span class="t-dim">│</span>
<span class="t-dim">│</span>    <span class="t-bold">#38  fix: tokyo-night contrast improvements</span>             <span class="t-green">✓ clean</span>  <span class="t-dim">3d ago</span>  <span class="t-dim">│</span>
<span class="t-dim">│</span>    <span class="t-bold">#37  feat: diff split view mode</span>                        <span class="t-dim">● draft</span>  <span class="t-dim">4d ago</span>  <span class="t-dim">│</span>
<span class="t-dim">│</span>                                                                              <span class="t-dim">│</span>
<span class="t-dim">├──────────────────────────────────────────────────────────────────────────────┤</span>
<span class="t-dim">│</span> <span class="t-dim">[j/k] navigate  [Enter] open  [d] diff  [m] merge  [/] search  [r] refresh</span>  <span class="t-dim">│</span>
<span class="t-dim">└──────────────────────────────────────────────────────────────────────────────┘</span>
</pre></div>
  </div>
</div>

<!-- ── Why section ────────────────────────────────────────────────────────── -->
<section class="section" id="why">
  <div class="why-grid">
    <div class="why-prose">
      <span class="section-label">Why lazyhub?</span>
      <h2 style="font-size:1.8rem;font-weight:800;letter-spacing:-0.02em;margin-bottom:1.5rem;">${copy.why_heading}</h2>
      ${copy.why_paragraphs.map(p => `<p>${p}</p>`).join('\n      ')}
    </div>
    <div class="stat-grid">
      <div class="stat-card">
        <div class="stat-num">5</div>
        <div class="stat-label">Built-in Panes</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">40+</div>
        <div class="stat-label">Keybindings</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">5</div>
        <div class="stat-label">Themes</div>
      </div>
      <div class="stat-card">
        <div class="stat-num">∞</div>
        <div class="stat-label">Custom Panes</div>
      </div>
    </div>
  </div>
</section>

<hr class="divider" />

<!-- ── Features ───────────────────────────────────────────────────────────── -->
<section class="section" id="features">
  <div class="section-header">
    <span class="section-label">Features</span>
    <h2>${copy.features_heading}</h2>
    <p>${copy.features_sub}</p>
  </div>
  <div class="features-grid">
    ${FEATURES.map(f => `
    <div class="feature-card">
      <div class="feature-icon">${f.icon}</div>
      <h3>${f.title}</h3>
      <p>${f.description}</p>
    </div>`).join('')}
  </div>
</section>

<hr class="divider" />

<!-- ── Keybindings ────────────────────────────────────────────────────────── -->
<section class="section kb-section" id="keybindings">
  <div class="section-header">
    <span class="section-label">Keybindings</span>
    <h2>${copy.kb_heading}</h2>
    <p>${copy.kb_sub}</p>
  </div>
  <div class="kb-grid">
    ${kbSections.map(([group, keys]) => `
    <div class="kb-group">
      <h3>${group.replace(/([A-Z])/g, ' $1').trim()}</h3>
      ${keys.map(k => `
      <div class="kb-row">
        <kbd>${k.key}</kbd>
        <span class="kb-desc">${k.action}</span>
      </div>`).join('')}
    </div>`).join('')}
  </div>
</section>

<hr class="divider" />

<!-- ── Themes ─────────────────────────────────────────────────────────────── -->
<section class="section" id="themes">
  <div class="section-header">
    <span class="section-label">Themes</span>
    <h2>${copy.themes_heading}</h2>
    <p>${copy.themes_sub}</p>
  </div>
  <div class="themes-grid">
    ${THEMES.map(th => `
    <div class="theme-card${th.default ? ' active' : ''}">
      <div class="theme-palette">
        ${th.palette.map(c => `<div class="swatch" style="background:${c}"></div>`).join('')}
      </div>
      <h4>${th.label}${th.default ? ' <span style="color:var(--accent);font-size:0.7rem">default</span>' : ''}</h4>
      <code>"${th.name}"</code>
    </div>`).join('')}
  </div>
  <div style="margin-top:1.5rem;">
    <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem;">Set in <code style="font-family:var(--mono);color:var(--accent)">~/.config/lazyhub/config.json</code>:</p>
    <div class="code-block">
      <span class="c">// Built-in theme</span><br>
      <span class="k">"theme"</span>: <span class="s">"catppuccin-mocha"</span><br><br>
      <span class="c">// Custom JSON file</span><br>
      <span class="k">"theme"</span>: <span class="s">"~/my-theme.json"</span><br><br>
      <span class="c">// Named theme + per-key overrides</span><br>
      <span class="k">"theme"</span>: { <span class="k">"name"</span>: <span class="s">"tokyo-night"</span>, <span class="k">"overrides"</span>: { <span class="k">"ui"</span>: { <span class="k">"selected"</span>: <span class="s">"#ff9900"</span> } } }
    </div>
  </div>
</section>

<hr class="divider" />

<!-- ── Config reference ───────────────────────────────────────────────────── -->
<section class="section" id="config">
  <div class="section-header">
    <span class="section-label">Configuration</span>
    <h2>${copy.config_heading}</h2>
    <p>${copy.config_sub}</p>
  </div>
  <div class="table-wrap">
    <table class="config-table">
      <thead>
        <tr>
          <th>Field</th>
          <th>Type</th>
          <th>Default</th>
          <th>Description</th>
        </tr>
      </thead>
      <tbody>
        ${CONFIG_FIELDS.map(f => `
        <tr>
          <td class="field">${f.field}</td>
          <td class="type">${f.type}</td>
          <td class="def">${f.default}</td>
          <td class="desc">${f.desc}</td>
        </tr>`).join('')}
      </tbody>
    </table>
  </div>

  <div style="margin-top:2.5rem;">
    <h3 style="font-size:1.1rem;font-weight:700;margin-bottom:1rem;">Custom Pane Example</h3>
    <p style="color:var(--muted);font-size:0.9rem;margin-bottom:1rem;">
      Add any <code style="font-family:var(--mono);color:var(--accent)">gh api</code> endpoint as a first-class pane.
      The command must return a JSON array; recommended fields are <code style="font-family:var(--mono);color:var(--orange)">title</code>,
      <code style="font-family:var(--mono);color:var(--orange)">number</code>, <code style="font-family:var(--mono);color:var(--orange)">state</code>,
      <code style="font-family:var(--mono);color:var(--orange)">updatedAt</code>, <code style="font-family:var(--mono);color:var(--orange)">url</code>.
    </p>
    <div class="code-block">
<span class="c">// ~/.config/lazyhub/config.json</span>
{
  <span class="k">"panes"</span>: [<span class="s">"prs"</span>, <span class="s">"issues"</span>, <span class="s">"deployments"</span>],
  <span class="k">"customPanes"</span>: {
    <span class="k">"deployments"</span>: {
      <span class="k">"label"</span>: <span class="s">"Deployments"</span>,
      <span class="k">"icon"</span>:  <span class="s">"▶"</span>,
      <span class="k">"command"</span>: <span class="s">"gh api repos/{repo}/deployments --jq '[.[] | {title:.environment,number:.id,state:.task,updatedAt:.created_at,url:.url}]'"</span>,
      <span class="k">"actions"</span>: { <span class="k">"o"</span>: <span class="s">"open"</span> }
    }
  }
}</div>
  </div>
</section>

<hr class="divider" />

<!-- ── Install ────────────────────────────────────────────────────────────── -->
<section class="section install-section" id="install">
  <div class="section-header" style="text-align:center">
    <span class="section-label">Get Started</span>
    <h2>${copy.install_heading}</h2>
    <p style="margin:0 auto">${copy.install_sub}</p>
  </div>
  <div class="install-steps">
    <div class="step">
      <div class="step-num">1</div>
      <div class="step-body">
        <code>npm install -g lazyhub</code>
        <small>Requires Node.js 18+ and the <a href="https://cli.github.com" target="_blank">gh CLI</a> authenticated</small>
      </div>
    </div>
    <div class="step">
      <div class="step-num">2</div>
      <div class="step-body">
        <code>gh auth login</code>
        <small>Authenticate the GitHub CLI if you haven't already</small>
      </div>
    </div>
    <div class="step">
      <div class="step-num">3</div>
      <div class="step-body">
        <code>lazyhub</code>
        <small>Run from any directory — lazyhub detects the current repo automatically</small>
      </div>
    </div>
    <div class="step">
      <div class="step-num">4</div>
      <div class="step-body">
        <span>Press <kbd>?</kbd> inside lazyhub to see all keybindings</span>
      </div>
    </div>
  </div>

  <div style="margin-top:2rem;text-align:center;">
    <p style="color:var(--muted);font-size:0.9rem;margin-bottom:0.5rem;">Also available via Homebrew:</p>
    <div class="install-strip" style="display:inline-flex">
      <span class="label">HOMEBREW</span>
      <span>brew install saketh-kowtha/tap/lazyhub</span>
    </div>
  </div>
</section>

<!-- ── Footer ─────────────────────────────────────────────────────────────── -->
<footer>
  <div>Built with ❤️ by <a href="https://github.com/saketh-kowtha" target="_blank">saketh-kowtha</a></div>
  <div class="footer-links">
    <a href="https://github.com/${REPO}" target="_blank">GitHub</a>
    <a href="https://github.com/${REPO}/issues" target="_blank">Issues</a>
    <a href="https://github.com/${REPO}/blob/main/CHANGELOG.md" target="_blank">Changelog</a>
    <a href="https://www.npmjs.com/package/lazyhub" target="_blank">npm</a>
    <a href="https://github.com/${REPO}/blob/main/LICENSE" target="_blank">MIT License</a>
  </div>
</footer>

</body>
</html>`
}

// ─── README template ────────────────────────────────────────────────────────

function buildReadme(copy) {
  const repoUrl = `https://github.com/${REPO}`
  const kbTable = Object.entries(KEYBINDINGS).map(([group, keys]) => {
    const header = group.replace(/([A-Z])/g, ' $1').trim()
    const rows = keys.map(k => `| \`${k.key}\` | ${k.action} |`).join('\n')
    return `### ${header}\n\n| Key | Action |\n|-----|--------|\n${rows}`
  }).join('\n\n')

  return `# ⚡ lazyhub

> ${copy.tagline}

[![npm version](https://img.shields.io/npm/v/lazyhub?color=3fb950&label=npm)](https://www.npmjs.com/package/lazyhub)
[![license](https://img.shields.io/github/license/saketh-kowtha/lazyhub?color=58a6ff)](${repoUrl}/blob/main/LICENSE)
[![stars](https://img.shields.io/github/stars/saketh-kowtha/lazyhub?color=f0c040)](${repoUrl}/stargazers)

${copy.why_paragraphs.join('\n\n')}

## ✨ Features

${FEATURES.map(f => `- **${f.title}** — ${f.description}`).join('\n')}

## 🚀 Installation

\`\`\`bash
npm install -g lazyhub
\`\`\`

Or via Homebrew:

\`\`\`bash
brew install saketh-kowtha/tap/lazyhub
\`\`\`

Requires Node.js 18+ and the [gh CLI](https://cli.github.com) authenticated with \`gh auth login\`.

## 🎯 Usage

\`\`\`bash
lazyhub
\`\`\`

Run from any git repo. lazyhub auto-detects the current GitHub repository.
Press \`?\` inside to see all keybindings.

## ⌨️ Keybindings

${kbTable}

## 🎨 Themes

Set in \`~/.config/lazyhub/config.json\`:

\`\`\`json
{ "theme": "catppuccin-mocha" }
\`\`\`

Available themes: \`github-dark\` (default), \`github-light\`, \`catppuccin-mocha\`, \`catppuccin-latte\`, \`tokyo-night\`.

You can also point to a custom JSON file or use per-key overrides:

\`\`\`json
{ "theme": { "name": "tokyo-night", "overrides": { "ui": { "selected": "#ff9900" } } } }
\`\`\`

## ⚙️ Configuration

Config file: \`~/.config/lazyhub/config.json\`

\`\`\`json
{
  "panes": ["prs", "issues", "branches", "actions", "notifications"],
  "defaultPane": "prs",
  "theme": "github-dark",
  "pr": { "defaultFilter": "open", "defaultScope": "all", "pageSize": 100 },
  "issues": { "defaultFilter": "open", "pageSize": 50 },
  "diff": { "defaultView": "unified", "syntaxHighlight": true, "maxLines": 2000 },
  "customPanes": {
    "deployments": {
      "label": "Deployments",
      "icon": "▶",
      "command": "gh api repos/{repo}/deployments --jq '[.[] | {title:.environment,number:.id,state:.task,updatedAt:.created_at,url:.url}]'"
    }
  }
}
\`\`\`

## 🏗️ Architecture

\`\`\`mermaid
graph LR
  UI[React/Ink UI] --> Hook[useGh Hook]
  Hook --> Executor[executor.js]
  Executor --> GH[gh CLI]
  GH --> API[GitHub API]
\`\`\`

## 📄 License

MIT © [saketh-kowtha](https://github.com/saketh-kowtha)
`
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  if (!GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY is not set.')
    process.exit(1)
  }

  const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
  const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" })

  // Ask Gemini ONLY for creative marketing copy — all factual content is locked above.
  const PROMPT = `You are writing marketing copy for **lazyhub** — a lazygit-style GitHub TUI built with React/Ink.
It lets developers manage PRs, issues, branches, Actions runs, and notifications entirely from the terminal using vim-style keybindings.

Return ONLY a JSON object (no markdown fences, no explanation) with exactly this schema:

{
  "tagline": "one punchy sentence that captures the essence — what it is and why it matters",
  "meta_description": "SEO meta description, 150 chars max",
  "hero_headline_html": "punchy 5-9 word headline for the hero — use <span class=\\"accent\\">lazyhub</span> for the product name and optionally <span class=\\"dim\\">word</span> for contrast",
  "hero_sub": "1-2 sentence expansion — speak to the developer who is tired of switching contexts between terminal and browser",
  "hero_sub2": "1 sentence social proof or secondary hook — shorter and punchier than hero_sub",
  "why_heading": "3-5 word section heading for the 'why lazyhub' section",
  "why_paragraphs": [
    "paragraph 1 — the problem: context-switching between terminal and GitHub web UI breaks flow",
    "paragraph 2 — the solution: every GitHub action from the terminal, no mouse required",
    "paragraph 3 — who it's for: engineers who live in the terminal, love vim, want speed"
  ],
  "features_heading": "short heading for features section (e.g. 'Everything you need, nothing you don\\'t')",
  "features_sub": "one supporting line for the features section",
  "kb_heading": "short heading for keybindings section",
  "kb_sub": "one line — convey that all keybindings are discoverable with ? and fully configurable",
  "themes_heading": "short heading for themes section",
  "themes_sub": "one line — convey built-in themes + full customisation",
  "config_heading": "short heading for config reference section",
  "config_sub": "one line — convey that config is a single JSON file with sane defaults",
  "install_heading": "short heading for install section",
  "install_sub": "one line — convey it is a single npm install away"
}

Write for senior developers. Be direct, confident, and specific. Avoid buzzwords like 'seamless', 'supercharge', 'revolutionize'. No em-dashes in headings.`

  console.log('Generating marketing copy with Gemini...')
  const result = await model.generateContent(PROMPT)
  const text = result.response.text().trim()

  let copy
  try {
    const jsonStr = text.replace(/^```json\s*/i, '').replace(/```\s*$/, '').trim()
    copy = JSON.parse(jsonStr)
  } catch (err) {
    console.error('Failed to parse Gemini JSON:', err.message)
    console.error('Raw:', text.slice(0, 500))
    process.exit(1)
  }

  writeFileSync('README.md', buildReadme(copy))
  console.log('✓ README.md updated.')

  writeFileSync('docs/index.html', buildHtml(copy))
  console.log('✓ docs/index.html updated.')
}

run().catch(err => {
  console.error('Growth Engine Fatal Error:', err)
  process.exit(1)
})
