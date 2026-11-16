// Pokedex gamification rules, shared by pokedex-agents, pokedex-console, pokedex-collection,
// pokedex-trainer and pokedex-encounter. Mods can't import across folders, so each keeps a copy;
// edit mods/pokedex-agents/game.js and run scripts/sync-game.sh (the repo checks the copies match).
// State lives in shared("pokedex.game"):
// { xp: {project: n}, tasks, subtasks, evolutions, streak: {last, days, best}, badges: [ids], shiny: [ids],
//   wild: [{id, at, balls, weak, project}] (the tall grass queue, oldest first), encounter: wild[0] | null,
//   encounters: {seen, caught, fled}, recent: [{id, at}], bag: {item: n}, dex: {id: {at, project, how}},
//   fainted: {project: true}, happy: {project: true}, quests: {day, week, d, w}, lastTurn,
//   digest: {levels, items: {item: n}, quests}, version,
//   stats: {days: {day: {turns, ms, seen, caught, fled, left, quests}}, lengths: [ms]} }
// Options live in shared("pokedex.options"): {alert: "off" | "on" | "smart", hardMode}.
// `stats` is private: it stays in the local save and is never shared.
// A project key is the space's git repo root (machine-qualified for remote spaces), else its name.
import { shared, setShared, notify, playSound, settings } from "herdr";
import { POKEMON as DEX } from "./pokemon.js";

export const nameOf = (id) => DEX[id - 1]?.name ?? `#${id}`;
export const projectLabel = (key) => String(key).split(/[/\\]/).filter(Boolean).pop() ?? String(key);

export const GAME = "pokedex.game";
export const CAUGHT = "pokedex.caught";
export const PARTNERS = "pokedex.partners";
export const PROJECTS = "pokedex.projects"; // space name -> project key, filled by pokedex-agents
export const projectKey = (name) => shared(PROJECTS)?.[name] ?? name;
export const SUBTASK_XP = 10;
export const ENCOUNTER_CHANCE = 0.15;
export const OPTIONS = "pokedex.options";
export const ENCOUNTER_MS = 24 * 3600000; // a wild Pokemon waits in the tall grass this long
export const WILD_MAX = 5; // the tall grass holds this many; no new encounter while it's full
export const BALLS = 3;
export const FAINT_MS = 10 * 60000; // hard mode: an agent left blocked this long makes its partner faint
export const HAPPY_BONUS = 0.25; // a fast answer: the project's next task earns this much more XP
const AWAY_MS = 2 * 3600000; // the first turn after this long away brings the "welcome back" summary
export const FAST_MS = 2 * 60000; // answering a blocked agent this fast counts for the quest
const STONE_CHANCE = 0.05;
const RECENT = 10;
const LEVEL_NEWS_EVERY = 5; // level-up toasts only when a partner crosses Lv5, Lv10, Lv15...
const JINGLES = { evolve: "mods/pokedex-agents/sounds/evolve.mp3", badge: "mods/pokedex-agents/sounds/badge.mp3" };

// Evolutions and badges get their own short jingle, silent when the person turned sounds off.
function jingle(name) {
  if (settings().sounds?.enabled === false) return;
  playSound(JINGLES[name]);
}
const LEGENDARY = [144, 145, 146, 150, 151];

// A finished turn earns 10 XP plus 5 per full minute it ran, up to 100.
export const taskXp = (ms) => 10 + 5 * Math.min(18, Math.floor(Math.max(0, ms) / 60000));

