# Gotta Ship 'Em All

**A Pokedex for [Rex](https://www.superlogical.com/rex/docs). Every coding agent in your terminal gets a Pokemon partner, and finishing work is how you fill the Pokedex.**

![A one-minute tour: partners, XP, an evolution, a wild Snorlax, the Kanto Dex and the trainer card](docs/demo.gif)

Claude Code is porting a town map. Codex is fixing a step counter. Beside them, in a red Kanto Pokedex, Pikachu and Eevee bob along while they work.

Then a task finishes. XP lands. Charmander hits Lv 16 and evolves on its own. And sometimes a wild Snorlax drops onto the window, and you have 60 seconds.

You can't grind it. You can only ship.

---

## What happens while you work

| When | What you see |
| --- | --- |
| An agent starts in a project | The project gets a partner Pokemon, and you catch it. |
| An agent is working | Its partner bobs in the sidebar. |
| An agent finishes a task | **10 XP, +5 per minute it ran, up to 100.** Level-ups, then evolutions at the real Gen 1 levels. |
| An agent is waiting on you | It jumps to the top under **NEEDS YOU**, in amber, blinking `!`. Leave it 10 minutes and its partner faints. |
| A task finishes (15% of the time) | A wild Pokemon appears. Three free Poke Balls, 60 seconds. |
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
- Ignore it for 60 seconds and it flees.

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

You need [Bun](https://bun.sh) and Rex. Clone into your Rex config folder:

```sh
git clone https://github.com/anthonymq/pokemon-rex.git ~/.config/rex/pokedex
```

Add one line to `~/.config/rex/init.lua`:

```lua
require("pokedex")
```

Then `rex config reload`, and press `ctrl+a o`.

Coming from [pokemon-herdr](https://github.com/anthonymq/pokemon-herdr)? Bring your progress with you:

```sh
bun ~/.config/rex/pokedex/bin/pokedex.js import-herdr
```

It copies your game, catches and partners from `~/.config/herdr-app/data/shared.json`, and refuses to replace existing progress without `--force`. A project whose repo path is the same in both keeps its partner and level.

---

## Keys

| Key | Action | What it opens |
| --- | --- | --- |
| `ctrl+a o` | `pokedex_toggle` | The sidebar, a full-height pane at the edge of the current tab. Again to close. |
| `ctrl+a g` | `pokedex_jump` | Teleport to the agent you picked in the sidebar, else the one that most needs you (blocked, then done, then working). |
| `ctrl+a d` | `pokedex_collection` | The Kanto Dex. |
| `ctrl+a t` | `pokedex_trainer` | The trainer card. |
| `ctrl+a e` | `pokedex_encounter` | The waiting wild Pokemon, focused so you can throw. |

All five are in the command palette under "Pokedex". Change the keys in `pokedex/init.lua` if they clash with yours.

In the sidebar:

| Key | |
| --- | --- |
| `h` `j` `k` `l` or arrows | select an agent |
| `enter` or click | go to that agent's tab and focus its pane |
| `p` or right-click | choose the project's partner from your catches, and use stones |
| `s` | group agents by priority or by session |
| `d` `t` `e` | Kanto Dex, trainer card, wild encounter |
| `?` `q` | help, close |

On the battle card: `1` Poke Ball, `2` Great Ball, `3` Ultra Ball, `r` run. Or click.

---

## The sidebar, top to bottom

![The Pokedex sidebar beside two Claude Code panes: six projects, each with a partner Pokemon](docs/sidebar.png)

- **The brand plate**: the lens and three status lights (yellow when an agent needs you, cyan when one is working).
- **PROJECTS / SESSIONS**: each session is a heading band, its tabs are rows under it with the partner of the agent in that tab and a mark (`!` needs you, `*` done, a spinner while working). Click a row to go to that tab.
- **POKEMON / AGENTS**: the Kanto Dex button, then one tile per agent under NEEDS YOU, DONE, WORKING and IDLE.
- **The agent card**: project, level, status, partner, program, its task and XP strip.
- **The trainer strip**: trainer level, streak, badges. Click it for the trainer card.

**News** (level-ups every 5 levels, evolutions, badges, quests, found items) shows as a small floating pane at the top right of the session it happened in, for 7 seconds.

**Tab names.** Rex's own sidebar can't hold custom content, but it shows tab names. With `labels.enabled`, a tab holding an agent is named after its partner, such as `Meowth Lv3 · rex`. Only tabs still carrying Rex's default name are renamed; a tab you named yourself is left alone.

---

## Settings

Optional, in `~/.local/state/rex-pokedex/config.json`:

```json
{
  "sidebar": { "auto": true, "side": "left", "columns": 30 },
  "labels": { "enabled": true },
  "sounds": { "enabled": false },
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
| `sounds.enabled` | The evolution and badge jingles (on by default). |
| `toasts.enabled` | The floating news pane (on by default). |

Rex only knows a pane's real size while it is on screen, so with `columns` the sidebar measures itself when shown and moves its own border; a sidebar opened in a background tab settles to the exact width when you first look at it.

---

## Commands

```sh
pokedex toggle                 # sidebar in this window
pokedex open collection        # add --pick <project> for the partner picker
pokedex open trainer
pokedex open encounter
pokedex status                 # daemon, trainer and agents as text
pokedex catch 25               # by hand; release 25 undoes it
pokedex stop | log             # the daemon
```

(`pokedex` here is `bun ~/.config/rex/pokedex/bin/pokedex.js`.)

---

## How it works

Rex has no native mods or layouts, so this is a terminal app: a sidebar pane and floating dialogs, drawn with true color and the real sprites through kitty graphics, which Rex's terminal supports. The pixel-font headings are pictures too.

- **A daemon** (`pokedex daemon`) follows `rex events --all` for every session. When an agent goes from working to idle or done, it awards the task. It starts with the Rex server and any pokedex command restarts it if it is gone. XP only counts while it runs.
- **The rules** are pokemon-herdr's `src/game.js`, unchanged, with its tests.
- **State** lives in `~/.local/state/rex-pokedex/` (`$XDG_STATE_HOME`, or `$POKEDEX_STATE`): `shared.json` holds your progress under the same keys Herdr uses, `agents.json` is the daemon's live list.

### Differences from pokemon-herdr

- No window chrome: Rex's own tabs, pane frames and status stay as they are.
- `enter` in the sidebar shows the agent's tab only when Remote Control is on in Rex's settings. With it off, the sidebar remembers the pick and `ctrl+a g` takes you there.
- Pins, drag reordering and the alerts drawer are not ported.
- The blocked pulse is a blinking `!` (terminal pictures can't fade).

---

## Develop

`bun test` runs pokemon-herdr's rule tests against `src/game.js`. `src/herdr.js` stands in for Herdr's `herdr` module (`tsconfig.json` maps the import), so `game.js` can be replaced by a newer copy from pokemon-herdr as is.

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
