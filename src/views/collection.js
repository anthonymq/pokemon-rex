// KANTO DEX: the searchable collection. With --pick <project> it is the partner picker:
// only caught Pokemon, Enter makes one the project's partner, and stones can be used.
import { POKEMON } from "../pokemon.js";
import { game, projectLabel, nameOf, itemsFor, ITEMS, progress } from "../game.js";
import { caught, partnerOf, sprite } from "../core.js";
import { call, shareOnX } from "../client.js";
import { C, runApp, clip, len } from "../term.js";
import { plate } from "./chrome.js";

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
    s.fill(0, 0, W, H, C.green, C.lcd);
    let y = plate(s, project ? "CHOOSE PARTNER" : "KANTO DEX", () => app.quit());

    // Progress, then search and the filter tabs.
    y++;
    const count = `CAUGHT ${have.size} / 151`;
    s.pixel("count", 2, y, count, "lcd");
    s.bar(len(count) + 4, y, Math.max(4, W - len(count) - 6), have.size / 151, C.cyan, C.band);
    if (project) s.pixel("for", 2, y + 1, clip(`FOR ${projectLabel(project).toUpperCase()}`, W - 4), "amber");
    y += project ? 2 : 1;
    s.pixel("search", 2, y, "SEARCH", "soft");
    const fw = Math.max(8, Math.min(30, W - 34));
    s.fill(9, y, fw, 1, C.lcd, C.ink);
    s.pixel("query", 10, y, clip(query, fw - 3), "ink");
    if (s.phase) s.put(10 + len(clip(query, fw - 3)), y, "▏", { fg: C.ink });
    if (!project) {
      let x = W - 17;
      for (const [label, value] of [["ALL", false], ["CAUGHT", true]]) {
        const on = only === value;
        s.fill(x, y, len(label) + 2, 1, on ? C.lcd : C.band, C.ink);
        s.pixel(`tab:${label}`, x + 1, y, label, on ? "ink" : "soft");
        s.hit(x, y, len(label) + 2, 1, () => { only = value; });
        x += len(label) + 3;
      }
    }
    y += 2;

    // Grid of cards: number and check, the sprite, the name.
    const cw = 13, ch = 6, top = y, bottom = H - 1;
    const per = Math.max(1, Math.floor((W - 2) / cw));
    const left = Math.floor((W - per * cw + 1) / 2);
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
    if (!items.length) s.put(2, top + 1, clip(project && !have.size ? "Nothing caught yet. Pokemon are caught when an agent opens in their project." : "No Pokemon match.", W - 4), { fg: C.soft });
    const current = project ? partnerOf(project) : null;
    items.slice(scroll * per, (scroll + rowsVisible) * per).forEach((p, i) => {
      const x = left + (i % per) * cw, cy = top + Math.floor(i / per) * ch;
      const got = have.has(p.id), on = p.id === sel, shiny = g.shiny.includes(p.id);
      const bg = got ? (shiny ? C.gold : C.lcd) : C.band;
      s.fill(x, cy, cw - 1, ch - 1, bg, C.ink);
      s.pixel(`no:${p.id}`, x + 1, cy, `#${String(p.id).padStart(3, "0")}`, got ? "band" : "mute");
      if (p.id === current) s.pixel(`cur:${p.id}`, x + 6, cy, "PARTN", "flame");
      else if (got) s.put(x + cw - 3, cy, shiny ? "✦" : "✓", { fg: shiny ? C.flame : C.green, bold: true });
      s.image(`p:${p.id}`, sprite(p.id), x + 3, cy + 1, 6, 3);
      s.fill(x, cy + 4, cw - 1, 1, on ? C.cyan : bg, C.ink);
      const name = clip(p.name, cw - 2);
      s.pixel(`n:${p.id}`, x + Math.max(0, Math.floor((cw - 1 - len(name)) / 2)), cy + 4, name, on || got ? "ink" : "soft");
      s.hit(x, cy, cw - 1, ch - 1, () => {
        if (project && sel === p.id) return choose();
        sel = p.id;
      });
    });
    const total = Math.ceil(items.length / per);
    if (total > rowsVisible) s.put(W - 1, top + Math.round((scroll / (total - rowsVisible)) * (bottom - top - 1)), "┃", { fg: C.pink });

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
    s.fill(0, H - 1, W, 1, C.red, C.cream);
    s.put(2, H - 1, clip(foot, W - 24), { fg: C.cream });
    s.put(W - 21, H - 1, project ? "type to search" : "^S share · tab filter", { fg: C.rose });
  }

  function choose() {
    if (!project) return;
    if (!caught().includes(sel)) return void (message = "Only caught Pokemon can be partners.");
    call("setPartner", project, sel).then(() => app.quit(), (error) => { message = error.message; });
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
      case "ctrl+s":
        message = "Opening X...";
        return void shareOnX().then(
          (copied) => { message = copied ? "Card copied: paste it into the post (⌘V)" : "X opened; the card couldn't be copied"; },
          (error) => { message = `Share failed: ${error.message}`; },
        );
      case "enter": return choose();
      case "backspace": return void (query = query.slice(0, -1));
    }
    if (project && /^[1-3]$/.test(ev.char ?? "") && !query) {
      const use = itemsFor(partnerOf(project))[Number(ev.char) - 1];
      if (!use) return;
      if (!use.have) return void (message = `No ${ITEMS[use.item].name} in the bag.`);
      call("useItem", project, use.item).then((to) => {
        if (!to) return;
        sel = to;
        const { level } = progress(game().xp[project]);
        message = `${projectLabel(project)}'s partner evolved into ${nameOf(to)} (Lv ${level})!`;
      }, (error) => { message = error.message; });
      return;
    }
    if (ev.char) query += ev.char;
  }
  const app = runApp({ render, onEvent });
}
