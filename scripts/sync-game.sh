#!/bin/sh
# src/game.js and src/pokemon.js are copies of the pokedex-agents-server repo's
# ($POKEDEX_SERVER_DIR, else ~/workspace-perso/pokedex-agents-server): Rex uses their read-only
# helpers (levels, names, odds); the server alone changes the game.
#   scripts/sync-game.sh          copy them here
#   scripts/sync-game.sh --check  exit 1 if either differs
set -eu
cd "$(dirname "$0")/.."
SERVER="${POKEDEX_SERVER_DIR:-$HOME/workspace-perso/pokedex-agents-server}"
[ -f "$SERVER/src/game.js" ] || { echo "pokedex-agents-server not found at $SERVER (set POKEDEX_SERVER_DIR)" >&2; exit 1; }
status=0
for file in game.js pokemon.js; do
  if [ "${1:-}" = "--check" ]; then
    cmp -s "$SERVER/src/$file" "src/$file" || { echo "src/$file differs from $SERVER/src/$file" >&2; status=1; }
  else
    cp "$SERVER/src/$file" "src/$file"
  fi
done
[ "${1:-}" = "--check" ] && [ "$status" -eq 0 ] && echo "game.js and pokemon.js match the server's"
exit "$status"
