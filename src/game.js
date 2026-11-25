// Pokedex gamification rules, shared by pokedex-agents, pokedex-console, pokedex-collection,
// pokedex-trainer and pokedex-encounter. Mods can't import across folders, so each keeps a copy;
// edit mods/pokedex-agents/game.js and run scripts/sync-game.sh (the repo checks the copies match).
// State lives in shared("pokedex.game"):
// { party: [ids] (the first leads), pokemon: {id: xp}, lifetime, bank, gifts: {got, pending}, results: {project: [kinds]},
//   seen: [keys], tasks, subtasks, evolutions, streak: {last, days, best, freezes, active}, badges: [ids], shiny: [ids],
//   wild: [{id, at, balls, weak, project}] (the tall grass queue, oldest first), encounter: wild[0] | null,
//   encounters: {seen, caught, fled}, recent: [{id, at}], bag: {item: n}, dex: {id: {at, project, how}},
//   fainted: {project: true}, happy: {project: true}, quests: {day, week, d, w, daily, spare, weekly, rerolled},
//   lastTurn, digest: {levels, items: {item: n}, quests}, version, rested, money, tutorial: [step ids] | null,
//   gyms: {at, since, need, c, head} (the open gym), league: {at, week, c} | null (the Elite Four),
//   medals: [ids], classic: [badge ids from before the gyms], legends: {run, week, mew}, fame: {at, party} | null,
//   stats: {days: {day: {turns, ms, xp, seen, caught, fled, left, fast, answered, long, variety, quests, silver,
//   gold, commit, green, merged, frozen}}, lengths: [ms]} }
// Options live in shared("pokedex.options"): {alert: "off" | "on" | "smart", hardMode}.
// `stats` is private: it stays in the local save and is never shared.
// A project key is the space's git repo root (machine-qualified for remote spaces), else its name.
import { shared, setShared, notify, playSound, settings } from "herdr";
import { POKEMON as DEX } from "./pokemon.js";

export const nameOf = (id) => DEX[id - 1]?.name ?? `#${id}`;
// A project's short name: the label kept on this machine for a key in the save (a hash), else the
// last path segment of a readable key.
export const projectLabel = (key) => shared(LABELS)?.[key] ?? String(key).split(/[/\\]/).filter(Boolean).pop() ?? String(key);

export const GAME = "pokedex.game";
export const CAUGHT = "pokedex.caught";
export const PARTNERS = "pokedex.partners";
// Project keys in the save are hashes (the server makes them from readable keys with a secret kept on
// this machine), so the save never holds repo paths or space names. Three maps stay on this machine,
// outside the save: PROJECTS (a Herdr space name -> its readable key, the repo root), KEYS (a readable
// key -> its key in the save) and LABELS (a key in the save -> the project's short name).
export const PROJECTS = "pokedex.projects";
export const KEYS = "pokedex.keys";
export const LABELS = "pokedex.labels";
export const projectKey = (name) => shared(PROJECTS)?.[name] ?? name;
// The save's key for a project an app knows by `name` (a space name or a repo path).
export const savedKey = (name) => { const key = projectKey(name); return shared(KEYS)?.[key] ?? key; };
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

// A finished turn earns 10 XP plus 5 per full minute it ran, up to 50: results pay the rest.
export const taskXp = (ms) => 10 + 5 * Math.min(8, Math.floor(Math.max(0, ms) / 60000));

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
  poke: { name: "Poke Ball", color: "#ef6b4a", bonus: 1 },
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

// --- Gyms: eight leaders in order, one open at a time. A gym offers options, and any one won beats it;
// an option's parts must all hold. A part counts from the day the gym opened, except `streak`, `level`
// and `caught`, which read the save as it is. With `mult`, a part asks for that many active days of the
// player's own median (over the 14 days before the gym opened), never under `min`.
export const GYMS = [
  { id: "boulder", leader: "Brock", name: "Boulder", color: "#a8a29a", options: [[{ key: "days", min: 5 }]] },
  { id: "cascade", leader: "Misty", name: "Cascade", color: "#5aa9e6", options: [[{ key: "fast", min: 10, mult: 4 }], [{ key: "answered", min: 12, mult: 4 }]] },
  { id: "thunder", leader: "Lt. Surge", name: "Thunder", color: "#f2c94c", options: [[{ key: "commit", min: 10, mult: 3 }], [{ key: "green", min: 10, mult: 3 }]] },
  { id: "rainbow", leader: "Erika", name: "Rainbow", color: "#9be29b", options: [[{ key: "variety", min: 3 }], [{ key: "varied", min: 5 }]] },
  { id: "soul", leader: "Koga", name: "Soul", color: "#e58ad6", options: [[{ key: "silver", min: 10 }], [{ key: "gold", min: 4 }]] },
  { id: "marsh", leader: "Sabrina", name: "Marsh", color: "#d4af37", options: [[{ key: "merged", min: 3 }], [{ key: "long", min: 5, mult: 3 }]] },
  { id: "volcano", leader: "Blaine", name: "Volcano", color: "#ef6b4a", options: [[{ key: "streak", min: 56 }], [{ key: "days", min: 30 }]] },
  { id: "earth", leader: "Giovanni", name: "Earth", color: "#5fbf77", options: [[{ key: "level", min: 50 }, { key: "caught", min: 100 }], [{ key: "level", min: 50 }, { key: "catches", min: 30 }]] },
];
// The Elite Four: after the eight badges, one member a week, in order. Only the member's week counts;
// a week that falls short is tried again the next one. Beating Lance makes the player Champion.
export const LEAGUE = [
  { id: "lorelei", leader: "Lorelei", options: [[{ key: "silver", min: 3 }]] },
  { id: "bruno", leader: "Bruno", options: [[{ key: "fast", min: 3 }], [{ key: "commit", min: 5 }], [{ key: "answered", min: 5 }]] },
  { id: "agatha", leader: "Agatha", options: [[{ key: "varied", min: 2 }]] },
  { id: "lance", leader: "Lance", options: [[{ key: "weekly", min: 1 }], [{ key: "silver", min: 6 }]] },
];
const NOW_KEYS = new Set(["streak", "level", "caught"]);
const pl = (n) => (n > 1 ? "s" : "");
const PART = {
  days: (n) => `be active on ${n} days`,
  fast: (n) => `answer ${n} blocked agent${pl(n)} within 2 minutes`,
  answered: (n) => `answer ${n} blocked agent${pl(n)}`,
  commit: (n) => `make ${n} commit${pl(n)}`,
  green: (n) => `finish ${n} task${pl(n)} with green tests or CI`,
  merged: (n) => `merge ${n} MR${pl(n)}`,
  long: (n) => `finish ${n} task${pl(n)} that ran 10+ minutes`,
  variety: (n) => `use ${n} branches, agents or repos in one day`,
  varied: (n) => `use 2+ branches, agents or repos on ${n} day${pl(n)}`,
  silver: (n) => `reach Silver on ${n} daily quest${pl(n)}`,
  gold: (n) => `reach Gold on ${n} daily quest${pl(n)}`,
  weekly: () => "reach Silver on the weekly quest",
  streak: (n) => `keep a ${n / 7}-week streak`,
  level: (n) => `train a Pokemon to Lv ${n}`,
  caught: (n) => `catch ${n} Pokemon`,
  catches: (n) => `catch ${n} wild Pokemon while this gym is open`,
};
const optionsText = (options, needs) => options.map((parts, i) => parts.map((p, j) => PART[p.key](needs?.[i]?.[j] ?? p.min)).join(" and ")).join(", or ");
export const KANTO = GYMS.map((x) => x.id);
export const BADGES = [
  ...GYMS.map((x) => ({ id: x.id, name: x.name, color: x.color, leader: x.leader, goal: `Beat ${x.leader}: ${optionsText(x.options)}` })),
  // Ranks past the gyms: drawn as medals, not badge art.
  { id: "elite", name: "Elite Four", rank: true, color: "#8e7cc3", goal: "Earn all 8 badges to face the Elite Four" },
  { id: "champion", name: "Champion", rank: true, color: "#f2994a", goal: "Beat the Elite Four, one member a week" },
];
// Side medals: never required for anything. Classic medals are the badges a save held before the gyms.
export const MEDALS = [
  { id: "tasks50", name: "Rookie", color: "#a8a29a", goal: "Finish 50 agent tasks", test: (g) => g.tasks >= 50 },
  { id: "tasks500", name: "Veteran", color: "#d4af37", goal: "Finish 500 agent tasks", test: (g) => g.tasks >= 500 },
  { id: "tasks1000", name: "Marathon", color: "#8e7cc3", goal: "Finish 1000 agent tasks", test: (g) => g.tasks >= 1000 },
];
// Legendaries come from milestones, never from the tall grass: a bird for three weekly quests done
// (Bronze) in a row, Mewtwo for the Champion, Mew once the other 150 are caught. They wait in the grass until
// caught, and don't flee.
export const BIRDS = [144, 145, 146];
const LEGEND_RATE = 0.35;
export const MISSING_SHARE = 0.4; // share of encounters rolled from species not caught yet

