#!/usr/bin/env bun
// pokedex: the Pokedex for Rex. Views run inside Rex panes; the rest are one-shot commands.
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { shared, STATE_DIR, readJson } from "../src/herdr.js";
import { game, partyOf, trainerLevel, liveStreak, nameOf, projectLabel, options, CAUGHT, GAME, GIFTS, PARTNERS, WILD_MAX } from "../src/game.js";
import { call, connect, loadState, serverDir, shareOnX } from "../src/client.js";
import { agentsSnapshot, caught, daemonPid, ensureDaemon, openDialog, wildNow, LOG_FILE } from "../src/core.js";
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

// The game is the Pokedex server's: views follow it live, one-shot commands read it once.
const VIEWS = ["sidebar", "collection", "trainer", "encounter", "toast"];
const READS = ["open", "status", "catch", "release", "import-herdr", "set"];
const optionsLine = (o = options()) => `alert ${o.alert} · hard mode ${o.hardMode ? "on" : "off"}`;
if (VIEWS.includes(cmd)) {
  ensureDaemon();
  await connect();
} else if (READS.includes(cmd)) {
  try { await loadState(); } catch (error) { need({ ok: false, error: error.message }); }
}
const ask = async (action, ...a) => {
  try {
    const value = await call(action, ...a);
    await loadState();
    return value;
  } catch (error) {
    need({ ok: false, error: error.message });
  }
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
    if (name === "encounter" && !wildNow(game()).length) {
      console.log("The tall grass is empty.");
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
    console.log(`server    ${serverDir() ?? "not installed"}`);
    console.log(`trainer   Lv ${trainerLevel(g)} (${g.lifetime} XP) · caught ${caught().length}/151 · tasks ${g.tasks} + ${g.subtasks} sub · streak ${liveStreak(g)}d (best ${g.streak.best})`);
    console.log(`badges    ${g.badges.join(", ") || "none"}`);
    console.log(`options   ${optionsLine()}`);
    const wild = wildNow(g);
    console.log(`wild      tall grass ${wild.length}/${WILD_MAX}${wild.length ? `: ${wild.map((e) => `${nameOf(e.id)} (${e.balls} balls)`).join(", ")}` : ""}`);
    const party = partyOf(g);
    if (!party.length) console.log(`party     no starter yet${g.bank ? ` (${g.bank} XP waiting)` : ""}: choose it on the trainer card`);
    party.forEach((p, i) => {
      console.log(`party     ${nameOf(p.id).padEnd(12)} Lv ${String(p.level).padStart(3)}  ${p.xp} XP${i === 0 ? "  lead" : "  Day Care"}`);
    });
    for (const tr of g.gifts.pending) console.log(`gift      waiting (trainer Lv ${tr}): ${GIFTS.find((x) => x.tr === tr)?.ids.map(nameOf).join(" or ")}, on the trainer card`);
    const mascots = shared(PARTNERS) ?? {};
    for (const [project, id] of Object.entries(mascots).sort(([a], [b]) => projectLabel(a).localeCompare(projectLabel(b)))) {
      console.log(`mascot    ${projectLabel(project).padEnd(24)} ${nameOf(id)}`);
    }
    for (const a of pid ? snap.agents : []) {
      console.log(`agent     ${projectLabel(a.project).padEnd(24)} ${a.state.padEnd(8)} ${(a.app || "?").padEnd(12)} ${nameOf(a.partner)} · ${a.sessionLabel}`);
    }
    break;
  }
  // Debug only: the server refuses unless it was started with POKEDEX_DEBUG=1, and says so.
  case "catch": {
    const id = dexId(args[0]);
    await ask("catch", id);
    console.log(`caught ${nameOf(id)}: ${JSON.stringify(caught())}`);
    break;
  }
  case "release": {
    const id = dexId(args[0]);
    await ask("release", id);
    console.log(`released ${nameOf(id)}: ${JSON.stringify(caught())}`);
    break;
  }
  // Options, kept by the server: when a new wild Pokemon may pop a toast, and hard mode (fainting).
  case "set": {
    const [key, value] = args;
    const onOff = { on: true, off: false };
    if (key === "alert" && ["off", "on", "smart"].includes(value)) await ask("setOption", "alert", value);
    else if (key === "hard-mode" && value in onOff) await ask("setOption", "hardMode", onOff[value]);
    else need({ ok: false, error: "set what? alert off|on|smart, or hard-mode on|off" });
    console.log(optionsLine());
    break;
  }
  case "stop": {
    const pid = daemonPid();
    if (pid) process.kill(pid, "SIGTERM");
    console.log(pid ? `stopped daemon ${pid}` : "daemon not running");
    break;
  }
  case "share": {
    try {
      const copied = await shareOnX();
      console.log(copied ? "X compose opened; the card is on the clipboard, paste it into the post" : "X compose opened; the card couldn't be copied");
    } catch (error) {
      need({ ok: false, error: error.message });
    }
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
    // The server keeps a backup and leaves a waiting encounter to the other app's clock.
    await ask("import", Object.fromEntries(keys.map((k) => [k, theirs[k]])));
    console.log(`imported ${keys.join(", ")} from ${from}`);
    break;
  }

  default:
    console.log(`pokedex: the Pokedex for Rex

  pokedex toggle             open or close the sidebar in this window
  pokedex open collection    KANTO DEX (add --pick <project> to choose its mascot)
  pokedex open trainer       trainer card: party, starter, gifts
  pokedex open encounter     the tall grass: wild Pokemon waiting for you
  pokedex status             daemon, trainer, options and agents, as text
  pokedex set alert off|on|smart   pop a toast for a new wild Pokemon: never, always,
                             or only while no agent is working (smart, the default)
  pokedex set hard-mode on|off     an agent left waiting on you too long costs its next task's XP
  pokedex catch <n> | release <n>  debug only: needs a server started with POKEDEX_DEBUG=1
  pokedex share              post progress on X (card image on the clipboard)
  pokedex import-herdr [shared.json] [--force]
  pokedex stop | log         the background daemon

Views (run by Rex panes): sidebar, collection, trainer, encounter, toast, daemon.`);
}
