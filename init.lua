-- Pokedex for Rex: actions and keys. Loaded from ~/.config/rex/init.lua with
--   require("pokedex")
-- The actions only start `bin/pokedex.js`; everything else lives there.

local home = os.getenv("HOME") or ""
local dir = (os.getenv("XDG_CONFIG_HOME") or (home .. "/.config")) .. "/rex/pokedex"
local cli = dir .. "/bin/pokedex.js"

local function exists(path)
  local f = io.open(path, "r")
  if f then f:close() return true end
  return false
end

-- The Rex server doesn't always have your shell's PATH, so look for bun in the usual places.
local bun = os.getenv("POKEDEX_BUN")
if not bun then
  for _, path in ipairs({ "/opt/homebrew/bin/bun", home .. "/.bun/bin/bun", "/usr/local/bin/bun", "/usr/bin/bun" }) do
    if exists(path) then bun = path break end
  end
end
bun = bun or "bun"

local function pokedex(ctx, ...)
  local argv = { bun, cli, ... }
  if ctx and ctx.session_id then
    argv[#argv + 1] = "--session"
    argv[#argv + 1] = ctx.session_id
  end
  if ctx and ctx.block_id then
    argv[#argv + 1] = "--block"
    argv[#argv + 1] = ctx.block_id
  end
  local h, err = rex.exec.start(argv, { detach = true, stdout = false, stderr = false })
  if not h then rex.log("warn", "pokedex: " .. tostring(err)) end
end

rex.action{
  name = "pokedex_toggle", title = "Pokedex: Toggle Sidebar", category = "Pokedex",
  keywords = "pokemon agents sidebar",
  run = function(ctx) pokedex(ctx, "toggle") end,
}
rex.action{
  name = "pokedex_collection", title = "Pokedex: Kanto Dex", category = "Pokedex",
  keywords = "pokemon collection caught",
  run = function(ctx) pokedex(ctx, "open", "collection") end,
}
rex.action{
  name = "pokedex_trainer", title = "Pokedex: Trainer Card", category = "Pokedex",
  keywords = "pokemon badges streak quests",
  run = function(ctx) pokedex(ctx, "open", "trainer") end,
}
rex.action{
  name = "pokedex_encounter", title = "Pokedex: Wild Encounter", category = "Pokedex",
  keywords = "pokemon wild catch ball",
  run = function(ctx) pokedex(ctx, "open", "encounter") end,
}

-- Teleport: show the agent picked in the sidebar a moment ago, else the one that most needs
-- you (blocked first, then done, then working). It runs inside the app, so it works with
-- Remote Control off, from any pane.
local state = (os.getenv("POKEDEX_STATE") or ((os.getenv("XDG_STATE_HOME") or (home .. "/.local/state")) .. "/rex-pokedex"))
local function read_json(path)
  local f = io.open(path, "r")
  if not f then return nil end
  local text = f:read("*a")
  f:close()
  return (rex.json.decode(text))
end
local urgency = { blocked = 0, done = 1, working = 2, idle = 3 }
rex.action{
  name = "pokedex_jump", title = "Pokedex: Jump to Agent", category = "Pokedex",
  keywords = "pokemon teleport goto agent needs you blocked next",
  run = function(ctx)
    local target
    local picked = read_json(state .. "/goto.json")
    if picked and picked.session and picked.at and os.time() * 1000 - picked.at < 60000 then
      target = { session = picked.session, window = picked.window, block = picked.block }
      os.remove(state .. "/goto.json")
    else
      local snap = read_json(state .. "/agents.json")
      for _, a in ipairs(snap and snap.agents or {}) do
        if a.block ~= ctx.block_id and (not target
            or urgency[a.state] < urgency[target.state]
            or (urgency[a.state] == urgency[target.state] and a.since > target.since)) then
          target = a
        end
      end
    end
    if not target then return "no agent to jump to" end
    if target.block then rex.session.focus_block{ session_id = target.session, block_id = target.block } end
    rex.client.queue("session.select", { session_id = target.session, window_id = target.window })
  end,
}

rex.bind("ctrl+a>o", "pokedex_toggle")
rex.bind("ctrl+a>g", "pokedex_jump")
rex.bind("ctrl+a>d", "pokedex_collection")
rex.bind("ctrl+a>t", "pokedex_trainer")
rex.bind("ctrl+a>e", "pokedex_encounter")

-- XP counts while the daemon runs, so start it with the server. A second copy exits at once.
rex.exec.start({ bun, cli, "daemon" }, { detach = true, stdout = false, stderr = false })