export function game() {
  const g = shared(GAME) ?? {};
  return {
    party: g.party ?? [], pokemon: g.pokemon ?? {}, lifetime: g.lifetime ?? 0, bank: g.bank ?? 0,
    gifts: g.gifts ?? { got: [], pending: [] }, results: g.results ?? {},
    // A brand-new save has nothing to explain: the Phase 2 explainer is for migrated saves.
    seen: g.seen ?? (Object.keys(g).length ? [] : ["phase2"]),
    tasks: g.tasks ?? 0, subtasks: g.subtasks ?? 0, evolutions: g.evolutions ?? 0,
    streak: { last: null, days: 0, best: 0, freezes: 0, active: 0, ...g.streak },
    badges: g.badges ?? [], shiny: g.shiny ?? [],
    wild: g.wild ?? (g.encounter ? [g.encounter] : []), encounter: g.wild?.[0] ?? g.encounter ?? null,
    encounters: g.encounters ?? { seen: 0, caught: 0, fled: 0 }, recent: g.recent ?? [],
    bag: g.bag ?? {}, dex: g.dex ?? {}, fainted: g.fainted ?? {}, happy: g.happy ?? {}, quests: g.quests ?? null,
    lastTurn: g.lastTurn ?? null, digest: g.digest ?? blankDigest(), rested: g.rested ?? 0, money: g.money ?? 0,
    // Professor Oak's steps done so far; null once finished, and for saves from before the tutorial.
    tutorial: g.tutorial !== undefined ? g.tutorial : Object.keys(g).length ? null : [],
    gyms: g.gyms ?? null, league: g.league ?? null, medals: g.medals ?? [], classic: g.classic ?? [],
    legends: g.legends ?? { run: 0, week: null, mew: false }, fame: g.fame ?? null,
    // A save written before versioning is version 1; a brand-new one starts at the current version.
    version: g.version ?? (Object.keys(g).length ? 1 : SAVE_VERSION), stats: g.stats ?? blankStats(),
  };
}

