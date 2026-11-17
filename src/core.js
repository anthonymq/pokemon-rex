// What every pokedex process shares besides the rules: mascots, sprites, news, the daemon.
import fs from "node:fs";
import path from "node:path";
import { ROOT, STATE_DIR, readJson, settings, shared, remoteState } from "./herdr.js";
import { PARTNERS, CAUGHT, ENCOUNTER_MS, RULES_VERSION, projectLabel, savedKey, quests, liveStreak, liveWeek, shouldAlert, defaultPartner as basePartner } from "./game.js";
import { BUN, CLI, LABELS, view, findWindow, windowBlocks, labelOf, openFloat, api } from "./rex.js";

export const AGENTS_FILE = path.join(STATE_DIR, "agents.json");
export const PID_FILE = path.join(STATE_DIR, "daemon.pid");
export const LOG_FILE = path.join(STATE_DIR, "daemon.log");
export const GOTO_FILE = path.join(STATE_DIR, "goto.json");
export const NOTE_MS = 7000;

export const sprite = (id) => path.join(ROOT, "assets", "pokemon", `${id}.png`);
export const badgeArt = (id) => path.join(ROOT, "assets", "badges", `${id}.png`);

// A project's mascot (PARTNERS, drawn on its cards): the saved one, else the default
// pokemon-herdr picks from the name.
// The 40-entry legacy pool is kept as is, so progress imported from Herdr keeps its partners;
// the server's defaultPartner() then makes it a base form, as savePartners stores it.
const LEGACY_POKEMON = [1, 4, 7, 10, 16, 25, 35, 39, 52, 54, 60, 63, 74, 77, 79, 92, 104, 113, 133, 147, 152, 155, 158, 175, 179, 194, 200, 216, 220, 231, 252, 255, 258, 280, 300, 311, 312, 393, 390, 387];
export function defaultPartner(key) {
  const name = projectLabel(key);
  let hash = 2166136261;
  for (const c of name || "?") hash = Math.imul(hash ^ c.codePointAt(0), 16777619);
  const legacy = LEGACY_POKEMON[(hash >>> 0) % LEGACY_POKEMON.length];
  return basePartner(legacy <= 151 ? legacy : (hash >>> 0) % 151 + 1);
}
// `key` is the project as Rex knows it (its repo path); the save keys it by a hash (savedKey).
export function partnerOf(key) {
  const saved = shared(PARTNERS)?.[savedKey(key)];
  return Number.isInteger(saved) && saved >= 1 && saved <= 151 ? saved : defaultPartner(key);
}
export const hasPartner = (key) => shared(PARTNERS)?.[savedKey(key)] !== undefined;

// What the server computed from its clock (today's quests, the live streak, the week): drawn as sent, so an
// older or newer copy of the rules here never shows different ones. An older server sends none.
export const serverView = () => remoteState()?.view ?? null;
export const questsNow = (g) => serverView()?.quests ?? quests(g);
export const streakNow = (g) => serverView()?.streak ?? liveStreak(g);
// The active days among the last 7: shown out of STREAK_NEED while the streak is 0.
export const weekNow = (g) => serverView()?.week ?? liveWeek(g);
// The server's rules version when it differs from this copy's (time to run scripts/sync-game.sh).
export const rulesMismatch = () => { const v = serverView(); return v && v.rules !== RULES_VERSION ? v.rules : null; };
export const caught = () => shared(CAUGHT) ?? [];

export const agentsSnapshot = () => readJson(AGENTS_FILE, { at: 0, agents: [], sessions: [] });
// News from the server: every app's, kept a day. Rex shows as toasts only those Rex caused.
export const notes = () => remoteState()?.notes ?? [];
// The tall grass: wild Pokemon still waiting, oldest first. A position here is the index
// throwBall and runAway take (the server drops the expired ones before counting).
export const wildNow = (g, now = Date.now()) => g.wild.filter((e) => now - e.at <= ENCOUNTER_MS);
// Agents working right now, from the daemon's snapshot: what the "smart" alert setting waits on.
export const busyAgents = () => agentsSnapshot().agents.filter((a) => a.state === "working").length;
// Whether a note may pop up as a toast. Small news (quiet) never does; a new wild Pokemon only
// when the alert setting allows it (`busy`: agents working right now).
export const toastable = (n, busy = busyAgents()) => !n.quiet && (!n.encounter || shouldAlert(busy));

// A note as a floating toast in the Rex session it came from, without taking focus. A wild
// Pokemon never opens its battle card by itself: it waits in the tall grass.
export function showNote(session, entry, busy) {
  if (!settings().toasts.enabled || !session || !toastable(entry, busy)) return;
  const v = view(session);
  const win = findWindow(v, {});
  if (!win) return;
  // One toast pane per window shows every fresh note; a second would only cover it.
  if (windowBlocks(win).some((b) => labelOf(win, b.block) === LABELS.toast)) return;
  openFloat(session, win, "toast", { focus: false, place: "right" });
}

// --- The daemon watches every Rex session and awards XP. Any pokedex command starts it.
export function daemonPid() {
  const pid = Number(readJson(PID_FILE, null));
  if (!pid) return null;
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return null;
  }
}
export function ensureDaemon() {
  if (daemonPid()) return;
  const log = fs.openSync(LOG_FILE, "a");
  Bun.spawn([BUN, CLI, "daemon"], { stdout: log, stderr: log, stdin: "ignore", cwd: ROOT, env: { ...process.env, REX_SESSION: "", REX_BLOCK: "" } }).unref();
}

// Opens a dialog over the window a pane is in. One of each per window: asking again focuses it.
export function openDialog(session, target, name, args = []) {
  const v = view(session);
  const win = findWindow(v, target);
  if (!win) return { ok: false, error: "no window" };
  const open = windowBlocks(win).find((b) => labelOf(win, b.block) === LABELS[name]);
  if (open) {
    // A picker for another project replaces the open one.
    if (!args.length) return api(session, "session.focus_block", { block_id: open.block });
    api(session, "block.close", { block_id: open.block });
  }
  return openFloat(session, win, name, { args, focus: true, place: name === "encounter" ? "top" : "center" });
}
