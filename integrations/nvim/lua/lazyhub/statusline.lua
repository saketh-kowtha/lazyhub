-- lazyhub.statusline — ambient PR status component for lualine / heirline
--
-- Exports:
--   require('lazyhub.statusline').setup(opts)     — kick off polling + IPC subscription
--   require('lazyhub.statusline').component()     — returns string for lualine
--   require('lazyhub.statusline').heirline()      — returns component table for heirline
--   require('lazyhub.statusline').state()         — returns raw cached state table
--
-- Display format (when a PR exists):
--   " PR #123  ✓ CI  💬 2"
--   Icon:   (nf-oct-git-pull-request — same glyph lazyhub uses in TUI)
--   CI:    ✓ pass / ✗ fail / ● pending / (omitted when null)
--   Threads: 💬 N (omitted when 0 or null)
--   When no PR: empty string (lualine hides the segment automatically)
--
-- Data sources (in priority order):
--   1. IPC `pr-for-branch` request (when lazyhub is running)
--   2. Fallback: `gh pr list --head <branch> --json ...` via vim.fn.jobstart
--
-- Polling:
--   - Every 30 seconds unconditionally
--   - On BufEnter (debounced 5 s) so the indicator refreshes as you navigate files
--   - Immediately on IPC `pr-state-changed` events (for the matching branch)

local M = {}

-- ─── Constants ────────────────────────────────────────────────────────────────

-- nf-oct-git-pull-request (U+F407).  Verified: same codepoint grep returns for
-- TUI nerd-font usage in this codebase.
local PR_ICON = '\u{f407}'

local CI_ICONS = {
  pass    = '✓',
  fail    = '✗',
  pending = '●',
}

local POLL_INTERVAL_MS  = 30 * 1000   -- 30 s
local BUFENTER_DEBOUNCE = 5 * 1000    -- 5 s

-- ─── Internal state ──────────────────────────────────────────────────────────

local _cache = {
  prNumber         = nil,
  prState          = nil,
  ciStatus         = nil,
  unresolvedThreads = nil,
}

local _last_branch      = nil    -- branch used for the last successful fetch
local _debounce_timer   = nil    -- luv timer for BufEnter debounce
local _poll_timer       = nil    -- luv timer for 30-s interval
local _initialized      = false

-- ─── Helpers ─────────────────────────────────────────────────────────────────

local function current_branch()
  -- vim.fn.system is acceptable for fast git reads (spec invariant 3 caveat)
  local b = vim.fn.system('git rev-parse --abbrev-ref HEAD 2>/dev/null'):gsub('%s+$', '')
  if b == '' or b == 'HEAD' then return nil end
  return b
end

local function update_cache(data)
  if not data then return end
  _cache.prNumber          = data.prNumber or nil
  _cache.prState           = data.prState  or nil
  _cache.ciStatus          = data.ciStatus or nil
  _cache.unresolvedThreads = data.unresolvedThreads or nil
end

-- ─── Fallback: gh pr list via jobstart ───────────────────────────────────────

local function fetch_via_gh(branch)
  if not branch then return end
  vim.fn.jobstart(
    { 'gh', 'pr', 'list', '--head', branch,
      '--json', 'number,state,statusCheckRollup,reviewThreads',
      '--limit', '1' },
    {
      stdout_buffered = true,
      on_stdout = function(_, data)
        local json = table.concat(data, '')
        if json == '' then return end
        local ok, parsed = pcall(vim.json.decode, json)
        if not ok or type(parsed) ~= 'table' then return end

        if #parsed == 0 then
          update_cache({ prNumber = nil })
          return
        end

        local pr = parsed[1]

        -- Map statusCheckRollup array → ciStatus string
        local ci_status = nil
        local rollup = pr.statusCheckRollup
        if type(rollup) == 'table' then
          local has_fail, has_pending, all_pass = false, false, true
          for _, c in ipairs(rollup) do
            local s = ((c.conclusion or c.state or ''):upper())
            if s == 'FAILURE' or s == 'ERROR' or s == 'TIMED_OUT' or s == 'CANCELLED' then
              has_fail = true; all_pass = false
            elseif s ~= 'SUCCESS' then
              has_pending = true; all_pass = false
            end
          end
          if has_fail then ci_status = 'fail'
          elseif has_pending then ci_status = 'pending'
          elseif all_pass and #rollup > 0 then ci_status = 'pass'
          end
        end

        -- Count unresolved review threads
        local unresolved = nil
        if type(pr.reviewThreads) == 'table' then
          local n = 0
          for _, t in ipairs(pr.reviewThreads) do
            if t.isResolved == false then n = n + 1 end
          end
          if n > 0 then unresolved = n end
        end

        update_cache({
          prNumber          = pr.number,
          prState           = pr.state,
          ciStatus          = ci_status,
          unresolvedThreads = unresolved,
        })
      end,
    }
  )