// --- Save versions. Each step upgrades a save from version n to n + 1; the server runs them at start
// and after an import or a merge. A save newer than these rules is left alone.
//   1 -> 2: local stats.
//   2 -> 3: the tall grass queue (the waiting encounter joins it); fainting became hard mode only.
//   3 -> 4: one party instead of a partner per project (see fromProjects).
//   4 -> 5: active-day streaks (the streak and its best carry over, with a Streak Freeze per 7 active
//           days already recorded, up to 2); no tutorial for a save that already played.
//   5 -> 6: gyms. Badges earned before become Classic medals (each gives its gym a 50% head start),
//           task counts become side medals, and the gyms start from Brock.
export const SAVE_VERSION = 6;
// The rules' version: bump it with any change to what the rules compute, so an app whose copy of
// this file is older or newer than the server's can say so (the server sends it with the state).
export const RULES_VERSION = 3;
const MIGRATIONS = {
  1: (g) => ({ ...g, stats: g.stats ?? blankStats() }),
  2: (g) => ({ ...g, wild: g.wild ?? (g.encounter ? [g.encounter] : []), fainted: {}, happy: g.happy ?? {} }),
  3: (g) => fromProjects(g),
  4: (g) => {
    const active = Object.values(g.stats?.days ?? {}).filter((d) => d.turns > 0).length;
    const streak = { last: null, days: 0, best: 0, ...g.streak, freezes: Math.min(FREEZE_MAX, Math.floor(active / FREEZE_EVERY)), active };
    return { ...g, streak, tutorial: null, rested: 0, money: g.money ?? 0 };
  },
  5: (g) => {
    const tasks = g.tasks ?? 0;
    const medals = MEDALS.filter((m) => m.test({ tasks })).map((m) => m.id);
    return { ...g, classic: g.badges ?? [], badges: [], medals, gyms: null, league: null, legends: { run: 0, week: null, mew: false }, fame: null };
  },
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
    g.rested > 0 && `rested: your next ${g.rested} XP count double`,
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

// Per-project partners become one party. Every partner joins the Pokedex and keeps its project's XP
// (summed when several projects share one); the six with the most XP form the party, the top one
// leading; lifetime XP is the sum, so the trainer level carries over (its gifts come with the next
// XP). Partners stay as mascots.
function fromProjects(g) {
  const partners = shared(PARTNERS) ?? {};
  const pokemon = { ...(g.pokemon ?? {}) };
  for (const [project, xp] of Object.entries(g.xp ?? {})) {
    const id = partners[project];
    if (id) pokemon[id] = (pokemon[id] ?? 0) + xp;
  }
  const ids = [...new Set(Object.values(partners))];
  const caught = shared(CAUGHT) ?? [];
  const fresh = ids.filter((id) => !caught.includes(id));
  if (fresh.length) setShared(CAUGHT, [...caught, ...fresh].sort((x, y) => x - y));
  const at = Date.now();
  const dex = { ...(g.dex ?? {}), ...Object.fromEntries(fresh.map((id) => [id, { at, project: null, how: "partner" }])) };
  const party = Object.entries(pokemon).sort(([, x], [, y]) => y - x).map(([id]) => +id).slice(0, PARTY_MAX);
  const { xp, ...rest } = g;
  const lifetime = Object.values(xp ?? {}).reduce((s, n) => s + n, 0);
  return { ...rest, pokemon, party, dex, lifetime, bank: 0, gifts: { got: [], pending: [] }, results: {}, seen: [] };
}

// --- Local stats, for pacing and (later) goals sized to the player's own median.
const STATS_DAYS = 90; // days kept
const STATS_LENGTHS = 200; // recent turn lengths kept for the median
const blankStats = () => ({ days: {}, lengths: [] });
// `fast`: blocked agents answered within FAST_MS; `long`: turns of 10+ minutes; `variety`: the most
// branches, agents or repos used that day; `gold`: daily quests that reached Gold; `frozen`: a day
// a Streak Freeze covered.
const blankDay = () => ({ turns: 0, ms: 0, xp: 0, seen: 0, caught: 0, fled: 0, left: 0, fast: 0, answered: 0, long: 0, variety: 0, quests: 0, silver: 0, gold: 0, commit: 0, green: 0, merged: 0 });
// Adds n to today's `key` (or raises it to n with `max`), and to the open gym's and Elite Four's
// counters. Mutates g.
function tally(g, key, n = 1, max = false) {
  const s = g.stats ?? blankStats(), k = day(new Date());
  const today = { ...blankDay(), ...s.days[k] };
  const prev = today[key] ?? 0;
  today[key] = max ? Math.max(prev, n) : prev + n;
  g.stats = { ...s, days: { ...s.days, [k]: today } };
  count(g, key, prev, today[key]);
}
// What a gym or Elite Four member counts: the first turn of a day is an active day, a day's variety
// reaching 2 is a varied day, and the rest add up.
const COUNTED = new Set(["turns", "caught", "variety", "fast", "answered", "long", "silver", "gold", "commit", "green", "merged", "weekly"]);
function count(g, key, prev, now) {
  if (!COUNTED.has(key) || now === prev) return;
  if (!g.gyms) openGym(g, 0);
  const add = (c0) => {
    const c = { ...c0 };
    if (key === "turns") { if (!prev) c.days = (c.days ?? 0) + 1; }
    else if (key === "variety") {
      c.variety = Math.max(c.variety ?? 0, now);
      if (prev < 2 && now >= 2) c.varied = (c.varied ?? 0) + 1;
    } else if (key === "caught") c.catches = (c.catches ?? 0) + (now - prev);
    else c[key] = (c[key] ?? 0) + (now - prev);
    return c;
  };
  if (g.gyms && g.gyms.at < GYMS.length) g.gyms = { ...g.gyms, c: add(g.gyms.c ?? {}) };
  leagueWeek(g);
  if (g.league && g.league.at < LEAGUE.length && g.league.week === week(new Date())) g.league = { ...g.league, c: add(g.league.c ?? {}) };
}
// The active days among the `span` days before day key `end` (not included).
const before = (g, end, span) => Array.from({ length: span }, (_, i) => g.stats.days[addDays(end, -1 - i)]).filter((d) => d?.turns > 0);
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
  const sum = (key) => days.reduce((n, d) => n + (d[key] ?? 0), 0);
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
// The trainer level grows with lifetime XP, the same however many projects earned it.
export const trainerLevel = (g) => Math.max(1, Math.floor(Math.sqrt((g.lifetime ?? 0) / 40)));
// --- Active-day streaks: a day keeps the streak when 5 of the 7 days ending with it were active, so
// any two days off a week (weekends or not) are fine. The streak counts those days. A Streak Freeze,
// earned every 7 active days (2 at most), covers a missing day when the streak would break.
export const STREAK_WINDOW = 7, STREAK_NEED = 5, FREEZE_EVERY = 7, FREEZE_MAX = 2;
// Walks the streak from the day after its last one through day key `until`, spending freezes where
// they save it. With `write`, saves the result and marks the frozen days. Returns the streak.
function walkStreak(g, until, write) {
  const s = { ...g.streak };
  const frozen = new Set();
  const counts = (k) => g.stats.days[k]?.turns > 0 || !!g.stats.days[k]?.frozen || frozen.has(k);
  for (let k = s.last ? addDays(s.last, 1) : until; k <= until; k = addDays(k, 1)) {
    const win = Array.from({ length: STREAK_WINDOW }, (_, i) => addDays(k, -i));
    let n = win.filter(counts).length;
    const missing = STREAK_NEED - n;
    if (missing > 0 && s.days > 0 && missing <= s.freezes) {
      for (const x of win.filter((x) => !counts(x)).slice(0, missing)) frozen.add(x);
      s.freezes -= missing;
      n = STREAK_NEED;
    }
    s.days = n >= STREAK_NEED ? s.days + 1 : 0;
    s.best = Math.max(s.best, s.days);
    s.last = k;
  }
  if (write) {
    g.streak = s;
    for (const x of frozen) g.stats = { ...g.stats, days: { ...g.stats.days, [x]: { ...blankDay(), ...g.stats.days[x], frozen: 1 } } };
  }
  return s;
}
// Today's streak: what it is through yesterday when today has no finished task yet.
export function liveStreak(g, now = new Date()) {
  const k = day(now);
  if (!g.streak.last) return 0;
  if (g.streak.last >= k) return g.streak.days;
  return walkStreak(g, addDays(k, -1), false).days;
}
// The week's progress toward a streak: the active (or frozen) days among the 7 ending today, out of
// the STREAK_NEED a day needs. What the apps show while the streak is 0.
export function liveWeek(g, now = new Date()) {
  const k = day(now);
  return Array.from({ length: STREAK_WINDOW }, (_, i) => g.stats?.days?.[addDays(k, -i)]).filter((d) => d?.turns > 0 || d?.frozen).length;
}

const day = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const addDays = (k, n) => { const [y, m, d] = k.split("-").map(Number); return day(new Date(y, m - 1, d + n)); };
// A week is named by its Monday.
const week = (d) => day(new Date(d.getFullYear(), d.getMonth(), d.getDate() - (d.getDay() + 6) % 7));
const hash = (s) => [...s].reduce((h, c) => Math.imul(h ^ c.codePointAt(0), 16777619) >>> 0, 2166136261);
const shinyChance = (g) => { const s = liveStreak(g); return s >= 30 ? 1 / 4 : s >= 7 ? 1 / 8 : 0; };
export const catchRate = (id) => LEGENDARY.includes(id) ? 0.03 : FINAL.has(id) ? 0.35 : 0.6;
// One throw's odds: the ball's bonus, and +25% for each task finished while the Pokemon waited (up to 3).
// A legendary earned from a milestone (`staying`) is as easy as a final form.
export const throwRate = (e, ball = "poke") => Math.min(1, (e.staying ? LEGEND_RATE : catchRate(e.id)) * (ITEMS[ball]?.bonus ?? 1) * (1 + 0.25 * (e.weak ?? 0)));
const expired = (e, now = Date.now()) => !e.staying && now - e.at > ENCOUNTER_MS;

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
  const news = [];
  const medals = MEDALS.filter((m) => !g.medals.includes(m.id) && m.test(g));
  g.medals = [...g.medals, ...medals.map((m) => m.id)];
  for (const m of medals) news.push({ title: `${m.name} medal!`, body: m.goal });
  advance(g, news);
  // Mew shows up once the other 150 are in the Pokedex.
  const have = shared(CAUGHT) ?? [];
  if (!g.legends.mew && have.filter((id) => id !== 151).length >= 150) {
    g.legends = { ...g.legends, mew: true };
    summon(g, 151, "Something stirs in the tall grass...");
  }
  if (news.length) {
    if (!jingled) jingle("badge");
    for (const n of news) notify({ ...n, level: "success" });
  }
  put(g);
}

