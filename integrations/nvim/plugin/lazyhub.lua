-- lazyhub.nvim — plugin entry point
-- Lazy-loaded: only sets up commands, does NOT call setup() automatically.
-- Users must call require('lazyhub').setup() in their config.

if vim.g.loaded_lazyhub then return end
vim.g.loaded_lazyhub = true

-- Provide stub commands that auto-initialize with defaults on first use
-- so the plugin works even if the user forgets to call setup().
local function ensure_setup()
  if not vim.g.lazyhub_setup_done then
    require('lazyhub').setup()
    vim.g.lazyhub_setup_done = true
  end
end

vim.api.nvim_create_user_command('LazyHub',             function() ensure_setup(); require('lazyhub').open() end,             { desc = 'Open lazyhub TUI' })
vim.api.nvim_create_user_command('LazyHubPR',           function() ensure_setup(); require('lazyhub').open_pr() end,            { desc = 'Open lazyhub for current branch PR' })
vim.api.nvim_create_user_command('LazyHubBlame',        function() ensure_setup(); require('lazyhub').blame_pr() end,           { desc = 'Open PR that introduced line under cursor' })
vim.api.nvim_create_user_command('LazyHubDiag',         function() ensure_setup(); require('lazyhub').load_diagnostics() end,   { desc = 'Load PR review comments as diagnostics' })
vim.api.nvim_create_user_command('LazyHubState',        function() ensure_setup(); require('lazyhub').show_state() end,         { desc = 'Show lazyhub IPC state' })

-- Phase 2: review overlay commands
vim.api.nvim_create_user_command('LazyHubReview',       function() ensure_setup(); require('lazyhub.review').attach() end,      { desc = 'Attach inline PR review overlay' })
vim.api.nvim_create_user_command('LazyHubReviewRefresh',function() ensure_setup(); require('lazyhub.review').refresh() end,     { desc = 'Refresh inline PR review overlay' })
vim.api.nvim_create_user_command('LazyHubReviewDetach', function() ensure_setup(); require('lazyhub.review').detach() end,      { desc = 'Detach inline PR review overlay' })
