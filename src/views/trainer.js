// The trainer card: stats, recent catches, badges, quests, the bag and every partner by XP.
import { shared } from "herdr";
import { game, progress, trainerLevel, liveStreak, projectLabel, nameOf, quests, options, BADGES, ITEMS, PARTNERS } from "../game.js";
import { caught, sprite, badgeArt } from "../core.js";
import { shareOnX } from "../client.js";
import { C, runApp, clip, len } from "../term.js";
import { plate, section } from "./chrome.js";

export function runTrainer() {
  let scroll = 0, message = "";
  function render(s) {
    const W = s.cols, H = s.rows;
    const g = game();
    const have = caught();
    s.fill(0, 0, W, H, C.green, C.lcd);
    let y = plate(s, "TRAINER CARD", () => app.quit()) + 1;

    // Two rows of four stats, each on its own band.
    const seen = g.encounters.seen;
    const stats = [
      ["TRAINER LV", trainerLevel(g)], ["CAUGHT", `${have.length}/151`], ["TASKS", `${g.tasks}+${g.subtasks} sub`], ["STREAK", `${liveStreak(g)}d best ${g.streak.best}`],
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

    // Every partner, by XP.
    section(s, "h:partners", 2, y, "PARTNERS", W - 4);
    y++;
    const partners = shared(PARTNERS) ?? {};
    const rows = Object.entries(g.xp).sort((a, b) => b[1] - a[1]);
    const room = Math.max(0, Math.floor((H - 1 - y) / 2));
    scroll = Math.max(0, Math.min(scroll, Math.max(0, rows.length - room)));
    if (!rows.length) s.put(2, y, clip("No partner has earned XP yet. Finish an agent task.", W - 4), { fg: C.soft });
    rows.slice(scroll, scroll + room).forEach(([project, xp], i) => {
      const ry = y + i * 2, id = partners[project];
      const { level, into } = progress(xp);
      if (id) {
        s.fill(2, ry, 4, 2, C.lcd, C.ink);
        s.image(`x:${project}`, sprite(id), 2, ry, 4, 2);
      }
      s.pixel(`pn:${project}`, 7, ry, clip(projectLabel(project), 22), "lcd");
      s.put(7, ry + 1, clip(id ? nameOf(id) : "?", 22), { fg: C.soft });
      const lv = `LV ${level}`;
      const barW = Math.max(4, W - 32 - len(lv) - 3);
      s.bar(31, ry, barW, into, C.cyan, C.band);
      s.pixel(`pl:${project}`, 31 + barW + 1, ry, lv, "lcd");
      s.put(31, ry + 1, `${xp} XP${g.fainted[project] ? " · fainted" : ""}`, { fg: C.soft });
    });
    s.fill(0, H - 1, W, 1, C.red, C.cream);
    const o = options();
    s.put(2, H - 1, clip(message || `s share on X · j/k scroll · q close · alert ${o.alert} · hard mode ${o.hardMode ? "on" : "off"} (pokedex set)`, W - 4), { fg: C.cream });
  }
  function share() {
    message = "Opening X...";
    shareOnX().then(
      (copied) => { message = copied ? "Card copied: paste it into the post (⌘V)" : "X opened; the card couldn't be copied"; },
      (error) => { message = `Share failed: ${error.message}`; },
    );
  }
  function onEvent(ev) {
    if (ev.wheel) scroll = Math.max(0, scroll + ev.wheel);
    if (ev.key === "down" || ev.key === "j") scroll++;
    if (ev.key === "up" || ev.key === "k") scroll = Math.max(0, scroll - 1);
    if (ev.key === "s" || ev.key === "ctrl+s") share();
    if (ev.key === "escape" || ev.key === "q" || ev.key === "enter") app.quit();
  }
  const app = runApp({ render, onEvent });
}