// --- Gym progress.
// The player's median per active day of `key` over the 14 days before day `k`.
const baseOf14 = (g, k, key) => median(before(g, k, 14).map((d) => d[key] ?? 0));
const needOf = (g, k, part) => Math.max(part.min, part.mult ? Math.ceil(part.mult * baseOf14(g, k, part.key) - 1e-9) : 0);
// Opens gym `at` (GYMS.length: all beaten), its needs fixed from the player's pace now. A Classic badge
// for it counts half of each need as done. Mutates g.
function openGym(g, at) {
  if (at >= GYMS.length) {
    g.gyms = { at, since: day(new Date()), need: [], c: {}, head: false };
    return;
  }
  const k = day(new Date());
  g.gyms = { at, since: k, need: GYMS[at].options.map((parts) => parts.map((p) => needOf(g, k, p))), c: {}, head: g.classic.includes(GYMS[at].id) };
}
// How far a part is: its count (or the save's value), plus half the need with a head start.
function partValue(g, key, c) {
  if (key === "streak") return g.streak.days;
  if (key === "level") return Math.max(0, ...Object.values(g.pokemon).map(levelOf));
  if (key === "caught") return (shared(CAUGHT) ?? []).length;
  return c[key] ?? 0;
}
function optionsView(g, options, need, c, head) {
  return options.map((parts, i) => {
    const ps = parts.map((p, j) => {
      const n = need[i][j];
      const have = partValue(g, p.key, c) + (head ? Math.ceil(n / 2) : 0);
      return { key: p.key, need: n, n: Math.min(n, have), goal: PART[p.key](n) };
    });
    return { goal: ps.map((p) => p.goal).join(" and "), parts: ps, done: ps.every((p) => p.n >= p.need) };
  });
}
// The Elite Four moves to a new week: counters start over (a member not beaten tries again).
function leagueWeek(g) {
  const wk = week(new Date());
  if (g.league && g.league.at < LEAGUE.length && wk > g.league.week) g.league = { ...g.league, week: wk, c: {} };
}
// Beats every gym and Elite Four member whose challenge is met; news goes to `news`. Mutates g.
function advance(g, news) {
  if (!g.gyms) openGym(g, 0);
  while (g.gyms.at < GYMS.length) {
    const gym = GYMS[g.gyms.at];
    if (!optionsView(g, gym.options, g.gyms.need, g.gyms.c ?? {}, g.gyms.head).some((o) => o.done)) break;
    g.badges = addOnce(g.badges, gym.id);
    news.push({ title: `${gym.name} Badge earned!`, body: `You beat ${gym.leader}.${GYMS[g.gyms.at + 1] ? ` Next: ${GYMS[g.gyms.at + 1].leader}.` : ""}` });
    openGym(g, g.gyms.at + 1);
  }
  if (KANTO.every((id) => g.badges.includes(id)) && !g.badges.includes("elite")) {
    g.badges = [...g.badges, "elite"];
    g.league = { at: 0, week: week(new Date()), c: {} };
    news.push({ title: "All 8 badges!", body: "The Elite Four awaits: one member a week, starting with Lorelei." });
  }
  leagueWeek(g);
  const l = g.league;
  if (!l || l.at >= LEAGUE.length || l.week !== week(new Date())) return;
  const member = LEAGUE[l.at];
  const need = member.options.map((parts) => parts.map((p) => p.min));
  if (!optionsView(g, member.options, need, l.c ?? {}, false).some((o) => o.done)) return;
  // The next member waits for next week.
  g.league = { at: l.at + 1, week: addDays(l.week, 7), c: {} };
  if (l.at + 1 < LEAGUE.length) {
    news.push({ title: `You beat ${member.leader}!`, body: `Next week: ${LEAGUE[l.at + 1].leader}.` });
    return;
  }
  g.badges = addOnce(g.badges, "champion");
  g.fame = { at: Date.now(), party: partyOf(g).map(({ id, level }) => ({ id, level, shiny: g.shiny.includes(id) })) };
  news.push({ title: "You are the Champion!", body: "Your team enters the Hall of Fame." });
  summon(g, 150, "A presence answers the new Champion...");
}
// The open gym and the Elite Four as the apps draw them: `gym` (null once all eight are beaten) with
// its options and their progress, `league` (null before the eighth badge or after the Champion).
export function gymView(g0 = game(), now = new Date()) {
  const g = { ...g0 };
  if (!g.gyms) openGym(g, 0);
  leagueWeek(g);
  const at = g.gyms.at;
  const gym = at < GYMS.length ? {
    ...GYMS[at], index: at, since: g.gyms.since, head: g.gyms.head, options: optionsView(g, GYMS[at].options, g.gyms.need, g.gyms.c ?? {}, g.gyms.head),
  } : null;
  const l = g.league;
  const league = l && l.at < LEAGUE.length ? {
    ...LEAGUE[l.at], index: l.at, week: l.week, waiting: l.week > week(now),
    options: optionsView(g, LEAGUE[l.at].options, LEAGUE[l.at].options.map((ps) => ps.map((p) => p.min)), l.week === week(now) ? l.c ?? {} : {}, false),
  } : null;
  return { gym, league, badges: g.badges.filter((id) => KANTO.includes(id)).length, champion: g.badges.includes("champion"), fame: g.fame };
}

