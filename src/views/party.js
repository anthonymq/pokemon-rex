// Screens the trainer card opens over itself: the New Pokedex explainer, the starter choice, a
// waiting gift and the party editor. Each is { render(s), onEvent(ev) }; `done(next)` hands the
// pane back to the card, or to the screen named `next`.
import { game, partyOf, progress, nameOf, trainerLevel, itemsFor, ITEMS, STARTERS, GIFTS, PARTY_MAX, DAYCARE } from "../game.js";
import { caught, sprite } from "../core.js";
import { call } from "../client.js";
import { C, clip, len, wrap } from "../term.js";
import { plate, section } from "./chrome.js";

const pct = Math.round(DAYCARE * 100);
// The one-time explainer, for a save that had progress before the party came (a new save starts
// with it seen).
export const needsExplainer = (g) => g.lifetime > 0 && !g.seen.includes("phase2");
// What the trainer card opens on: the explainer first, then the starter choice, else itself.
export const firstScreen = (g) => (needsExplainer(g) ? "phase2" : !g.party.length ? "starter" : null);
// The trainer level and how far into it lifetime XP is: level n starts at 40 n^2.
export function trainerProgress(g) {
  const tr = trainerLevel(g), lo = 40 * tr ** 2, next = 40 * (tr + 1) ** 2;
  return { tr, next, into: Math.max(0, Math.min(1, (g.lifetime - lo) / (next - lo))) };
}