// Gen 1 level evolutions: from -> [to, level].
const EVOLVE = {
  1: [2, 16], 2: [3, 32], 4: [5, 16], 5: [6, 36], 7: [8, 16], 8: [9, 36], 10: [11, 7], 11: [12, 10],
  13: [14, 7], 14: [15, 10], 16: [17, 18], 17: [18, 36], 19: [20, 20], 21: [22, 20], 23: [24, 22],
  27: [28, 22], 29: [30, 16], 32: [33, 16], 41: [42, 22], 43: [44, 21], 46: [47, 24], 48: [49, 31],
  50: [51, 26], 52: [53, 28], 54: [55, 33], 56: [57, 28], 60: [61, 25], 63: [64, 16], 66: [67, 28],
  69: [70, 21], 72: [73, 30], 74: [75, 25], 77: [78, 40], 79: [80, 37], 81: [82, 30], 84: [85, 31],
  86: [87, 34], 88: [89, 38], 92: [93, 25], 96: [97, 26], 98: [99, 28], 100: [101, 30], 104: [105, 28],
  109: [110, 35], 111: [112, 42], 116: [117, 32], 118: [119, 33], 129: [130, 20], 138: [139, 40],
  140: [141, 40], 147: [148, 30], 148: [149, 55],
};
// Stone and trade evolutions: from -> {item: to}. They happen when the person uses the item.
export const ITEM_EVOLVE = {
  25: { thunder: 26 }, 30: { moon: 31 }, 33: { moon: 34 }, 35: { moon: 36 }, 37: { fire: 38 }, 39: { moon: 40 },
  44: { leaf: 45 }, 58: { fire: 59 }, 61: { water: 62 }, 64: { link: 65 }, 67: { link: 68 }, 70: { leaf: 71 },
  75: { link: 76 }, 90: { water: 91 }, 93: { link: 94 }, 102: { leaf: 103 }, 120: { water: 121 },
  133: { water: 134, thunder: 135, fire: 136 },
};
const TARGETS = [...Object.values(EVOLVE).map(([to]) => to), ...Object.values(ITEM_EVOLVE).flatMap(Object.values)];
const FINAL = new Set(TARGETS.filter((to) => !EVOLVE[to] && !ITEM_EVOLVE[to]));

export const ITEMS = {
  great: { name: "Great Ball", color: "#5aa9e6", bonus: 1.5 },
  ultra: { name: "Ultra Ball", color: "#f2c94c", bonus: 2 },
  fire: { name: "Fire Stone", color: "#ef6b4a" },
  water: { name: "Water Stone", color: "#5aa9e6" },
  thunder: { name: "Thunder Stone", color: "#f2c94c" },
  leaf: { name: "Leaf Stone", color: "#5fbf77" },
  moon: { name: "Moon Stone", color: "#a8a29a" },
  link: { name: "Link Cable", color: "#b48ae6" },
};
const STONES = ["fire", "water", "thunder", "leaf", "moon"];

const KANTO = ["boulder", "cascade", "thunder", "rainbow", "soul", "marsh", "volcano", "earth"];
export const BADGES = [
  { id: "boulder", name: "Boulder", color: "#a8a29a", goal: "Catch 10 Pokemon", test: (g, c) => c >= 10 },
  { id: "cascade", name: "Cascade", color: "#5aa9e6", goal: "Finish 50 agent tasks", test: (g) => g.tasks >= 50 },
  { id: "thunder", name: "Thunder", color: "#f2c94c", goal: "Evolve a partner", test: (g) => g.evolutions >= 1 },
  { id: "rainbow", name: "Rainbow", color: "#9be29b", goal: "Reach a 3-day streak", test: (g) => g.streak.best >= 3 },
  { id: "soul", name: "Soul", color: "#e58ad6", goal: "Catch 75 Pokemon", test: (g, c) => c >= 75 },
  { id: "marsh", name: "Marsh", color: "#d4af37", goal: "Finish 500 agent tasks", test: (g) => g.tasks >= 500 },
  { id: "volcano", name: "Volcano", color: "#ef6b4a", goal: "Reach a 30-day streak", test: (g) => g.streak.best >= 30 },
  { id: "earth", name: "Earth", color: "#5fbf77", goal: "Catch all 151", test: (g, c) => c >= 151 },
  // Ranks past the gyms: drawn as medals, not badge art.
  { id: "elite", name: "Elite Four", rank: true, color: "#8e7cc3", goal: "Finish 1000 agent tasks", test: (g) => g.tasks >= 1000 },
  { id: "champion", name: "Champion", rank: true, color: "#f2994a", goal: "Earn all 8 Kanto badges", test: (g) => KANTO.every((id) => g.badges.includes(id)) },
];

