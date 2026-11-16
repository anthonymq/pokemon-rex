// The trainer card: stats, recent catches (Professor Oak's steps while the tutorial lasts), badges,
// quests, the bag and the party. It also hosts the starter choice, the New Pokedex explainer, waiting
// gifts and the party editor (party.js).
import { remoteState } from "herdr";
import { game, partyOf, progress, liveStreak, nameOf, quests, options, BADGES, ITEMS, GIFTS, DAYCARE, TUTORIAL } from "../game.js";
import { caught, sprite, badgeArt } from "../core.js";
import { call, shareOnX } from "../client.js";
import { C, runApp, clip, len } from "../term.js";
import { plate, section } from "./chrome.js";
import { makeScreen, firstScreen, trainerProgress } from "./party.js";

// A quest's tier mark: none yet, Bronze, Silver, Gold.
const TIER_MARK = [null, "B", "S", "G"];

export function runTrainer() {
  let message = "", screen; // undefined until the first state arrives, then null (the card) or a screen
  // Opening the card is one of Professor Oak's steps.
  call("seen", "trainer").catch(() => {});
  const open = (name, note = "") => {
    screen = name ? makeScreen(name, { quit: () => app.quit(), done: open }) : null;
    if (note) message = note;
  };
  function render(s) {
    if (screen === undefined && remoteState()) open(firstScreen(game()));
    if (screen) return screen.render(s);
    const W = s.cols, H = s.rows;
    const g = game();
    const { tr, next } = trainerProgress(g);
    const have = caught();
    s.fill(0, 0, W, H, C.green, C.lcd);
    let y = plate(s, "TRAINER CARD", () => app.quit()) + 1;

    // Two rows of four stats, each on its own band.
    const seen = g.encounters.seen;
    const stats = [
      ["TRAINER LV", `${tr} · ${g.lifetime}/${next} XP`], ["CAUGHT", `${have.length}/151`], ["TASKS", `${g.tasks}+${g.subtasks} sub`], [`STREAK · ${g.streak.freezes ?? 0} FREEZE${g.streak.freezes === 1 ? "" : "S"}`, `${liveStreak(g)}d best ${g.streak.best}`],
      ["ENCOUNTERS", seen], ["WILD CATCHES", g.encounters.caught], ["FLED", g.encounters.fled], ["CATCH RATE", seen ? `${Math.round((g.encounters.caught / seen) * 100)}%` : "-"],
    ];
    const sw = Math.floor((W - 2) / 4);
    stats.forEach(([label, value], i) => {
      const x = 1 + (i % 4) * sw, sy = y + Math.floor(i / 4) * 3;
      s.fill(x, sy, sw - 1, 2, C.band, C.lcd);
      s.pixel(`sl:${i}`, x + 1, sy, clip(label, sw - 3), "soft");
      s.pixel(`sv:${i}`, x + 1, sy + 1, clip(String(value), sw - 3), "lcd");
    });
    y += 6;

    // Professor Oak's first steps while the tutorial lasts, then recent catches.
    if (Array.isArray(g.tutorial)) {
      section(s, "h:oak", 2, y, `PROFESSOR OAK · ${g.tutorial.length}/${TUTORIAL.length} · 5 Poke Balls and your Pokedex`, W - 4);
      const colW = Math.floor((W - 4) / 2);
      TUTORIAL.forEach((t, i) => {
        const x = 2 + Math.floor(i / 3) * colW, done = g.tutorial.includes(t.id);
        s.put(x, y + 1 + (i % 3), done ? "✓" : "·", { fg: done ? C.done : C.cyan, bold: true });
        s.put(x + 2, y + 1 + (i % 3), clip(t.goal, colW - 3), { fg: done ? C.done : C.lcd });
      });
    } else {
      section(s, "h:recent", 2, y, "RECENT CATCHES", W - 4);
      if (!g.recent.length) s.put(2, y + 2, "None yet. Wild Pokemon wait in the tall grass after finished tasks.".slice(0, W - 4), { fg: C.soft });
      g.recent.slice(0, Math.floor((W - 4) / 7)).forEach((r, i) => {
        const x = 2 + i * 7, shiny = g.shiny.includes(r.id);
        s.fill(x, y + 1, 6, 3, shiny ? C.gold : C.lcd, C.ink);
        s.image(`r:${i}:${r.id}`, sprite(r.id), x, y + 1, 6, 3);
      });
    }
    y += 5;

    // Badges: earned ones show their art, locked ones an empty socket.
    section(s, "h:badges", 2, y, "BADGES", W - 4);
    const bw = Math.max(6, Math.min(11, Math.floor((W - 3) / BADGES.length)));
    BADGES.forEach((b, i) => {
      const x = 2 + i * bw, got = g.badges.includes(b.id);
      if (x + bw - 1 > W) return;
      s.fill(x, y + 1, bw - 1, 2, got ? C.lcd : C.band, C.ink);
      if (got && !b.rank) s.image(`b:${b.id}`, badgeArt(b.id), x + Math.floor((bw - 5) / 2), y + 1, 4, 2, { crop: false });
      else s.put(x + Math.floor((bw - 2) / 2), y + 1, got ? "★" : "◇", { fg: got ? C.flame : C.mute, bold: true });
      s.pixel(`bn:${b.id}`, x, y + 3, clip(b.id === "elite" ? "ELITE 4" : b.name.toUpperCase(), bw - 1), got ? "lcd" : "mute");
    });
    y += 5;

    // Quests and the bag, side by side.
    const half = Math.floor((W - 3) / 2);
    // Each quest has Bronze, Silver and Gold, sized to the player's own pace: the mark is the tier
    // reached, the count heads for the next one. A daily quest with no tier yet can be rerolled once a day.
    section(s, "h:quests", 2, y, "QUESTS · B S G", half - 2);
    const qs = quests(g);
    qs.forEach((q, i) => {
      const mark = TIER_MARK[q.tier] ?? (q.weekly ? "W" : "·");
      s.put(2, y + 1 + i, mark, { fg: q.tier >= 3 ? C.gold : q.tier ? C.amber : C.cyan, bold: true });
      s.put(4, y + 1 + i, clip(`${q.rerollable ? `${i + 1} ` : ""}${q.goal}`, half - 12), { fg: q.done ? C.done : C.lcd });
      s.pixel(`q:${i}`, half - 5, y + 1 + i, q.done ? "GOLD" : `${q.n}/${q.need}`, q.done ? "lcd" : "soft");
      if (q.rerollable) s.hit(2, y + 1 + i, half - 2, 1, () => reroll(q));
    });
    section(s, "h:bag", half + 3, y, "BAG", W - half - 5);
    // PokeDollars and Rested XP sit with the items.
    const rows = [
      ...(g.money ? [["money", "PokeDollars", C.gold, `P${g.money}`]] : []),
      ...(g.rested ? [["rested", "Rested: XP x2", C.cyan, `${g.rested} XP`]] : []),
      ...Object.entries(g.bag).filter(([, n]) => n > 0).map(([item, n]) => [item, ITEMS[item]?.name ?? item, ITEMS[item]?.color ?? C.lcd, `x${n}`]),
    ];
    if (!rows.length) s.put(half + 3, y + 1, "empty", { fg: C.soft });
    rows.slice(0, 5).forEach(([key, name, color, n], i) => {
      s.put(half + 3, y + 1 + i, "●", { fg: color });
      s.put(half + 5, y + 1 + i, clip(name, W - half - 14), { fg: C.lcd });
      s.pixel(`bag:${key}`, W - 2 - len(n), y + 1 + i, n, "soft");
    });
    y += 6;

    // The party, two columns: the lead earns every task's XP, the Day Care a share of it.
    section(s, "h:party", 2, y, "PARTY", W - 4);
    const gift = GIFTS.find((x) => x.tr === g.gifts.pending[0]);
    const right = gift ? `A gift is waiting: ${gift.ids.map(nameOf).join(" or ")} · g` : `p change · Day Care ${Math.round(DAYCARE * 100)}%`;
    s.put(W - 2 - len(right), y, right, { fg: gift ? C.amber : C.soft, bold: !!gift });
    if (gift) s.hit(W - 2 - len(right), y, len(right), 1, () => open("gift"));
    y++;
    const party = partyOf(g);
    if (!party.length) {
      s.fill(2, y, W - 4, 2, C.amber, C.ink);
      s.put(3, y, clip("Choose your starter: Bulbasaur, Charmander or Squirtle · c", W - 6), { fg: C.ink, bold: true });
      s.put(3, y + 1, clip(g.bank ? `${g.bank} XP is waiting for it.` : "It leads your party and earns your agents' XP.", W - 6), { fg: C.band });
      s.hit(2, y, W - 4, 2, () => open("starter"));
    }
    const colW = Math.floor((W - 4) / 2);
    party.forEach((p, i) => {
      const x = 2 + (i % 2) * colW, ry = y + Math.floor(i / 2) * 2;
      if (ry + 2 > H - 1) return;
      const { into } = progress(p.xp);
      s.fill(x, ry, 4, 2, i === 0 ? C.cream : C.lcd, C.ink);
      s.image(`x:${i}:${p.id}`, sprite(p.id), x, ry, 4, 2);
      s.pixel(`pn:${i}`, x + 5, ry, clip(nameOf(p.id).toUpperCase(), 14), "lcd");
      s.put(x + 5, ry + 1, clip(i === 0 ? "lead" : "Day Care", 14), { fg: i === 0 ? C.amber : C.soft });
      const lv = `LV ${p.level}`;
      const barW = Math.max(4, colW - 22 - len(lv) - 2);
      s.bar(x + 20, ry, barW, into, C.cyan, C.band);
      s.pixel(`pl:${i}`, x + 21 + barW, ry, lv, "lcd");
      s.put(x + 20, ry + 1, `${p.xp} XP`, { fg: C.soft });
      s.hit(x, ry, colW - 1, 2, () => open("party"));
    });
    s.fill(0, H - 1, W, 1, C.red, C.cream);
    const o = options();
    const rerolls = qs.some((q) => q.rerollable) ? " · 1-3 reroll a quest" : "";
    s.put(2, H - 1, clip(message || `${party.length ? "p party" : "c starter"}${rerolls} · s share on X · q close · alert ${o.alert} · hard mode ${o.hardMode ? "on" : "off"} (pokedex set)`, W - 4), { fg: C.cream });
  }
  function reroll(q) {
    message = "Rerolling...";
    call("rerollQuest", q.id).then(
      () => { message = "A new quest for today"; },
      (error) => { message = `Reroll failed: ${error.message}`; },
    );
  }
  function share() {
    message = "Opening X...";
    shareOnX().then(
      (copied) => { message = copied ? "Card copied: paste it into the post (⌘V)" : "X opened; the card couldn't be copied"; },
      (error) => { message = `Share failed: ${error.message}`; },
    );
  }
  function onEvent(ev) {
    if (screen) return screen.onEvent(ev);
    message = "";
    const g = game();
    if (ev.key === "p") open(g.party.length ? "party" : "starter");
    if (ev.key === "c" && !g.party.length) open("starter");
    if (ev.key === "g" && g.gifts.pending.length) open("gift");
    const q = ["1", "2", "3"].includes(ev.key) ? quests(g)[Number(ev.key) - 1] : null;
    if (q?.rerollable) reroll(q);
    if (ev.key === "s" || ev.key === "ctrl+s") share();
    if (ev.key === "escape" || ev.key === "q" || ev.key === "enter") app.quit();
  }
  const app = runApp({ render, onEvent });
}
