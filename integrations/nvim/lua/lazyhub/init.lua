-- lazyhub.nvim — Deep NeoVim integration for lazyhub
-- https://github.com/saketh-kowtha/lazyhub
--
-- Features:
--   :LazyHub              open lazyhub in a floating terminal
--   :LazyHubPR            smart open: jumps to the PR for the current branch
--   :LazyHubBlame         open PR that introduced the line under cursor
--   :LazyHubDiagnostics   load PR review comments as vim diagnostics
--   :LazyHubState         show current lazyhub IPC state
--
-- IPC: communicates with a running lazyhub instance via ~/.lazyhub-socket
-- (lazyhub must be running with IPC enabled, which is the default)

local M = {}

-- ─── Default config ───────────────────────────────────────────────────────────

M.config = {
  -- Floating window dimensions (0–1 as fraction of screen, or absolute integer)
  width  = 0.9,
  height = 0.9,
  border = 'rounded',    -- 'none' | 'single' | 'double' | 'rounded' | 'solid'

  -- Key to close the floating window from within lazyhub
  -- (lazyhub's own Esc/q handles this, this is a fallback)
  close_key = '<C-q>',

  -- Namespace for diagnostics
  diagnostics_ns = vim.api.nvim_create_namespace('lazyhub'),

  -- Auto-load PR review comments as diagnostics when entering a buffer
  -- that belongs to an open PR (requires lazyhub to be running)
  auto_diagnostics = false,
}

-- ─── Sub-module references (extracted, loaded lazily) ────────────────────────

local function _ipc()  return require('lazyhub.ipc')  end
local function _float() return require('lazyhub.float') end

-- ─── Commands ─────────────────────────────────────────────────────────────────

--- Open lazyhub in a floating terminal.
function M.open(opts)
  opts = opts or {}
  local cmd = 'lazyhub'
  local repo_env = ''
  if opts.repo then
    repo_env = 'GHUI_REPO=' .. opts.repo .. ' '
  end
  _float().open_float(repo_env .. cmd)
end

--- Smart open: if a PR exists for the current branch, navigate to it.
--- Behavior:
---   1. Query IPC pr-for-branch with the current branch name.
---   2a. If a PR is found AND lazyhub is running:
---       send navigate { view='diff', prNumber=N }, then open the float.
---   2b. If a PR is found AND lazyhub is NOT running:
---       spawn lazyhub with GHUI_PR=N env (requires lazyhub bootstrap to honour it;
---       if not supported, lazyhub opens normally — graceful degradation).
---   3. If no PR: open lazyhub on the default PR list.
function M.open_pr()
  local branch = vim.fn.system('git rev-parse --abbrev-ref HEAD 2>/dev/null'):gsub('%s+$', '')
  if branch == '' or branch == 'HEAD' then
    vim.notify('[lazyhub] not in a git repo or detached HEAD', vim.log.levels.WARN)
    return
  end

  -- Ask IPC for the PR associated with this branch
  _ipc().request({ type = 'pr-for-branch', branch = branch }, function(resp)
    local pr_num = resp and resp.prNumber

    if pr_num then
      -- lazyhub is running (IPC responded) — navigate to diff view, then open float
      _ipc().request({ type = 'navigate', view = 'diff', prNumber = pr_num }, function()
        M.open()
      end)
    else
      -- IPC unavailable or no PR: fall back to gh pr list directly
      vim.fn.jobstart(
        { 'gh', 'pr', 'list', '--head', branch, '--json', 'number', '--limit', '1' },
        {
          stdout_buffered = true,
          on_stdout = function(_, data)
            local json = table.concat(data, '')
            local ok, parsed = pcall(vim.json.decode, json)
            local fallback_num = ok and type(parsed) == 'table' and parsed[1] and parsed[1].number

            if fallback_num then
              -- lazyhub not running — spawn with GHUI_PR env for initial navigation
              -- Note: lazyhub bootstrap will honour GHUI_PR once that env var is wired;
              -- until then it opens normally (graceful degradation per invariant 2).
              _float().open_float('GHUI_PR=' .. tostring(fallback_num) .. ' lazyhub')
            else
              -- No PR for this branch — open lazyhub on the PR list
              M.open()
            end
          end,
          on_exit = function(_, code)
            if code ~= 0 then
              -- gh not available or error — just open lazyhub normally
              M.open()
            end
          end,
        }
      )
    end
  end)
end

--- Open lazyhub and navigate to the PR that introduced the line under the cursor
--- (uses git blame to find the commit SHA, then asks lazyhub via IPC).
function M.blame_pr()
  local file = vim.fn.expand('%:p')
  local line = vim.api.nvim_win_get_cursor(0)[1]
  local sha  = vim.fn.system(
    string.format('git blame -L %d,%d --porcelain %s 2>/dev/null | head -1 | cut -d" " -f1',
      line, line, vim.fn.shellescape(file))
  ):gsub('%s+$', '')

  if sha == '' or sha:match('^0+$') then
    vim.notify('[lazyhub] could not determine commit for this line', vim.log.levels.WARN)
    return
  end

  vim.fn.jobstart(
    { 'gh', 'pr', 'list', '--search', sha, '--json', 'number', '--jq', '.[0].number' },
    {
      stdout_buffered = true,
      on_stdout = function(_, data)
        local pr_num = tonumber((data[1] or ''):gsub('%s+', ''))
        if pr_num then
          _ipc().request({ type = 'navigate', prNumber = pr_num }, function()
            M.open()
          end)
        else
          vim.notify('[lazyhub] no PR found for commit ' .. sha:sub(1, 8), vim.log.levels.INFO)
          M.open()
        end
      end,
    }
  )
end

--- Load PR review comments as Neovim diagnostics.
--- Requires a running lazyhub instance (for IPC state) or falls back to gh CLI.
function M.load_diagnostics()
  _ipc().request({ type = 'state' }, function(resp)
    local pr_number = resp and resp.state and resp.state.prNumber
    if not pr_number then
      vim.notify('[lazyhub] no PR open in lazyhub', vim.log.levels.INFO)
      return
    end

    local repo = (resp.state and resp.state.repo) or
                 vim.fn.system('gh repo view --json nameWithOwner --jq .nameWithOwner 2>/dev/null'):gsub('%s+$', '')

    vim.fn.jobstart(
      { 'gh', 'api', string.format('repos/%s/pulls/%d/comments', repo, pr_number),
        '--jq', '[.[] | {path: .path, line: .line, body: .body, user: .user.login}]' },
      {
        stdout_buffered = true,
        on_stdout = function(_, data)
          local json = table.concat(data, '')
          if json == '' then return end
          local ok, comments = pcall(vim.json.decode, json)
          if not ok or type(comments) ~= 'table' then return end

          vim.diagnostic.reset(M.config.diagnostics_ns)

          local by_file = {}
          for _, c in ipairs(comments) do
            if c.path and c.line then
              by_file[c.path] = by_file[c.path] or {}
              table.insert(by_file[c.path], c)
            end
          end

          for _, bufnr in ipairs(vim.api.nvim_list_bufs()) do
            if not vim.api.nvim_buf_is_loaded(bufnr) then goto continue end
            local bufpath = vim.api.nvim_buf_get_name(bufnr)
            for file_path, file_comments in pairs(by_file) do
              if bufpath:find(file_path, 1, true) then
                local diags = {}
                for _, c in ipairs(file_comments) do
                  table.insert(diags, {
                    lnum     = (c.line or 1) - 1,
                    col      = 0,
                    severity = vim.diagnostic.severity.INFO,
                    message  = string.format('[%s] %s', c.user or 'reviewer', c.body or ''),
                    source   = 'lazyhub',
                  })
                end
                vim.diagnostic.set(M.config.diagnostics_ns, bufnr, diags)
              end
            end
            ::continue::
          end

          local total = #comments
          vim.notify(string.format('[lazyhub] loaded %d review comment%s as diagnostics',
            total, total == 1 and '' or 's'), vim.log.levels.INFO)
        end,
      }
    )
  end)
end

--- Show current lazyhub IPC state in a floating notification.
function M.show_state()
  _ipc().request({ type = 'state' }, function(resp)
    if not resp or not resp.state then
      vim.notify('[lazyhub] not running or IPC unavailable', vim.log.levels.WARN)
      return
    end
    local s = resp.state
    local lines = {
      string.format('repo:  %s', s.repo  or '—'),
      string.format('pane:  %s', s.pane  or '—'),
      string.format('view:  %s', s.view  or '—'),
      s.prNumber    and string.format('PR:    #%d', s.prNumber)    or nil,
      s.issueNumber and string.format('issue: #%d', s.issueNumber) or nil,
    }
    local filtered = {}
    for _, l in ipairs(lines) do if l then table.insert(filtered, l) end end
    vim.notify(table.concat(filtered, '\n'), vim.log.levels.INFO, { title = 'lazyhub state' })
  end)
end

-- ─── Setup ────────────────────────────────────────────────────────────────────

function M.setup(opts)
  M.config = vim.tbl_deep_extend('force', M.config, opts or {})

  -- Propagate config to float module so open_float() uses the user's settings
  _float()._config = M.config

  vim.api.nvim_create_user_command('LazyHub',      function() M.open() end,            { desc = 'Open lazyhub' })
  vim.api.nvim_create_user_command('LazyHubPR',    function() M.open_pr() end,         { desc = 'Open lazyhub for current branch PR' })
  vim.api.nvim_create_user_command('LazyHubBlame', function() M.blame_pr() end,        { desc = 'Open PR that introduced line under cursor' })
  vim.api.nvim_create_user_command('LazyHubDiag',  function() M.load_diagnostics() end, { desc = 'Load PR review comments as diagnostics' })
  vim.api.nvim_create_user_command('LazyHubState', function() M.show_state() end,      { desc = 'Show current lazyhub IPC state' })

  if M.config.auto_diagnostics then
    vim.api.nvim_create_autocmd('BufEnter', {
      group = vim.api.nvim_create_augroup('lazyhub_auto_diag', { clear = true }),
      callback = function() M.load_diagnostics() end,
    })
  end
end

return M