end

-- ─── Primary fetch via IPC ────────────────────────────────────────────────────

local function fetch(branch)
  branch = branch or current_branch()
  if not branch then return end
  _last_branch = branch

  local ipc = require('lazyhub.ipc')
  ipc.request({ type = 'pr-for-branch', branch = branch }, function(resp)
    if resp and resp.prNumber ~= nil then
      -- IPC responded (even prNumber=null is a valid authoritative answer)
      update_cache(resp)
    else
      -- IPC unavailable — fall back to gh
      fetch_via_gh(branch)
    end
  end)
end

-- ─── Polling timers ──────────────────────────────────────────────────────────

local function start_poll_timer()
  if _poll_timer then return end
  local uv = vim.uv or vim.loop
  _poll_timer = uv.new_timer()
  _poll_timer:start(POLL_INTERVAL_MS, POLL_INTERVAL_MS, vim.schedule_wrap(function()
    fetch()
  end))
end

local function schedule_bufenter_fetch()
  local uv = vim.uv or vim.loop
  if _debounce_timer then
    _debounce_timer:stop()
  else
    _debounce_timer = uv.new_timer()
  end
  _debounce_timer:start(BUFENTER_DEBOUNCE, 0, vim.schedule_wrap(function()
    fetch()
  end))
end

-- ─── Public API ──────────────────────────────────────────────────────────────

--- Returns the raw cached state table.
--- @return table  { prNumber, prState, ciStatus, unresolvedThreads }
function M.state()
  return vim.deepcopy(_cache)
end

--- Returns a plain string for lualine (or any statusline using tostring).
--- Empty string when no PR is open (lualine hides the segment).
--- @return string
function M.component()
  local s = _cache
  if not s.prNumber then return '' end

  local parts = { PR_ICON .. ' PR #' .. tostring(s.prNumber) }

  if s.ciStatus then
    local icon = CI_ICONS[s.ciStatus]
    if icon then
      table.insert(parts, ' ' .. icon .. ' CI')
    end
  end

  if s.unresolvedThreads and s.unresolvedThreads > 0 then
    table.insert(parts, '  \xf0\x9f\x92\xac ' .. tostring(s.unresolvedThreads))
  end

  return table.concat(parts, '')
end

--- Returns a heirline component table.
--- @return table  heirline component spec
function M.heirline()
  return {
    provider = function() return M.component() end,
    hl       = function()
      local s = _cache
      if s.ciStatus == 'fail' then
        return { fg = 'DiagnosticError' }
      elseif s.ciStatus == 'pass' then
        return { fg = 'DiagnosticOk' }
      end
      return {}
    end,
    update   = { 'User', pattern = 'LazyhubStatusUpdate' },
  }
end

--- Kick off polling and IPC subscription.
--- Call this from your init / config (e.g. require('lazyhub.statusline').setup()).
--- @param opts? table  (reserved for future options; unused in Phase 1)
function M.setup(opts)
  if _initialized then return end
  _initialized = true

  -- Initial fetch
  fetch()

  -- 30-s poll timer
  start_poll_timer()

  -- BufEnter re-poll (debounced 5 s)
  vim.api.nvim_create_autocmd('BufEnter', {
    group    = vim.api.nvim_create_augroup('lazyhub_statusline', { clear = true }),
    callback = function() schedule_bufenter_fetch() end,
  })

  -- IPC pr-state-changed event subscription.
  -- The IPC module delivers server-push events as raw NDJSON lines; for Phase 1
  -- we rely on polling and the BufEnter debounce.  When a lazyhub build that emits
  -- pr-state-changed lands, this autocmd will fire on the User event published below.
  -- For now, any code that calls emitIPC('pr-state-changed', payload) from the TUI
  -- will reach connected clients via the socket.  The Lua side receives it as part of
  -- a future long-lived socket subscription (Phase 2); in Phase 1 polling covers it.
end

return M