// A legendary from a milestone waits at the front of the tall grass, even when it's full. Mutates g.
function summon(g, id, body) {
  if ((shared(CAUGHT) ?? []).includes(id) || g.wild.some((e) => e.id === id)) return;
  g.wild = [{ id, at: Date.now(), balls: BALLS, weak: 0, project: null, staying: true }, ...g.wild];
  g.encounters = { ...g.encounters, seen: g.encounters.seen + 1 };
  tally(g, "seen");
  notify({ title: `${nameOf(id)} appeared!`, body: `${body} It waits in the tall grass and won't flee.`, level: "success", icon: `mods/pokedex-agents/pokemon/${id}.png`, action: { name: "mod.open", args: { name: "pokedex-encounter" } } });
}
// The weekly quest paid (Bronze) in week `wk`: three weeks in a row bring the next bird. Mutates g.
function weeklyDone(g, wk) {
  const l = g.legends;
  if (l.week === wk) return;
  const run = l.week === addDays(wk, -7) ? l.run + 1 : 1;
  const bird = BIRDS.find((id) => !(shared(CAUGHT) ?? []).includes(id) && !g.wild.some((e) => e.id === id));
  g.legends = { ...l, week: wk, run: run >= 3 && bird ? 0 : run };
  if (run >= 3 && bird) summon(g, bird, "Three strong weeks in a row drew a legendary bird.");
}
// A wild Pokemon: MISSING_SHARE of them from species not caught yet, never a legendary.
function wildId() {
  const have = new Set(shared(CAUGHT) ?? []);
  const missing = Array.from({ length: 151 }, (_, i) => i + 1).filter((id) => !have.has(id) && !LEGENDARY.includes(id));
  if (missing.length && Math.random() < MISSING_SHARE) return missing[Math.floor(Math.random() * missing.length)];
  let id;
  do id = 1 + Math.floor(Math.random() * 151); while (LEGENDARY.includes(id));
  return id;
}

// Awards every badge the save already qualifies for, after progress came in from outside the rules
// (a merge, an import, a restored backup).
export function checkBadges() {
  save(game());
}

// --- Quests sized to the player: three daily ones (always a task quest, plus two that the player's last
// 30 days show they can do) and one weekly one. Each has Bronze / Silver / Gold thresholds at 50% /
// 100% / 150% of the player's own median over the 14 days before (a weekly one: their weekly average),
// never under a minimum, and every tier pays. The set is fixed when the day or week starts.
export const TIERS = ["Bronze", "Silver", "Gold"];
const RATIOS = [0.5, 1, 1.5];
const variety = (c) => Math.max(c.projects.length, c.agents.length, c.branches.length);
const plural = (n) => (n > 1 ? "s" : "");
const QUESTS = [
  { id: "tasks", stat: "turns", min: [2, 3, 5], weeklyMin: [5, 10, 15], n: (c) => c.tasks, goal: (n) => `Finish ${n} agent task${plural(n)}` },
  { id: "catch", stat: "caught", min: [1, 2, 3], weeklyMin: [2, 3, 5], n: (c) => c.catches, goal: (n) => `Catch ${n} wild Pokemon` },
  { id: "fast", stat: "fast", min: [1, 2, 3], weeklyMin: [2, 3, 5], n: (c) => c.fast, goal: (n) => `Answer ${n} blocked agent${plural(n)} within 2 minutes` },
  { id: "long", stat: "long", min: [1, 2, 3], weeklyMin: [2, 3, 5], n: (c) => c.long, goal: (n) => `Finish ${n} task${plural(n)} that ran 10+ minutes` },
  // Daily only: 2 branches or 2 agents or 2 repos all count, so one repo is no handicap.
  { id: "variety", stat: "variety", min: [2, 3, 4], n: variety, goal: (n) => `Show variety: ${n} branches, agents or repos` },
];
const questDef = (id) => QUESTS.find((x) => x.id === id);
// What each tier pays; `stone` is the week's stone, `money` PokeDollars.
const DAILY_PAY = [{ great: 1 }, { great: 2 }, { ultra: 1, money: 50 }];
const WEEKLY_PAY = [{ ultra: 1 }, { ultra: 1, stone: 1 }, { ultra: 1, money: 200 }];
const weekStone = (wk) => STONES[hash(wk) % STONES.length];
const payText = (pay, wk) => Object.entries(pay).map(([k, n]) => (k === "money" ? `${n} PokeDollars` : `${n} ${ITEMS[k === "stone" ? weekStone(wk) : k].name}${plural(n)}`)).join(" + ");
function pay(g, p, wk) {
  for (const [k, n] of Object.entries(p)) {
    if (k === "money") g.money += n;
    else gain(g, k === "stone" ? weekStone(wk) : k, n);
  }
}
// Thresholds from a base (a median or a weekly average): each tier at least its minimum and above the
// tier before it.
function needs(min, base) {
  const out = [];
  for (const [i, r] of RATIOS.entries()) out.push(Math.max(min[i], Math.ceil(r * base - 1e-9), (out[i - 1] ?? 0) + 1));
  return out;
}
// Day `k`'s candidates, best first: the task quest, then every quest the best of the last 30 days
// would have reached Bronze in, shuffled by the date. The first three are offered; the rest are rerolls.
function planDay(g, k) {
  const recent = before(g, k, 14), month = before(g, k, 30);
  const h = hash(k);
  const fits = QUESTS.map((x) => ({ id: x.id, need: needs(x.min, median(recent.map((d) => d[x.stat] ?? 0))) }))
    .filter((q) => q.id === "tasks" || Math.max(0, ...month.map((d) => d[questDef(q.id).stat] ?? 0)) >= q.need[0]);
  const [core, ...rest] = fits;
  return [core, ...rest.sort((a, b) => hash(a.id + h) - hash(b.id + h))];
}
// Week `wk`'s quest: one of those whose Bronze the player's weekly average reaches (the task one always).
function planWeek(g, wk) {
  const recent = before(g, wk, 14);
  const fits = QUESTS.filter((x) => x.weeklyMin).map((x) => {
    const base = recent.reduce((n, d) => n + (d[x.stat] ?? 0), 0) / 2;
    return { id: x.id, need: needs(x.weeklyMin, base), base };
  }).filter((q) => q.id === "tasks" || q.base >= q.need[0]);
  const { base, ...q } = fits[hash(wk) % fits.length];
  return q;
}
const blankCount = () => ({ tasks: 0, projects: [], agents: [], branches: [], catches: 0, fast: 0, long: 0, evolutions: 0, tiers: {} });
// This period's quests and counters, fresh when the day or week turned. Mutates g.
function questState(g, now = new Date()) {
  const q = g.quests ?? {};
  const k = day(now), wk = week(now);
  const today = q.day === k && q.daily ? { daily: q.daily, spare: q.spare ?? [], rerolled: !!q.rerolled } : (() => {
    const plan = planDay(g, k);
    return { daily: plan.slice(0, 3), spare: plan.slice(3), rerolled: false };
  })();
  g.quests = {
    day: k, week: wk, ...today,
    weekly: q.week === wk && q.weekly ? q.weekly : planWeek(g, wk),
    d: q.day === k ? { ...blankCount(), ...q.d } : blankCount(),
    w: q.week === wk ? { ...blankCount(), ...q.w } : blankCount(),
  };
  return g.quests;
}
// Today's and this week's quests with their progress, for the trainer card. `tier`: tiers reached (0-3);
// `need` and `reward`: the next tier's; `done`: Gold reached.
export function quests(g = game(), now = new Date()) {
  const q = questState({ ...g }, now);
  const view = (x, c, weekly) => {
    const def = questDef(x.id), tier = c.tiers[x.id] ?? 0, need = x.need[Math.min(tier, 2)];
    return {
      id: `${weekly ? "w" : "d"}-${x.id}`, goal: def.goal(need), need, needs: x.need, n: Math.min(need, def.n(c)), tier, done: tier >= 3, weekly,
      reward: tier < 3 ? payText((weekly ? WEEKLY_PAY : DAILY_PAY)[tier], q.week) : null,
      rerollable: !weekly && !q.rerolled && tier === 0 && x.id !== "tasks" && q.spare.length > 0,
    };
  };
  return [...q.daily.map((x) => view(x, q.d, false)), view(q.weekly, q.w, true)];
}
// Counts something toward both periods' quests and pays every tier it reaches. Mutates g.
function bump(g, fn) {
  const q = questState(g);
  fn(q.d);
  fn(q.w);
  for (const [x, c, weekly] of [...q.daily.map((x) => [x, q.d, false]), [q.weekly, q.w, true]]) {
    const def = questDef(x.id), n = def.n(c);
    let tier = c.tiers[x.id] ?? 0;
    for (; tier < 3 && n >= x.need[tier]; tier++) {
      const p = (weekly ? WEEKLY_PAY : DAILY_PAY)[tier];
      pay(g, p, q.week);
      if (tier === 0) {
        tally(g, "quests");
        remember(g, "quests");
      }
      if (tier === 2 && !weekly) tally(g, "gold");
      if (tier === 1 && !weekly) tally(g, "silver");
      if (tier === 1 && weekly) count(g, "weekly", 0, 1);
      if (tier === 0 && weekly) weeklyDone(g, q.week);
      notify({ title: `${weekly ? "Weekly" : "Daily"} quest: ${TIERS[tier]}!`, body: `${def.goal(x.need[tier])}: ${payText(p, q.week)}.`, level: "success", quiet: true });
    }
    c.tiers = { ...c.tiers, [x.id]: tier };
  }
}
// Swaps one of today's quests (not the task one, nor one that already paid) for another that fits:
// once a day.
export function rerollQuest(id) {
  const g = game();
  const q = questState(g);
  const bare = String(id).replace(/^d-/, "");
  const i = q.daily.findIndex((x) => x.id === bare);
  if (q.rerolled) throw new Error("one reroll a day: try again tomorrow");
  if (i < 0 || bare === "tasks") throw new Error("only today's quests other than the task quest can be rerolled");
  if ((q.d.tiers[bare] ?? 0) > 0) throw new Error("that quest already paid out");
  if (!q.spare.length) throw new Error("no other quest fits your last 30 days yet");
  const [next, ...spare] = q.spare;
  q.spare = [...spare, q.daily[i]];
  q.daily = q.daily.map((x, j) => (j === i ? next : x));
  q.rerolled = true;
  bump(g, () => {}); // a new quest already met pays at once
  put(g);
  return `d-${next.id}`;
}
const addOnce = (list, v) => (v && !list.includes(v) ? [...list, v] : list);

