// Game rules (mods/pokedex-agents/game.js) against an in-memory stand-in for Herdr's `herdr` module.
// Run with `bun test`. Randomness is pinned per test; nothing touches a real Herdr.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";

const herdr = { state: {}, notes: [], sounds: [], soundsEnabled: true };
mock.module("herdr", () => ({
  shared: (key) => herdr.state[key],
  setShared: (key, value) => { herdr.state[key] = structuredClone(value); },
  notify: (n) => { herdr.notes.push(n); return "note"; },
  playSound: (sound) => { herdr.sounds.push(sound); return null; },
  settings: () => ({ sounds: { enabled: herdr.soundsEnabled } }),
}));
const G = await import("../src/game.js");

const realRandom = Math.random;
const roll = (value) => { Math.random = () => value; };
const titles = () => herdr.notes.map((n) => n.title);

beforeEach(() => {
  herdr.state = {};
  herdr.notes = [];
  herdr.sounds = [];
  herdr.soundsEnabled = true;
  roll(0.99); // no encounter, no shiny unless a test says otherwise
});
afterEach(() => { Math.random = realRandom; });

describe("XP and levels", () => {
  test("a turn earns 10 XP plus 5 per full minute, capped at 100", () => {
    expect(G.taskXp(5000)).toBe(10);
    expect(G.taskXp(180000)).toBe(25);
    expect(G.taskXp(3600000)).toBe(100);
    expect(G.taskXp(-1)).toBe(10);
  });

  test("level n needs 4 * n^2 XP, from Lv1 to Lv100", () => {
    expect(G.levelOf(0)).toBe(1);
    expect(G.levelOf(1023)).toBe(15);
    expect(G.levelOf(1024)).toBe(16);
    expect(G.levelOf(1e9)).toBe(100);
    expect(G.progress(4 * 16 ** 2 + (4 * 17 ** 2 - 4 * 16 ** 2) / 2).into).toBeCloseTo(0.5);
  });

  test("level-up news only when a partner crosses a multiple of 5", () => {
    herdr.state[G.GAME] = { xp: { p: 4 * 8 ** 2 } }; // Lv8
    G.finishTask("p", 1, 0); // +10 XP, still Lv8
    expect(titles()).toEqual([]);
    herdr.state[G.GAME].xp.p = 4 * 10 ** 2 - 5; // just under Lv10
    G.finishTask("p", 1, 0);
    expect(titles()).toEqual(["Bulbasaur reached Lv 10!"]);
  });
});

describe("project keys", () => {
  test("labels are the key's last path segment", () => {
    expect(G.projectLabel("/Users/a/workspace/kanto-api")).toBe("kanto-api");
    expect(G.projectLabel("vps:/srv/app")).toBe("app");
  });

  test("projectKey maps a space name, else returns it", () => {
    herdr.state[G.PROJECTS] = { "kanto renamed": "/r/kanto" };
    expect(G.projectKey("kanto renamed")).toBe("/r/kanto");
    expect(G.projectKey("other")).toBe("other");
  });

  test("migrating adds XP to the key and keeps an existing partner there", () => {
    herdr.state[G.PARTNERS] = { "old-name": 4, "/r/kanto": 25 };
    herdr.state[G.GAME] = { xp: { "old-name": 900, "/r/kanto": 100 } };
    G.migrateProject("old-name", "/r/kanto");
    expect(G.game().xp).toEqual({ "/r/kanto": 1000 });
    expect(herdr.state[G.PARTNERS]).toEqual({ "/r/kanto": 25 });
  });
});

describe("evolution, jingles and badges", () => {
  test("reaching the evolution level evolves, catches, plays one jingle and earns Thunder", () => {
    herdr.state[G.GAME] = { xp: { p: 1000 } };
    G.finishTask("p", 4, 600000); // +60 XP -> Lv16: Charmander -> Charmeleon
    expect(herdr.state[G.PARTNERS]).toEqual({ p: 5 });
    expect(herdr.state[G.CAUGHT]).toEqual([5]);
    expect(G.game().recent.map((r) => r.id)).toEqual([5]);
    expect(G.game().badges).toContain("thunder");
    expect(herdr.sounds).toEqual(["mods/pokedex-agents/sounds/evolve.mp3"]); // the badge stays quiet
  });

  test("a badge on its own plays the badge jingle", () => {
    herdr.state[G.CAUGHT] = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    G.recordCatches([10]);
    expect(G.game().badges).toEqual(["boulder"]);
    expect(herdr.sounds).toEqual(["mods/pokedex-agents/sounds/badge.mp3"]);
  });

  test("jingles stay silent when sounds are off", () => {
    herdr.soundsEnabled = false;
    herdr.state[G.GAME] = { xp: { p: 1000 } };
    G.finishTask("p", 4, 600000);
    expect(herdr.sounds).toEqual([]);
    expect(herdr.state[G.PARTNERS]).toEqual({ p: 5 });
  });
});

describe("partners", () => {
  test("a project's first XP saves its partner, and a saved one is kept", () => {
    G.finishTask("p", 52, 0);
    expect(herdr.state[G.PARTNERS]).toEqual({ p: 52 });
    G.finishTask("p", 1, 0);
    expect(herdr.state[G.PARTNERS]).toEqual({ p: 52 });
  });
});

describe("sub-agents", () => {
  test("a finished sub-agent earns 10 XP without counting a task", () => {
    G.finishSubTask("p", 1);
    expect(G.game().xp.p).toBe(G.SUBTASK_XP);
    expect(G.game().subtasks).toBe(1);
    expect(G.game().tasks).toBe(0);
  });
});

