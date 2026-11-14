// The Pokedex sidebar: the red device housing with the brand plate, the sessions screen,
// the agents' Pokemon (tiles or cards) and the trainer strip.
import fs from "node:fs";
import { shared, setShared, locked, writeJson } from "herdr";
import { game, progress, trainerLevel, liveStreak, projectLabel, nameOf, BADGES, ENCOUNTER_MS } from "../game.js";
import { agentsSnapshot, notes, sprite, ensureDaemon, openDialog, daemonPid, NOTE_MS, GOTO_FILE } from "../core.js";
import { api, rex } from "../rex.js";
import { C, runApp, clip, pad, len, ago } from "../term.js";

const SESSION = process.env.REX_SESSION;
const BLOCK = process.env.REX_BLOCK;
const WORDS = { working: "WORKING", blocked: "NEEDS YOU", done: "DONE", idle: "IDLE" };
const GROUPS = [["blocked", "NEEDS YOU"], ["done", "DONE"], ["working", "WORKING"], ["idle", "IDLE"]];
const SPIN = ["◐", "◓", "◑", "◒"];
const MARK = { blocked: "!", done: "✦", idle: "z", working: "" };

export function runSidebar() {
  ensureDaemon();
  let sel = 0, scroll = 0, spin = 0, message = null, order = [];
  const say = (text) => { message = { text, at: Date.now() }; };
  const sort = () => {
    const v = shared("agents.sort");
    return v === "grouped" ? "grouped" : "priority";
  };
  const mode = () => shared("agents.view") ?? "tiles";
  const dialog = (name, args) => {
    if (!SESSION) return say("Not inside Rex");
    const r = openDialog(SESSION, { block: BLOCK }, name, args);
    if (!r.ok) say(r.error);
  };

  // Teleporting to an agent: the server focuses its pane, then the app has to show that
  // session and tab. The app takes that from us only with Remote Control on; without it the
  // target is left for the pokedex_jump action (ctrl+a g), which runs inside the app.
  function focusAgent(a) {
    if (!a) return;
    const r = api(a.session, "session.focus_block", { block_id: a.block });
    if (!r.ok) return say(r.error);
    show(a.session, a.window, a.block);
  }
  const gotoSession = (id) => { if (id !== SESSION) show(id, null, null); };
  function show(session, window, block) {
    writeJson(GOTO_FILE, { at: Date.now(), session, window, block });
    const app = (rex(["client", "ls", "--json"]).value?.clients ?? []).find((c) => c.info?.kind === "app");
    if (!app) return say("No Rex app connected");
    const r = rex(["-C", app.client_id, "do", "session.select", `session_id=${session}`, ...(window ? [`window_id=${window}`] : [])]);
    if (!r.ok) return say(/Remote Control/.test(r.error) ? "Press ctrl+a g to jump there (or turn on Remote Control)" : r.error);
    try { fs.unlinkSync(GOTO_FILE); } catch {} // shown already; ctrl+a g goes back to "most urgent"
  }

  // Agents in the order they are drawn, under their group labels.
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
    const W = s.cols, H = s.rows, compact = W < 20;
    const snap = agentsSnapshot();
    const g = game();
    const agents = snap.agents;
    const now = Date.now();
    let y = 0;

    // Brand plate.
    const blocked = agents.some((a) => a.state === "blocked"), working = agents.some((a) => a.state === "working");
    s.put(1, 1, " ◉ ", { fg: C.lens, bg: C.cream, bold: true });
    if (!compact) {
      s.put(6, 1, "POKEDEX", { fg: C.cream, bold: true });
      s.put(6, 2, "AGENT CONTROL", { fg: C.rose });
      s.put(W - 6, 1, "●", { fg: blocked ? C.yellow : C.off });
      s.put(W - 4, 1, "●", { fg: working ? C.cyan : C.off });
      s.put(W - 2, 1, "●", { fg: C.lcd });
      s.put(W - 8, 2, "━━━ ━ ━", { fg: C.redDark });
    }
    s.put(0, 3, "━".repeat(W), { fg: C.pink });
    y = 4;

    // Sessions screen.
    const header = (title, right = "") => {
      s.put(1, y, "●", { fg: C.cyan });
      if (!compact) s.put(3, y, clip(title, W - 4 - len(right)), { fg: C.cream, bold: true });
      if (right && !compact) s.put(W - len(right) - 1, y, right, { fg: C.rose });
      y++;
    };
    header("PROJECTS / SESSIONS");
    const sessions = snap.sessions;
    const shown = sessions.slice(0, Math.max(1, Math.min(sessions.length, Math.floor(H / 5))));
    s.fill(0, y, W, shown.length || 1, C.green, C.lcd);
    if (!sessions.length) s.put(2, y, clip(daemonPid() ? "No sessions" : "Starting…", W - 3), { fg: C.mute });
    shown.forEach((sess, i) => {
      const mine = agents.filter((a) => a.session === sess.id);
      const mark = mine.some((a) => a.state === "blocked") ? "!" : mine.some((a) => a.state === "done") ? "*" : mine.some((a) => a.state === "working") ? SPIN[spin % 4] : " ";
      const active = sess.id === SESSION;
      const fg = active ? C.ink : C.lcd, bg = active ? C.lcd : C.green;
      s.fill(0, y, W, 1, bg, fg);
      if (active) s.put(0, y, "▌", { fg: C.cyan });
      if (compact) s.put(1, y, pad(String(i + 1), W - 3), { fg, bold: active });
      else {
        s.put(2, y, "■", { fg: active ? C.green : C.band });
        s.put(4, y, clip(sess.label || "session", W - 7), { fg, bold: active });
      }
      s.put(W - 2, y, mark, { fg: active ? C.flame : mark === "!" ? C.amber : C.cyan, bold: true });
      s.hit(0, y, W, 1, () => gotoSession(sess.id));
      y++;
    });
    if (!shown.length) y++;
    if (sessions.length > shown.length) {
      s.fill(0, y, W, 1, C.green, C.mute);
      s.put(2, y, clip(`+${sessions.length - shown.length} more`, W - 3), { fg: C.mute });
      y++;
    }

    // Agents.
    s.put(0, y, "━".repeat(W), { fg: C.redDark });
    y++;
    const tiles = mode() === "tiles" && !compact;
    header("POKÉMON / AGENTS", `${sort() === "grouped" ? "by session" : "priority"} ⇅`);
    s.hit(0, y - 1, W, 1, toggleSort);
    const top = y, bottom = H - 3; // the news row and the footer stay below
    const layout = [];
    let vy = 0;
    order = [];
    for (const group of groups(agents)) {
      layout.push({ kind: "label", y: vy, h: 1, group });
      vy += 1;
      if (compact) {
        for (const a of group.list) {
          layout.push({ kind: "rail", y: vy, h: 3, a, x: 0, w: W });
          order.push(a);
          vy += 3;
        }
      } else if (tiles) {
        const tw = 10, per = Math.max(1, Math.floor((W - 1) / (tw + 1)));
        group.list.forEach((a, i) => {
          layout.push({ kind: "tile", y: vy + Math.floor(i / per) * 7, h: 6, a, x: 1 + (i % per) * (tw + 1), w: tw });
          order.push(a);
        });
        vy += Math.ceil(group.list.length / per) * 7;
      } else {
        for (const a of group.list) {
          layout.push({ kind: "card", y: vy, h: 4, a, x: 1, w: W - 2 });
          order.push(a);
          vy += 5;
          for (const sub of a.subs) {
            layout.push({ kind: "sub", y: vy - 1, h: 1, sub, x: 3, w: W - 4 });
            vy += 1;
          }
          if (a.subs.length) vy += 1;
        }
      }
    }
    sel = Math.max(0, Math.min(order.length - 1, sel));
    const selected = order[sel];
    const selBox = layout.find((it) => it.a && it.a === selected);
    const room = bottom - top;
    if (selBox) {
      if (selBox.y - 1 < scroll) scroll = Math.max(0, selBox.y - 1);
      if (selBox.y + selBox.h > scroll + room) scroll = selBox.y + selBox.h - room;
    }
    scroll = Math.max(0, Math.min(scroll, Math.max(0, vy - room)));

    if (!agents.length && room >= 4 && !compact) {
      s.fill(1, top + 1, W - 2, 4, C.lcd, C.ink);
      s.put(3, top + 1, "NO DATA", { fg: C.ink, bold: true });
      ["Agents appear when they report", "status (OSC 7501): Claude Code,", "Codex and others do."].forEach((line, i) => s.put(3, top + 2 + i, clip(line, W - 5), { fg: C.band }));
    }
    for (const it of layout) {
      const ry = top + it.y - scroll;
      if (ry < top || ry + it.h > bottom) continue;
      if (it.kind === "label") {
        const count = String(it.group.list.length);
        s.put(1, ry, clip(it.group.label, W - 3), { fg: C.rose, bold: true });
        const from = 2 + len(clip(it.group.label, W - 3));
        if (W - from - len(count) - 2 > 0) s.put(from, ry, "─".repeat(W - from - len(count) - 2), { fg: C.redDark });
        s.put(W - len(count) - 1, ry, count, { fg: C.rose });
        continue;
      }
      if (it.kind === "sub") {
        s.fill(it.x, ry, it.w, 1, C.lcdDim, C.ink);
        s.put(it.x - 1, ry, "└", { fg: C.redDark });
        s.put(it.x + 1, ry, clip(it.sub.title, it.w - 4), { fg: C.ink });
        s.put(it.x + it.w - 2, ry, it.sub.state === "working" ? SPIN[spin % 4] : MARK[it.sub.state] || "·", { fg: C.flame, bold: true });
        continue;
      }
      const a = it.a, on = a === selected;
      const { level, into } = progress(g.xp[a.project]);
      const fainted = !!g.fainted[a.project];
      const mark = fainted ? "x" : a.state === "blocked" ? (s.phase ? "!" : " ") : MARK[a.state];
      const bob = a.state === "working" && s.phase ? 4 : 0;
      const name = projectLabel(a.project);
      s.hit(it.x, ry, it.w, it.h, (ev) => {
        sel = order.indexOf(a);
        if (ev.button === 2) dialog("collection");
        else if (it.kind !== "rail" && ev.x < it.x + 9 && it.kind === "card") dialog("collection", ["--pick", a.project]);
        else focusAgent(a);
      });
      if (it.kind === "rail") {
        s.fill(0, ry, W, 2, on ? C.green : C.lcd, C.ink);
        if (W >= 6) s.image(`a:${a.block}`, sprite(a.partner), Math.floor((W - 4) / 2), ry, 4, 2, { dy: 0 });
        s.put(W - 1, ry, a.state === "working" ? SPIN[spin % 4] : mark || "·", { fg: C.flame, bold: true });
        continue;
      }
      if (it.kind === "tile") {
        const border = a.state === "blocked" ? C.flame : null;
        s.fill(it.x, ry, it.w, 6, C.lcd, C.ink);
        s.image(`a:${a.block}`, sprite(a.partner), it.x + 1, ry, 8, 4, { dy: bob });
        s.put(it.x + it.w - 1, ry, a.state === "working" ? SPIN[spin % 4] : mark || " ", { fg: C.flame, bold: true });
        if (a.subs.length) s.put(it.x, ry, `+${a.subs.length}`, { fg: C.band });
        s.fill(it.x, ry + 4, it.w, 1, on ? C.green : border ?? C.lcd, on || border ? C.lcd : C.ink);
        s.put(it.x, ry + 4, pad(clip(name, it.w), it.w), { fg: on || border ? C.lcd : C.ink, bold: true });
        const lv = `Lv${level}`;
        s.put(it.x, ry + 5, lv, { fg: C.band });
        s.bar(it.x + len(lv) + 1, ry + 5, it.w - len(lv) - 1, into, C.green, C.lcdDim);
        continue;
      }
      // A full card: scene, name and level, task, status line, XP strip.
      s.fill(it.x, ry, it.w, 4, C.lcd, C.ink);
      s.image(`a:${a.block}`, sprite(a.partner), it.x, ry, 8, 4, { dy: bob });
      s.put(it.x + 7, ry, mark || " ", { fg: C.flame, bold: true });
      const tx = it.x + 9, tw = it.w - 10;
      const lv = `Lv${level}`;
      s.fill(tx - 1, ry, tw + 2, 1, on ? C.green : C.lcd, on ? C.lcd : C.ink);
      s.put(tx, ry, clip(name, tw - len(lv) - 1), { fg: on ? C.lcd : C.ink, bold: true });
      s.put(tx + tw - len(lv), ry, lv, { fg: on ? C.lcd : C.band });
      s.put(tx, ry + 1, clip(a.msg || a.title || (a.label && a.label !== "shell" ? a.label : ""), tw), { fg: C.band });
      const word = fainted ? "FAINTED" : a.failed ? "FAILED" : WORDS[a.state];
      const glyph = a.state === "working" ? SPIN[spin % 4] : a.state === "blocked" ? "!" : a.state === "done" ? "●" : "○";
      s.put(tx, ry + 2, glyph, { fg: a.state === "blocked" ? C.flame : C.green, bold: true });
      s.put(tx + 2, ry + 2, clip(word, tw - 2), { fg: a.state === "idle" ? C.band : C.ink, bold: true });
      const rest = [a.app, a.session !== SESSION ? a.sessionLabel : "", ago(now - a.since)].filter(Boolean).join(" · ");
      const used = 3 + len(word);
      if (tw - used > 3) s.put(tx + used, ry + 2, clip(rest, tw - used), { fg: C.band });
      s.bar(tx, ry + 3, tw, into, C.green, C.lcdDim);
    }
    if (vy > room && room > 0) s.put(W - 1, top + Math.round((scroll / Math.max(1, vy - room)) * (room - 1)), "┃", { fg: C.pink });

    // News row: a waiting wild Pokemon, a message from an action, or the latest note.
    const e = g.encounter && now - g.encounter.at <= ENCOUNTER_MS ? g.encounter : null;
    const note = notes().filter((n) => now - n.at < NOTE_MS).pop();
    const ny = H - 3;
    if (e) {
      const left = Math.max(0, Math.ceil((ENCOUNTER_MS - (now - e.at)) / 1000));
      s.fill(0, ny, W, 1, s.phase ? C.gold : C.cream, C.ink);
      s.put(1, ny, clip(compact ? "!" : `! WILD ${nameOf(e.id).toUpperCase()} · e · ${left}s`, W - 2), { fg: C.ink, bold: true });
      s.hit(0, ny, W, 1, () => dialog("encounter"));
    } else if (message && now - message.at < 6000) {
      s.put(1, ny, clip(message.text, W - 2), { fg: C.amber });
    } else if (note && !compact) {
      s.put(1, ny, clip(note.title, W - 2), { fg: C.cream, bold: true });
    }

    // Footer: the trainer strip.
    s.put(0, H - 2, "━".repeat(W), { fg: C.redDark });
    const fy = H - 1;
    const tr = `TR${trainerLevel(g)}`;
    s.fill(1, fy, W - 2, 1, C.lcd, C.ink);
    s.put(2, fy, clip(tr, W - 3), { fg: C.ink, bold: true });
    if (!compact) {
      const streak = liveStreak(g);
      let x = 3 + len(tr);
      s.put(x, fy, `▲${streak}d`, { fg: streak ? C.flame : C.band });
      x += len(`▲${streak}d`) + 1;
      for (const b of BADGES.filter((b) => !b.rank)) {
        if (x >= W - 9) break;
        s.put(x++, fy, g.badges.includes(b.id) ? "◆" : "◇", { fg: g.badges.includes(b.id) ? C.flame : C.band });
      }
      s.put(W - 8, fy, "d t ?", { fg: C.band });
      s.hit(W - 9, fy, 3, 1, () => dialog("collection"));
    }
    s.hit(1, fy, Math.max(1, W - 10), 1, () => dialog("trainer"));
    if (help && !compact) {
      const lines = ["j/k move   enter focus agent", "p choose partner  d Kanto Dex", "t trainer card  e encounter", "s sort   v tiles/cards   q quit"];
      const hy = Math.max(top, H - 3 - lines.length);
      s.fill(0, hy, W, lines.length, C.ink, C.soft);
      lines.forEach((line, i) => s.put(1, hy + i, clip(line, W - 2), { fg: C.soft }));
    }
  }

  let help = false;
  const toggleSort = () => locked(() => setShared("agents.sort", sort() === "grouped" ? "priority" : "grouped"));
  function onEvent(ev) {
    if (ev.wheel) return void (scroll = Math.max(0, scroll + ev.wheel * 3));
    switch (ev.key) {
      case "j": case "down": case "right": case "l": sel++; break;
      case "k": case "up": case "left": case "h": sel = Math.max(0, sel - 1); break;
      case "enter": focusAgent(order[sel]); break;
      case "p": order[sel] ? dialog("collection", ["--pick", order[sel].project]) : say("No agent selected"); break;
      case "d": dialog("collection"); break;
      case "t": dialog("trainer"); break;
      case "e": game().encounter ? dialog("encounter") : say("No wild Pokemon right now"); break;
      case "s": toggleSort(); break;
      case "v": locked(() => setShared("agents.view", mode() === "tiles" ? "cards" : "tiles")); break;
      case "?": help = !help; break;
      case "q": app.quit(); break;
    }
  }
  const app = runApp({ render, onEvent, tick: 500, onTick: () => { spin++; ensureDaemonSometimes(); } });
  let ticks = 0;
  function ensureDaemonSometimes() {
    if (++ticks % 20 === 0) ensureDaemon();
  }
}
