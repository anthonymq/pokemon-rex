// Stand-in for Herdr's `herdr` module, so src/game.js (a copy of pokedex-agents-server's) loads
// here for its read-only helpers: levels, names, odds. The game itself is the server's; shared()
// reads the copy src/client.js keeps, and anything that would change it throws.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

// Rex's own files: agents seen, settings, the daemon's pid and log, tab names.
export const STATE_DIR = process.env.POKEDEX_STATE
  ?? path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "rex-pokedex");
export const ROOT = path.resolve(import.meta.dir, "..");

fs.mkdirSync(STATE_DIR, { recursive: true });

export function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return fallback;
  }
}
// Written whole to a temp file and renamed, so a reader never sees half a file.
export function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value));
  fs.renameSync(tmp, file);
}

// The last state the server sent (src/client.js), or null before the first one.
let remote = null;
export const setRemote = (state) => { remote = state; };
export const remoteState = () => remote;

export const shared = (key) => remote?.shared?.[key];
const serverOnly = () => { throw new Error("the game changes only through the Pokedex server (src/client.js call())"); };
export const setShared = serverOnly;
export const notify = serverOnly;
export const playSound = () => null;

// { sounds, toasts, sidebar, labels, server }, from config.json in the state folder.
export const settings = () => {
  const c = readJson(path.join(STATE_DIR, "config.json"), {});
  return { ...c, sounds: { enabled: c.sounds?.enabled !== false }, toasts: { enabled: c.toasts?.enabled !== false } };
};