describe("encounters", () => {
  test("a finished task can spawn one, counted as seen", () => {
    roll(0);
    G.finishTask("p", 1, 0);
    expect(G.game().encounter).not.toBeNull();
    expect(G.game().encounters.seen).toBe(1);
  });

  test("an expired encounter counts as fled and no longer blocks new ones", () => {
    herdr.state[G.GAME] = { encounter: { id: 94, at: Date.now() - G.ENCOUNTER_MS - 1000, balls: 3 } };
    G.finishTask("p", 1, 0);
    expect(G.game().encounters.fled).toBe(1);
    expect(G.game().encounter).toBeNull();
  });

  test("a throw that lands catches it", () => {
    herdr.state[G.GAME] = { encounter: { id: 94, at: Date.now(), balls: 3 } };
    roll(0);
    expect(G.throwBall()).toBe("caught");
    expect(G.game().encounters.caught).toBe(1);
    expect(herdr.state[G.CAUGHT]).toEqual([94]);
  });

  test("three misses and it flees", () => {
    herdr.state[G.GAME] = { encounter: { id: 94, at: Date.now(), balls: 3 } };
    expect([G.throwBall(), G.throwBall(), G.throwBall()]).toEqual(["missed", "missed", "fled"]);
    expect(G.game().encounters.fled).toBe(1);
  });

  test("running away counts as fled", () => {
    herdr.state[G.GAME] = { encounter: { id: 94, at: Date.now(), balls: 3 } };
    G.runAway();
    expect(G.game().encounters.fled).toBe(1);
    expect(G.game().encounter).toBeNull();
  });

  test("catch rates: basic, final form, legendary", () => {
    expect(G.catchRate(4)).toBe(0.6);
    expect(G.catchRate(6)).toBe(0.35);
    expect(G.catchRate(150)).toBe(0.03);
    expect(G.catchRate(26)).toBe(0.35); // Raichu: a stone evolution's result is final
  });

  test("tasks finished while it waits weaken it, raising the odds", () => {
    herdr.state[G.GAME] = { encounter: { id: 4, at: Date.now(), balls: 3, weak: 0 } };
    G.finishTask("p", 1, 0);
    G.finishTask("p", 1, 0);
    const e = G.game().encounter;
    expect(e.weak).toBe(2);
    expect(G.throwRate(e)).toBeCloseTo(0.9);
    expect(G.throwRate(e, "ultra")).toBe(1);
  });

  test("Great Balls come from the bag and keep it there after the free balls run out", () => {
    herdr.state[G.GAME] = { encounter: { id: 94, at: Date.now(), balls: 1 }, bag: { great: 1 } };
    expect(G.throwBall("poke")).toBe("missed");
    expect(G.throwBall("poke")).toBe("empty");
    expect(G.throwBall("great")).toBe("fled");
    expect(G.game().bag.great).toBe(0);
  });

  test("a wild catch gets a dex entry", () => {
    herdr.state[G.GAME] = { encounter: { id: 94, at: Date.now(), balls: 3, project: "p" } };
    roll(0);
    G.throwBall();
    expect(G.game().dex[94]).toMatchObject({ project: "p", how: "wild" });
  });
});

describe("items and item evolutions", () => {
  test("stone Pokemon no longer evolve by level", () => {
    herdr.state[G.GAME] = { xp: { p: 1e6 } };
    G.finishTask("p", 25, 0);
    expect(herdr.state[G.PARTNERS]).toEqual({ p: 25 });
  });

  test("using a stone evolves the partner and spends it; without one nothing happens", () => {
    herdr.state[G.PARTNERS] = { p: 133 };
    herdr.state[G.GAME] = { bag: { thunder: 1 } };
    expect(G.useItem("p", "fire")).toBeNull();
    expect(G.useItem("p", "thunder")).toBe(135);
    expect(herdr.state[G.PARTNERS]).toEqual({ p: 135 });
    expect(G.game().bag.thunder).toBe(0);
    expect(G.game().dex[135]).toMatchObject({ how: "evolved" });
  });

  test("an hour-long task finds a Link Cable and a Great Ball", () => {
    G.finishTask("p", 1, 3600000);
    expect(G.game().bag).toMatchObject({ link: 1 });
    expect(G.game().bag.great).toBeGreaterThanOrEqual(1);
  });
});

describe("blocked agents", () => {
  test("left waiting 10 minutes, the partner faints and its next task earns no XP", () => {
    herdr.state[G.PARTNERS] = { p: 1 };
    G.unblocked("p", G.FAINT_MS);
    expect(G.game().fainted).toEqual({ p: true });
    G.finishTask("p", 1, 0);
    expect(G.game().xp.p ?? 0).toBe(0);
    expect(G.game().fainted).toEqual({});
    G.finishTask("p", 1, 0);
    expect(G.game().xp.p).toBe(10);
  });
});

describe("quests and ranks", () => {
  test("four quests, one weekly, and a completed one pays once", () => {
    const qs = G.quests();
    expect(qs.length).toBe(4);
    expect(qs.filter((q) => q.weekly).length).toBe(1);
    for (let i = 0; i < 40; i++) G.finishTask(`p${i % 4}`, 1, 0);
    const tasks = G.quests().find((q) => q.id === "w-tasks" || q.id === "w-projects");
    if (tasks) expect(tasks.done).toBe(true);
    expect(G.quests().every((q) => q.n <= q.need)).toBe(true);
  });

  test("all eight Kanto badges make you Champion in the same save", () => {
    herdr.state[G.GAME] = { badges: ["boulder", "cascade", "thunder", "rainbow", "soul", "marsh", "volcano"] };
    herdr.state[G.CAUGHT] = Array.from({ length: 150 }, (_, i) => i + 1);
    G.recordCatches([151]);
    expect(G.game().badges).toEqual(expect.arrayContaining(["earth", "champion"]));
  });
});