export function game() {
  const g = shared(GAME) ?? {};
  return {
    xp: g.xp ?? {}, tasks: g.tasks ?? 0, subtasks: g.subtasks ?? 0, evolutions: g.evolutions ?? 0,
    streak: g.streak ?? { last: null, days: 0, best: 0 },
    badges: g.badges ?? [], shiny: g.shiny ?? [],
    wild: g.wild ?? (g.encounter ? [g.encounter] : []), encounter: g.wild?.[0] ?? g.encounter ?? null,
    encounters: g.encounters ?? { seen: 0, caught: 0, fled: 0 }, recent: g.recent ?? [],
    bag: g.bag ?? {}, dex: g.dex ?? {}, fainted: g.fainted ?? {}, happy: g.happy ?? {}, quests: g.quests ?? null,
    lastTurn: g.lastTurn ?? null, digest: g.digest ?? blankDigest(),
    // A save written before versioning is version 1; a brand-new one starts at the current version.
    version: g.version ?? (Object.keys(g).length ? 1 : SAVE_VERSION), stats: g.stats ?? blankStats(),
  };
}

// --- Save versions. Each step upgrades a save from version n to n + 1; the server runs them at start
// and after an import or a merge. A save newer than these rules is left alone.
//   1 -> 2: local stats.
//   2 -> 3: the tall grass queue (the waiting encounter joins it); fainting became hard mode only.
export const SAVE_VERSION = 3;
const MIGRATIONS = {
  1: (g) => ({ ...g, stats: g.stats ?? blankStats() }),
  2: (g) => ({ ...g, wild: g.wild ?? (g.encounter ? [g.encounter] : []), fainted: {}, happy: g.happy ?? {} }),
};
// Writes the game; `encounter` mirrors the head of the queue for views that show one Pokemon.
function put(g) {
  setShared(GAME, { ...g, encounter: g.wild?.[0] ?? null });
}

// --- Options: when a new wild Pokemon may grab attention, and hard mode (fainting).
//   alert "off": never; "on": always; "smart" (default): only while no agent is busy.
export const ALERTS = ["off", "on", "smart"];
export const options = () => ({ alert: "smart", hardMode: false, ...(shared(OPTIONS) ?? {}) });
export const shouldAlert = (busyAgents, o = options()) => o.alert === "on" || (o.alert === "smart" && busyAgents === 0);
export function setOption(key, value) {
  if (key === "alert" && !ALERTS.includes(value)) throw new Error(`alert is one of ${ALERTS.join(", ")}`);
  if (key === "hardMode" && typeof value !== "boolean") throw new Error("hardMode is true or false");
  if (!["alert", "hardMode"].includes(key)) throw new Error(`unknown option ${key}`);
  setShared(OPTIONS, { ...(shared(OPTIONS) ?? {}), [key]: value });
  if (key === "hardMode" && !value) put({ ...game(), fainted: {} });
}

// --- The "welcome back" summary: small news (level-ups, items, quests) is kept quiet and counted here,
// then told once when the person comes back.
const blankDigest = () => ({ levels: 0, items: {}, quests: 0 });
function remember(g, key, item) {
  const d = { ...blankDigest(), ...g.digest };
  g.digest = key === "items" ? { ...d, items: { ...d.items, [item]: (d.items[item] ?? 0) + 1 } } : { ...d, [key]: d[key] + 1 };
}
// One "welcome back" note with what waits and what happened since the last one; null when nothing did.
// The server sends it at the first turn after AWAY_MS; a client may call it when the person returns.
export function digest(g0 = null) {
  const g = g0 ?? game();
  const d = { ...blankDigest(), ...g.digest };
  const wild = g.wild.filter((e) => !expired(e)).length;
  const items = Object.entries(d.items).map(([k, n]) => `${n} ${ITEMS[k]?.name ?? k}${n > 1 ? "s" : ""}`);
  const parts = [
    wild && `${wild} wild Pokemon waiting`, d.levels && `${d.levels} level-up${d.levels > 1 ? "s" : ""}`,
    items.length && `found ${items.join(", ")}`, d.quests && `${d.quests} quest${d.quests > 1 ? "s" : ""} done`,
  ].filter(Boolean);
  g.digest = blankDigest();
  if (!g0) put(g);
  if (!parts.length) return null;
  notify({ title: "Welcome back!", body: `${parts.join(" | ")}.`, level: "info" });
  return parts;
}
// Upgrades the save to SAVE_VERSION. Returns the version it now has.
export function migrateSave() {
  const raw = shared(GAME);
  if (!raw) return SAVE_VERSION;
  let g = raw, v = raw.version ?? 1;
  if (v >= SAVE_VERSION) return v;
  while (v < SAVE_VERSION) g = { ...MIGRATIONS[v](g), version: ++v };
  setShared(GAME, g);
  return v;
}