export function makeScreen(name, { quit, done }) {
  let message = "", busy = false;
  // One server action at a time; its error stays on the footer.
  const act = (action, args, then) => {
    if (busy) return;
    busy = true;
    call(action, ...args).then((v) => { busy = false; then(v); }, (error) => { busy = false; message = error.message; });
  };
  const footer = (s, text, keys) => {
    const W = s.cols, H = s.rows;
    s.fill(0, H - 1, W, 1, C.red, C.cream);
    s.put(2, H - 1, clip(message || text, W - 4 - len(keys) - 2), { fg: C.cream });
    s.put(W - 2 - len(keys), H - 1, keys, { fg: C.rose });
  };
  // Big cards side by side, one per Pokemon to choose from.
  const choices = (s, ids, sel, y, label, pick) => {
    const W = s.cols, cw = Math.min(28, Math.floor((W - 4) / ids.length)), x0 = Math.floor((W - ids.length * cw) / 2);
    ids.forEach((id, i) => {
      const x = x0 + i * cw, on = i === sel;
      s.fill(x, y, cw - 2, 11, on ? C.cream : C.lcd, C.ink);
      s.pixel(`k:${id}`, x + 1, y, String(i + 1), "band");
      s.image(`c:${id}`, sprite(id), x + Math.floor((cw - 2 - 12) / 2), y + 1, 12, 6);
      const n = nameOf(id).toUpperCase();
      s.pixel(`cn:${id}`, x + Math.max(0, Math.floor((cw - 2 - len(n)) / 2)), y + 8, clip(n, cw - 3), "ink");
      const sub = label(id);
      s.put(x + Math.max(0, Math.floor((cw - 2 - len(sub)) / 2)), y + 9, clip(sub, cw - 3), { fg: C.band });
      if (on) s.put(x, y + 10, "▀".repeat(cw - 2), { fg: C.green });
      s.hit(x, y, cw - 2, 11, () => (on ? pick() : void (screen.sel = i)));
    });
  };

  const screen = { sel: 0 };
  if (name === "starter") {
    const TYPES = { 1: "Grass", 4: "Fire", 7: "Water" };
    const pick = () => act("chooseStarter", [STARTERS[screen.sel]], (id) => {
      message = `${nameOf(id)} leads your party!`;
      done(null, message);
    });
    screen.render = (s) => {
      const W = s.cols, g = game();
      s.fill(0, 0, W, s.rows, C.green, C.lcd);
      let y = plate(s, "CHOOSE YOUR STARTER", quit) + 1;
      const lines = [
        "Your first Pokemon leads your party. Every task your agents finish, in any project, gives it XP.",
        g.bank ? `${g.bank} XP already earned is waiting for it.` : "Choose well: it grows with all your work.",
      ];
      for (const line of lines.flatMap((l) => wrap(l, W - 4, 2))) s.put(2, y++, line, { fg: C.soft });
      choices(s, STARTERS, screen.sel, y + 1, (id) => TYPES[id], pick);
      footer(s, `enter choose ${nameOf(STARTERS[screen.sel])}`, "← → 1 2 3 · esc later");
    };
    screen.onEvent = (ev) => {
      message = "";
      if (ev.key === "left" || ev.key === "h") screen.sel = Math.max(0, screen.sel - 1);
      else if (ev.key === "right" || ev.key === "l") screen.sel = Math.min(STARTERS.length - 1, screen.sel + 1);
      else if (/^[1-3]$/.test(ev.char ?? "")) screen.sel = Number(ev.char) - 1;
      else if (ev.key === "enter") pick();
      else if (ev.key === "escape" || ev.key === "q") done(null);
    };
  }

  if (name === "gift") {
    const pending = () => GIFTS.find((x) => x.tr === game().gifts.pending[0]);
    const pick = () => {
      const gift = pending();
      if (gift) act("claimGift", [gift.tr, gift.ids[screen.sel]], (id) => done(null, `${nameOf(id)} joined your Pokedex!`));
    };
    screen.render = (s) => {
      const W = s.cols, gift = pending();
      s.fill(0, 0, W, s.rows, C.green, C.lcd);
      let y = plate(s, "A GIFT", quit) + 1;
      if (!gift) return void done(null);
      s.put(2, y++, clip(`Trainer Lv ${gift.tr}: a gift for your progress. Choose one; it joins your Pokedex.`, W - 4), { fg: C.soft });
      choices(s, gift.ids, screen.sel, y + 1, (id) => `No. ${String(id).padStart(3, "0")}`, pick);
      footer(s, `enter take ${nameOf(gift.ids[screen.sel])}`, "← → · esc later");
    };
    screen.onEvent = (ev) => {
      message = "";
      const n = pending()?.ids.length ?? 1;
      if (ev.key === "left" || ev.key === "h") screen.sel = Math.max(0, screen.sel - 1);
      else if (ev.key === "right" || ev.key === "l") screen.sel = Math.min(n - 1, screen.sel + 1);
      else if (/^[1-9]$/.test(ev.char ?? "") && Number(ev.char) <= n) screen.sel = Number(ev.char) - 1;
      else if (ev.key === "enter") pick();
      else if (ev.key === "escape" || ev.key === "q") done(null);
    };
  }

  if (name === "phase2") {
    const steps = (g) => [
      { title: "ONE PARTY", ids: g.party, text: `Your Pokemon travel together now. Every finished task, in any project, gives its XP to your lead: the first of up to ${PARTY_MAX} in your party. The others train at the Day Care and get ${pct}% of it. Change the lead and the party from the trainer card (p).` },
      { title: "MASCOTS", ids: [], text: "Each project keeps its Pokemon as a mascot, drawn on that project's agent cards. Your old partners joined your Pokedex, and the strongest formed your party with their XP. Pick a project's mascot with p in the sidebar." },
      { title: "TRAINER LEVEL", ids: GIFTS.map((x) => x.ids[0]), text: `Your trainer level comes from all the XP you ever earned: you are trainer Lv ${trainerLevel(g)}. Gifts arrive at trainer levels ${GIFTS.map((x) => x.tr).join(", ")}; some let you choose.` },
    ];
    const finish = () => act("seen", ["phase2"], () => done(game().party.length ? null : "starter"));
    screen.render = (s) => {
      const W = s.cols, g = game(), list = steps(g), step = list[screen.sel];
      s.fill(0, 0, W, s.rows, C.green, C.lcd);
      let y = plate(s, "NEW POKEDEX", quit) + 1;
      const counter = `${screen.sel + 1}/${list.length}`;
      section(s, "h:step", 2, y, step.title, W - 6 - len(counter));
      s.pixel("step", W - 2 - len(counter), y, counter, "soft");
      y += 2;
      for (const line of wrap(step.text, Math.min(80, W - 4), 6)) s.put(2, y++, line, { fg: C.lcd });
      y++;
      step.ids.slice(0, Math.floor((W - 4) / 7)).forEach((id, i) => {
        s.fill(2 + i * 7, y, 6, 3, i === 0 && screen.sel === 0 ? C.cream : C.lcd, C.ink);
        s.image(`e:${screen.sel}:${i}`, sprite(id), 2 + i * 7, y, 6, 3);
      });
      footer(s, screen.sel < list.length - 1 ? "enter next" : "enter got it", "← → · esc skip");
    };
    screen.onEvent = (ev) => {
      message = "";
      if (ev.key === "left" || ev.key === "h") screen.sel = Math.max(0, screen.sel - 1);
      else if (ev.key === "right" || ev.key === "l" || ev.key === "enter") screen.sel < 2 ? screen.sel++ : finish();
      else if (ev.key === "escape" || ev.key === "q") finish();
    };
  }

  if (name === "party") {
    let sel = game().party[0] ?? caught()[0] ?? 1, scroll = 0, per = 1;
    const say = (text) => { message = text; };
    const toggle = () => {
      const party = game().party;
      if (party.includes(sel)) {
        if (party.length === 1) return say("The party needs at least one Pokemon.");
        act("setParty", [party.filter((id) => id !== sel)], () => say(`${nameOf(sel)} went to rest.`));
      } else if (party.length >= PARTY_MAX) say(`The party is full (${PARTY_MAX}): remove one first (space).`);
      else act("setParty", [[...party, sel]], () => say(`${nameOf(sel)} joined the party.`));
    };
    const makeLead = () => {
      const party = game().party;
      if (party[0] === sel) return say(`${nameOf(sel)} already leads.`);
      const out = !party.includes(sel) && party.length >= PARTY_MAX ? party[PARTY_MAX - 1] : null;
      act("setLead", [sel], () => say(`${nameOf(sel)} leads the party${out ? `; ${nameOf(out)} went to rest` : ""}.`));
    };
    const useItem = (k) => {
      const g = game();
      if (!g.party.includes(sel)) return say("Stones and the Link Cable work on party members.");
      const use = itemsFor(sel, g)[k];
      if (!use) return;
      if (!use.have) return say(`No ${ITEMS[use.item].name} in the bag.`);
      const from = sel;
      act("useItem", [from, use.item], (to) => {
        if (!to) return say("Nothing happened.");
        sel = to;
        say(`${nameOf(from)} evolved into ${nameOf(to)}!`);
      });
    };
    screen.render = (s) => {
      const W = s.cols, H = s.rows, g = game(), have = caught(), party = partyOf(g);
      s.fill(0, 0, W, H, C.green, C.lcd);
      let y = plate(s, "PARTY", quit) + 1;

      // The party: the lead first, then the Day Care.
      section(s, "h:party", 2, y, "PARTY", W - 4);
      const note = `lead first · Day Care ${pct}% of its XP`;
      s.put(W - 2 - len(note), y, note, { fg: C.soft });
      y++;
      const sw = Math.floor((W - 3) / PARTY_MAX);
      for (let i = 0; i < PARTY_MAX; i++) {
        const x = 2 + i * sw, p = party[i];
        s.fill(x, y, sw - 1, 6, p ? (i === 0 ? C.cream : C.lcd) : C.band, C.ink);
        if (!p) continue;
        s.image(`pt:${i}:${p.id}`, sprite(p.id), x + Math.floor((sw - 7) / 2), y, 6, 3);
        s.pixel(`ptk:${i}`, x, y, i === 0 ? "★" : String(i + 1), i === 0 ? "flame" : "band");
        s.put(x + 1, y + 3, clip(nameOf(p.id), sw - 3), { fg: C.ink, bold: p.id === sel });
        const lv = `Lv${p.level}`;
        s.put(x + 1, y + 4, lv, { fg: C.band });
        if (i === 0) s.put(x + 2 + len(lv), y + 4, "LEAD", { fg: C.flame, bold: true });
        s.bar(x + 1, y + 5, sw - 3, progress(p.xp).into, C.green, C.lcdDim);
        s.hit(x, y, sw - 1, 6, () => { sel = p.id; });
      }
      y += 7;

      // Every caught Pokemon to pick from.
      section(s, "h:dex", 2, y, "YOUR POKEMON", W - 4);
      y++;
      const cw = 9, ch = 4, top = y, bottom = H - 2;
      per = Math.max(1, Math.floor((W - 3) / cw));
      const rows = Math.max(1, Math.floor((bottom - top) / ch));
      const index = Math.max(0, have.indexOf(sel));
      const row = Math.floor(index / per);
      if (row < scroll) scroll = row;
      if (row >= scroll + rows) scroll = row - rows + 1;
      if (!have.length) s.put(2, top, "Nothing caught yet.", { fg: C.soft });
      have.slice(scroll * per, (scroll + rows) * per).forEach((id, i) => {
        const x = 2 + (i % per) * cw, cy = top + Math.floor(i / per) * ch, on = id === sel;
        const at = g.party.indexOf(id);
        s.fill(x, cy, cw - 1, ch - 1, on ? C.cream : C.lcd, C.ink);
        s.image(`d:${id}`, sprite(id), x + 1, cy, 6, 3);
        if (at >= 0) s.put(x + cw - 2, cy, at === 0 ? "★" : "●", { fg: at === 0 ? C.flame : C.green, bold: true });
        s.put(x, cy + ch - 1, clip(`Lv${progress(g.pokemon[id]).level}`, cw - 1), { fg: on ? C.cream : C.soft, bold: on });
        s.hit(x, cy, cw - 1, ch - 1, () => (sel === id ? makeLead() : void (sel = id)));
      });

      // Footer: the selected Pokemon, and what its stones would do.
      const xp = g.pokemon[sel] ?? 0, at = g.party.indexOf(sel);
      const items = at >= 0 ? itemsFor(sel, g) : [];
      const info = `${nameOf(sel)} Lv${progress(xp).level} · ${xp} XP${at === 0 ? " · lead" : at > 0 ? " · Day Care" : ""}`;
      const uses = items.map((u, i) => `${i + 1} ${ITEMS[u.item].name} ×${u.have} → ${nameOf(u.to)}`).join(" · ");
      footer(s, uses ? `${info} · ${uses}` : info, "enter lead · space add/remove · esc");
    };
    screen.onEvent = (ev) => {
      message = "";
      const have = caught();
      const index = Math.max(0, have.indexOf(sel));
      const move = (to) => { if (have.length) sel = have[Math.max(0, Math.min(have.length - 1, to))]; };
      if (ev.wheel) return move(index + ev.wheel * per);
      switch (ev.key) {
        case "left": case "h": return move(index - 1);
        case "right": case "l": return move(index + 1);
        case "up": case "k": return move(index - per);
        case "down": case "j": return move(index + per);
        case "enter": return makeLead();
        case " ": case "a": return toggle();
        case "escape": case "q": return done(null);
      }
      if (/^[1-3]$/.test(ev.char ?? "")) useItem(Number(ev.char) - 1);
    };
  }
  return screen;
}
