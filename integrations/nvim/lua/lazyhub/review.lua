-- lazyhub.review — Inline PR review overlay (Phase 2)
--
-- Shows PR review comments as virtual text on the lines they annotate.
-- Only activates after an explicit :LazyHubReview or <leader>grr — never auto-attaches.
--
-- Public API:
--   M.setup(opts)      — one-time init: highlight groups, Plug mappings, autocmds
--   M.attach()         — :LazyHubReview — fetch + render for current PR/branch
--   M.detach()         — :LazyHubReviewDetach — clear all extmarks/signs in all buffers
--   M.refresh()        — :LazyHubReviewRefresh — re-fetch + re-render
--   M.reply()          — <Plug>(lazyhub-review-reply)
--   M.resolve()        — <Plug>(lazyhub-review-resolve)
--   M.next_comment()   — <Plug>(lazyhub-review-next) / ]r
--   M.prev_comment()   — <Plug>(lazyhub-review-prev) / [r
--
-- Namespace: lazyhub.review  (dedicated; never shared with lazyhub diagnostics)
-- Invariants:
--   1. All gh calls use vim.fn.jobstart({'gh',...}) — never shell strings
--   2. Degrades gracefully when lazyhub IPC is unavailable (falls back to gh api)
--   3. No blocking calls (no vim.fn.system for slow ops)
--   4. Never auto-attaches to new PRs — only re-renders PRs already attached

local M = {}

-- ─── Namespace & state ────────────────────────────────────────────────────────

-- Extmark namespace — dedicated per spec §3.2 / Phase 2 invariants
local _ns = vim.api.nvim_create_namespace('lazyhub.review')

-- Per-PR attachment state
-- _state.active_pr    = prNumber (number) | nil   — the PR we are currently displaying
-- _state.comments     = list of comment objects fetched from IPC / gh
-- _state.extmarks     = map of extmark_id -> comment (one per extmark)
-- _state.buf_extmarks = map of bufnr -> list of extmark_ids placed in that buffer
local _state = {
  active_pr    = nil,
  comments     = {},
  extmarks     = {},
  buf_extmarks = {},
}

-- Sign group name
local SIGN_GROUP = 'lazyhub_review'
-- Sign name
local SIGN_NAME  = 'LazyhubReviewSign'

-- ─── Helpers ─────────────────────────────────────────────────────────────────

local function _ipc()
  -- ipc.lua lives in the Phase 1 tree; loaded lazily so Phase 2 can be parsed
  -- standalone without erroring when Phase 1 isn't present (e.g. headless smoke test)
  return require('lazyhub.ipc')
end

--- Truncate a string to max_len, appending "…" if truncated.
local function _truncate(s, max_len)
  if not s then return '' end
  if #s <= max_len then return s end
  return s:sub(1, max_len - 1) .. '\xe2\x80\xa6' -- …
end

--- Build the virtual text chunks for a comment.
--- Returns a list of {text, hl_group} pairs suitable for nvim_buf_set_extmark virt_text.
local function _virt_text(comment, win_width)
  local max_w   = math.max(10, (win_width or 80) - 4)
  local hl      = comment.resolved and 'LazyhubReviewResolved' or 'LazyhubReviewComment'
  local hl_auth = comment.resolved and 'LazyhubReviewResolved' or 'LazyhubReviewAuthor'
  local user    = comment.user or 'reviewer'
  local prefix  = '\xe2\x96\x8e @' .. user .. ': '  -- ▎ @user:
  local body    = (comment.body or ''):gsub('\n', ' ')
  local content = _truncate(prefix .. body, max_w)
  return { { content, hl } }, hl_auth
end

--- Return all loaded buffers whose name ends with `path` (relative path from PR root).
local function _bufs_for_path(path)
  if not path or path == '' then return {} end
  local result = {}
  for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
    if vim.api.nvim_buf_is_loaded(bufnr) then
      local name = vim.api.nvim_buf_get_name(bufnr)
      -- Match if the buffer path ends with the comment's relative path
      if name ~= '' and (name:sub(-#path) == path or name:find('/' .. path .. '$', 1, true)) then
        table.insert(result, bufnr)
      end
    end
  end
  return result
end

--- Return the 0-based line index for an extmark placement.
--- GitHub line numbers are 1-based; nvim is 0-based.
local function _line0(comment)
  local l = comment.line
  if not l or l < 1 then return 0 end
  return l - 1
end

--- Get current window width (capped at 200 for safety).
local function _win_width()
  local ok, w = pcall(vim.api.nvim_win_get_width, 0)
  if ok and w and w > 0 then return math.min(w, 200) end
  return 80
end

-- ─── Sign column ─────────────────────────────────────────────────────────────

local _signs_defined = false
local function _ensure_signs()
  if _signs_defined then return end
  _signs_defined = true
  -- nvim 0.10+ uses vim.fn.sign_define; still works on 0.9
  vim.fn.sign_define(SIGN_NAME, { text = '\xe2\x96\x88', texthl = 'LazyhubReviewSign' })  -- █
end

local function _place_sign(bufnr, line1)
  _ensure_signs()
  pcall(vim.fn.sign_place, 0, SIGN_GROUP, SIGN_NAME, bufnr, { lnum = line1, priority = 10 })
end

local function _unplace_signs(bufnr)
  pcall(vim.fn.sign_unplace, SIGN_GROUP, { buffer = bufnr })
end

-- ─── Extmark management ───────────────────────────────────────────────────────

--- Place extmarks for `comments` into `bufnr`.
--- Groups comments by line, stacks multiple comments on the same line as virt_lines.
local function _render_buf(bufnr, comments)
  -- Remove existing extmarks from this buffer
  vim.api.nvim_buf_clear_namespace(bufnr, _ns, 0, -1)
  _unplace_signs(bufnr)
  _state.buf_extmarks[bufnr] = {}

  -- Group comments by line (0-based)
  local by_line = {}
  for _, c in ipairs(comments) do
    local ln = _line0(c)
    by_line[ln] = by_line[ln] or {}
    table.insert(by_line[ln], c)
  end

  local w = _win_width()
  for ln, line_comments in pairs(by_line) do
    -- First comment: inline virtual text (virt_text)
    local first = line_comments[1]
    local vt, _ = _virt_text(first, w)

    -- Additional comments on the same line: virtual lines below
    local virt_lines = {}
    for i = 2, #line_comments do
      local vt_extra, _ = _virt_text(line_comments[i], w)
      table.insert(virt_lines, vt_extra)
    end

    local ok, eid = pcall(vim.api.nvim_buf_set_extmark, bufnr, _ns, ln, 0, {
      virt_text          = vt,
      virt_text_pos      = 'eol',
      virt_lines         = #virt_lines > 0 and virt_lines or nil,
      virt_lines_above   = false,
      hl_mode            = 'combine',
    })
    if ok then
      -- Map extmark_id -> first comment on this line (for reply/resolve lookup)
      _state.extmarks[eid]              = first
      _state.extmarks[eid]._line_group  = line_comments
      table.insert(_state.buf_extmarks[bufnr], eid)
    end

    -- Sign column
    _place_sign(bufnr, ln + 1)  -- sign_place uses 1-based lines
  end
end

-- ─── Fetch comments ──────────────────────────────────────────────────────────

--- Parse a comment array fetched from gh api (REST /pulls/{n}/comments).
--- Shapes it to match the IPC response format.
local function _parse_rest_comments(raw, thread_map)
  -- thread_map: optional, databaseId -> { threadId, isResolved } from a prior GraphQL call
  -- For the fallback gh api path we don't have thread info — best effort.
  thread_map = thread_map or {}
  local out = {}
  for _, c in ipairs(raw or {}) do
    local thread_info = thread_map[tostring(c.id)] or {}
    table.insert(out, {
      id       = c.id,
      threadId = thread_info.threadId or tostring(c.id),
      path     = c.path,
      line     = c.line or c.original_line,
      body     = c.body,
      user     = c.user and c.user.login or nil,
      resolved = thread_info.resolved or false,
    })
  end
  return out
end

--- Fetch comments via gh api (fallback when IPC is unavailable).
--- Calls cb(comments | nil) on completion.
local function _fetch_via_gh(pr_number, repo, cb)
  -- We need the repo to construct the REST path
  if not repo or repo == '' then
    -- Try to get repo from gh repo view
    vim.fn.jobstart(
      { 'gh', 'repo', 'view', '--json', 'nameWithOwner', '--jq', '.nameWithOwner' },
      {
        stdout_buffered = true,
        on_stdout = function(_, data)
          local r = vim.trim(table.concat(data, ''))
          if r ~= '' then
            _fetch_via_gh(pr_number, r, cb)
          else
            if cb then cb(nil) end
          end
        end,
        on_exit = function(_, code)
          if code ~= 0 then if cb then cb(nil) end end
        end,
      }
    )
    return
  end

  -- Fetch comments using gh cli REST endpoint
  vim.fn.jobstart(
    { 'gh', 'api',
      string.format('repos/%s/pulls/%d/comments', repo, pr_number),
      '--jq', '[.[] | {id: .id, path: .path, line: .line, original_line: .original_line, body: .body, user: {login: .user.login}}]' },
    {
      stdout_buffered = true,
      on_stdout = function(_, data)
        local json = vim.trim(table.concat(data, ''))
        if json == '' then
          if cb then cb({}) end
          return
        end
        local ok, parsed = pcall(vim.json.decode, json)
        if ok and type(parsed) == 'table' then
          if cb then cb(_parse_rest_comments(parsed)) end
        else
          if cb then cb({}) end
        end
      end,
      on_exit = function(_, code)
        if code ~= 0 then if cb then cb(nil) end end
      end,
    }
  )
end

--- Fetch comments for `pr_number`.
--- Tries IPC first; falls back to gh api if IPC is unavailable.
--- Calls cb(comments) on completion — comments may be empty but not nil.
local function _fetch_comments(pr_number, repo, cb)
  local ipc_ok, ipc = pcall(_ipc)
  if not ipc_ok or not ipc then
    -- Phase 1 ipc.lua not present — go straight to gh fallback
    _fetch_via_gh(pr_number, repo, function(c) cb(c or {}) end)
    return
  end

  ipc.request({ type = 'review-comments', prNumber = pr_number }, function(resp)
    if resp and type(resp.comments) == 'table' then
      cb(resp.comments)
    else
      -- IPC unavailable or returned nothing — fall back to gh api
      _fetch_via_gh(pr_number, repo, function(c) cb(c or {}) end)
    end
  end)
end

--- Resolve the current PR number.
--- Tries IPC state first; falls back to gh pr view.
--- Calls cb(prNumber | nil, repo | nil).
local function _resolve_pr(cb)
  local ipc_ok, ipc = pcall(_ipc)
  if ipc_ok and ipc then
    ipc.request({ type = 'state' }, function(resp)
      local s = resp and resp.state
      if s and s.prNumber then
        cb(s.prNumber, s.repo)
        return
      end
      -- IPC state had no PR — fall back to gh
      vim.fn.jobstart(
        { 'gh', 'pr', 'view', '--json', 'number,headRefName', '--jq', '.number' },
        {
          stdout_buffered = true,
          on_stdout = function(_, data)
            local num = tonumber(vim.trim(table.concat(data, '')))
            cb(num, nil)
          end,
          on_exit = function(_, code)
            if code ~= 0 then cb(nil, nil) end
          end,
        }
      )
    end)
  else
    -- No IPC module — go direct
    vim.fn.jobstart(
      { 'gh', 'pr', 'view', '--json', 'number', '--jq', '.number' },
      {
        stdout_buffered = true,
        on_stdout = function(_, data)
          local num = tonumber(vim.trim(table.concat(data, '')))
          cb(num, nil)
        end,
        on_exit = function(_, code)
          if code ~= 0 then cb(nil, nil) end
        end,
      }
    )
  end
end

-- ─── Core render pipeline ────────────────────────────────────────────────────

--- Given a list of fetched comments, render them into all matching open buffers.
local function _render_all(comments)
  _state.comments  = comments or {}
  _state.extmarks  = {}

  -- Group comments by file path
  local by_path = {}
  for _, c in ipairs(_state.comments) do
    if c.path and c.path ~= '' then
      by_path[c.path] = by_path[c.path] or {}
      table.insert(by_path[c.path], c)
    end
  end

  -- For each open buffer whose name matches a comment path, render
  for path, path_comments in pairs(by_path) do
    for _, bufnr in ipairs(_bufs_for_path(path)) do
      _render_buf(bufnr, path_comments)
    end
  end
end

-- ─── Public API ──────────────────────────────────────────────────────────────

--- One-time initialisation: highlight groups, Plug mappings, BufEnter autocmd.
--- Safe to call multiple times (idempotent via _initialized guard).
local _initialized = false

function M.setup(opts)
  if _initialized then return end
  _initialized = true

  -- Define highlight groups (`:hi default link` — user theme can override)
  vim.api.nvim_command('hi default link LazyhubReviewComment  Comment')
  vim.api.nvim_command('hi default link LazyhubReviewSign     DiagnosticSignInfo')
  vim.api.nvim_command('hi default link LazyhubReviewAuthor   DiagnosticInfo')
  vim.api.nvim_command('hi default link LazyhubReviewResolved NonText')

  -- Register <Plug> mappings — users (or LazyExtras) bind these to <leader>gr*
  vim.keymap.set('n', '<Plug>(lazyhub-review-reply)',   function() M.reply() end,         { desc = 'Reply to review thread under cursor' })
  vim.keymap.set('n', '<Plug>(lazyhub-review-resolve)', function() M.resolve() end,       { desc = 'Resolve review thread under cursor' })
  vim.keymap.set('n', '<Plug>(lazyhub-review-next)',    function() M.next_comment() end,  { desc = 'Jump to next review comment' })
  vim.keymap.set('n', '<Plug>(lazyhub-review-prev)',    function() M.prev_comment() end,  { desc = 'Jump to prev review comment' })

  -- BufEnter: re-render for already-attached PR when opening a matching file
  -- (per spec: never auto-attach NEW PRs; only re-render for already-attached one)
  vim.api.nvim_create_autocmd('BufEnter', {
    group    = vim.api.nvim_create_augroup('lazyhub.review', { clear = false }),
    callback = function()
      if not _state.active_pr then return end
      local bufnr  = vim.api.nvim_get_current_buf()
      local bufname = vim.api.nvim_buf_get_name(bufnr)
      if bufname == '' then return end
      -- Check if any cached comment matches this buffer
      local matching = {}
      for _, c in ipairs(_state.comments) do
        if c.path and c.path ~= '' then
          if bufname:sub(-#c.path) == c.path or bufname:find('/' .. c.path .. '$', 1, true) then
            table.insert(matching, c)
          end
        end
      end
      if #matching > 0 and not (_state.buf_extmarks[bufnr] and #_state.buf_extmarks[bufnr] > 0) then
        _render_buf(bufnr, matching)
      end
    end,
  })

  -- Subscribe to IPC live events (review-comment-added, review-thread-resolved)
  -- The Phase 1 ipc.lua doesn't have a subscription API, so we use a polling
  -- approach via a User autocmd pattern.  When a future IPC subscription lands,
  -- replace this with ipc.subscribe() calls.
  vim.api.nvim_create_autocmd('User', {
    pattern  = 'LazyhubReviewCommentAdded',
    group    = vim.api.nvim_create_augroup('lazyhub.review', { clear = false }),
    callback = function(ev)
      if not _state.active_pr then return end
      local data = ev.data or {}
      if data.prNumber and data.prNumber ~= _state.active_pr then return end
      -- Append the new comment and re-render affected buffer only
      if data.comment then
        table.insert(_state.comments, data.comment)
        local path = data.comment.path
        if path then
          for _, bufnr in ipairs(_bufs_for_path(path)) do
            -- Re-render only this buffer with the full updated comment list for that path
            local buf_comments = {}
            for _, c in ipairs(_state.comments) do
              if c.path == path then table.insert(buf_comments, c) end
            end
            _render_buf(bufnr, buf_comments)
          end
        end
      end
    end,
  })

  vim.api.nvim_create_autocmd('User', {
    pattern  = 'LazyhubReviewThreadResolved',
    group    = vim.api.nvim_create_augroup('lazyhub.review', { clear = false }),
    callback = function(ev)
      if not _state.active_pr then return end
      local data = ev.data or {}
      if data.prNumber and data.prNumber ~= _state.active_pr then return end
      if not data.threadId then return end
      -- Mark matching comments as resolved and patch extmarks
      local affected_paths = {}
      for _, c in ipairs(_state.comments) do
        if c.threadId == data.threadId then
          c.resolved = true
          if c.path then affected_paths[c.path] = true end
        end
      end
      -- Re-render affected paths
      for path in pairs(affected_paths) do
        local path_comments = {}
        for _, c in ipairs(_state.comments) do
          if c.path == path then table.insert(path_comments, c) end
        end
        for _, bufnr in ipairs(_bufs_for_path(path)) do
          _render_buf(bufnr, path_comments)
        end
      end
    end,
  })
end

--- Attach the review overlay for the current PR/branch.
--- Fetches comments and renders them into all open buffers whose paths match.
function M.attach()
  _resolve_pr(function(pr_number, repo)
    if not pr_number then
      vim.notify('[lazyhub] no PR found for current branch', vim.log.levels.WARN)
      return
    end
    _state.active_pr = pr_number
    vim.notify(string.format('[lazyhub] loading review comments for PR #%d…', pr_number), vim.log.levels.INFO)
    _fetch_comments(pr_number, repo, function(comments)
      if not comments then
        vim.notify('[lazyhub] failed to load review comments', vim.log.levels.ERROR)
        return
      end
      vim.schedule(function()
        _render_all(comments)
        local n = #comments
        vim.notify(
          string.format('[lazyhub] review overlay attached (%d comment%s)', n, n == 1 and '' or 's'),
          vim.log.levels.INFO
        )
      end)
    end)
  end)
end

--- Detach: clear all extmarks and signs from all buffers and reset state.
function M.detach()
  for bufnr in pairs(_state.buf_extmarks) do
    if vim.api.nvim_buf_is_valid(bufnr) then
      vim.api.nvim_buf_clear_namespace(bufnr, _ns, 0, -1)
      _unplace_signs(bufnr)
    end
  end
  _state.active_pr    = nil
  _state.comments     = {}
  _state.extmarks     = {}
  _state.buf_extmarks = {}
  vim.notify('[lazyhub] review overlay detached', vim.log.levels.INFO)
end

--- Re-fetch and re-render the overlay for the current PR.
function M.refresh()
  if not _state.active_pr then
    -- Not yet attached — run attach() instead
    M.attach()
    return
  end
  local pr_number = _state.active_pr
  -- Resolve repo from IPC state (best-effort)
  local ipc_ok, ipc = pcall(_ipc)
  local repo = nil
  if ipc_ok and ipc then
    -- Synchronous-ish: cache the last known repo from the state, non-blocking
    ipc.request({ type = 'state' }, function(resp)
      local s = resp and resp.state
      repo = s and s.repo
    end)
  end
  -- Clear current extmarks, then re-fetch
  for bufnr in pairs(_state.buf_extmarks) do
    if vim.api.nvim_buf_is_valid(bufnr) then
      vim.api.nvim_buf_clear_namespace(bufnr, _ns, 0, -1)
      _unplace_signs(bufnr)
    end
  end
  _state.extmarks     = {}
  _state.buf_extmarks = {}

  _fetch_comments(pr_number, repo, function(comments)
    if not comments then
      vim.notify('[lazyhub] refresh failed', vim.log.levels.ERROR)
      return
    end
    vim.schedule(function()
      _render_all(comments)
      vim.notify('[lazyhub] review overlay refreshed', vim.log.levels.INFO)
    end)
  end)
end

-- ─── Cursor-position helpers ─────────────────────────────────────────────────

--- Find the comment (and its extmark_id) at the current cursor line in current buffer.
--- Returns (comment, extmark_id) or (nil, nil).
local function _comment_at_cursor()
  local bufnr   = vim.api.nvim_get_current_buf()
  local cursor  = vim.api.nvim_win_get_cursor(0)
  local cur_ln  = cursor[1] - 1  -- 0-based

  local eids = _state.buf_extmarks[bufnr] or {}
  for _, eid in ipairs(eids) do
    local pos = vim.api.nvim_buf_get_extmark_by_id(bufnr, _ns, eid, {})
    if pos and pos[1] == cur_ln then
      return _state.extmarks[eid], eid
    end
  end
  return nil, nil
end

-- ─── Reply flow ───────────────────────────────────────────────────────────────

--- Post a reply and update the overlay on success.
local function _do_reply(comment, body)
  if not body or vim.trim(body) == '' then return end
  local thread_id = comment.threadId
  local pr_number = _state.active_pr

  -- Try IPC first; fall back to gh api graphql
  local ipc_ok, ipc = pcall(_ipc)
  if ipc_ok and ipc then
    ipc.request({ type = 'reply-thread', threadId = thread_id, body = body }, function(resp)
      if resp and resp.ok then
        vim.schedule(function()
          vim.notify('[lazyhub] reply posted', vim.log.levels.INFO)
          -- Optimistic: re-fetch this thread's comments
          _fetch_comments(pr_number, nil, function(comments)
            if comments then
              vim.schedule(function() _render_all(comments) end)
            end
          end)
        end)
      else
        local msg = (resp and resp.error) or 'reply failed'
        vim.schedule(function()
          vim.notify('[lazyhub] ' .. msg, vim.log.levels.ERROR)
        end)
      end
    end)
  else
    -- Fallback: gh api graphql directly
    local mutation = 'mutation($threadId: ID!, $body: String!) { addPullRequestReviewThreadReply(input: { pullRequestReviewThreadId: $threadId, body: $body }) { comment { databaseId } } }'
    vim.fn.jobstart(
      { 'gh', 'api', 'graphql',
        '-f', 'query=' .. mutation,
        '-f', 'threadId=' .. thread_id,
        '-f', 'body=' .. body },
      {
        stdout_buffered = true,
        on_stdout = function(_, data)
          local json = vim.trim(table.concat(data, ''))
          local ok, parsed = pcall(vim.json.decode, json)
          if ok and parsed and parsed.data and parsed.data.addPullRequestReviewThreadReply then
            vim.schedule(function()
              vim.notify('[lazyhub] reply posted', vim.log.levels.INFO)
              _fetch_comments(pr_number, nil, function(comments)
                if comments then
                  vim.schedule(function() _render_all(comments) end)
                end
              end)
            end)
          end
        end,
        on_exit = function(_, code)
          if code ~= 0 then
            vim.schedule(function()
              vim.notify('[lazyhub] reply failed (gh api error)', vim.log.levels.ERROR)
            end)
          end
        end,
      }
    )
  end
end

--- Open the reply input.
--- Tries Snacks.input first (multi-line); falls back to a scratch floating buffer.
local function _open_reply_input(comment)
  local thread_id = comment.threadId

  -- Attempt Snacks.input (LazyVim / snacks.nvim users)
  local snacks_ok, Snacks = pcall(require, 'snacks')
  if snacks_ok and Snacks and Snacks.input then
    Snacks.input({
      prompt = string.format('[lazyhub] reply to @%s (thread %s): ', comment.user or 'reviewer', thread_id:sub(1, 8)),
    }, function(value)
      if value and vim.trim(value) ~= '' then
        _do_reply(comment, value)
      end
    end)
    return
  end

  -- Fallback: scratch floating buffer
  local scratch_buf = vim.api.nvim_create_buf(false, true)
  vim.api.nvim_buf_set_option(scratch_buf, 'buftype', 'nofile')
  vim.api.nvim_buf_set_option(scratch_buf, 'bufhidden', 'wipe')
  vim.api.nvim_buf_set_option(scratch_buf, 'filetype', 'markdown')
  vim.api.nvim_buf_set_name(scratch_buf, 'lazyhub://reply/' .. thread_id)

  local ui       = vim.api.nvim_list_uis()[1] or { width = 80, height = 24 }
  local width    = math.min(70, ui.width - 4)
  local height   = 8
  local row      = math.floor((ui.height - height) / 2)
  local col      = math.floor((ui.width - width) / 2)

  local win = vim.api.nvim_open_win(scratch_buf, true, {
    relative = 'editor',
    row      = row,
    col      = col,
    width    = width,
    height   = height,
    style    = 'minimal',
    border   = 'rounded',
    title    = string.format(' Reply to @%s ', comment.user or 'reviewer'),
    title_pos = 'center',
  })

  -- Hint line (non-editable header shown via virtual text)
  vim.api.nvim_buf_set_extmark(scratch_buf, _ns, 0, 0, {
    virt_lines = { { { '<C-s> send  q/<Esc> cancel', 'Comment' } } },
    virt_lines_above = true,
  })

  local function _send_reply()
    local lines = vim.api.nvim_buf_get_lines(scratch_buf, 0, -1, false)
    local body  = vim.trim(table.concat(lines, '\n'))
    vim.api.nvim_win_close(win, true)
    if body ~= '' then
      _do_reply(comment, body)
    end
  end

  local opts = { buffer = scratch_buf, nowait = true, silent = true }
  vim.keymap.set({ 'n', 'i' }, '<C-s>', _send_reply, opts)
  vim.keymap.set('n', 'q',     function() vim.api.nvim_win_close(win, true) end, opts)
  vim.keymap.set('n', '<Esc>', function() vim.api.nvim_win_close(win, true) end, opts)
end

--- Reply to the review thread under the cursor.
function M.reply()
  local comment = _comment_at_cursor()
  if not comment then
    vim.notify('[lazyhub] no review comment at cursor', vim.log.levels.INFO)
    return
  end
  _open_reply_input(comment)
end

-- ─── Resolve flow ─────────────────────────────────────────────────────────────

--- Resolve the review thread under the cursor.
function M.resolve()
  local comment = _comment_at_cursor()
  if not comment then
    vim.notify('[lazyhub] no review comment at cursor', vim.log.levels.INFO)
    return
  end
  if comment.resolved then
    vim.notify('[lazyhub] thread is already resolved', vim.log.levels.INFO)
    return
  end

  local thread_id = comment.threadId
  local pr_number = _state.active_pr

  vim.ui.select({ 'Yes', 'No' }, {
    prompt = string.format('Resolve thread by @%s?', comment.user or 'reviewer'),
  }, function(choice)
    if choice ~= 'Yes' then return end

    local ipc_ok, ipc = pcall(_ipc)
    if ipc_ok and ipc then
      ipc.request({ type = 'resolve-thread', threadId = thread_id, prNumber = pr_number }, function(resp)
        if resp and resp.ok then
          vim.schedule(function()
            -- Mark all comments in this thread as resolved and re-render
            local affected_paths = {}
            for _, c in ipairs(_state.comments) do
              if c.threadId == thread_id then
                c.resolved = true
                if c.path then affected_paths[c.path] = true end
              end
            end
            for path in pairs(affected_paths) do
              local path_comments = {}
              for _, c in ipairs(_state.comments) do
                if c.path == path then table.insert(path_comments, c) end
              end
              for _, bufnr in ipairs(_bufs_for_path(path)) do
                _render_buf(bufnr, path_comments)
              end
            end
            vim.notify('[lazyhub] thread resolved', vim.log.levels.INFO)
          end)
        else
          local msg = (resp and resp.error) or 'resolve failed'
          vim.schedule(function()
            vim.notify('[lazyhub] ' .. msg, vim.log.levels.ERROR)
          end)
        end
      end)
    else
      -- Fallback: gh api graphql directly
      local mutation = 'mutation($threadId: ID!) { resolveReviewThread(input: { threadId: $threadId }) { thread { id isResolved } } }'
      vim.fn.jobstart(
        { 'gh', 'api', 'graphql',
          '-f', 'query=' .. mutation,
          '-f', 'threadId=' .. thread_id },
        {
          on_exit = function(_, code)
            if code == 0 then
              vim.schedule(function()
                local affected_paths = {}
                for _, c in ipairs(_state.comments) do
                  if c.threadId == thread_id then
                    c.resolved = true
                    if c.path then affected_paths[c.path] = true end
                  end
                end
                for path in pairs(affected_paths) do
                  local path_comments = {}
                  for _, c in ipairs(_state.comments) do
                    if c.path == path then table.insert(path_comments, c) end
                  end
                  for _, bufnr in ipairs(_bufs_for_path(path)) do
                    _render_buf(bufnr, path_comments)
                  end
                end
                vim.notify('[lazyhub] thread resolved', vim.log.levels.INFO)
              end)
            else
              vim.schedule(function()
                vim.notify('[lazyhub] resolve failed (gh api error)', vim.log.levels.ERROR)
              end)
            end
          end,
        }
      )
    end
  end)
end

-- ─── Navigation ───────────────────────────────────────────────────────────────

--- Collect all extmark line positions in the current buffer, sorted.
local function _sorted_lines(bufnr)
  local eids = _state.buf_extmarks[bufnr] or {}
  local lines = {}
  for _, eid in ipairs(eids) do
    local pos = vim.api.nvim_buf_get_extmark_by_id(bufnr, _ns, eid, {})
    if pos and pos[1] then
      table.insert(lines, pos[1])
    end
  end
  table.sort(lines)
  return lines
end

--- Jump to the next review comment in the current buffer (wraps at end).
function M.next_comment()
  local bufnr  = vim.api.nvim_get_current_buf()
  local lines  = _sorted_lines(bufnr)
  if #lines == 0 then
    vim.notify('[lazyhub] no review comments in this buffer', vim.log.levels.INFO)
    return
  end
  local cur_ln = vim.api.nvim_win_get_cursor(0)[1] - 1  -- 0-based
  -- Find first comment line strictly after cursor
  for _, ln in ipairs(lines) do
    if ln > cur_ln then
      vim.api.nvim_win_set_cursor(0, { ln + 1, 0 })
      return
    end
  end
  -- Wrap: jump to first comment
  vim.api.nvim_win_set_cursor(0, { lines[1] + 1, 0 })
end

--- Jump to the previous review comment in the current buffer (wraps at start).
function M.prev_comment()
  local bufnr  = vim.api.nvim_get_current_buf()
  local lines  = _sorted_lines(bufnr)
  if #lines == 0 then
    vim.notify('[lazyhub] no review comments in this buffer', vim.log.levels.INFO)
    return
  end
  local cur_ln = vim.api.nvim_win_get_cursor(0)[1] - 1  -- 0-based
  -- Find last comment line strictly before cursor (reverse iterate)
  for i = #lines, 1, -1 do
    if lines[i] < cur_ln then
      vim.api.nvim_win_set_cursor(0, { lines[i] + 1, 0 })
      return
    end
  end
  -- Wrap: jump to last comment
  vim.api.nvim_win_set_cursor(0, { lines[#lines] + 1, 0 })
end

return M