// --- Local stats, for pacing and (later) goals sized to the player's own median.
const STATS_DAYS = 90; // days kept
const STATS_LENGTHS = 200; // recent turn lengths kept for the median
const blankStats = () => ({ days: {}, lengths: [] });
const blankDay = () => ({ turns: 0, ms: 0, seen: 0, caught: 0, fled: 0, left: 0, quests: 0 });
// Adds n to today's `key`. Mutates g.
function tally(g, key, n = 1) {
  const s = g.stats ?? blankStats(), k = day(new Date());
  const today = { ...blankDay(), ...s.days[k] };
  today[key] += n;
  g.stats = { ...s, days: { ...s.days, [k]: today } };
}
const median = (xs) => {
  if (!xs.length) return 0;
  const s = [...xs].sort((a, b) => a - b), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
// The last `span` days (today included): active days, median turns per active day, median turn
// length, encounters and quests completed.
export function localStats(g = game(), now = new Date(), span = 14) {
  const keys = new Set(Array.from({ length: span }, (_, i) => day(new Date(now.getFullYear(), now.getMonth(), now.getDate() - i))));
  const days = Object.entries(g.stats.days).filter(([k, d]) => keys.has(k) && d.turns > 0).map(([, d]) => d);
  const sum = (key) => days.reduce((n, d) => n + d[key], 0);
  return {
    span, activeDays: days.length, turnsPerDay: median(days.map((d) => d.turns)), medianTurnMs: median(g.stats.lengths),
    turns: sum("turns"), seen: sum("seen"), caught: sum("caught"), fled: sum("fled"), left: sum("left") || 0, quests: sum("quests"),
  };
}

// Level n needs 4 * n^2 XP: Lv16 at 1024, Lv36 at 5184, Lv100 at 40000.
export const levelOf = (xp) => Math.max(1, Math.min(100, Math.floor(Math.sqrt((xp ?? 0) / 4))));
export function progress(xp) {
  const level = levelOf(xp);
  if (level >= 100) return { level, into: 1 };
  const lo = 4 * level ** 2, hi = 4 * (level + 1) ** 2;
  return { level, into: Math.min(1, Math.max(0, ((xp ?? 0) - lo) / (hi - lo))) };
}
export const trainerLevel = (g) => Object.values(g.xp).reduce((sum, xp) => sum + levelOf(xp), 0);
// True when the streak's last day is yesterday, or only a weekend lies between it and today:
// weekends never break a streak.
function streakAlive(last, now = new Date()) {
  if (!last) return false;
  for (let i = 1; i <= 3; i++) {
    const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - i);
    if (day(d) === last) return true;
    if (d.getDay() !== 0 && d.getDay() !== 6) return false;
  }
  return false;
}
// Today's streak, which lapses when a weekday passed with no finished task.
export function liveStreak(g, now = new Date()) {
  const s = g.streak;
  return s.last === day(now) || streakAlive(s.last, now) ? s.days : 0;
}

const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
// A week is named by its Monday.
const week = (d) => day(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7));
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0, 2166136261);
const shinyChance = (g) => { const s = liveStreak(g); return s >= 30 ? 1 / 4 : s >= 7 ? 1 / 8 : 0; };
export const catchRate = (id) => LEGENDARY.includes(id) ? 0.03 : FINAL.has(id) ? 0.35 : 0.6;
// One throw's odds: the ball's bonus, and +25% for each task finished while the Pokemon waited (up to 3).
export const throwRate = (e, ball = "poke") => Math.min(1, catchRate(e.id) * (ITEMS[ball]?.bonus ?? 1) * (1 + 0.25 * (e.weak ?? 0)));
const expired = (e, now = Date.now()) => now - e.at > ENCOUNTER_MS;

function gain(g, item, n = 1) {
  g.bag = { ...g.bag, [item]: (g.bag[item] ?? 0) + n };
}

