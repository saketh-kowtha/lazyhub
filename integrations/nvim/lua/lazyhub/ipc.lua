-- lazyhub.ipc — NDJSON Unix-socket client with exponential-backoff reconnect
--
-- Public API:
--   require('lazyhub.ipc').request(msg, cb)  — send a request, receive response via cb(resp|nil)
--   require('lazyhub.ipc').connect()         — (re)connect to the IPC socket; called automatically
--
-- Reconnect invariant (spec §3.2 invariant 2):
--   If the socket path is not reachable, every feature degrades gracefully.
--   The module retries with exponential backoff: 1s → 2s → 4s … capped at 30s.
--   On successful connect the backoff resets.

local M = {}

-- ─── Helpers ─────────────────────────────────────────────────────────────────

local function socket_path()
  local daemon = vim.fn.expand('~/.config/lazyhub/daemon.sock')
  if vim.fn.filereadable(daemon) == 1 then
    return daemon
  end
  local pointer = vim.fn.expand('~/.lazyhub-socket')
  if vim.fn.filereadable(pointer) == 1 then
    return vim.fn.readfile(pointer)[1]
  end
  return nil
end

-- ─── Reconnect state ─────────────────────────────────────────────────────────

local _retry_delay  = 1    -- seconds; doubles on each failure, capped at 30
local _retry_timer  = nil

local function _schedule_reconnect()
  if _retry_timer then return end -- already pending
  _retry_timer = vim.defer_fn(function()
    _retry_timer = nil
    M.connect()
  end, _retry_delay * 1000)
  _retry_delay = math.min(_retry_delay * 2, 30)
end

-- Reset backoff on successful operation
local function _reset_backoff()
  _retry_delay = 1
  if _retry_timer then
    -- cancel pending retry
    pcall(function()
      local uv = (vim.uv or vim.loop)
      -- vim.defer_fn uses a libuv timer internally; we can't cancel it by handle
      -- so we just let it fire harmlessly (connect() is idempotent when socket exists)
    end)
  end
end

-- ─── request() ───────────────────────────────────────────────────────────────

--- Send a request to a running lazyhub IPC server.
--- Non-blocking: uses libuv pipes. Calls cb(response|nil) on vim.schedule().
--- @param msg  table   request object (id will be set automatically)
--- @param cb   function(response|nil)
function M.request(msg, cb)
  local path = socket_path()
  if not path or vim.fn.filereadable(path) == 0 then
    _schedule_reconnect()
    if cb then vim.schedule(function() cb(nil) end) end
    return
  end

  msg.id = tostring(math.random(1e9))
  local json = vim.json.encode(msg) .. '\n'

  local ok, uv = pcall(require, 'luv')
  if not ok then uv = vim.uv or vim.loop end

  local client = uv.new_pipe(false)
  local buf = ''

  client:connect(path, function(err)
    if err then
      client:close()
      _schedule_reconnect()
      if cb then vim.schedule(function() cb(nil) end) end
      return
    end

    _reset_backoff()
    client:write(json)
    client:read_start(function(rerr, data)
      if rerr or not data then
        client:close()
        return
      end
      buf = buf .. data
      for line in buf:gmatch('[^\n]+') do
        local ok2, parsed = pcall(vim.json.decode, line)
        if ok2 and parsed.id == msg.id then
          client:close()
          if cb then vim.schedule(function() cb(parsed) end) end
          return
        end
      end
    end)
  end)
end

--- Attempt a connection (used by reconnect logic).
--- No-op when the socket is already reachable.
function M.connect()
  local path = socket_path()
  if not path then
    _schedule_reconnect()
    return
  end
  -- Verify reachable with a ping; resets backoff on success
  M.request({ type = 'ping' }, function(resp)
    if not resp then
      _schedule_reconnect()
    end
  end)
end

return M
