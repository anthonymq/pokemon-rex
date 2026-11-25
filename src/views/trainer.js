// The trainer card: who you are (lead, trainer level, totals), today's quests, the open gym (or the
// Elite Four, or the Hall of Fame), the party, the badges and side medals, the bag and recent catches (Professor Oak's steps while the tutorial lasts). It also hosts the
// starter choice, the New Pokedex explainer, waiting gifts and the party editor (party.js).
// The look matches pokemon-herdr's card: a red frame around one dark screen, sections on tonal bands
// instead of light slabs, amber for what's best (the lead, Gold quests, shinies).
import { remoteState } from "herdr";
import { game, partyOf, progress, nameOf, options, BADGES, MEDALS, GYMS, ITEMS, GIFTS, DAYCARE, TUTORIAL, TIERS, STREAK_NEED } from "../game.js";
import { caught, sprite, badgeArt, questsNow, streakNow, weekNow, gymNow } from "../core.js";
import { call, shareOnX, shareMessage } from "../client.js";
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

    // Two columns under the identity rows, like Herdr's card: what you're working toward (quests, the
    // gym, the bag, Professor Oak) on the left, what you have (party, badges, medals, recent catches)
    // on the right. A narrow pane stacks them.
    const two = IW >= 100;
    const LW = two ? Math.floor((IW - 3) / 2) : IW;
    const L = { x: X, w: LW }, Rc = two ? { x: X + LW + 3, w: IW - LW - 3 } : L;
    const fits = (cy, rows) => cy + rows < H - 1;
    const qs = questsNow(g);
    const ly = drawLeft(L, y);
    drawRight(Rc, two ? y : ly);

    // Items as dots and labels, wrapping onto up to `max` rows from `cy`; returns the rows used.
    function dots(c, cy, items, max) {
      let row = 0, bx = c.x;
      s.fill(c.x - 1, cy, c.w + 2, 1, C.band, C.cream);
      for (const [color, label] of items) {
        if (bx + len(label) + 2 > c.x + c.w && bx > c.x) {
          if (row + 1 >= max || !fits(cy + row + 1, 1)) break;
          row++;
          bx = c.x;
          s.fill(c.x - 1, cy + row, c.w + 2, 1, C.band, C.cream);
        }
        s.put(bx, cy + row, "●", { fg: color });
        s.put(bx + 2, cy + row, clip(label, c.w - 2), { fg: C.cream });
        bx += len(label) + 4;
      }
      return row + 1;
    }

    function drawLeft(c, cy) {
      // Today's quests and this week's: the tier reached in its colour, the goal for the next tier,
      // what it pays when there's room, and the count. A daily quest with no tier yet can be rerolled
      // (1-3, or a click).
      if (fits(cy, qs.length + 1)) {
        heading(s, "h:quests", c.x, cy, "QUESTS");
        qs.forEach((q, i) => {
          const qy = cy + 1 + i;
          s.fill(c.x - 1, qy, c.w + 2, 1, C.band, C.cream);
          s.put(c.x, qy, q.weekly ? "WEEK" : "DAY", { fg: C.mute });
          s.put(c.x + 5, qy, q.tier ? TIERS[q.tier - 1] : "—", { fg: q.tier ? TIER_COLOR[q.tier - 1] : C.mute, bold: !!q.tier });
          const count = `${q.n}/${q.need}`;
          let tail = q.done ? "" : q.reward ?? "";
          if (c.w - 13 - len(count) - len(tail) - 2 < 24) tail = "";
          const gw = c.w - 13 - len(count) - (tail ? len(tail) + 2 : 0);
          s.put(c.x + 12, qy, clip(`${q.rerollable ? `${i + 1} ` : ""}${q.goal}`, gw), { fg: q.done ? C.soft : C.cream });
          if (tail) s.put(c.x + c.w - len(count) - len(tail) - 2, qy, tail, { fg: C.mute });
          s.put(c.x + c.w - len(count), qy, count, { fg: q.done ? C.gold : C.cream, bold: true });
          if (q.rerollable) s.hit(c.x - 1, qy, c.w + 2, 1, () => reroll(q));
        });
        cy += qs.length + 2;
      }

      // The open gym (any one option beats it), the Elite Four member of the week, or the Hall of Fame.
      const gv = gymNow(g), ch = gv.gym ?? gv.league;
      const gymRows = ch ? ch.options.length + 1 : gv.fame ? 4 : 0;
      if (gymRows && fits(cy, gymRows)) {
        const title = gv.gym ? `GYM ${ch.index + 1}/${GYMS.length} · ${ch.leader.toUpperCase()}` : gv.league ? `ELITE 4 ${ch.index + 1}/4 · ${ch.leader.toUpperCase()}` : "HALL OF FAME";
        heading(s, "h:gym", c.x, cy, title);
        const note = gv.gym ? `${ch.name} Badge${ch.head ? " · head start" : ""}` : gv.league ? (ch.waiting ? "from next Monday" : "this week only") : `Champion since ${new Date(gv.fame.at).toLocaleDateString()}`;
        // The note gets its own row: the pixel title can take most of a column.
        s.fill(c.x - 1, cy + 1, c.w + 2, 1, C.green, C.cream);
        s.put(c.x, cy + 1, clip(note, c.w), { fg: C.mute });
        if (ch) ch.options.forEach((o, i) => {
          const oy = cy + 2 + i, count = o.parts.map((p) => `${p.n}/${p.need}`).join(" + "), bw = Math.min(10, Math.max(4, c.w - 40));
          s.fill(c.x - 1, oy, c.w + 2, 1, C.band, C.cream);
          if (i) s.put(c.x, oy, "OR", { fg: C.mute });
          s.put(c.x + 3, oy, clip(o.goal.charAt(0).toUpperCase() + o.goal.slice(1), c.w - 5 - len(count) - bw), { fg: o.done ? C.soft : C.cream });
          s.bar(c.x + c.w - len(count) - bw - 1, oy, bw, Math.min(...o.parts.map((p) => p.n / p.need)), C.lcd, C.green);
          s.put(c.x + c.w - len(count), oy, count, { fg: o.done ? C.gold : C.cream, bold: true });
        });
        else gv.fame.party.forEach((m, i) => {
          if (i * 7 + 6 > c.w) return;
          s.image(`fame:${i}:${m.id}`, sprite(m.id), c.x + i * 7, cy + 2, 6, 3);
        });
        cy += gymRows + 2;
      }

      // The bag: PokeDollars and Rested XP first, then balls, stones and cables, wrapping.
      if (fits(cy, 2)) {
        heading(s, "h:bag", c.x, cy, "BAG");
        const items = [
          ...(g.money ? [[C.gold, `${g.money} PokeDollars`]] : []),
          ...(g.rested ? [[C.cyan, `Rested: next ${g.rested} XP x2`]] : []),
          ...Object.entries(g.bag).filter(([, n]) => n > 0).map(([item, n]) => [ITEMS[item]?.color ?? C.lcd, `${ITEMS[item]?.name ?? item} ×${n}`]),
        ];
        if (!items.length) {
          s.fill(c.x - 1, cy + 1, c.w + 2, 1, C.band, C.cream);
          s.put(c.x, cy + 1, clip("Empty. Long tasks, active days and quests fill it.", c.w), { fg: C.mute });
          cy += 3;
        } else cy += dots(c, cy + 1, items, 4) + 2;
      }

      // Professor Oak's first steps while the tutorial lasts.
      if (Array.isArray(g.tutorial) && fits(cy, 4)) {
        heading(s, "h:oak", c.x, cy, `PROFESSOR OAK ${g.tutorial.length}/${TUTORIAL.length}`);
        const cw = Math.floor(c.w / 2);
        TUTORIAL.forEach((t, i) => {
          const x = c.x + Math.floor(i / 3) * cw, done = g.tutorial.includes(t.id);
          s.put(x, cy + 1 + (i % 3), done ? "✓" : "·", { fg: done ? C.done : C.cyan, bold: true });
          s.put(x + 2, cy + 1 + (i % 3), clip(t.goal, cw - 3), { fg: done ? C.mute : C.cream });
        });
        cy += 5;
      }
      return cy;
    }

    function drawRight(c, cy) {
      // The party: the lead on a raised band, the Day Care with a share of the XP. Two by two when the
      // column is wide enough, else one per row.
      const gift = GIFTS.find((x) => x.tr === g.gifts.pending[0]);
      heading(s, "h:party", c.x, cy, `PARTY ${party.length}/6`);
      const note = gift ? `Gift: ${gift.ids.map(nameOf).join(" or ")} · g` : `p change · Day Care ${Math.round(DAYCARE * 100)}%`;
      s.put(c.x + c.w - len(note), cy, note, { fg: gift ? C.amber : C.mute, bold: !!gift });
      if (gift) s.hit(c.x + c.w - len(note), cy, len(note), 1, () => open("gift"));
      cy++;
      if (!party.length) {
        s.fill(c.x - 1, cy, c.w + 2, 2, C.lcd, C.ink);
        s.put(c.x, cy, clip("Choose your starter: Bulbasaur, Charmander or Squirtle · c", c.w), { fg: C.ink, bold: true });
        s.put(c.x, cy + 1, clip(g.bank ? `${g.bank} XP is waiting for it.` : "It leads your party and earns your agents' XP.", c.w), { fg: C.green });
        s.hit(c.x - 1, cy, c.w + 2, 2, () => open("starter"));
        cy += 3;
      }
      const per = c.w >= 70 ? 2 : 1;
      const colW = Math.floor((c.w + 1) / per);
      party.forEach((p, i) => {
        const x = c.x - 1 + (i % per) * colW, ry = cy + Math.floor(i / per) * 2;
        if (!fits(ry, 2)) return;
        const { into: lvInto } = progress(p.xp);
        s.fill(x, ry, colW - 1, 2, i === 0 ? C.band : C.green, C.cream);
        s.image(`x:${i}:${p.id}`, sprite(p.id), x + 1, ry, 4, 2);
        s.pixel(`pn:${i}`, x + 6, ry, clip(nameOf(p.id).toUpperCase(), 13), "cream");
        if (g.shiny.includes(p.id)) s.put(x + 19, ry, "✦", { fg: C.gold });
        const lv = `LV ${p.level}`;
        s.pixel(`pl:${i}`, x + colW - 2 - len(lv), ry, lv, "cream");
        const xp = `${p.xp} XP`, bw = Math.max(4, colW - 24 - len(xp));
        s.put(x + 6, ry + 1, i === 0 ? "LEAD" : `DAY CARE ${Math.round(DAYCARE * 100)}%`, { fg: i === 0 ? C.amber : C.mute, bold: i === 0 });
        s.bar(x + 20, ry + 1, bw, lvInto, C.lcd, C.band);
        s.put(x + colW - 2 - len(xp), ry + 1, xp, { fg: C.mute });
        s.hit(x, ry, colW - 1, 2, () => open("party"));
      });
      if (party.length) cy += Math.ceil(party.length / per) * 2 + 1;

      // Badges: earned ones in colour on a band, the rest an empty socket. Then side and Classic medals.
      if (fits(cy, 4)) {
        heading(s, "h:badges", c.x, cy, "BADGES");
        const bw = Math.max(5, Math.min(11, Math.floor((c.w + 1) / BADGES.length)));
        BADGES.forEach((b, i) => {
          const x = c.x + i * bw, got = g.badges.includes(b.id);
          if (x + bw - 1 > c.x + c.w) return;
          s.fill(x, cy + 1, bw - 1, 2, C.band, C.ink);
          if (got && !b.rank) s.image(`b:${b.id}`, badgeArt(b.id), x + Math.floor((bw - 5) / 2), cy + 1, 4, 2, { crop: false });
          else s.put(x + Math.floor((bw - 2) / 2), cy + 1, got ? "★" : "◇", { fg: got ? C.gold : C.mute, bold: got });
          s.put(x, cy + 3, clip(b.id === "elite" ? "ELITE4" : b.name.toUpperCase(), bw - 1), { fg: got ? C.cream : C.mute });
        });
        cy += 4;
        const medals = [
          ...MEDALS.filter((m) => g.medals.includes(m.id)).map((m) => [m.color, m.name]),
          ...BADGES.filter((b) => g.classic.includes(b.id)).map((b) => [b.color, `Classic ${b.name}`]),
        ];
        if (medals.length && fits(cy, 1)) cy += dots(c, cy, medals, 3);
        cy++;
      }

      // Recent catches.
      if (fits(cy, 4)) {
        heading(s, "h:recent", c.x, cy, "RECENT CATCHES");
        if (!g.recent.length) s.put(c.x, cy + 2, clip("None yet. Wild Pokemon wait in the tall grass after finished tasks.", c.w), { fg: C.mute });
        g.recent.slice(0, Math.floor(c.w / 7)).forEach((r, i) => {
          const x = c.x + i * 7;
          s.image(`r:${i}:${r.id}`, sprite(r.id), x, cy + 1, 6, 3);
          if (g.shiny.includes(r.id)) s.put(x + 2, cy + 4, "✦✦", { fg: C.gold });
        });
        cy += 5;
      }
      return cy;
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
      (r) => { message = shareMessage(r); },
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