// New catches go into the Pokedex, its entries and the recent list; each may be shiny on a long streak.
// `how`: "met" (an agent opened in its project), "wild" or "evolved". Mutates g.
function addCaught(g, ids, how = "met", project = null) {
  const caught = shared(CAUGHT) ?? [];
  const fresh = ids.filter((id) => !caught.includes(id));
  if (!fresh.length) return [];
  for (const id of fresh) if (Math.random() < shinyChance(g) && !g.shiny.includes(id)) g.shiny = [...g.shiny, id];
  const at = Date.now();
  g.recent = [...fresh.map((id) => ({ id, at })), ...g.recent].slice(0, RECENT);
  g.dex = { ...g.dex, ...Object.fromEntries(fresh.map((id) => [id, { at, project, how }])) };
  setShared(CAUGHT, [...caught, ...fresh].sort((a, b) => a - b));
  return fresh;
}

// `jingled`: an evolution already played its jingle in this save, so a badge earned with it stays quiet.
function save(g, jingled = false) {
  const count = (shared(CAUGHT) ?? []).length;
  let earned = [];
  // Twice, so a rank that needs the badges just earned (Champion) comes with them.
  for (let pass = 0; pass < 2; pass++) {
    const more = BADGES.filter((b) => !g.badges.includes(b.id) && b.test(g, count));
    g.badges = [...g.badges, ...more.map((b) => b.id)];
    earned = [...earned, ...more];
  }
  if (earned.length) {
    if (!jingled) jingle("badge");
    for (const b of earned) notify({ title: `${b.name} ${b.rank ? "rank reached" : "Badge earned"}!`, body: b.goal, level: "success" });
  }
  put(g);
}

// Awards every badge the save already qualifies for, after progress came in from outside the rules
// (a merge, an import, a restored backup).
export function checkBadges() {
  save(game());
}

// Quests: three daily ones and one weekly one, picked from the date so every screen agrees.
const DAILY = [
  { id: "d-tasks", goal: "Finish 5 agent tasks", need: 5, n: (q) => q.tasks },
  { id: "d-projects", goal: "Work in 2 projects", need: 2, n: (q) => q.projects.length },
  { id: "d-agents", goal: "Finish tasks with 2 different agents", need: 2, n: (q) => q.agents.length },
  { id: "d-catch", goal: "Catch a wild Pokemon", need: 1, n: (q) => q.catches },
  { id: "d-fast", goal: "Answer a blocked agent within 2 minutes", need: 1, n: (q) => q.fast },
  { id: "d-long", goal: "Finish a task that ran 10+ minutes", need: 1, n: (q) => q.long },
];
const WEEKLY = [
  { id: "w-tasks", goal: "Finish 40 agent tasks", need: 40, n: (q) => q.tasks },
  { id: "w-catch", goal: "Catch 5 wild Pokemon", need: 5, n: (q) => q.catches },
  { id: "w-evolve", goal: "Evolve a partner", need: 1, n: (q) => q.evolutions },
  { id: "w-projects", goal: "Work in 4 projects", need: 4, n: (q) => q.projects.length },
];
const blankCount = () => ({ tasks: 0, projects: [], agents: [], catches: 0, fast: 0, long: 0, evolutions: 0, done: [] });
function picks(now = new Date()) {
  const h = hash(day(now));
  const daily = [...DAILY].sort((a, b) => hash(a.id + h) - hash(b.id + h)).slice(0, 3);
  return { daily, weekly: WEEKLY[hash(week(now)) % WEEKLY.length] };
}
// This period's counters, fresh when the day or week turned. Mutates g.
function questState(g, now = new Date()) {
  const q = g.quests ?? {};
  const d = q.day === day(now) ? q.d : blankCount();
  const w = q.week === week(now) ? q.w : blankCount();
  g.quests = { day: day(now), week: week(now), d, w };
  return g.quests;
}
// Today's and this week's quests with their progress, for the trainer card.
export function quests(g = game(), now = new Date()) {
  const q = questState({ ...g }, now);
  const { daily, weekly } = picks(now);
  const view = (x, c, weekly) => ({ id: x.id, goal: x.goal, need: x.need, n: Math.min(x.need, x.n(c)), done: c.done.includes(x.id), weekly, reward: weekly ? "2 Ultra Balls + a stone" : "2 Great Balls" });
  return [...daily.map((x) => view(x, q.d, false)), view(weekly, q.w, true)];
}
// Counts something toward both periods' quests and pays out the ones it completes. Mutates g.
function bump(g, fn) {
  const q = questState(g);
  fn(q.d);
  fn(q.w);
  const { daily, weekly: week1 } = picks();
  for (const [x, c, weekly] of [...daily.map((x) => [x, q.d, false]), [week1, q.w, true]]) {
    if (c.done.includes(x.id) || x.n(c) < x.need) continue;
    c.done = [...c.done, x.id];
    tally(g, "quests");
    remember(g, "quests");
    let reward = "2 Great Balls";
    if (weekly) {
      const stone = STONES[hash(q.week) % STONES.length];
      gain(g, "ultra", 2);
      gain(g, stone);
      reward = `2 Ultra Balls and a ${ITEMS[stone].name}`;
    } else gain(g, "great", 2);
    notify({ title: `${weekly ? "Weekly" : "Daily"} quest complete!`, body: `${x.goal}: ${reward}.`, level: "success", quiet: true });
  }
}
const addOnce = (list, v) => (v && !list.includes(v) ? [...list, v] : list);

