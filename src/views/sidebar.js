// The Pokedex sidebar, laid out like pokemon-herdr's: the brand plate with its lens, the
// PROJECTS / SESSIONS screen (each session a heading band, its tabs under it with their
// partner), then POKEMON / AGENTS: the KANTO DEX button, a grid of square sprite tiles, a
// detail card for the selected agent, and the trainer strip.
import fs from "node:fs";
import path from "node:path";
import { shared, writeJson, ROOT } from "herdr";
import { call } from "../client.js";
import { game, progress, trainerLevel, liveStreak, projectLabel, nameOf, BADGES, ENCOUNTER_MS } from "../game.js";
import { agentsSnapshot, notes, sprite, badgeArt, caught, ensureDaemon, openDialog, daemonPid, NOTE_MS, GOTO_FILE } from "../core.js";
import { api, rex, view, findWindow, fitColumns } from "../rex.js";
import { C, runApp, clip, len, ago } from "../term.js";

const SESSION = process.env.REX_SESSION;
const BLOCK = process.env.REX_BLOCK;
const WORDS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };
const GROUPS = [["blocked", "NEEDS YOU"], ["done", "DONE"], ["working", "WORKING"], ["idle", "IDLE"]];
const URGENCY = { blocked: 0, done: 1, working: 2, idle: 3 };
const SPIN = ["◐", "◓", "◑", "◒"];
const MARK = { blocked: "!", done: "✦", idle: "z", working: "" };
const SQUARES = ["#5fbfb0", "#e58a4a", "#6f8fe6", "#9a7be6", "#d95f8c", "#5fbf77", "#e8c35a"];
const AUTO_TAB = /^Window [0-9a-f]{8}$|^.+ Lv\d+ · /; // Rex's default name, or one the daemon gave

// Static art drawn by tools/make_art.py and shown with kitty graphics: the lens, the lights
// and the headings in the pixel font. A heading image of n letters covers n cells.
const art = (name) => path.join(ROOT, "assets", "ui", `${name}.png`);
const plain = { crop: false };

