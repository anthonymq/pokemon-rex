# Gotta Ship 'Em All

**A Pokedex for [Rex](https://www.superlogical.com/rex/docs). Every coding agent in your terminal gets a Pokemon partner, and finishing work is how you fill the Pokedex.**

![A one-minute tour: partners, XP, an evolution, a wild Snorlax, the Kanto Dex and the trainer card](docs/demo.gif)

Claude Code is porting a town map. Codex is fixing a step counter. Beside them, in a red Kanto Pokedex, Pikachu and Eevee bob along while they work.

Then a task finishes. XP lands. Charmander hits Lv 16 and evolves on its own. And sometimes a wild Snorlax shows up in the tall grass, waiting for you to finish what you're doing.

---

## What happens while you work

| When | What you see |
| --- | --- |
| An agent starts in a project | The project gets a partner Pokemon. |
| An agent is working | Its partner bobs in the sidebar. |
| An agent finishes a task | **10 XP, +5 per minute it ran, up to 100.** Level-ups, then evolutions at the real Gen 1 levels. |
| An agent is waiting on you | It jumps to the top under **NEEDS YOU**, in amber, blinking `!`. Answer within 2 minutes and its partner is happy: +25% XP on the next task. |
| A task finishes (15% of the time) | A wild Pokemon joins the tall grass. Three free Poke Balls, and it waits a day. |
| You keep a streak going | Shinies start showing up at 7 days, more at 30. |

Agents are found by [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status), the status protocol Claude Code, Codex and others already speak. Nothing is guessed from screen text.

---

## The game

### Partners and XP

Every project (a git repo, else a folder) has one partner, shared by every agent working in it.

- **10 XP** per finished task, **+5 per full minute** it ran, up to **100**
- **10 XP** for each finished sub-agent
- Level *n* costs `4 × n²` XP: Lv 16 is 1,024 XP, Lv 100 is 40,000

Partners **evolve at their real Gen 1 levels**. Charmander becomes Charmeleon at 16. Dratini makes you wait until 30, then 55. Magikarp is still Magikarp until 20.

Stone and trade evolutions need the item: Fire, Water, Thunder, Leaf and Moon Stones, and a **Link Cable** for the four that used to need a friend. Long tasks and quests drop them, and you choose when to use one.

### Wild encounters

![A wild Snorlax appeared over the workspace, with catch odds for each ball](docs/wild-encounter.png)

- **3 free Poke Balls.** Great Balls (×1.5) and Ultra Balls (×2) come from your bag.
- Base odds: **60%** for most, **35%** for final evolutions, **3%** for legendaries.
- **Keep working and it weakens.** Each task finished while it waits adds 25% to your odds, up to three times.
- **The tall grass** holds up to 5 wild Pokemon. Each waits 24 hours, then leaves. Nothing opens on its own: the sidebar shows `Tall grass 2/5`; open it with `e`, a click or `ctrl+a e` and pick which one to throw at.
- A toast for a new one depends on `pokedex set alert`: `smart` (the default) only while no agent is working, `on` always, `off` never.

### Hard mode

Off by default. With `pokedex set hard-mode on`, an agent left waiting on you for 10 minutes makes its partner faint, and the next task earns no XP.

### Kanto Dex

![The Kanto Dex: a grid of caught Pokemon with their sprites](docs/kanto-dex.png)

All 151, searchable by name or number. Every catch remembers how you got it (met in a project, caught wild, evolved), where and when. Shinies get a gold card.

### Trainer card

![The trainer card: stats, recent catches, badges, quests, bag and partners](docs/trainer-card.png)

- **Eight Kanto badges** and two ranks past them: Elite Four at 1,000 tasks, Champion with all eight badges.
- **Three daily quests and one weekly**, paid in balls and stones.
- **A daily streak**, your bag, your recent catches and every project's partner by XP.

---

## Install

You need [Bun](https://bun.sh), Rex and the [Pokedex agents server](https://github.com/anthonymq/pokedex-agents-server), which holds the game and your progress. Clone both:

```sh
git clone https://github.com/anthonymq/pokedex-agents-server.git ~/.local/share/pokedex-agents-server
git clone https://github.com/anthonymq/pokemon-rex.git ~/.config/rex/pokedex
```

The Pokedex starts the server when it isn't running. Put the server somewhere else with `$POKEDEX_SERVER_DIR` or `server.dir` in the config.

Add one line to `~/.config/rex/init.lua`:

```lua
require("pokedex")
```

Then `rex config reload`, and press `ctrl+a o`.

Also playing in [pokemon-herdr](https://github.com/anthonymq/pokemon-herdr)? It uses the same server, so both apps share one save, and a project whose repo path is the same in both keeps its partner and level. To replace your progress with a copy of an old Herdr `shared.json` instead, run `bun ~/.config/rex/pokedex/bin/pokedex.js import-herdr [file] --force`. The server keeps a backup.

---

## Keys

| Key | Action | What it opens |
| --- | --- | --- |
| `ctrl+a o` | `pokedex_toggle` | The sidebar, a full-height pane at the edge of the current tab. Again to close. |
| `ctrl+a g` | `pokedex_jump` | Teleport to the agent you picked in the sidebar, else the one that most needs you (blocked, then done, then working). |
| `ctrl+a d` | `pokedex_collection` | The Kanto Dex. |
| `ctrl+a t` | `pokedex_trainer` | The trainer card. |
| `ctrl+a e` | `pokedex_encounter` | The tall grass: the waiting wild Pokemon, focused so you can throw. |

All five are in the command palette under "Pokedex". Change the keys in `pokedex/init.lua` if they clash with yours.

In the sidebar:

| Key | |
| --- | --- |
| `h` `j` `k` `l` or arrows | select an agent |
| `enter` or click | go to that agent's tab and focus its pane |
| `p` or right-click | choose the project's partner from your catches, and use stones |
| `s` | group agents by priority or by session |
| `d` `t` `e` | Kanto Dex, trainer card, tall grass |
| `?` `q` | help, close |

On the battle card: `←` `→` choose a Pokemon, `1` Poke Ball, `2` Great Ball, `3` Ultra Ball, `r` run, `q` close (they keep waiting). Or click.

---

## The sidebar, top to bottom

![The Pokedex sidebar beside two Claude Code panes: six projects, each with a partner Pokemon](docs/sidebar.png)

- **The brand plate**: the lens and three status lights (yellow when an agent needs you, cyan when one is working).
- **PROJECTS / SESSIONS**: each session is a heading band, its tabs are rows under it with the partner of the agent in that tab and a mark (`!` needs you, `*` done, a spinner while working). Click a row to go to that tab.
- **POKEMON / AGENTS**: the Kanto Dex button, then one tile per agent under NEEDS YOU, DONE, WORKING and IDLE.
- **The agent card**: project, level, status, partner, program, its task and XP strip.
- **The trainer strip**: trainer level, streak, badges. Click it for the trainer card.

**News** (evolutions, badges, a "Welcome back!" summary) shows as a small floating pane at the top right of the session it happened in, for 7 seconds, without taking focus. Small news (level-ups, found items, quests) only shows in the sidebar's news row; the server sums it up in the "Welcome back!" note after 2 hours away.

**Tab names.** Rex's own sidebar can't hold custom content, but it shows tab names. With `labels.enabled`, a tab holding an agent is named after its partner, such as `Meowth Lv3 · rex`. Only tabs still carrying Rex's default name are renamed; a tab you named yourself is left alone.

---

## Settings

Optional, in `~/.local/state/rex-pokedex/config.json`:

```json
{
  "sidebar": { "auto": true, "side": "left", "columns": 30 },
  "labels": { "enabled": true },
  "toasts": { "enabled": false }
}
```

| Setting | |
| --- | --- |
| `sidebar.side` | `right` (default) or `left`. |
| `sidebar.columns` | Width in terminal cells, the same in every tab. 30 is slim and still fits everything. |
| `sidebar.width` | Width as a share of the tab (default 0.25), used when `columns` is absent. |
| `sidebar.auto` | Keep the sidebar open in every session's current tab, so it is there wherever you switch. |
| `labels.enabled` | Name agent tabs after their partner. |
| `toasts.enabled` | The floating news pane (on by default). |

Game options are the server's, shared with pokemon-herdr, and shown by `pokedex status` and on the trainer card: `pokedex set alert off|on|smart` and `pokedex set hard-mode on|off`.

The evolution and badge jingles are the server's: turn them off with `"sounds": { "enabled": false }` in `~/.local/state/pokedex-agents-server/config.json`.

Rex only knows a pane's real size while it is on screen, so with `columns` the sidebar measures itself when shown and moves its own border; a sidebar opened in a background tab settles to the exact width when you first look at it.

---

## Commands

```sh
pokedex toggle                 # sidebar in this window
pokedex open collection        # add --pick <project> for the partner picker
pokedex open trainer
pokedex open encounter
pokedex status                 # daemon, trainer, options and agents as text
pokedex set alert smart        # off | on | smart: toasts for new wild Pokemon
pokedex set hard-mode off      # on: partners can faint
pokedex catch 25               # debug only (server started with POKEDEX_DEBUG=1); release 25 undoes it
pokedex stop | log             # the daemon
```

(`pokedex` here is `bun ~/.config/rex/pokedex/bin/pokedex.js`.)

---

## How it works

Rex has no native mods or layouts, so this is a terminal app: a sidebar pane and floating dialogs, drawn with true color and the real sprites through kitty graphics, which Rex's terminal supports. The pixel-font headings are pictures too.

- **The game** is the [Pokedex agents server](https://github.com/anthonymq/pokedex-agents-server)'s. It plays the rules and keeps your progress. Every pokedex process follows it live and sends it what happens, so Rex and Herdr play one save.
- **A daemon** (`pokedex daemon`) follows `rex events --all` for every session. When an agent goes from working to idle or done, it reports the finished task to the server, and it shows the news Rex caused as toasts. It starts with the Rex server, and any pokedex command restarts it if it is gone. XP only counts while it runs.
- **Rex's own state** lives in `~/.local/state/rex-pokedex/` (`$XDG_STATE_HOME`, or `$POKEDEX_STATE`): the settings, the daemon's pid and log, and `agents.json`, the daemon's live list of agents.

### Differences from pokemon-herdr

- No window chrome: Rex's own tabs, pane frames and status stay as they are.
- `enter` in the sidebar shows the agent's tab only when Remote Control is on in Rex's settings. With it off, the sidebar remembers the pick and `ctrl+a g` takes you there.
- Pins, drag reordering and the alerts drawer are not ported.
- The blocked pulse is a blinking `!` (terminal pictures can't fade).

---

## Develop

The rules and their tests live in pokedex-agents-server. `src/game.js` and `src/pokemon.js` are copies of its files, kept for read-only helpers (levels, names, odds). `scripts/sync-game.sh` refreshes them, and `--check` reports a copy that differs. `src/herdr.js` stands in for Herdr's `herdr` module (`tsconfig.json` maps the import), and it refuses any change to the game: changes go through `src/client.js`.

To look at a view without a terminal, dump one frame and turn it into a PNG (needs Pillow):

```sh
POKEDEX_DUMP=/tmp/frame.json POKEDEX_SIZE=100x34 bun bin/pokedex.js collection
python3 tools/preview.py /tmp/frame.json /tmp/frame.png
```

`python3 tools/make_art.py` redraws `assets/ui/`: the lens, the lights and the pixel-font glyph strips.

| File | |
| --- | --- |
| `src/game.js`, `src/pokemon.js` | the rules and names, from pokemon-herdr |
| `src/herdr.js` | shared state file, lock, settings, notify and sound hooks |
| `src/daemon.js` | follows Rex events, tracks agents, awards XP |
| `src/core.js` | partners, news, toasts, opening dialogs |
| `src/rex.js` | `rex` CLI wrappers: views, splits, floating panes |
| `src/term.js`, `src/png.js` | the TUI kit: cells, kitty pictures, input; sprite cropping |
| `src/views/` | sidebar, collection, trainer, encounter, toast; `chrome.js` is their shared header |
| `tools/` | `make_art.py` draws the UI art, `preview.py` renders a dumped frame |
| `init.lua` | Rex actions and keys |

---

Sprites and Pokemon names are third-party artwork; see [NOTICE.md](NOTICE.md). The screenshots show a staged session with scripted agents.
