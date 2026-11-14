# pokemon-rex

A Pokedex for [Rex](https://www.superlogical.com/rex/docs): a port of
[pokemon-herdr](https://github.com/anthonymq/pokemon-herdr). Every coding agent
running in Rex gets its project's Pokemon partner. Partners level up and evolve
as agents finish tasks, wild Pokemon appear, and a trainer card tracks badges,
quests and a daily streak.

Rex has no native mods or layouts, so this is a terminal app: a sidebar pane and
floating dialogs, drawn with true color and the real sprites (kitty graphics,
which Rex's terminal supports). The game rules are pokemon-herdr's `game.js`,
unchanged.

## What you get

| Key | Action | What it opens |
| --- | --- | --- |
| `ctrl+a o` | `pokedex_toggle` | The sidebar, a full-height pane on the left of the current tab. Again to close. |
| `ctrl+a g` | `pokedex_jump` | Teleport to the agent you picked in the sidebar, else the one that most needs you (blocked, then done, then working). Works from any pane, with Remote Control off. |
| `ctrl+a d` | `pokedex_collection` | KANTO DEX, the searchable collection of all 151. |
| `ctrl+a t` | `pokedex_trainer` | The trainer card: stats, recent catches, badges, quests, bag, partners. |
| `ctrl+a e` | `pokedex_encounter` | The waiting wild Pokemon, focused so you can throw. |

The five actions are also in the command palette under "Pokedex".

**Sidebar.** Laid out like pokemon-herdr's:

- the brand plate, with the lens and three status lights (yellow: an agent
  needs you, cyan: one is working). The lens, the lights, the badges and the
  headings in the PxPlus IBM VGA pixel font are pictures (kitty graphics), not
  characters; `python3 tools/make_art.py` redraws them into `assets/ui/`;
- **PROJECTS / SESSIONS**, a dark green screen: each session is a heading band,
  its tabs are rows under it with a colour square, the partner of the agent in
  that tab and a mark (`!` needs you, `*` done, a spinner while working). The
  tab the sidebar is in is highlighted. Click a row to go to that tab;
- **POKEMON / AGENTS**: the KANTO DEX button with your catch count, then one
  square tile per agent under NEEDS YOU, DONE, WORKING and IDLE. A working
  agent's Pokemon bobs, a blocked tile turns amber and blinks `!`, a done one
  gets `✦`, an idle one `z`;
- a card for the selected agent: project, level, status, partner, program,
  time since the last change, its task and XP strip;
- the trainer strip (trainer level, streak, badges); click it for the trainer card.

| In the sidebar | |
| --- | --- |
| `h` `j` `k` `l` or arrows | select an agent |
| `enter` or click | go to that agent's tab and focus its pane |
| `p` or right-click | choose the project's partner from your catches (and use stones) |
| `s` | group agents by priority or by session |
| `d` `t` `e` | Kanto Dex, trainer card, wild encounter |
| `?` `q` | help, close |

**News.** Level-ups (every 5 levels), evolutions, badges, quests and found items
show as a small floating pane at the top right of the session they happened in,
for 7 seconds. A wild Pokemon opens a battle card at the top of the window: click
a ball or press `ctrl+a e` then `1` (Poke Ball), `2` (Great), `3` (Ultra) or `r`
(run). It flees after 60 seconds.

**Tab names in Rex's own sidebar.** Rex's sidebar can't hold custom content, but
it shows tab names. With `{ "labels": { "enabled": true } }` in `config.json`, a
tab holding an agent is named after its partner, such as `Meowth Lv3 · rex`
(`+1` when the tab has agents from more projects). Only tabs still carrying Rex's
default name (`Window 1a2b3c4d`) are renamed; a tab you named yourself is left
alone, and a tab gets its default name back when its agents are gone or the
option is turned off.

## How it works

- **Agents** are terminals that report status with
  [OSC 7501](https://www.superlogical.com/rex/docs/build/program-status), as
  Claude Code, Codex and others do. Nothing is guessed from screen text.
  Records with an id are shown as sub-agents.
- **A daemon** (`pokedex daemon`) follows `rex events --all` for every session.
  When an agent goes from working to idle or done it calls `finishTask`: 10 XP
  plus 5 per full minute, up to 100. It starts with the Rex server (from
  `init.lua`) and any pokedex command restarts it if it is gone. XP only counts
  while it runs.
- **A project** is the git repo an agent started in (`git rev-parse
  --show-toplevel`), else its folder. Agents in one repo share a partner.
- **Rules**: `src/game.js`, as in pokemon-herdr. Level n needs 4·n² XP; Gen 1
  evolution levels; stones and Link Cable from the bag; 15% wild encounters;
  shinies on 7 and 30 day streaks; eight Kanto badges and two ranks; three daily
  quests and one weekly.
- **State** is in `~/.local/state/rex-pokedex/` (`$XDG_STATE_HOME`, or
  `$POKEDEX_STATE`): `shared.json` holds your progress under the same keys Herdr
  uses, `agents.json` is the daemon's live list, `config.json` is optional:

  ```json
  { "sounds": { "enabled": false }, "toasts": { "enabled": false } }
  ```

## Install

Needs [Bun](https://bun.sh) and Rex. Clone it into your Rex config folder:

```sh
git clone https://github.com/anthonymq/pokemon-rex.git ~/.config/rex/pokedex
```

Then add one line to `~/.config/rex/init.lua`:

```lua
require("pokedex")
```

Then `rex config reload`. Change the keys in `pokedex/init.lua` if they clash
with yours.

To bring your progress over from pokemon-herdr:

```sh
bun ~/.config/rex/pokedex/bin/pokedex.js import-herdr
```

It copies `pokedex.game`, `pokedex.caught` and `pokedex.partners` from
`~/.config/herdr-app/data/shared.json` and refuses to replace existing progress
without `--force`. Herdr keys partners by its own project keys; a project whose
repo path is the same in both keeps its partner and level.

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

## Develop

`bun test` runs pokemon-herdr's rule tests against `src/game.js`. `src/herdr.js`
stands in for Herdr's `herdr` module (`tsconfig.json` maps the import), so
`game.js` can be replaced by a newer copy from pokemon-herdr as is.

| File | |
| --- | --- |
| `src/game.js`, `src/pokemon.js` | the rules and names, from pokemon-herdr |
| `src/herdr.js` | shared state file, lock, settings, notify and sound hooks |
| `src/daemon.js` | follows Rex events, tracks agents, awards XP |
| `src/core.js` | partners, news, toasts, opening dialogs |
| `src/rex.js` | `rex` CLI wrappers: views, splits, floating panes |
| `src/term.js`, `src/png.js` | the TUI kit: cells, kitty pictures, input; sprite cropping |
| `src/views/` | sidebar, collection, trainer, encounter, toast |
| `init.lua` | Rex actions and keys |

## Differences from pokemon-herdr

- No window chrome: Rex's own tabs, pane frames and status stay as they are.
  Only fixed headings use the pixel font (as pictures); names and other live
  text use the terminal's font.
- `enter` in the sidebar shows the agent's session and tab only when Remote
  Control is on in Rex's settings (Rex takes "show this tab" from outside the
  app only then). With it off, the sidebar remembers the pick and `ctrl+a g`
  takes you there.
- Pins, drag reordering and the alerts drawer are not ported.
- The blocked pulse is a blinking `!` (terminal pictures can't fade).

Sprites and Pokemon names are third-party artwork; see [NOTICE.md](NOTICE.md).