// Catches from outside the rules (the debug catch action) go through here, for shinies and badges.
export function recordCatches(ids, project = null) {
  const g = game();
  const fresh = addCaught(g, ids, "met", project);
  if (fresh.length) save(g);
}

// Moves a project's XP and partner to a new key (a space renamed, or the key scheme changing).
export function migrateProject(from, to) {
  if (from === to) return;
  const g = game();
  const partners = shared(PARTNERS) ?? {};
  if (g.xp[from] !== undefined) {
    const { [from]: moved, ...rest } = g.xp;
    g.xp = { ...rest, [to]: (rest[to] ?? 0) + moved };
    put(g);
  }
  if (partners[from] !== undefined) {
    const { [from]: partner, ...rest } = partners;
    setShared(PARTNERS, { ...rest, [to]: rest[to] ?? partner });
  }
}

// A partner changes form: it joins the Pokedex, counts for badges and quests, and plays the jingle. Mutates g.
function evolve(g, project, from, to, detail) {
  g.evolutions += 1;
  setShared(PARTNERS, { ...(shared(PARTNERS) ?? {}), [project]: to });
  addCaught(g, [to], "evolved", project);
  bump(g, (c) => { c.evolutions += 1; });
  jingle("evolve");
  notify({ title: `What? ${nameOf(from)} is evolving!`, body: `${projectLabel(project)}'s partner became ${nameOf(to)}${detail}.`, level: "success", icon: `mods/pokedex-agents/pokemon/${to}.png` });
}

// XP to a project's partner, with level-up and evolution news. Mutates g; true when it evolved.
function award(g, project, partnerId, amount) {
  // A project's first XP saves its partner, so every view (the trainer card too) shows the same one.
  if ((shared(PARTNERS) ?? {})[project] === undefined) setShared(PARTNERS, { ...(shared(PARTNERS) ?? {}), [project]: partnerId });
  const before = levelOf(g.xp[project]);
  g.xp = { ...g.xp, [project]: (g.xp[project] ?? 0) + amount };
  const after = levelOf(g.xp[project]);
  // Evolve as many stages as the new level allows.
  let id = partnerId;
  while (EVOLVE[id] && after >= EVOLVE[id][1]) id = EVOLVE[id][0];
  if (id !== partnerId) {
    evolve(g, project, partnerId, id, ` (Lv ${after})`);
    return true;
  }
  if (after > before) remember(g, "levels");
  if (Math.floor(after / LEVEL_NEWS_EVERY) > Math.floor(before / LEVEL_NEWS_EVERY)) {
    notify({ title: `${nameOf(partnerId)} reached Lv ${after}!`, body: projectLabel(project), level: "info", icon: `mods/pokedex-agents/pokemon/${partnerId}.png`, quiet: true });
  }
  return false;
}

// The items a partner can evolve with, and how many of each the bag holds.
export function itemsFor(partnerId, g = game()) {
  return Object.entries(ITEM_EVOLVE[partnerId] ?? {}).map(([item, to]) => ({ item, to, have: g.bag[item] ?? 0 }));
}

