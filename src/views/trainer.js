// The trainer card: who you are (lead, trainer level, totals), today's quests, the party, the badges,
// the bag and recent catches (Professor Oak's steps while the tutorial lasts). It also hosts the
// starter choice, the New Pokedex explainer, waiting gifts and the party editor (party.js).
// The look matches pokemon-herdr's card: a red frame around one dark screen, sections on tonal bands
// instead of light slabs, amber for what's best (the lead, Gold quests, shinies).
import { remoteState } from "herdr";
import { game, partyOf, progress, nameOf, options, BADGES, ITEMS, GIFTS, DAYCARE, TUTORIAL, TIERS, STREAK_NEED } from "../game.js";
import { caught, sprite, badgeArt, questsNow, streakNow, weekNow } from "../core.js";
import { call, shareOnX } from "../client.js";
import { C, runApp, clip, len } from "../term.js";
import { plate } from "./chrome.js";
import { makeScreen, firstScreen, trainerProgress } from "./party.js";

// A quest tier's colour: Bronze, Silver, Gold.
const TIER_COLOR = ["#c98a4b", C.soft, C.gold];

export function runTrainer() {
  let message = "", screen; // undefined until the first state arrives, then null (the card) or a screen
  // Opening the card is one of Professor Oak's steps.
  call("seen", "trainer").catch(() => {});
  const open = (name, note = "") => {
    screen = name ? makeScreen(name, { quit: () => app.quit(), done: open }) : null;
    if (note) message = note;
  };
  // A section title in the pixel font.
  const heading = (s, slot, x, y, label) => s.pixel(slot, x, y, label, "soft");

  function render(s) {
    if (screen === undefined && remoteState()) open(firstScreen(game()));
    if (screen) return screen.render(s);
    const W = s.cols, H = s.rows, X = 3, IW = W - 6;
    const g = game();
    const { tr, next, into } = trainerProgress(g);
    const have = caught();
    const party = partyOf(g);
    // The red frame: the plate on top, one column each side, the footer below.
    s.fill(0, 0, W, H, C.red, C.cream);
    let y = plate(s, "TRAINER CARD", () => app.quit());
    s.fill(1, y, W - 2, H - y - 1, C.green, C.lcd);
    y++;
    const room = (rows) => y + rows < H - 1;

    // Who you are: the lead, the trainer level and its XP, and the totals.
    s.fill(X - 1, y, IW + 2, 4, C.band, C.cream);
    if (party[0]) s.image("lead", sprite(party[0].id), X, y, 8, 4);
    const lx = X + 10;
    s.pixel("tr", lx, y, `TRAINER LV ${tr}`, "cream");
    const barW = Math.min(26, Math.max(10, Math.floor(IW / 3) - 2));
    s.bar(lx, y + 1, barW, into, C.lcd, C.green);
    s.put(lx, y + 2, clip(`${g.lifetime} / ${next} XP`, barW), { fg: C.soft });
    const freezes = g.streak.freezes ?? 0, streak = streakNow(g);
    const frozen = freezes ? `${freezes} freeze${freezes > 1 ? "s" : ""}` : "";
    const facts = [
      ["CAUGHT", `${have.length}/151`, g.shiny.length ? `${g.shiny.length} shiny` : ""],
      ["TASKS", String(g.tasks), g.subtasks ? `+${g.subtasks} sub` : ""],
      // Until a streak starts, the week's active days toward one.
      streak ? ["STREAK", `${streak} day${streak > 1 ? "s" : ""}`, `best ${g.streak.best}`, frozen]
        : ["STREAK", `${weekNow(g)}/${STREAK_NEED}`, `days this week · best ${g.streak.best}`, frozen],
      ["WILD", `${g.encounters.caught}/${g.encounters.seen}`, g.encounters.fled ? `${g.encounters.fled} fled` : ""],
    ];
    // A fact's `extra` (the streak's freezes) sits on the value row, after the value.
    const fx = lx + barW + 3, span = X + IW - fx, weights = [1, 0.8, 1.4, 1];
    const widths = weights.map((w) => Math.max(8, Math.floor((span * w) / weights.reduce((a, b) => a + b, 0))));
    facts.forEach(([label, value, note, extra], i) => {
      const x = fx + widths.slice(0, i).reduce((a, b) => a + b, 0), fw = widths[i];
      if (x + 6 > X + IW) return;
      s.put(x, y, clip(label, fw - 1), { fg: C.soft });
      s.pixel(`f:${i}`, x, y + 1, clip(value, fw - 1), "cream");
      if (extra && fw - len(value) - 3 > 4) s.put(x + len(value) + 1, y + 1, clip(extra, fw - len(value) - 2), { fg: C.mute });
      if (note) s.put(x, y + 2, clip(note, fw - 1), { fg: C.mute });
    });
    y += 5;

    // Today's quests and this week's: the tier reached in its colour, the goal for the next tier,
    // what it pays and the count. A daily quest with no tier yet can be rerolled (1-3, or a click).
    const qs = questsNow(g);
    if (room(qs.length + 1)) {
      heading(s, "h:quests", X, y, "QUESTS");
      qs.forEach((q, i) => {
        const qy = y + 1 + i;
        s.fill(X - 1, qy, IW + 2, 1, C.band, C.cream);
        s.put(X, qy, q.weekly ? "WEEK" : "DAY", { fg: C.mute });
        s.put(X + 5, qy, q.tier ? TIERS[q.tier - 1] : "—", { fg: q.tier ? TIER_COLOR[q.tier - 1] : C.mute, bold: !!q.tier });
        const count = `${q.n}/${q.need}`;
        const tail = q.done ? "" : q.reward ?? "";
        const gw = IW - 13 - len(count) - (tail ? len(tail) + 2 : 0);
        s.put(X + 12, qy, clip(`${q.rerollable ? `${i + 1} ` : ""}${q.goal}`, gw), { fg: q.done ? C.soft : C.cream });
        if (tail && gw > 10) s.put(X + IW - len(count) - len(tail) - 2, qy, tail, { fg: C.mute });
        s.put(X + IW - len(count), qy, count, { fg: q.done ? C.gold : C.cream, bold: true });
        if (q.rerollable) s.hit(X - 1, qy, IW + 2, 1, () => reroll(q));
      });
      y += qs.length + 2;
    }

    // The party, two by two: the lead on a raised band, the Day Care with a share of the XP.
    const gift = GIFTS.find((x) => x.tr === g.gifts.pending[0]);
    heading(s, "h:party", X, y, `PARTY ${party.length}/6`);
    const right = gift ? `A gift is waiting: ${gift.ids.map(nameOf).join(" or ")} · g` : `p change · Day Care ${Math.round(DAYCARE * 100)}%`;
    s.put(X + IW - len(right), y, right, { fg: gift ? C.amber : C.mute, bold: !!gift });
    if (gift) s.hit(X + IW - len(right), y, len(right), 1, () => open("gift"));
    y++;
    if (!party.length) {
      s.fill(X - 1, y, IW + 2, 2, C.lcd, C.ink);
      s.put(X, y, clip("Choose your starter: Bulbasaur, Charmander or Squirtle · c", IW), { fg: C.ink, bold: true });
      s.put(X, y + 1, clip(g.bank ? `${g.bank} XP is waiting for it.` : "It leads your party and earns your agents' XP.", IW), { fg: C.green });
      s.hit(X - 1, y, IW + 2, 2, () => open("starter"));
      y += 3;
    }
    const colW = Math.floor((IW + 1) / 2);
    party.forEach((p, i) => {
      const x = X - 1 + (i % 2) * colW, ry = y + Math.floor(i / 2) * 2;
      if (!room(2) || ry + 2 > H - 1) return;
      const { into: lvInto } = progress(p.xp);
      s.fill(x, ry, colW - 1, 2, i === 0 ? C.band : C.green, C.cream);
      s.image(`x:${i}:${p.id}`, sprite(p.id), x + 1, ry, 4, 2);
      s.pixel(`pn:${i}`, x + 6, ry, clip(nameOf(p.id).toUpperCase(), 13), "cream");
      if (g.shiny.includes(p.id)) s.put(x + 19, ry, "✦", { fg: C.gold });
      const lv = `LV ${p.level}`;
      s.pixel(`pl:${i}`, x + colW - 2 - len(lv), ry, lv, "cream");
      const bw = Math.max(4, colW - 30);
      s.put(x + 6, ry + 1, i === 0 ? "LEAD" : `DAY CARE ${Math.round(DAYCARE * 100)}%`, { fg: i === 0 ? C.amber : C.mute, bold: i === 0 });
      s.bar(x + 21, ry + 1, bw, lvInto, C.lcd, C.band);
      s.put(x + colW - 2 - len(`${p.xp} XP`), ry + 1, `${p.xp} XP`, { fg: C.mute });
      s.hit(x, ry, colW - 1, 2, () => open("party"));
    });
    if (party.length) y += Math.ceil(party.length / 2) * 2 + 1;

    // Badges: earned ones in colour on a band, the rest an empty socket.
    if (room(4)) {
      heading(s, "h:badges", X, y, "BADGES");
      const bw = Math.max(6, Math.min(11, Math.floor((IW + 1) / BADGES.length)));
      BADGES.forEach((b, i) => {
        const x = X + i * bw, got = g.badges.includes(b.id);
        if (x + bw - 1 > X + IW) return;
        s.fill(x, y + 1, bw - 1, 2, C.band, C.ink);
        if (got && !b.rank) s.image(`b:${b.id}`, badgeArt(b.id), x + Math.floor((bw - 5) / 2), y + 1, 4, 2, { crop: false });
        else s.put(x + Math.floor((bw - 2) / 2), y + 1, got ? "★" : "◇", { fg: got ? C.gold : C.mute, bold: got });
        s.pixel(`bn:${b.id}`, x, y + 3, clip(b.id === "elite" ? "ELITE 4" : b.name.toUpperCase(), bw - 1), got ? "cream" : "mute");
      });
      y += 5;
    }

    // The bag on one line: PokeDollars and Rested XP first, then balls, stones and cables.
    if (room(2)) {
      heading(s, "h:bag", X, y, "BAG");
      const items = [
        ...(g.money ? [[C.gold, `${g.money} PokeDollars`]] : []),
        ...(g.rested ? [[C.cyan, `Rested: next ${g.rested} XP x2`]] : []),
        ...Object.entries(g.bag).filter(([, n]) => n > 0).map(([item, n]) => [ITEMS[item]?.color ?? C.lcd, `${ITEMS[item]?.name ?? item} ×${n}`]),
      ];
      s.fill(X - 1, y + 1, IW + 2, 1, C.band, C.cream);
      let bx = X;
      if (!items.length) s.put(bx, y + 1, "Empty. Long tasks, active days and quests fill it.", { fg: C.mute });
      for (const [color, label] of items) {
        if (bx + len(label) + 2 > X + IW) break;
        s.put(bx, y + 1, "●", { fg: color });
        s.put(bx + 2, y + 1, label, { fg: C.cream });
        bx += len(label) + 5;
      }
      y += 3;
    }

    // Professor Oak's first steps while the tutorial lasts, then recent catches.
    if (Array.isArray(g.tutorial) && room(4)) {
      heading(s, "h:oak", X, y, `PROFESSOR OAK ${g.tutorial.length}/${TUTORIAL.length}`);
      s.put(X + 22, y, "5 Poke Balls and your Pokedex", { fg: C.mute });
      const cw = Math.floor(IW / 2);
      TUTORIAL.forEach((t, i) => {
        const x = X + Math.floor(i / 3) * cw, done = g.tutorial.includes(t.id);
        s.put(x, y + 1 + (i % 3), done ? "✓" : "·", { fg: done ? C.done : C.cyan, bold: true });
        s.put(x + 2, y + 1 + (i % 3), clip(t.goal, cw - 3), { fg: done ? C.mute : C.cream });
      });
    } else if (room(4)) {
      heading(s, "h:recent", X, y, "RECENT CATCHES");
      if (!g.recent.length) s.put(X, y + 2, clip("None yet. Wild Pokemon wait in the tall grass after finished tasks.", IW), { fg: C.mute });
      g.recent.slice(0, Math.floor(IW / 7)).forEach((r, i) => {
        const x = X + i * 7;
        s.image(`r:${i}:${r.id}`, sprite(r.id), x, y + 1, 6, 3);
        if (g.shiny.includes(r.id)) s.put(x + 2, y + 4, "✦✦", { fg: C.gold });
      });
    }

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
    const q = ["1", "2", "3"].includes(ev.key) ? questsNow(g)[Number(ev.key) - 1] : null;
    if (q?.rerollable) reroll(q);
    if (ev.key === "s" || ev.key === "ctrl+s") share();
    if (ev.key === "escape" || ev.key === "q" || ev.key === "enter") app.quit();
  }
  const app = runApp({ render, onEvent });
}
