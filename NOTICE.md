# Third-party notices

pokemon-rex is a port of [pokemon-herdr](https://github.com/anthonymq/pokemon-herdr)
to Rex. `src/game.js` (the game rules), `src/pokemon.js` (names) and
`tests/game.test.js` are copied from it; `src/game.js` and `src/pokemon.js` are
unchanged, and the test file differs only in its import path. The partner
defaults in `src/core.js` and the agent tracking in `src/daemon.js` follow its
`pokedex-agents` mod, which derives from Herdr's shipped mods. The inherited
license is in [LICENSE-APACHE-2.0.txt](LICENSE-APACHE-2.0.txt).

That license does not cover the artwork:

- `assets/pokemon/` (151 sprites) and `assets/badges/` (eight Kanto badges)
  come from the PokeAPI sprites repository by way of pokemon-herdr. This
  package grants no rights to Pokemon artwork or names.
- `assets/sounds/` holds pokemon-herdr's two synthesized jingles, not game audio.