// Uses a stone or Link Cable on a project's partner. Returns the new Pokemon, or null when it can't.
export function useItem(project, item) {
  const g = game();
  const from = (shared(PARTNERS) ?? {})[project];
  const to = ITEM_EVOLVE[from]?.[item];
  if (!to || !(g.bag[item] > 0)) return null;
  g.bag = { ...g.bag, [item]: g.bag[item] - 1 };
  evolve(g, project, from, to, ` with a ${ITEMS[item].name}`);
  save(g, true);
  return to;
}

// The base form of a Pokemon's evolution line (Charizard -> Charmander).
const PREV = Object.fromEntries([...Object.entries(EVOLVE).map(([from, [to]]) => [to, +from]), ...Object.entries(ITEM_EVOLVE).flatMap(([from, m]) => Object.values(m).map((to) => [to, +from]))]);
export function baseOf(id) {
  while (PREV[id]) id = PREV[id];
  return id;
}
// A default partner, from whatever a client hashed: always a base form, never a legendary.
const STARTERS = [1, 4, 7];
export const defaultPartner = (id) => (LEGENDARY.includes(id) ? STARTERS[id % 3] : baseOf(id));

// An agent stopped needing the person after `ms`. A quick answer counts for a quest and makes the
// project's partner happy (+25% XP on its next task). In hard mode, one left waiting FAINT_MS or more
// makes the partner faint until its next task.
export function unblocked(project, ms) {
  const g = game();
  if (ms <= FAST_MS) {
    bump(g, (c) => { c.fast += 1; });
    g.happy = { ...g.happy, [project]: true };
  } else if (options().hardMode && ms >= FAINT_MS && !g.fainted[project]) {
    g.fainted = { ...g.fainted, [project]: true };
    const id = (shared(PARTNERS) ?? {})[project];
    notify({ title: `${id ? nameOf(id) : "Your partner"} fainted!`, body: `${projectLabel(project)}'s agent waited ${Math.round(ms / 60000)} min. Its next task earns no XP.`, level: "warning", icon: id ? `mods/pokedex-agents/pokemon/${id}.png` : undefined });
  }
  put(g);
}

// A wild Pokemon leaves the queue: "caught", "fled" (it got away or waited too long) or "left"
// (the person ran). Mutates g.
function leave(g, index, how) {
  g.wild = g.wild.filter((_, i) => i !== index);
  const key = how === "left" ? "fled" : how;
  g.encounters = { ...g.encounters, [key]: g.encounters[key] + 1 };
  tally(g, how);
}
// Pokemon that waited longer than ENCOUNTER_MS flee. Mutates g.
function expire(g, now = Date.now()) {
  for (let i = g.wild.length - 1; i >= 0; i--) if (expired(g.wild[i], now)) leave(g, i, "fled");
}

