// Talking to the Pokedex agents server (the pokedex-agents-server repo), which owns
// the game. Every process here reads the game from a copy the server keeps fresh over /events,
// so views still draw synchronously; every change goes through call(). If the server isn't
// running, the first process that needs it starts it.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT, STATE_DIR, settings, setRemote } from "./herdr.js";

const port = () => Number(process.env.POKEDEX_PORT) || settings().server?.port || 7151;
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

// Shares progress on X: the server puts the card image on the clipboard, and X's compose
// window opens with the post's text. Resolves with whether the card was copied.
export async function shareOnX() {
  const r = await (await fetch(`${base()}/share`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ sprites: path.join(ROOT, "assets", "pokemon") }),
  })).json();
  if (!r.ok) throw new Error(r.error);
  Bun.spawn(["open", r.url], { stdout: "ignore", stderr: "ignore" }).unref();
  return r.copied;
}

async function post(session, action, args) {
  const res = await fetch(`${base()}/call`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ action, args, origin: "rex", session }),
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
// For changes nobody waits on: a failure is logged, not thrown.
export const sendFrom = (session, action, ...args) =>
  callFrom(session, action, ...args).catch((error) => console.error(`pokedex: ${action} failed: ${error.message}`));

// Follows /events for as long as the process lives, reconnecting (and starting the server) when
// it goes away. `onState` sees each state. Resolves true once the first state is in, false if
// none came within `wait` ms.
export function connect({ wait = 4000, onState } = {}) {
  return new Promise((resolve) => {
    let settled = false;
    const done = (v) => { if (!settled) { settled = true; resolve(v); } };
    setTimeout(() => done(false), wait);
    (async () => {
      for (let fails = 0; ; ) {
        try {
          const res = await fetch(`${base()}/events`);
          fails = 0;
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
              setRemote(state);
              try { onState?.(state); } catch (error) { console.error(`pokedex: ${error}`); }
              done(true);
            }
          }
        } catch {
          if (fails++ === 0) startServer();
        }
        await Bun.sleep(Math.min(5000, 500 * (fails + 1)));
      }
    })();
  });
}
