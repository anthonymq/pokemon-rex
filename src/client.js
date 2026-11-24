// Talking to the Pokedex agents server (the pokedex-agents-server repo), which owns
// the game. Every process here reads the game from a copy the server keeps fresh over /events,
// so views still draw synchronously; every change goes through call(). If the server isn't
// running, the first process that needs it starts it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, STATE_DIR, settings, setRemote, readJson } from "./herdr.js";

// The server's port: POKEDEX_PORT, `server.port` in Rex's config.json, else `port` in the server's own
// config.json (where the server reads it), else 7151.
const SERVER_CONFIG = path.join(process.env.XDG_STATE_HOME ?? path.join(os.homedir(), ".local", "state"), "pokedex-agents-server", "config.json");
const port = () => Number(process.env.POKEDEX_PORT) || settings().server?.port || Number(readJson(SERVER_CONFIG, {})?.port) || 7151;
const base = () => `http://127.0.0.1:${port()}`;

// Where the server is installed: POKEDEX_SERVER_DIR, `server.dir` in config.json, or a usual place.
export function serverDir() {
  const home = os.homedir();
  const candidates = [
    process.env.POKEDEX_SERVER_DIR,
    settings().server?.dir,
    path.join(home, ".local", "share", "pokedex-agents-server"),
    path.join(home, "workspace-perso", "pokedex-agents-server"),
  ];
  return candidates.find((d) => d && fs.existsSync(path.join(d, "bin", "pokedex-agents-server.js"))) ?? null;
}
// Starts the server in the background; a second copy exits at once, so racing callers are fine.
export function startServer() {
  const dir = serverDir();
  if (!dir) return false;
  const log = fs.openSync(path.join(STATE_DIR, "server.log"), "a");
  Bun.spawn([process.execPath, path.join(dir, "bin", "pokedex-agents-server.js")], { stdout: log, stderr: log, stdin: "ignore", cwd: dir }).unref();
  return true;
}

// Opens a URL in the browser: open on macOS, start on Windows, else xdg-open (WSL: wslview, else
// Windows' own opener).
function openUrl(url) {
  const cmd = process.platform === "darwin" ? ["open", url]
    : process.platform === "win32" ? ["cmd", "/c", "start", "", url]
    : ["sh", "-c", 'xdg-open "$1" || wslview "$1" || explorer.exe "$1"', "sh", url];
  Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" }).unref();
}
// What to tell the person after shareOnX().
export const shareMessage = ({ copied, card }) => (copied
  ? `Card copied: paste it into the post (${process.platform === "darwin" ? "⌘V" : "Ctrl+V"})`
  : `X opened; attach the card from ${card}`);

// A jingle the server couldn't play itself (no afplay off macOS) comes with its note as `sound`:
// played here from the server's assets with the first player installed.
const SOUNDS = new Set(["evolve.mp3", "badge.mp3"]);
export function playNoteSound(note) {
  const dir = serverDir();
  if (!SOUNDS.has(note.sound) || !dir) return;
  const file = path.join(dir, "assets", "sounds", note.sound);
  const player = [["mpv", "--no-video", "--really-quiet"], ["ffplay", "-nodisp", "-autoexit", "-loglevel", "quiet"], ["mpg123", "-q"], ["play", "-q"]]
    .find(([bin]) => Bun.which(bin));
  if (player) Bun.spawn([...player, file], { stdout: "ignore", stderr: "ignore", stdin: "ignore" }).unref();
}

// Shares progress on X: the server puts the card image on the clipboard, and X's compose
// window opens with the post's text. Resolves with { copied, card } (card: the image's path).
export async function shareOnX() {
  const r = await (await fetch(`${base()}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sprites: path.join(ROOT, "assets", "pokemon") }),
  })).json();
  if (!r.ok) throw new Error(r.error);
  openUrl(r.url);
  return { copied: r.copied, card: r.card };
}

async function post(session, action, args, at) {
  const res = await fetch(`${base()}/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args, origin: "rex", session, ...(at ? { at } : {}) }),
  });
  return res.json();
}
// Resolves with the action's value; rejects with the server's error. A server that is down is
// started, then given a few seconds to listen. `session` is the Rex session the news belongs to.
export async function callFrom(session, action, ...args) {
  let r;
  for (let tries = 0; ; tries++) {
    try {
      r = await post(session || null, action, args);
      break;
    } catch {
      if (tries === 0 && !startServer()) throw new Error("Pokedex server not installed (see POKEDEX_SERVER_DIR)");
      if (tries >= 20) throw new Error("Pokedex server not running");
      await Bun.sleep(200);
    }
  }
  if (!r.ok) throw new Error(r.error);
  return r.value;
}
// One look at the state, for commands that print and exit (starts the server if needed).
export async function loadState() {
  for (let tries = 0; ; tries++) {
    try {
      const state = await (await fetch(`${base()}/state`)).json();
      setRemote(state);
      return state;
    } catch {
      if (tries === 0 && !startServer()) throw new Error("Pokedex server not installed (see POKEDEX_SERVER_DIR)");
      if (tries >= 20) throw new Error("Pokedex server not running");
      await Bun.sleep(200);
    }
  }
}
export const call = (action, ...args) => callFrom(process.env.REX_SESSION, action, ...args);