// Catches from outside the rules (the debug catch action) go through here, for shinies and badges.
export function recordCatches(ids, project = null) {
  const g = game();
  const fresh = addCaught(g, ids, "met", project);
  if (fresh.length) save(g);
}

// Moves a project's mascot to a new key (a space renamed, or the key scheme changing).
export function migrateProject(from, to) {
  if (from === to) return;
  const partners = shared(PARTNERS) ?? {};
  if (partners[from] !== undefined) {
    const { [from]: partner, ...rest } = partners;
    setShared(PARTNERS, { ...rest, [to]: rest[to] ?? partner });
  }
}

// --- The party: up to PARTY_MAX Pokemon from the Pokedex, the first one leading. Every XP award goes
// to the lead, whatever the project; the rest of the party gets DAYCARE of it. A project's entry in
// PARTNERS is only its mascot, drawn on its cards.
export const PARTY_MAX = 6;
export const DAYCARE = 0.25;
export const STARTERS = [1, 4, 7];
export const partyOf = (g = game()) => g.party.map((id) => ({ id, xp: g.pokemon[id] ?? 0, level: levelOf(g.pokemon[id]) }));
export const lead = (g = game()) => g.party[0] ?? null;

// A party member changes form, keeping its XP: it joins the Pokedex, counts for badges and quests,
// and plays the jingle. Projects showing it as their mascot show the new form. Mutates g.
function evolve(g, from, to, detail) {
  g.evolutions += 1;
  const { [from]: xp, ...rest } = g.pokemon;
  g.pokemon = { ...rest, [to]: Math.max(xp ?? 0, rest[to] ?? 0) };
  g.party = [...new Set(g.party.map((id) => (id === from ? to : id)))];
  const partners = shared(PARTNERS) ?? {};
  if (Object.values(partners).includes(from)) {
    setShared(PARTNERS, Object.fromEntries(Object.entries(partners).map(([k, id]) => [k, id === from ? to : id])));
  }
  addCaught(g, [to], "evolved", null);
  bump(g, (c) => { c.evolutions += 1; });
  jingle("evolve");
  notify({ title: `What? ${nameOf(from)} is evolving!`, body: `${nameOf(from)} became ${nameOf(to)}${detail}.`, level: "success", icon: `mods/pokedex-agents/pokemon/${to}.png` });
}

// XP to one Pokemon, with level-up and evolution news. Mutates g; true when it evolved.
function grow(g, id, amount) {
  const before = levelOf(g.pokemon[id]);
  g.pokemon = { ...g.pokemon, [id]: (g.pokemon[id] ?? 0) + amount };
  const after = levelOf(g.pokemon[id]);
  // Evolve as many stages as the new level allows.
  let to = id;
  while (EVOLVE[to] && after >= EVOLVE[to][1]) to = EVOLVE[to][0];
  if (to !== id) {
    evolve(g, id, to, ` (Lv ${after})`);
    return true;
  }
  if (after > before) remember(g, "levels");
  if (Math.floor(after / LEVEL_NEWS_EVERY) > Math.floor(before / LEVEL_NEWS_EVERY)) {
    notify({ title: `${nameOf(id)} reached Lv ${after}!`, body: id === g.party[0] ? "Your lead partner" : "Day Care", level: "info", icon: `mods/pokedex-agents/pokemon/${id}.png`, quiet: true });
  }
  return false;
}

// XP earned by the trainer: it counts toward the trainer level, goes to the lead and (DAYCARE of it)
// to the rest of the party. Before a starter is chosen it waits in `bank` for it. Mutates g; true when
// something evolved.
function award(g, amount) {
  if (amount <= 0) return false;
  tally(g, "xp", amount);
  // Rested XP doubles what comes in until it runs out.
  const bonus = Math.min(g.rested, amount);
  g.rested -= bonus;
  amount += bonus;
  g.lifetime += amount;
  gifts(g);
  if (!g.party.length) {
    g.bank += amount;
    return false;
  }
  let evolved = false;
  for (const [i, id] of [...g.party].entries()) if (grow(g, id, i === 0 ? amount : Math.round(amount * DAYCARE))) evolved = true;
  return evolved;
}

