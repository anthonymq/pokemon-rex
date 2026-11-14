// The trainer card: stats, recent catches, badges, quests, the bag and every partner by XP.
import { shared } from "herdr";
import { game, progress, trainerLevel, liveStreak, projectLabel, nameOf, quests, BADGES, ITEMS, PARTNERS } from "../game.js";
import { caught, sprite, badgeArt } from "../core.js";
import { C, runApp, clip, pad, len } from "../term.js";

export function runTrainer() {
  let scroll = 0;
  function render(s) {
    const W = s.cols, H = s.rows;
    const g = game();
    const have = caught();
    s.fill(0, 0, W, H, C.ink, C.lcd);
    s.fill(0, 0, W, 1, C.red, C.cream);
    s.put(2, 0, "TRAINER CARD", { fg: C.cream, bold: true });
    s.put(W - 8, 0, "esc ×", { fg: C.rose });
    s.hit(W - 9, 0, 9, 1, () => app.quit());

    // Two rows of four stats.
    const seen = g.encounters.seen;
    const stats = [
      ["TRAINER LV", trainerLevel(g)], ["CAUGHT", `${have.length}/151`], ["TASKS", `${g.tasks} + ${g.subtasks} sub`], ["STREAK", `${liveStreak(g)}d (best ${g.streak.best})`],
      ["ENCOUNTERS", seen], ["CAUGHT IN WILD", g.encounters.caught], ["FLED", g.encounters.fled], ["CATCH RATE", seen ? `${Math.round((g.encounters.caught / seen) * 100)}%` : "-"],
    ];
    const sw = Math.floor((W - 2) / 4);
    stats.forEach(([label, value], i) => {
      const x = 1 + (i % 4) * sw, y = 2 + Math.floor(i / 4) * 3;
      s.fill(x, y, sw - 1, 2, C.green, C.lcd);
      s.put(x + 1, y, clip(label, sw - 3), { fg: C.mute });
      s.put(x + 1, y + 1, clip(String(value), sw - 3), { fg: C.lcd, bold: true });
    });

    // Recent catches.
    let y = 8;
    s.put(2, y, "RECENT CATCHES", { fg: C.mute });
    if (!g.recent.length) s.put(18, y, "none yet", { fg: C.band });
    g.recent.slice(0, Math.floor((W - 4) / 7)).forEach((r, i) => {
      const x = 2 + i * 7, shiny = g.shiny.includes(r.id);
      s.fill(x, y + 1, 6, 3, shiny ? C.gold : C.lcd, C.ink);
      s.image(`r:${i}:${r.id}`, sprite(r.id), x, y + 1, 6, 3);
    });
    y += 5;

    // Badges: earned ones show their art, locked ones an empty socket.
    s.put(2, y, "BADGES", { fg: C.mute });
    const bw = Math.max(6, Math.min(11, Math.floor((W - 3) / BADGES.length)));
    BADGES.forEach((b, i) => {
      const x = 2 + i * bw, got = g.badges.includes(b.id);
      if (x + bw - 1 > W) return;
      s.fill(x, y + 1, bw - 1, 2, C.green, C.lcd);
      if (got && !b.rank) s.image(`b:${b.id}`, badgeArt(b.id), x + Math.floor((bw - 5) / 2), y + 1, 4, 2, { crop: false });
      else s.put(x + Math.floor((bw - 2) / 2), y + 1, got ? "★" : "◇", { fg: got ? b.color : C.band, bold: true });
      s.put(x, y + 3, clip(b.name, bw - 1), { fg: got ? C.lcd : C.band });
    });
    y += 5;

    // Quests and the bag, side by side.
    const half = Math.floor((W - 3) / 2);
    s.put(2, y, "QUESTS", { fg: C.mute });
    quests(g).forEach((q, i) => {
      const label = `${q.done ? "✓" : q.weekly ? "W" : "·"} ${q.goal}`;
      s.put(2, y + 1 + i, pad(clip(label, half - 7), half - 7), { fg: q.done ? C.done : C.lcd });
      s.put(half - 4, y + 1 + i, `${q.n}/${q.need}`, { fg: q.done ? C.done : C.mute });
    });
    s.put(half + 3, y, "BAG", { fg: C.mute });
    const bag = Object.entries(g.bag).filter(([, n]) => n > 0);
    if (!bag.length) s.put(half + 3, y + 1, "empty", { fg: C.band });
    bag.slice(0, 4).forEach(([item, n], i) => {
      s.put(half + 3, y + 1 + i, "●", { fg: ITEMS[item]?.color ?? C.lcd });
      s.put(half + 5, y + 1 + i, clip(`${ITEMS[item]?.name ?? item} ×${n}`, W - half - 7), { fg: C.lcd });
    });
    y += 6;

    // Every partner, by XP.
    s.put(2, y, "PARTNERS", { fg: C.mute });
    y++;
    const partners = shared(PARTNERS) ?? {};
    const rows = Object.entries(g.xp).sort((a, b) => b[1] - a[1]);
    const room = Math.max(0, Math.floor((H - y) / 2));
    scroll = Math.max(0, Math.min(scroll, Math.max(0, rows.length - room)));
    if (!rows.length) s.put(2, y, "No partner has earned XP yet. Finish an agent task.", { fg: C.band });
    rows.slice(scroll, scroll + room).forEach(([project, xp], i) => {
      const ry = y + i * 2, id = partners[project];
      const { level, into } = progress(xp);
      if (id) s.image(`x:${project}`, sprite(id), 2, ry, 4, 2);
      s.put(7, ry, clip(projectLabel(project), 22), { fg: C.lcd, bold: true });
      s.put(7, ry + 1, clip(id ? nameOf(id) : "?", 22), { fg: C.mute });
      const lv = `Lv ${level}`;
      const bw = Math.max(4, W - 32 - len(lv) - 3);
      s.bar(31, ry, bw, into, C.cyan, C.band);
      s.put(31 + bw + 1, ry, lv, { fg: C.lcd, bold: true });
      s.put(31, ry + 1, `${xp} XP${g.fainted[project] ? " · fainted" : ""}`, { fg: C.mute });
    });
  }
  function onEvent(ev) {
    if (ev.wheel) scroll = Math.max(0, scroll + ev.wheel);
    if (ev.key === "down" || ev.key === "j") scroll++;
    if (ev.key === "up" || ev.key === "k") scroll = Math.max(0, scroll - 1);
    if (ev.key === "escape" || ev.key === "q" || ev.key === "enter") app.quit();
  }
  const app = runApp({ render, onEvent });
}
