# pokemon-rex

The Pokedex for Rex: a client of pokedex-agents-server. `init.lua` registers the actions and keys, and `bin/pokedex.js` runs the views and one-shot commands.

## The three repos

| Repo | Local path | Role |
|---|---|---|
| pokedex-agents-server (github.com/anthonymq/pokedex-agents-server) | `~/workspace-perso/pokedex-agents-server` | The only process that runs the game rules. Bun, 127.0.0.1:7151. Save: `~/.local/state/pokedex-agents-server/shared.json`. |
| pokemon-rex (github.com/anthonymq/pokemon-rex) | `~/.config/rex/pokedex` | Rex client. The checkout is also the live install. |
| pokemon-herdr (github.com/anthonymq/pokemon-herdr) | `~/workspace-perso/pokemon-herdr` | Herdr client. The checkout is not live: the mods run from `~/.config/herdr-app/mods/pokedex-*`. |

- Neither app depends on the other. Whichever app needs the server starts it; a second copy exits at once.
- A rule change belongs in the server's `src/game.js`. The apps only read the game and send actions (`POST /call`, `POST /share`).
- The apps keep read-only copies of the server's `game.js` and `pokemon.js`, and every Herdr mod keeps a copy of `mods/pokedex-agents/server.js`. Never edit a copy: change the source, then run `scripts/sync-game.sh` in the app repo. `scripts/sync-game.sh --check` is what Herdr's CI runs.

## Changing things safely

- Before any write to the live save (a live Herdr mod, a running server, a real Rex pane), copy `~/.local/state/pokedex-agents-server/shared.json` aside first, not after.
- For experiments use an isolated server: `POKEDEX_STATE=<tmp dir> POKEDEX_PORT=7199`. Test panes in a live Rex are seen by the real daemon and change the real save.
- The running server only picks up new code after a restart. Its pid is in `~/.local/state/pokedex-agents-server/server.json`; start it again with `bun bin/pokedex-agents-server.js` from the server repo.
- When an app starts using a new server route, push the server first.
- Anything shared publicly (the X post, the share card) shows Pokemon, levels and totals, never project names or paths: those include work repos.

## This repo

- This checkout is what Rex runs, so a saved edit is live the next time a view opens.
- `src/client.js` talks to the server and starts it when it's down. `src/daemon.js` follows Rex's agents. `src/views/*` draw the terminal views.
- `src/game.js` and `src/pokemon.js` are copies from the server: refresh them with `scripts/sync-game.sh`.
- No test suite. Check a change with `bun build --no-bundle <file>` and by opening the view, against an isolated server when it writes.
- Commit messages: a plain sentence, no prefix.