// The first choice: Bulbasaur, Charmander or Squirtle leads the party, with any XP earned before it.
export function chooseStarter(id) {
  const g = game();
  if (g.party.length) throw new Error("the starter is already chosen");
  if (!STARTERS.includes(id)) throw new Error("the starter is Bulbasaur (1), Charmander (4) or Squirtle (7)");
  addCaught(g, [id], "starter", null);
  g.party = [id];
  const bank = g.bank;
  g.bank = 0;
  const evolved = grow(g, id, bank);
  save(g, evolved);
  return id;
}

// A new party, in order (the first leads): 1 to PARTY_MAX different Pokemon from the Pokedex.
export function setParty(ids) {
  const caught = shared(CAUGHT) ?? [];
  if (!Array.isArray(ids) || !ids.length || ids.length > PARTY_MAX || new Set(ids).size !== ids.length) throw new Error(`a party is 1 to ${PARTY_MAX} different Pokemon`);
  const missing = ids.find((id) => !caught.includes(id));
  if (missing) throw new Error(`${nameOf(missing)} isn't in your Pokedex`);
  const g = game();
  if (g.party.length && g.party[0] !== ids[0]) learn(g, "lead");
  g.party = ids;
  put(g);
  return ids;
}
// Puts a Pokemon from the Pokedex at the head of the party (the previous lead stays in it, room allowing).
export const setLead = (id) => setParty([id, ...game().party.filter((x) => x !== id)].slice(0, PARTY_MAX));

// Marks a one-time screen ("phase2": the New Pokedex explainer) as seen. "trainer": the trainer card
// opened, a tutorial step.
export function markSeen(key) {
  const g = game();
  const before = JSON.stringify([g.seen, g.tutorial]);
  if (!g.seen.includes(key) && key !== "trainer") g.seen = [...g.seen, key];
  if (key === "trainer") learn(g, "trainer");
  if (JSON.stringify([g.seen, g.tutorial]) !== before) put(g);
}

// --- Professor Oak's tutorial, for a new save: five first steps, then 5 Poke Balls and the Pokedex.
export const TUTORIAL = [
  { id: "agent", goal: "Open an agent" },
  { id: "task", goal: "Finish a task" },
  { id: "catch", goal: "Catch your first wild Pokemon" },
  { id: "lead", goal: "Change your lead partner" },
  { id: "trainer", goal: "Open the trainer card" },
];
// A tutorial step done; the last one pays. Mutates g.
function learn(g, id) {
  if (!g.tutorial || g.tutorial.includes(id)) return;
  g.tutorial = [...g.tutorial, id];
  if (!TUTORIAL.every((t) => g.tutorial.includes(t.id))) return;
  g.tutorial = null;
  gain(g, "poke", 5);
  notify({ title: "Professor Oak: well done!", body: "Here is your Pokedex, and 5 Poke Balls to fill it.", level: "success" });
}

// --- Rested XP: each day off beyond the two a week a streak allows (a day whose last 7 days held fewer
// than STREAK_NEED active ones) banks one day of the player's average XP, up to RESTED_DAYS of it, and
// XP counts double until the bank is spent. A usual weekend banks nothing. Runs on the first turn of a
// day, before `lastTurn` moves.
export const RESTED_DAYS = 3;
function rest(g, today) {
  if (!g.lastTurn) return;
  let away = 0;
  for (let k = addDays(day(new Date(g.lastTurn)), 1); k < today && away < RESTED_DAYS; k = addDays(k, 1)) {
    const active = Array.from({ length: STREAK_WINDOW }, (_, i) => g.stats.days[addDays(k, -i)]).filter((d) => d?.turns > 0).length;
    if (active < STREAK_NEED) away++;
  }
  const xp = before(g, today, 14).map((d) => d.xp ?? 0).filter((n) => n > 0);
  if (!away || !xp.length) return;
  const avg = xp.reduce((n, x) => n + x, 0) / xp.length;
  g.rested = Math.round(Math.min(RESTED_DAYS * avg, g.rested + away * avg));
}

// --- Gifts at trainer levels, the same for everyone. One with several `ids` waits for a choice.
export const GIFTS = [
  { tr: 5, ids: [133] }, { tr: 10, ids: [131] }, { tr: 15, ids: [138, 140] }, { tr: 20, ids: [106, 107] }, { tr: 30, ids: [137] },
];
// Grants every gift the trainer level reached; choices go to g.gifts.pending. Mutates g.
function gifts(g) {
  const tr = trainerLevel(g);
  for (const gift of GIFTS) {
    if (gift.tr > tr || g.gifts.got.includes(gift.tr) || g.gifts.pending.includes(gift.tr)) continue;
    if (gift.ids.length > 1) {
      g.gifts = { ...g.gifts, pending: [...g.gifts.pending, gift.tr] };
      notify({ title: `Trainer Lv ${gift.tr}: a gift is waiting!`, body: `Choose ${gift.ids.map(nameOf).join(" or ")}.`, level: "success" });
    } else {
      g.gifts = { ...g.gifts, got: [...g.gifts.got, gift.tr] };
      addCaught(g, gift.ids, "gift", null);
      notify({ title: `Trainer Lv ${gift.tr}: you received ${nameOf(gift.ids[0])}!`, body: "A gift for your progress.", level: "success", icon: `mods/pokedex-agents/pokemon/${gift.ids[0]}.png` });
    }
  }
}
// Takes a waiting gift: `id` is one of its choices.
export function claimGift(tr, id) {
  const g = game();
  const gift = GIFTS.find((x) => x.tr === tr);
  if (!gift || !g.gifts.pending.includes(tr)) throw new Error("no gift waiting at that trainer level");
  if (!gift.ids.includes(id)) throw new Error(`choose ${gift.ids.map(nameOf).join(" or ")}`);
  g.gifts = { got: [...g.gifts.got, tr], pending: g.gifts.pending.filter((x) => x !== tr) };
  addCaught(g, [id], "gift", null);
  save(g);
  return id;
}

// The items a Pokemon can evolve with, and how many of each the bag holds.
export function itemsFor(id, g = game()) {
  return Object.entries(ITEM_EVOLVE[id] ?? {}).map(([item, to]) => ({ item, to, have: g.bag[item] ?? 0 }));
}

// Uses a stone or Link Cable on a party member. Returns the new Pokemon, or null when it can't.
export function useItem(id, item) {
  const g = game();
  const to = ITEM_EVOLVE[id]?.[item];
  if (!g.party.includes(id) || !to || !(g.bag[item] > 0)) return null;
  g.bag = { ...g.bag, [item]: g.bag[item] - 1 };
  evolve(g, id, to, ` with a ${ITEMS[item].name}`);
  save(g, true);
  return to;
}

