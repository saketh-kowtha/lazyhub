--[[
  lazyhub LazyExtras module
  =========================
  This file is a COPY-PASTE TARGET — it is NOT auto-loaded by the lazyhub plugin.

  To use it, either:
    a) Drop it into LazyVim's extras directory as:
         ~/.config/nvim/lua/plugins/extras/tool/lazyhub.lua
       then enable via :LazyExtras → tool.lazyhub

    b) Paste the contents into your own plugins/ config file.

  This file will eventually be submitted upstream to LazyVim/LazyVim as:
    lua/lazyvim/plugins/extras/tool/lazyhub.lua

  Source repo: https://github.com/saketh-kowtha/lazyhub
  Plugin subdir: integrations/nvim  (the plugin lives inside the monorepo)
--]]

return {
  -- ─── Plugin spec ────────────────────────────────────────────────────────────
  {
    'saketh-kowtha/lazyhub',
    -- The nvim plugin lives in a subdirectory of the monorepo.
    -- lazy.nvim ≥ 11 supports `subdir` natively; older versions need `dir`.
    subdir = 'integrations/nvim',

    cmd = {
      'LazyHub',
      'LazyHubPR',
      'LazyHubBlame',
      'LazyHubDiag',
      'LazyHubState',
      'LazyHubReview',
      'LazyHubReviewRefresh',
      'LazyHubReviewDetach',
    },

    keys = {
      -- ── which-key group: lazyhub ───────────────────────────────────────────
      { '<leader>gh',  group = 'lazyhub' },

      { '<leader>gho', '<cmd>LazyHub<cr>',       desc = 'Open lazyhub' },
      { '<leader>ghp', '<cmd>LazyHubPR<cr>',     desc = 'Open PR for current branch' },
      { '<leader>ghb', '<cmd>LazyHubBlame<cr>',  desc = 'Open PR for line under cursor' },
      { '<leader>ghd', '<cmd>LazyHubDiag<cr>',   desc = 'Load PR review comments as diagnostics' },
      { '<leader>ghs', '<cmd>LazyHubState<cr>',  desc = 'Show lazyhub IPC state' },

      -- ── which-key group: review ────────────────────────────────────────────
      { '<leader>gr',  group = 'review' },

      { '<leader>grr', '<cmd>LazyHubReview<cr>',         desc = 'Attach review overlay' },
      { '<leader>grR', '<Plug>(lazyhub-review-reply)',   desc = 'Reply to thread under cursor' },
      { '<leader>grx', '<Plug>(lazyhub-review-resolve)', desc = 'Resolve thread under cursor' },

      -- ── navigation ─────────────────────────────────────────────────────────
      { ']r',          '<Plug>(lazyhub-review-next)',    desc = 'Next review comment' },
      { '[r',          '<Plug>(lazyhub-review-prev)',    desc = 'Previous review comment' },
    },

    opts = {
      -- Floating window options (passed to require('lazyhub').setup())
      width     = 0.9,
      height    = 0.9,
      border    = 'rounded',
      close_key = '<C-q>',
    },

    config = function(_, opts)
      require('lazyhub').setup(opts)
      require('lazyhub.review').setup()

      -- Kick off the statusline poller.
      -- The component is exposed for manual wiring — see lualine snippet below.
      require('lazyhub.statusline').setup()
    end,
  },

  -- ─── lualine integration (optional) ─────────────────────────────────────────
  --
  -- If you use lualine, add the component to your lualine config.
  -- Example — add to your existing lualine setup() call:
  --
  --   require('lualine').setup({
  --     sections = {
  --       lualine_b = {
  --         'branch',
  --         -- lazyhub PR status:
  --         { function() return require('lazyhub.statusline').component() end,
  --           cond = function() return require('lazyhub.statusline').component() ~= '' end },
  --       },
  --     },
  --   })
  --
  -- LazyVim users can extend lualine opts using the LazyVim.lualine helper:
  --
  --   {
  --     'nvim-lualine/lualine.nvim',
  --     optional = true,
  --     opts = function(_, opts)
  --       table.insert(opts.sections.lualine_b, {
  --         function() return require('lazyhub.statusline').component() end,
  --         cond = function() return require('lazyhub.statusline').component() ~= '' end,
  --       })
  --       return opts
  --     end,
  --   },
  --
  -- Uncomment the block below to enable the lualine integration automatically:
  --
  -- {
  --   'nvim-lualine/lualine.nvim',
  --   optional = true,
  --   opts = function(_, opts)
  --     opts.sections = opts.sections or {}
  --     opts.sections.lualine_b = opts.sections.lualine_b or {}
  --     table.insert(opts.sections.lualine_b, {
  --       function() return require('lazyhub.statusline').component() end,
  --       cond = function() return require('lazyhub.statusline').component() ~= '' end,
  --     })
  --     return opts
  --   end,
  -- },
}
