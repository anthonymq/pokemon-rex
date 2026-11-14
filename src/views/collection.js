// KANTO DEX: the searchable collection. With --pick <project> it is the partner picker:
// only caught Pokemon, Enter makes one the project's partner, and stones can be used.
import { locked } from "herdr";
import { POKEMON } from "../pokemon.js";
import { game, projectLabel, nameOf, itemsFor, useItem, ITEMS, progress } from "../game.js";
import { caught, partnerOf, setPartner, sprite } from "../core.js";
import { C, runApp, clip, pad, len } from "../term.js";

export function runCollection(args) {
  const pickAt = args.indexOf("--pick");
  const project = pickAt >= 0 ? args[pickAt + 1] : null;
  let query = "", only = !!project, sel = project ? partnerOf(project) : 1, scroll = 0, message = "";

  function list() {
    const have = new Set(caught());
    const q = query.trim().toLowerCase().replace(/^#/, "");
    return POKEMON.filter((p) => (!only || have.has(p.id)) && (!q || p.name.toLowerCase().includes(q) || String(p.id).padStart(3, "0").includes(q)));
  }

  function render(s) {
    const W = s.cols, H = s.rows;
    const have = new Set(caught());
    const g = game();
    const items = list();
    s.fill(0, 0, W, H, C.ink, C.lcd);
    s.fill(0, 0, W, 1, C.red, C.cream);
    s.put(2, 0, clip(project ? `CHOOSE PARTNER · ${projectLabel(project).toUpperCase()}` : "KANTO DEX", W - 12), { fg: C.cream, bold: true });
    s.put(W - 8, 0, "esc ×", { fg: C.rose });
    s.hit(W - 9, 0, 9, 1, () => app.quit());

    const count = `Caught ${have.size} / 151`;
    s.put(2, 2, count, { fg: C.lcd, bold: true });
    s.bar(len(count) + 4, 2, Math.max(4, W - len(count) - 7), have.size / 151, C.cyan, C.band);
    s.put(2, 3, "Search ", { fg: C.mute });
    s.fill(9, 3, Math.min(30, W - 30), 1, C.green, C.lcd);
    s.put(10, 3, clip(query + (s.phase ? "▏" : " "), Math.min(28, W - 32)), { fg: C.lcd });
    if (!project) {
      const tabs = [["All", false], ["Caught", true]];
      let x = W - 18;
      for (const [label, value] of tabs) {
        const on = only === value;
        s.put(x, 3, ` ${label} `, { fg: on ? C.ink : C.soft, bg: on ? C.lcd : C.band, bold: on });
        s.hit(x, 3, len(label) + 2, 1, () => { only = value; });
        x += len(label) + 3;
      }
    }

    // Grid of cards: number and check, the sprite, the name.
    const cw = 12, ch = 6, top = 5, bottom = H - 2;
    const per = Math.max(1, Math.floor((W - 2) / cw));
    const left = Math.floor((W - per * cw) / 2);
    const rowsVisible = Math.max(1, Math.floor((bottom - top) / ch));
    let index = items.findIndex((p) => p.id === sel);
    if (index < 0 && items.length) {
      index = 0;
      sel = items[0].id;
    }
    const selRow = Math.floor(Math.max(0, index) / per);
    if (selRow < scroll) scroll = selRow;
    if (selRow >= scroll + rowsVisible) scroll = selRow - rowsVisible + 1;
    scroll = Math.max(0, Math.min(scroll, Math.max(0, Math.ceil(items.length / per) - rowsVisible)));
    render.per = per;
    render.rows = rowsVisible;
    if (!items.length) s.put(2, top + 1, project && !have.size ? "Nothing caught yet. Pokemon are caught when an agent opens in their project." : "No Pokemon match.", { fg: C.mute });
    const current = project ? partnerOf(project) : null;
    items.slice(scroll * per, (scroll + rowsVisible) * per).forEach((p, i) => {
      const x = left + (i % per) * cw, y = top + Math.floor(i / per) * ch;
      const got = have.has(p.id), on = p.id === sel, shiny = g.shiny.includes(p.id);
      const bg = got ? C.lcd : C.green, fg = got ? C.ink : C.mute;
      s.fill(x, y, cw - 1, ch - 1, bg, fg);
      s.put(x, y, pad(`#${String(p.id).padStart(3, "0")}`, cw - 3), { fg: got ? C.band : C.mute });
      if (got) s.put(x + cw - 3, y, shiny ? "✦" : "✓", { fg: shiny ? C.flame : C.green, bold: true });
      if (p.id === current) s.put(x + 4, y, "PARTNER".slice(0, cw - 8), { fg: C.flame, bold: true });
      s.image(`p:${p.id}`, sprite(p.id), x + 2, y + 1, 6, 3);
      s.fill(x, y + 4, cw - 1, 1, on ? C.cyan : bg, on ? C.ink : fg);
      s.put(x, y + 4, pad(clip(p.name, cw - 1), cw - 1), { fg: on ? C.ink : fg, bold: on || got });
      s.hit(x, y, cw - 1, ch - 1, () => {
        if (project && sel === p.id) return choose();
        sel = p.id;
      });
    });

    // Footer: what the selected Pokemon is, and what Enter does.
    const p = POKEMON[sel - 1];
    const entry = g.dex[sel];
    let foot = "";
    if (message) foot = message;
    else if (project) {
      const usable = itemsFor(current, g);
      foot = `enter choose · ${usable.length ? usable.map((u, i) => `${i + 1} ${ITEMS[u.item].name} ×${u.have} → ${nameOf(u.to)}`).join(" · ") : "no stone fits this partner"}`;
    } else if (p) {
      const how = { met: "met in", wild: "caught wild in", evolved: "evolved in" }[entry?.how];
      foot = have.has(sel)
        ? `No. ${String(sel).padStart(3, "0")} ${p.name}${g.shiny.includes(sel) ? " ✦ SHINY" : ""}${entry ? ` · ${how ?? "caught in"} ${entry.project ? projectLabel(entry.project) : "the wild"} · ${new Date(entry.at).toLocaleDateString()}` : ""}`
        : `No. ${String(sel).padStart(3, "0")} ${p.name} · not caught yet`;
    }
    s.fill(0, H - 1, W, 1, C.green, C.lcd);
    s.put(2, H - 1, clip(foot, W - 22), { fg: C.lcd });
    s.put(W - 19, H - 1, project ? "type to search" : "tab filter · type", { fg: C.mute });
  }

  function choose() {
    if (!project) return;
    if (!caught().includes(sel)) return void (message = "Only caught Pokemon can be partners.");
    setPartner(project, sel);
    app.quit();
  }
  function onEvent(ev) {
    message = "";
    const items = list();
    const index = Math.max(0, items.findIndex((p) => p.id === sel));
    const per = render.per ?? 6;
    const move = (to) => { if (items.length) sel = items[Math.max(0, Math.min(items.length - 1, to))].id; };
    if (ev.wheel) return move(index + ev.wheel * per);
    switch (ev.key) {
      case "escape": return query ? void (query = "") : app.quit();
      case "left": return move(index - 1);
      case "right": return move(index + 1);
      case "up": return move(index - per);
      case "down": return move(index + per);
      case "pageup": return move(index - per * (render.rows ?? 3));
      case "pagedown": return move(index + per * (render.rows ?? 3));
      case "home": return move(0);
      case "end": return move(items.length - 1);
      case "tab": return void (project || (only = !only));
      case "enter": return choose();
      case "backspace": return void (query = query.slice(0, -1));
    }
    if (project && /^[1-3]$/.test(ev.char ?? "") && !query) {
      const use = itemsFor(partnerOf(project))[Number(ev.char) - 1];
      if (!use) return;
      if (!use.have) return void (message = `No ${ITEMS[use.item].name} in the bag.`);
      const to = locked(() => useItem(project, use.item));
      if (to) {
        sel = to;
        const { level } = progress(game().xp[project]);
        message = `${projectLabel(project)}'s partner evolved into ${nameOf(to)} (Lv ${level})!`;
      }
      return;
    }
    if (ev.char) query += ev.char;
  }
  const app = runApp({ render, onEvent });
}