export function runSidebar() {
  ensureDaemon();
  let sel = 0, scroll = 0, listScroll = 0, spin = 0, message = null, order = [], help = false, perRow = 1;
  let listBox = { top: 0, bottom: 0 };
  // The tab this sidebar sits in: its row is the highlighted one, as the current space is in Herdr.
  let myWindow = null;
  try { myWindow = SESSION ? findWindow(view(SESSION), { block: BLOCK })?.window_id ?? null : null; } catch {}
  const say = (text) => { message = { text, at: Date.now() }; };
  const sort = () => (shared("agents.sort") === "grouped" ? "grouped" : "priority");
  const dialog = (name, args) => {
    if (!SESSION) return say("Not inside Rex");
    const r = openDialog(SESSION, { block: BLOCK }, name, args);
    if (!r.ok) say(r.error);
  };

  // Teleporting: the server focuses the pane, then the app has to show that session and tab.
  // The app takes that from us only with Remote Control on; without it the target is left
  // for the pokedex_jump action (ctrl+a g), which runs inside the app.
  function focusAgent(a) {
    if (!a) return;
    const r = api(a.session, "session.focus_block", { block_id: a.block });
    if (!r.ok) return say(r.error);
    show(a.session, a.window, a.block);
  }
  function show(session, window, block) {
    if (session === SESSION && window && window === myWindow && !block) return;
    writeJson(GOTO_FILE, { at: Date.now(), session, window, block });
    const app = (rex(["client", "ls", "--json"]).value?.clients ?? []).find((c) => c.info?.kind === "app");
    if (!app) return say("No Rex app connected");
    const r = rex(["-C", app.client_id, "do", "session.select", `session_id=${session}`, ...(window ? [`window_id=${window}`] : [])]);
    if (!r.ok) return say(/Remote Control/.test(r.error) ? "Press ctrl+a g to jump there" : r.error);
    try { fs.unlinkSync(GOTO_FILE); } catch {} // shown already; ctrl+a g goes back to "most urgent"
  }

  function groups(agents) {
    const newest = (a, b) => b.since - a.since;
    if (sort() === "grouped") {
      const by = new Map();
      for (const a of agents) by.set(a.sessionLabel || "session", [...(by.get(a.sessionLabel || "session") ?? []), a]);
      return [...by].map(([label, list]) => ({ label: label.toUpperCase(), list: list.sort(newest) }));
    }
    return GROUPS.map(([state, label]) => ({ label, list: agents.filter((a) => a.state === state).sort(newest) })).filter((g) => g.list.length);
  }

  function render(s) {
    const W = s.cols, H = s.rows;
    const snap = agentsSnapshot();
    const g = game();
    const agents = snap.agents;
    const now = Date.now();

    // --- Brand plate: lens, name, status lights, the three bars.
    const anyBlocked = agents.some((a) => a.state === "blocked"), anyWorking = agents.some((a) => a.state === "working");
    // Two rows: a small lens, the name at twice the letter size, the lights; then the pink rule.
    s.image("lens", art("lens"), 1, 0, 4, 2, plain);
    if (W >= 22) s.image("title", art("title"), 6, 0, 14, 2, plain);
    else s.put(6, 0, clip("POKEDEX", W - 7), { fg: C.cream, bold: true });
    if (W >= 28) {
      s.image("l1", art(anyBlocked ? "light-yellow" : "light-off"), W - 7, 0, 2, 1, plain);
      s.image("l2", art(anyWorking ? "light-cyan" : "light-off"), W - 5, 0, 2, 1, plain);
      s.image("l3", art("light-lcd"), W - 3, 0, 2, 1, plain);
    }
    s.put(0, 2, "▁".repeat(W), { fg: C.pink });
    let y = 3;

    const header = (title, right, fn, name) => {
      s.image(`h:${name}`, art("light-cyan"), 1, y, 2, 1, plain);
      if (W >= 4 + len(title) + 3) s.image(`ht:${name}`, art(name), 4, y, len(title), 1, plain);
      else s.put(4, y, clip(title, W - 6 - len(right ?? "")), { fg: C.cream, bold: true });
      if (right) s.put(W - len(right) - 1, y, right, { fg: C.cream });
      if (fn) s.hit(0, y, W, 1, fn);
      y++;
    };
    const footRows = 3; // news row, rule, trainer strip
    const detailRows = agents.length ? 5 : 0;

    // --- PROJECTS / SESSIONS: the dark green screen.
    header("PROJECTS / SESSIONS", null, null, "projects");
    const lines = [];
    for (const sess of snap.sessions) {
      const tabs = (snap.windows ?? []).filter((w) => w.session === sess.id);
      lines.push({ kind: "band", sess, count: tabs.length });
      tabs.forEach((tab, i) => {
        const here = agents.filter((a) => a.window === tab.id).sort((a, b) => URGENCY[a.state] - URGENCY[b.state]);
        const name = here[0] ? projectLabel(here[0].project) : AUTO_TAB.test(tab.label) || !tab.label ? `tab ${i + 1}` : tab.label;
        lines.push({ kind: "tab", tab, i, a: here[0] ?? null, more: here.length - 1, name });
      });
    }
    const space = H - y - footRows - detailRows - 6; // what's left for both lists, less headers
    const listRows = Math.max(2, Math.min(lines.length || 1, Math.max(3, Math.floor(space * 0.5))));
    listScroll = Math.max(0, Math.min(listScroll, Math.max(0, lines.length - listRows)));
    listBox = { top: y, bottom: y + listRows };
    s.fill(0, y, W, listRows, C.green, C.lcd);
    if (!lines.length) s.put(2, y, clip(daemonPid() ? "No sessions" : "Starting…", W - 3), { fg: C.mute });
    lines.slice(listScroll, listScroll + listRows).forEach((line, k) => {
      const ry = y + k;
      if (line.kind === "band") {
        const label = (line.sess.label || "session").toUpperCase(), count = String(line.count);
        s.fill(0, ry, W, 1, C.band, C.lcd);
        s.put(0, ry, "▌", { fg: C.cyan });
        s.put(2, ry, "▣", { fg: line.sess.id === SESSION ? C.cyan : C.mute });
        s.pixel(`band:${line.sess.id}`, 4, ry, clip(label, W - 8 - len(count)), "lcd");
        const from = 5 + len(clip(label, W - 8 - len(count)));
        if (W - from - len(count) - 3 > 0) s.put(from, ry, "─".repeat(W - from - len(count) - 3), { fg: C.mute });
        s.pixel(`bandn:${line.sess.id}`, W - len(count) - 2, ry, count, "lcd");
        s.hit(0, ry, W, 1, () => show(line.sess.id, null, null));
        return;
      }
      const active = line.tab.id === myWindow;
      const bg = active ? C.lcd : C.green, ink = active ? C.ink : C.lcd;
      s.fill(0, ry, W, 1, bg, ink);
      if (active) s.put(0, ry, "▌", { fg: C.cyan });
      s.put(2, ry, "■", { fg: SQUARES[line.i % SQUARES.length] });
      if (line.a) s.image(`t:${line.tab.id}`, sprite(line.a.partner), 4, ry, 2, 1);
      const state = line.a?.state;
      const mark = state === "blocked" ? "!" : state === "done" ? "*" : state === "working" ? SPIN[spin % 4] : "";
      s.pixel(`tab:${line.tab.id}`, line.a ? 7 : 4, ry, clip(line.name + (line.more > 0 ? ` +${line.more}` : ""), W - (line.a ? 7 : 4) - 3), active ? "ink" : "lcd");
      if (mark) s.put(W - 3, ry, mark, { fg: active ? C.flame : state === "blocked" ? C.amber : C.cyan, bold: true });
      s.hit(0, ry, W, 1, () => (line.a ? focusAgent(line.a) : show(line.tab.session, line.tab.id, null)));
    });
    if (lines.length > listRows) s.put(W - 1, y + Math.round((listScroll / (lines.length - listRows)) * (listRows - 1)), "┃", { fg: C.mute });
    y += listRows;
    s.put(0, y, "▔".repeat(W), { fg: C.redDark });
    y++;

    // --- POKEMON / AGENTS.
    header("POKÉMON / AGENTS", sort() === "grouped" ? "≡" : "◷", () => toggleSort(), "agents");
    y++;
    const have = caught().length;
    const right = `Caught ${have} / 151 ›`;
    s.fill(1, y, W - 2, 1, C.lcd, C.ink);
    if (W >= 14) s.image("kanto", art("kanto"), 2, y, 9, 1, plain);
    else s.put(2, y, clip("KANTO DEX", W - 4), { fg: C.ink, bold: true });
    if (W - 4 - 10 >= len(right)) {
      s.pixel("caught", W - 2 - len(right), y, right.slice(0, -1), "band");
      s.put(W - 3, y, "›", { fg: C.band });
    }
    s.hit(1, y, W - 2, 1, () => dialog("collection"));
    y += 2;

    // The grid: square LCD tiles, one per agent, under their group labels.
    const top = y, bottom = H - footRows - detailRows;
    const tw = 6, th = 3, gapX = 1, gapY = 1;
    perRow = Math.max(1, Math.floor((W - 1) / (tw + gapX)));
    const layout = [];
    let vy = 0;
    order = [];
    for (const group of groups(agents)) {
      layout.push({ kind: "label", y: vy, h: 1, group });
      vy += 2;
      group.list.forEach((a, i) => {
        layout.push({ kind: "tile", y: vy + Math.floor(i / perRow) * (th + gapY), h: th, a, x: 1 + (i % perRow) * (tw + gapX) });
        order.push(a);
      });
      vy += Math.ceil(group.list.length / perRow) * (th + gapY);
    }
    sel = Math.max(0, Math.min(order.length - 1, sel));
    const selected = order[sel];
    const selBox = layout.find((it) => it.a && it.a === selected);
    const room = Math.max(0, bottom - top);
    if (selBox) {
      if (selBox.y - 2 < scroll) scroll = Math.max(0, selBox.y - 2);
      if (selBox.y + selBox.h > scroll + room) scroll = selBox.y + selBox.h - room;
    }
    scroll = Math.max(0, Math.min(scroll, Math.max(0, vy - room)));

    if (!agents.length && room >= 5) {
      s.fill(1, top, W - 2, 4, C.lcd, C.ink);
      s.put(3, top, "NO DATA", { fg: C.ink, bold: true });
      ["Agents appear when they report", "status (OSC 7501): Claude Code,", "Codex and others do."].forEach((line, i) => s.put(3, top + 1 + i, clip(line, W - 5), { fg: C.band }));
    }
    for (const it of layout) {
      const ry = top + it.y - scroll;
      if (ry < top || ry + it.h > bottom) continue;
      if (it.kind === "label") {
        const label = `${it.group.label} ${it.group.list.length}`;
        const word = `group-${it.group.label.toLowerCase().replace(/ /g, "-")}`;
        // The four status words and the count's digits are pixel-font pictures; a session name
        // (when grouped by session) is ordinary text.
        if (GROUPS.some(([, l]) => l === it.group.label) && W >= len(label) + 5) {
          s.image(`g:${it.group.label}`, art(word), 1, ry, len(it.group.label), 1, plain);
          [...String(it.group.list.length)].forEach((digit, k) => s.image(`g:${it.group.label}:${k}`, art(`digit-${digit}`), 2 + len(it.group.label) + k, ry, 1, 1, plain));
        } else s.pixel(`gl:${it.group.label}`, 1, ry, clip(label, W - 4), "rose");
        const from = 2 + len(clip(label, W - 4));
        if (W - from - 3 > 0) s.put(from, ry, "─".repeat(W - from - 3), { fg: C.pink });
        s.put(W - 2, ry, "›", { fg: C.rose });
        continue;
      }
      const a = it.a, on = a === selected;
      const fainted = !!g.fainted[a.project];
      const mark = a.state === "working" ? SPIN[spin % 4] : fainted ? "x" : a.state === "blocked" ? (s.phase ? "!" : " ") : MARK[a.state];
      // The selected tile is brighter with a dark frame line under it; a blocked one glows amber.
      const bg = on ? C.cream : a.state === "blocked" ? C.amber : C.lcd;
      s.fill(it.x, ry, tw, th, bg, C.ink);
      s.image(`a:${a.block}`, sprite(a.partner), it.x, ry, tw, th, { dy: a.state === "working" && s.phase ? 4 : 0 });
      if (mark && mark !== " ") s.put(it.x + tw - 1, ry, mark, { fg: a.state === "blocked" ? C.flame : C.green, bold: true });
      if (a.subs.length) s.put(it.x, ry, `+${a.subs.length}`, { fg: C.band });
      if (on) s.put(it.x, ry + th, "▀".repeat(tw), { fg: C.green });
      s.hit(it.x, ry, tw, th, (ev) => {
        sel = order.indexOf(a);
        if (ev.button === 2) dialog("collection", ["--pick", a.project]);
        else focusAgent(a);
      });
    }
    if (vy > room && room > 0) s.put(W - 1, top + Math.round((scroll / Math.max(1, vy - room)) * (room - 1)), "┃", { fg: C.pink });

    // --- The selected agent, spelled out: what a tooltip says in Herdr.
    if (selected && detailRows) {
      const dy = bottom + 1;
      const a = selected;
      const { level, into } = progress(g.xp[a.project]);
      const fainted = !!g.fainted[a.project];
      s.fill(1, dy, W - 2, 4, C.lcd, C.ink);
      const lv = `Lv${level}`;
      s.fill(1, dy, W - 2, 1, C.green, C.lcd);
      s.pixel("d:name", 2, dy, clip(projectLabel(a.project), W - 5 - len(lv)), "lcd");
      s.pixel("d:lv", W - 2 - len(lv), dy, lv, "lcd");
      const word = fainted ? "FAINTED" : a.failed ? "FAILED" : WORDS[a.state];
      const glyph = a.state === "working" ? SPIN[spin % 4] : a.state === "blocked" ? "!" : a.state === "done" ? "●" : "○";
      s.put(2, dy + 1, glyph, { fg: a.state === "blocked" ? C.flame : C.green, bold: true });
      s.pixel("d:word", 4, dy + 1, clip(word, W - 6), a.state === "blocked" ? "flame" : "ink");
      const rest = [nameOf(a.partner), a.app, ago(now - a.since)].filter(Boolean).join(" · ");
      if (W - 7 - len(word) > 4) s.put(5 + len(word), dy + 1, clip(rest, W - 7 - len(word)), { fg: C.band });
      const where = a.session !== SESSION ? a.sessionLabel : "";
      s.put(2, dy + 2, clip(a.msg || a.title || [where, a.subs.length ? `${a.subs.length} sub-agents` : ""].filter(Boolean).join(" · ") || "enter: go to its tab · p: partner", W - 4), { fg: C.band });
      s.bar(2, dy + 3, W - 4, into, C.green, C.lcdDim);
      s.hit(1, dy, W - 2, 4, () => focusAgent(a));
    }

    // --- News row: a waiting wild Pokemon, a message from an action, or the latest note.
    const e = g.encounter && now - g.encounter.at <= ENCOUNTER_MS ? g.encounter : null;
    const note = notes().filter((n) => now - n.at < NOTE_MS).pop();
    const ny = H - 3;
    if (e) {
      const left = Math.max(0, Math.ceil((ENCOUNTER_MS - (now - e.at)) / 1000));
      s.fill(0, ny, W, 1, s.phase ? C.gold : C.cream, C.ink);
      s.put(1, ny, clip(`! WILD ${nameOf(e.id).toUpperCase()} · e · ${left}s`, W - 2), { fg: C.ink, bold: true });
      s.hit(0, ny, W, 1, () => dialog("encounter"));
    } else if (message && now - message.at < 6000) {
      s.put(1, ny, clip(message.text, W - 2), { fg: C.amber });
    } else if (note) {
      s.put(1, ny, clip(`✦ ${note.title}`, W - 2), { fg: C.cream, bold: true });
    }

    // --- Footer: the trainer strip on an LCD chip, and a help button.
    s.put(0, H - 2, "▁".repeat(W), { fg: C.redDark });
    const fy = H - 1;
    const chipW = Math.max(6, W - 9);
    s.fill(1, fy, chipW, 1, C.lcd, C.ink);
    const tr = `TR${trainerLevel(g)}`;
    s.pixel("tr", 2, fy, clip(tr, chipW - 2), "ink");
    const streak = liveStreak(g);
    let x = 3 + len(tr);
    if (x + 4 < chipW) {
      s.put(x, fy, `▲${streak}`, { fg: streak ? C.flame : C.band, bold: !!streak });
      x += len(`▲${streak}`) + 1;
    }
    for (const b of BADGES.filter((b) => !b.rank)) {
      if (x + 1 >= chipW) break;
      // An earned badge shows its art; a locked one is an empty socket.
      if (g.badges.includes(b.id)) s.image(`badge:${b.id}`, badgeArt(b.id), x, fy, 2, 1, plain);
      else s.put(x, fy, "○", { fg: C.lcdDim });
      x += 2;
    }
    s.hit(1, fy, chipW, 1, () => dialog("trainer"));
    s.fill(W - 7, fy, 6, 1, C.redDark, C.cream);
    s.pixel("help", W - 6, fy, "HELP", "cream");
    s.hit(W - 7, fy, 6, 1, () => { help = !help; });

    if (help) {
      const text = ["h j k l   move between agents", "enter     go to the agent's tab", "p         choose its partner", "s         priority / by session", "d         Kanto Dex", "t         trainer card", "e         wild encounter", "q         close the sidebar"];
      const hy = Math.max(3, H - 3 - text.length);
      s.fill(0, hy, W, text.length, C.ink, C.soft);
      text.forEach((line, i) => s.put(1, hy + i, clip(line, W - 2), { fg: C.soft }));
    }
  }

  const toggleSort = () => call("setSort", sort() === "grouped" ? "priority" : "grouped").catch((error) => say(error.message));
  function onEvent(ev) {
    if (ev.wheel) {
      if (ev.y >= listBox.top && ev.y < listBox.bottom) listScroll = Math.max(0, listScroll + ev.wheel);
      else scroll = Math.max(0, scroll + ev.wheel * 2);
      return;
    }
    switch (ev.key) {
      case "l": case "right": sel++; break;
      case "h": case "left": sel = Math.max(0, sel - 1); break;
      case "j": case "down": sel += perRow; break;
      case "k": case "up": sel = Math.max(0, sel - perRow); break;
      case "enter": focusAgent(order[sel]); break;
      case "p": order[sel] ? dialog("collection", ["--pick", order[sel].project]) : say("No agent selected"); break;
      case "d": dialog("collection"); break;
      case "t": dialog("trainer"); break;
      case "e": game().encounter ? dialog("encounter") : say("No wild Pokemon right now"); break;
      case "s": toggleSort(); break;
      case "?": help = !help; break;
      case "q": app.quit(); break;
    }
  }
  // Keep to the configured width in columns: measured here, because only a pane that is on
  // screen knows its real size. Checked a moment after each resize, and now and then.
  let ticks = 0, lastCols = 0, fitAt = 0;
  const app = runApp({
    render, onEvent, tick: 500,
    onTick: (s) => {
      spin++;
      if (++ticks % 20 === 0) ensureDaemon();
      if (s.cols !== lastCols) {
        lastCols = s.cols;
        fitAt = ticks + 1;
      }
      if (ticks === fitAt || ticks % 10 === 0) { try { fitColumns(SESSION, BLOCK); } catch {} }
    },
  });
}
