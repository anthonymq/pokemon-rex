#!/usr/bin/env bun
// pokedex: the Pokedex for Rex. Views run inside Rex panes; the rest are one-shot commands.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { shared, setShared, locked, sharedFile, STATE_DIR, readJson } from "../src/herdr.js";
import { game, levelOf, trainerLevel, liveStreak, nameOf, projectLabel, recordCatches, CAUGHT, GAME, PARTNERS } from "../src/game.js";
import { agentsSnapshot, caught, daemonPid, ensureDaemon, openDialog, LOG_FILE } from "../src/core.js";
import { toggleSidebar } from "../src/rex.js";

const [cmd = "help", ...args] = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : null;
};
const session = () => flag("session") || process.env.REX_SESSION;
const target = () => ({ block: flag("block") || process.env.REX_BLOCK || undefined, window: flag("window") || undefined });
const need = (r) => {
  if (r?.ok === false) {
    console.error(`pokedex: ${r.error}`);
    process.exit(1);
  }
};
const dexId = (text) => {
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > 151) {
    console.error(`pokedex: ${text} is not a Kanto number (1 to 151); nothing changed`);
    process.exit(1);
  }
  return n;
};

switch (cmd) {
  case "sidebar": (await import("../src/views/sidebar.js")).runSidebar(); break;
  case "collection": (await import("../src/views/collection.js")).runCollection(args); break;
  case "trainer": (await import("../src/views/trainer.js")).runTrainer(); break;
  case "encounter": (await import("../src/views/encounter.js")).runEncounter(); break;
  case "toast": (await import("../src/views/toast.js")).runToast(); break;
  case "daemon": await (await import("../src/daemon.js")).runDaemon(); break;

  // Opening things from a key binding or a shell.
  case "toggle": {
    if (!session()) need({ ok: false, error: "run this inside Rex, or pass --session" });
    ensureDaemon();
    need(toggleSidebar(session(), target()));
    break;
  }
  case "open": {
    const name = args[0];
    if (!["collection", "trainer", "encounter"].includes(name)) need({ ok: false, error: "open what? collection, trainer or encounter" });
    if (!session()) need({ ok: false, error: "run this inside Rex, or pass --session" });
    ensureDaemon();
    if (name === "encounter" && !game().encounter) {
      console.log("No wild Pokemon right now.");
      break;
    }
    const pick = flag("pick");
    need(openDialog(session(), target(), name, pick ? ["--pick", pick] : []));
    break;
  }

  case "status": {
    const g = game();
    const snap = agentsSnapshot();
    const pid = daemonPid();
    console.log(`daemon    ${pid ? `running (pid ${pid})` : "not running"}`);
    console.log(`state     ${STATE_DIR}`);
    console.log(`trainer   Lv ${trainerLevel(g)} · caught ${caught().length}/151 · tasks ${g.tasks} + ${g.subtasks} sub · streak ${liveStreak(g)}d (best ${g.streak.best})`);
    console.log(`badges    ${g.badges.join(", ") || "none"}`);
    if (g.encounter) console.log(`wild      ${nameOf(g.encounter.id)} (${g.encounter.balls} balls left)`);
    const partners = shared(PARTNERS) ?? {};
    for (const [project, xp] of Object.entries(g.xp).sort((a, b) => b[1] - a[1])) {
      console.log(`partner   ${projectLabel(project).padEnd(24)} ${nameOf(partners[project] ?? 0).padEnd(12)} Lv ${String(levelOf(xp)).padStart(3)}  ${xp} XP`);
    }
    for (const a of pid ? snap.agents : []) {
      console.log(`agent     ${projectLabel(a.project).padEnd(24)} ${a.state.padEnd(8)} ${(a.app || "?").padEnd(12)} ${nameOf(a.partner)} · ${a.sessionLabel}`);
    }
    break;
  }
  case "catch": {
    const id = dexId(args[0]);
    locked(() => recordCatches([id]));
    console.log(`caught ${nameOf(id)}: ${JSON.stringify(caught())}`);
    break;
  }
  case "release": {
    const id = dexId(args[0]);
    locked(() => setShared(CAUGHT, caught().filter((n) => n !== id)));
    console.log(`released ${nameOf(id)}: ${JSON.stringify(caught())}`);
    break;
  }
  case "stop": {
    const pid = daemonPid();
    if (pid) process.kill(pid, "SIGTERM");
    console.log(pid ? `stopped daemon ${pid}` : "daemon not running");
    break;
  }
  case "log": console.log(fs.existsSync(LOG_FILE) ? fs.readFileSync(LOG_FILE, "utf8").split("\n").slice(-40).join("\n") : "no log yet"); break;

  // Brings progress over from pokemon-herdr: the same keys, read from Herdr's shared.json.
  case "import-herdr": {
    const from = args.find((a) => !a.startsWith("--")) ?? path.join(os.homedir(), ".config", "herdr-app", "data", "shared.json");
    const theirs = readJson(from, null);
    if (!theirs) need({ ok: false, error: `can't read ${from}` });
    const keys = [GAME, CAUGHT, PARTNERS].filter((k) => theirs[k] !== undefined);
    if (!keys.length) need({ ok: false, error: `${from} holds no Pokedex progress` });
    const mine = keys.filter((k) => shared(k) !== undefined);
    if (mine.length && !args.includes("--force")) need({ ok: false, error: `you already have progress here (${mine.join(", ")}); pass --force to replace it` });
    if (mine.length) fs.copyFileSync(sharedFile, `${sharedFile}.bak-${Date.now()}`);
    // A waiting encounter belongs to the other app's clock; leave it there.
    locked(() => { for (const k of keys) setShared(k, k === GAME ? { ...theirs[k], encounter: null } : theirs[k]); });
    console.log(`imported ${keys.join(", ")} from ${from}`);
    break;
  }

  default:
    console.log(`pokedex: the Pokedex for Rex

  pokedex toggle             open or close the sidebar in this window
  pokedex open collection    KANTO DEX (add --pick <project> to choose a partner)
  pokedex open trainer       trainer card
  pokedex open encounter     the waiting wild Pokemon
  pokedex status             daemon, trainer and agents, as text
  pokedex catch <n> | release <n>
  pokedex import-herdr [shared.json] [--force]
  pokedex stop | log         the background daemon

Views (run by Rex panes): sidebar, collection, trainer, encounter, toast, daemon.`);
}