// --- Results: what a turn produced, reported by the client after it. Each kind pays once per turn
// and project, scaled like the turn itself by the day's diminishing returns.
export const RESULT_XP = { commit: 20, green: 30, merged: 50 };
export function result(project, kind) {
  if (!RESULT_XP[kind]) throw new Error(`a result is one of ${Object.keys(RESULT_XP).join(", ")}`);
  const g = game();
  const done = g.results[project];
  if (!done || done.includes(kind)) return null;
  g.results = { ...g.results, [project]: [...done, kind] };
  tally(g, kind);
  const evolved = award(g, Math.round(RESULT_XP[kind] * dailyRate(g)));
  // A merge also finds something rare.
  if (kind === "merged") {
    gain(g, "ultra");
    remember(g, "items", "ultra");
  }
  save(g, evolved);
  return kind;
}

// --- Daily diminishing returns, the same in 1 repo or 10: the day's turns 1-5 pay in full, 6-20 40%,
// 21-50 10%, the rest 3%. Tuned with scripts/simulate.js (the roadmap's 20/50 tiers let the pro reach
// Lv100 in under 3 weeks once all XP goes to one lead).
export const DAILY_RATES = [[5, 1], [20, 0.4], [50, 0.1], [Infinity, 0.03]];
function dailyRate(g) {
  const n = g.stats.days[day(new Date())]?.turns ?? 0;
  return DAILY_RATES.find(([upTo]) => n <= upTo)[1];
}

// The base form of a Pokemon's evolution line (Charizard -> Charmander).
const PREV = Object.fromEntries([...Object.entries(EVOLVE).map(([from, [to]]) => [to, +from]), ...Object.entries(ITEM_EVOLVE).flatMap(([from, m]) => Object.values(m).map((to) => [to, +from]))]);
export function baseOf(id) {
  while (PREV[id]) id = PREV[id];
  return id;
}
// A default partner, from whatever a client hashed: always a base form, never a legendary.
export const defaultPartner = (id) => (LEGENDARY.includes(id) ? STARTERS[id % 3] : baseOf(id));

// An agent stopped needing the person after `ms`. A quick answer counts for a quest and makes the
// project's partner happy (+25% XP on its next task). In hard mode, one left waiting FAINT_MS or more
// makes the partner faint until its next task.
export function unblocked(project, ms) {
  const g = game();
  tally(g, "answered");
  if (ms <= FAST_MS) {
    bump(g, (c) => { c.fast += 1; });
    tally(g, "fast");
    g.happy = { ...g.happy, [project]: true };
  } else if (options().hardMode && ms >= FAINT_MS && !g.fainted[project]) {
    g.fainted = { ...g.fainted, [project]: true };
    const id = (shared(PARTNERS) ?? {})[project];
    notify({ title: `${id ? nameOf(id) : "Your partner"} fainted!`, body: `${projectLabel(project)}'s agent waited ${Math.round(ms / 60000)} min. Its next task earns no XP.`, level: "warning", icon: id ? `mods/pokedex-agents/pokemon/${id}.png` : undefined });
  }
  learn(g, "agent");
  save(g);
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

// A finished agent turn: XP by its length, the streak, items, quests, maybe a wild Pokemon. `branch`:
// the git branch it ran on, when the client knows it (for variety).
export function finishTask(project, partnerId, ms, app = null, branch = null) {
  const g = game();
  const today = day(new Date());
  const firstToday = !(g.stats.days[today]?.turns > 0);
  if (firstToday) rest(g, today);
  // Back after a while: one summary of what waits and what happened, before this turn's news.
  if (g.lastTurn && Date.now() - g.lastTurn >= AWAY_MS) digest(g);
  // A turn replayed from an app's queue may be older than the last one counted.
  g.lastTurn = Math.max(g.lastTurn ?? 0, Date.now());
  g.tasks += 1;
  tally(g, "turns");
  if (ms >= 10 * 60000) tally(g, "long");
  learn(g, "agent");
  learn(g, "task");
  tally(g, "ms", Math.max(0, ms));
  // This turn's results (a commit, green tests, a merge) may follow it.
  g.results = { ...g.results, [project]: [] };
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
    evolved = award(g, Math.round(taskXp(ms) * (happy ? 1 + HAPPY_BONUS : 1) * dailyRate(g)));
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

  // A new active day: a Great Ball, maybe a Streak Freeze, and the streak walks up to today (an
  // Ultra Ball for each full week it reaches).
  if (firstToday) {
    const active = g.streak.active + 1;
    const freezes = active % FREEZE_EVERY === 0 ? Math.min(FREEZE_MAX, g.streak.freezes + 1) : g.streak.freezes;
    const weeks = Math.floor(g.streak.days / 7);
    g.streak = { ...g.streak, active, freezes };
    walkStreak(g, today, true);
    gain(g, "great");
    if (Math.floor(g.streak.days / 7) > weeks) gain(g, "ultra");
  }

  bump(g, (c) => {
    c.tasks += 1;
    c.projects = addOnce(c.projects, project);
    c.agents = addOnce(c.agents, app);
    c.branches = addOnce(c.branches, branch ? `${project}\n${branch}` : null);
    if (ms >= 10 * 60000) c.long += 1;
  });
  tally(g, "variety", variety(g.quests.d), true);

  // The tall grass: old Pokemon flee, the rest wear down with the work done while they wait, and a
  // new one may join while there's room. A new one is news, but never opens anything by itself:
  // clients alert only when shouldAlert() says so.
  expire(g);
  g.wild = g.wild.map((e) => ({ ...e, weak: Math.min(3, (e.weak ?? 0) + 1) }));
  if (g.wild.length < WILD_MAX && Math.random() < ENCOUNTER_CHANCE) {
    const wild = wildId();
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
  learn(g, "agent");
  save(g, g.fainted[project] ? false : award(g, Math.round(SUBTASK_XP * dailyRate(g))));
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
  // A Poke Ball is one of the encounter's free ones while they last, then one from the bag.
  const free = ball === "poke" && e.balls > 0;
  if (!free && !(g.bag[ball] > 0)) return "empty";
  const after = free ? { ...e, balls: e.balls - 1 } : e;
  if (!free) g.bag = { ...g.bag, [ball]: g.bag[ball] - 1 };
  if (Math.random() < throwRate(e, ball)) {
    addCaught(g, [e.id], "wild", e.project ?? null);
    leave(g, index, "caught");
    bump(g, (c) => { c.catches += 1; });
    learn(g, "catch");
    save(g);
    return "caught";
  }
  // It stays while any ball is left to throw (a legendary from a milestone, always: its free balls come back).
  if (e.staying && after.balls === 0) after.balls = BALLS;
  if (e.staying || after.balls > 0 || ["poke", "great", "ultra"].some((b) => (g.bag[b] ?? 0) > 0)) {
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
  // A legendary from a milestone can't be left behind: it waits.
  if (g.wild[index] && !g.wild[index].staying) leave(g, index, "left");
  put(g);
}