// --- What agents did, kept when the server can't be reached. Each report carries when it happened;
// one the server can't take now waits in OUTBOX and is sent later, oldest first (the server counts it
// on its own day). A report never overtakes an older one still waiting, so a commit follows its turn.
const EVENTS = new Set(["taskFinished", "subTaskFinished", "unblocked", "result"]);
export const OUTBOX = path.join(STATE_DIR, "outbox.json");
const outbox = () => { try { return JSON.parse(fs.readFileSync(OUTBOX, "utf8")); } catch { return []; } };
const keep = (box) => (box.length ? fs.writeFileSync(OUTBOX, JSON.stringify(box)) : fs.rmSync(OUTBOX, { force: true }));
let flushing = null;
// Sends what waits, oldest first, until it's all sent or the server is still out of reach.
export function flushOutbox() {
  flushing ??= (async () => {
    for (let box = outbox(); box.length; box = outbox()) {
      const e = box[0];
      let r;
      try { r = await post(e.session, e.action, e.args, e.at); } catch { return; }
      if (!r.ok) console.error(`pokedex: queued ${e.action} refused: ${r.error}`);
      keep(outbox().slice(1));
    }
  })().finally(() => { flushing = null; });
  return flushing;
}
async function report(session, action, args) {
  const e = { session: session || null, action, args, at: Date.now() };
  await flushOutbox();
  if (outbox().length) return void keep([...outbox(), e]);
  for (let tries = 0; ; tries++) {
    let r;
    try {
      r = await post(e.session, action, args, e.at);
    } catch {
      // Out of reach: start it, wait a few seconds, then keep the report for later.
      if (tries === 0) startServer();
      if (tries >= 20) return void keep([...outbox(), e]);
      await Bun.sleep(200);
      continue;
    }
    if (!r.ok) throw new Error(r.error); // the server answered no
    return r.value;
  }
}
// For changes nobody waits on: a failure is logged, not thrown. Agent reports are queued while the
// server is out of reach.
export const sendFrom = (session, action, ...args) =>
  (EVENTS.has(action) ? report(session, action, args) : callFrom(session, action, ...args))
    .catch((error) => console.error(`pokedex: ${action} failed: ${error.message}`));

// Follows /events for as long as the process lives, reconnecting when it goes away. The server is
// started only when it can't be reached, once until a state comes through again. `onState` sees each state. Resolves true once the first state is in, false if
// none came within `wait` ms.
export function connect({ wait = 4000, onState } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(false), wait);
    (async () => {
      for (let fails = 0, started = false; ; ) {
        let res;
        try {
          res = await fetch(`${base()}/events`);
        } catch {
          fails++;
          if (!started) { started = true; startServer(); }
          await Bun.sleep(Math.min(5000, 500 * (fails + 1)));
          continue;
        }
        try {
          const decoder = new TextDecoder();
          let buf = "";
          for await (const chunk of res.body) {
            buf += decoder.decode(chunk, { stream: true });
            let end;
            while ((end = buf.indexOf("\n\n")) >= 0) {
              const block = buf.slice(0, end);
              buf = buf.slice(end + 2);
              const data = block.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).join("\n");
              if (!data) continue;
              const state = JSON.parse(data);
              fails = 0;
              started = false;
              setRemote(state);
              try { onState?.(state); } catch (error) { console.error(`pokedex: ${error}`); }
              done(true);
            }
          }
        } catch {
          fails++; // connected, then dropped or sent a bad state: back off, never start another server
        }
        await Bun.sleep(Math.min(5000, 500 * (fails + 1)));
      }
    })();
  });
}
