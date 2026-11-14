// Stand-in for Herdr's `herdr` module, so src/game.js runs unchanged from pokemon-herdr.
// shared()/setShared() are backed by one JSON file that every pokedex process reads and
// writes; notify() and playSound() go through the handlers in notes.js.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

export const STATE_DIR = process.env.POKEDEX_STATE
  ?? path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "rex-pokedex");
export const ROOT = path.resolve(import.meta.dir, "..");
const FILE = path.join(STATE_DIR, "shared.json");
const LOCK = path.join(STATE_DIR, "shared.lock");

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

let cache = null;
let cacheStamp = "";
function load() {
  let stamp = "";
  try {
    const st = fs.statSync(FILE);
    stamp = `${st.mtimeMs}:${st.size}`;
  } catch {
    return {};
  }
  if (stamp !== cacheStamp || !cache) {
    cache = readJson(FILE, {});
    cacheStamp = stamp;
  }
  return cache;
}

export const shared = (key) => load()[key];
export function setShared(key, value) {
  cacheStamp = "";
  const all = { ...load(), [key]: structuredClone(value) };
  writeJson(FILE, all);
  cache = all;
  cacheStamp = "";
}
export const sharedFile = FILE;

// The rules read state, change it and write it back. Several processes play (the daemon
// awards XP, a dialog throws a ball), so each such step runs under one lock.
let held = 0;
export function locked(fn) {
  if (held) return fn();
  const until = Date.now() + 2000;
  for (;;) {
    try {
      fs.mkdirSync(LOCK);
      break;
    } catch {
      try {
        // A lock older than 5 s belongs to a process that died holding it.
        if (Date.now() - fs.statSync(LOCK).mtimeMs > 5000) fs.rmdirSync(LOCK);
      } catch {}
      if (Date.now() > until) break; // rather play unlocked than hang the interface
      Bun.sleepSync(5);
    }
  }
  held++;
  try {
    cacheStamp = "";
    return fn();
  } finally {
    held--;
    try { fs.rmdirSync(LOCK); } catch {}
  }
}

// { sounds: { enabled }, toasts: { enabled } }, from config.json in the state folder.
export const settings = () => {
  const c = readJson(path.join(STATE_DIR, "config.json"), {});
  return { ...c, sounds: { enabled: c.sounds?.enabled !== false }, toasts: { enabled: c.toasts?.enabled !== false } };
};

const handlers = { notify: null, sound: null };
export const setHandlers = (h) => Object.assign(handlers, h);
export function notify(note) {
  try { handlers.notify?.(note); } catch (error) { console.error(`pokedex: notify failed: ${error}`); }
  return "note";
}
export function playSound(sound) {
  try { handlers.sound?.(sound); } catch {}
  return null;
}
