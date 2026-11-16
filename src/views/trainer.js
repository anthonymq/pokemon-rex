// The trainer card: stats, recent catches, badges, quests, the bag and the party. It also hosts
// the starter choice, the New Pokedex explainer, waiting gifts and the party editor (party.js).
import { remoteState } from "herdr";
import { game, partyOf, progress, liveStreak, nameOf, quests, options, BADGES, ITEMS, GIFTS, DAYCARE } from "../game.js";
import { caught, sprite, badgeArt } from "../core.js";
import { shareOnX } from "../client.js";
import { C, runApp, clip, len } from "../term.js";
import { plate, section } from "./chrome.js";
import { makeScreen, firstScreen, trainerProgress } from "./party.js";

export function runTrainer() {
  let message = "", screen; // undefined until the first state arrives, then null (the card) or a screen
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
      ["TRAINER LV", `${tr} · ${g.lifetime}/${next} XP`], ["CAUGHT", `${have.length}/151`], ["TASKS", `${g.tasks}+${g.subtasks} sub`], ["STREAK", `${liveStreak(g)}d best ${g.streak.best}`],
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

    // Recent catches.
    section(s, "h:recent", 2, y, "RECENT CATCHES", W - 4);
    if (!g.recent.length) s.put(2, y + 2, "None yet. Wild Pokemon wait in the tall grass after finished tasks.".slice(0, W - 4), { fg: C.soft });
    g.recent.slice(0, Math.floor((W - 4) / 7)).forEach((r, i) => {
      const x = 2 + i * 7, shiny = g.shiny.includes(r.id);
      s.fill(x, y + 1, 6, 3, shiny ? C.gold : C.lcd, C.ink);
      s.image(`r:${i}:${r.id}`, sprite(r.id), x, y + 1, 6, 3);
    });
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
    section(s, "h:quests", 2, y, "QUESTS", half - 2);
    quests(g).forEach((q, i) => {
      s.put(2, y + 1 + i, q.done ? "✓" : q.weekly ? "W" : "·", { fg: q.done ? C.done : C.cyan, bold: true });
      s.put(4, y + 1 + i, clip(q.goal, half - 12), { fg: q.done ? C.done : C.lcd });
      s.pixel(`q:${i}`, half - 5, y + 1 + i, `${q.n}/${q.need}`, q.done ? "lcd" : "soft");
    });
    section(s, "h:bag", half + 3, y, "BAG", W - half - 5);
    const bag = Object.entries(g.bag).filter(([, n]) => n > 0);
    if (!bag.length) s.put(half + 3, y + 1, "empty", { fg: C.soft });
    bag.slice(0, 4).forEach(([item, n], i) => {
      s.put(half + 3, y + 1 + i, "●", { fg: ITEMS[item]?.color ?? C.lcd });
      s.put(half + 5, y + 1 + i, clip(ITEMS[item]?.name ?? item, W - half - 12), { fg: C.lcd });
      s.pixel(`bag:${item}`, W - 2 - len(`x${n}`), y + 1 + i, `x${n}`, "soft");
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
    s.put(2, H - 1, clip(message || `${party.length ? "p party" : "c starter"} · s share on X · q close · alert ${o.alert} · hard mode ${o.hardMode ? "on" : "off"} (pokedex set)`, W - 4), { fg: C.cream });
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
    if (ev.key === "s" || ev.key === "ctrl+s") share();
    if (ev.key === "escape" || ev.key === "q" || ev.key === "enter") app.quit();
  }
  const app = runApp({ render, onEvent });
}