// A finished agent turn: XP by its length, the streak, items, quests, maybe a wild Pokemon.
export function finishTask(project, partnerId, ms, app = null) {
  const g = game();
  // Back after a while: one summary of what waits and what happened, before this turn's news.
  if (g.lastTurn && Date.now() - g.lastTurn >= AWAY_MS) digest(g);
  g.lastTurn = Date.now();
  g.tasks += 1;
  tally(g, "turns");
  tally(g, "ms", Math.max(0, ms));
  g.stats = {
    days: Object.fromEntries(Object.entries(g.stats.days).filter(([k]) => k >= day(new Date(Date.now() - STATS_DAYS * 86400000)))),
    lengths: [...g.stats.lengths, Math.max(0, ms)].slice(-STATS_LENGTHS),
  };
  let evolved = false;
  if (g.fainted[project]) {
    // A fainted partner spends this task recovering.
    const { [project]: _, ...rest } = g.fainted;
    g.fainted = rest;
    notify({ title: `${nameOf(partnerId)} recovered`, body: `${projectLabel(project)}'s partner is back; this task earned no XP.`, level: "info", icon: `mods/pokedex-agents/pokemon/${partnerId}.png`, quiet: true });
  } else {
    const happy = !!g.happy[project];
    const { [project]: _, ...rest } = g.happy;
    g.happy = rest;
    evolved = award(g, project, partnerId, Math.round(taskXp(ms) * (happy ? 1 + HAPPY_BONUS : 1)));
  }

  // Long turns pay out in items.
  if (ms >= 10 * 60000) gain(g, "great");
  if (ms >= 60 * 60000) {
    gain(g, "link");
    remember(g, "items", "link");
    notify({ title: "Found a Link Cable!", body: "An hour-long task. Trade evolutions need one.", level: "success", quiet: true });
  }
  if (Math.random() < STONE_CHANCE) {
    const stone = STONES[Math.floor(Math.random() * STONES.length)];
    gain(g, stone);
    remember(g, "items", stone);
    notify({ title: `Found a ${ITEMS[stone].name}!`, body: "Use it from a partner's picker.", level: "success", quiet: true });
  }

  const today = day(new Date());
  if (g.streak.last !== today) {
    const days = streakAlive(g.streak.last) ? g.streak.days + 1 : 1;
    g.streak = { last: today, days, best: Math.max(g.streak.best, days) };
    gain(g, "great");
    if (days % 7 === 0) gain(g, "ultra");
  }

  bump(g, (c) => {
    c.tasks += 1;
    c.projects = addOnce(c.projects, project);
    c.agents = addOnce(c.agents, app);
    if (ms >= 10 * 60000) c.long += 1;
  });

  // The tall grass: old Pokemon flee, the rest wear down with the work done while they wait, and a
  // new one may join while there's room. A new one is news, but never opens anything by itself:
  // clients alert only when shouldAlert() says so.
  expire(g);
  g.wild = g.wild.map((e) => ({ ...e, weak: Math.min(3, (e.weak ?? 0) + 1) }));
  if (g.wild.length < WILD_MAX && Math.random() < ENCOUNTER_CHANCE) {
    let wild = 1 + Math.floor(Math.random() * 151);
    if (LEGENDARY.includes(wild)) wild = 1 + Math.floor(Math.random() * 151); // legendaries need a second roll
    g.wild = [...g.wild, { id: wild, at: Date.now(), balls: BALLS, weak: 0, project }];
    g.encounters = { ...g.encounters, seen: g.encounters.seen + 1 };
    tally(g, "seen");
    notify({ title: `A wild ${nameOf(wild)} appeared!`, body: `It's waiting in the tall grass (${g.wild.length}/${WILD_MAX}).`, level: "info", icon: `mods/pokedex-agents/pokemon/${wild}.png`, action: { name: "mod.open", args: { name: "pokedex-encounter" } } });
  }
  save(g, evolved);
}

// A finished sub-agent (one without its own pane): a smaller award, no encounter, no streak day.
export function finishSubTask(project, partnerId) {
  const g = game();
  g.subtasks += 1;
  save(g, g.fainted[project] ? false : award(g, project, partnerId, SUBTASK_XP));
}

// One ball at a waiting Pokemon (`index` in the queue, the oldest by default): "caught", "missed",
// "fled", "gone" (none there) or "empty" (none of that ball). Poke Balls are the encounter's free
// three; Great and Ultra Balls come from the bag.
export function throwBall(ball = "poke", index = 0) {
  const g = game();
  expire(g);
  const e = g.wild[index];
  if (!e) {
    put(g);
    return "gone";
  }
  if (ball === "poke" ? e.balls < 1 : !(g.bag[ball] > 0)) return "empty";
  const after = ball === "poke" ? { ...e, balls: e.balls - 1 } : e;
  if (ball !== "poke") g.bag = { ...g.bag, [ball]: g.bag[ball] - 1 };
  if (Math.random() < throwRate(e, ball)) {
    addCaught(g, [e.id], "wild", e.project ?? null);
    leave(g, index, "caught");
    bump(g, (c) => { c.catches += 1; });
    save(g);
    return "caught";
  }
  // It stays while any ball is left to throw.
  if (after.balls > 0 || (g.bag.great ?? 0) > 0 || (g.bag.ultra ?? 0) > 0) {
    g.wild = g.wild.map((w, i) => (i === index ? after : w));
    put(g);
    return "missed";
  }
  leave(g, index, "fled");
  put(g);
  return "fled";
}

// Leaves a waiting Pokemon (the oldest by default) in the grass for good.
export function runAway(index = 0) {
  const g = game();
  expire(g);
  if (g.wild[index]) leave(g, index, "left");
  put(g);
}
