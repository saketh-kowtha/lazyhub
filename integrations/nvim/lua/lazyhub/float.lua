-- lazyhub.float — floating terminal window management
--
-- Extracted from init.lua so other modules can open the lazyhub float
-- without requiring all of init.lua.

local M = {}

-- Reference to the parent config; set by init.lua after setup().
M._config = nil

--- Open a floating terminal running `cmd`.
--- Falls back to sensible defaults when _config is not yet set.
--- @param cmd string  shell command to run inside the float
--- @return number  window id
function M.open_float(cmd)
  local cfg = M._config or {
    width  = 0.9,
    height = 0.9,
    border = 'rounded',
    close_key = '<C-q>',
  }

  local width  = cfg.width  <= 1 and math.floor(vim.o.columns * cfg.width)  or cfg.width
  local height = cfg.height <= 1 and math.floor(vim.o.lines   * cfg.height) or cfg.height
  local row    = math.floor((vim.o.lines   - height) / 2)
  local col    = math.floor((vim.o.columns - width)  / 2)

  local buf = vim.api.nvim_create_buf(false, true)
  local win = vim.api.nvim_open_win(buf, true, {
    relative  = 'editor',
    width     = width,
    height    = height,
    row       = row,
    col       = col,
    style     = 'minimal',
    border    = cfg.border,
    title     = ' lazyhub ',
    title_pos = 'center',
  })

  vim.fn.termopen(cmd, {
    on_exit = function()
      if vim.api.nvim_win_is_valid(win) then
        vim.api.nvim_win_close(win, true)
      end
    end,
  })

  vim.api.nvim_buf_set_keymap(buf, 't', cfg.close_key,
    '<C-\\><C-n>:close<CR>', { noremap = true, silent = true })

  vim.cmd('startinsert')
  return win
end

return M
