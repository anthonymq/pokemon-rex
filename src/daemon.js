// The Pokedex daemon: one per machine. It follows every Rex session's program status
// (OSC 7501), turns terminals that report into agents, awards XP when a turn ends (and its
// commit, if it made one) and writes agents.json for the sidebars to draw.
import fs from "node:fs";
import path from "node:path";
import { writeJson, readJson, shared, settings, STATE_DIR } from "./herdr.js";
import { nameOf, projectLabel, PARTNERS } from "./game.js";
import { AGENTS_FILE, PID_FILE, daemonPid, partnerOf, hasPartner, showNote } from "./core.js";
import { connect, sendFrom, flushOutbox } from "./client.js";
import { REX, TERMINAL, rex, api, ensureSidebar, fitSidebar, sidebarPrefs, blockCall, sessions as listSessions, view, windowBlocks, labelOf } from "./rex.js";

const blocks = new Map(); // block id -> { session, records: Map<id, record>, cwd, project, since: {s, at}, subPrev, turn: {at, head} }
const sessionLabels = new Map();
const blockInfo = new Map(); // block id -> { window, label }
const projects = new Map(); // cwd -> project key
const seen = new Set(); // blocks whose project already got its mascot this start
const log = (...a) => console.log(new Date().toISOString(), ...a);

// A project is the git repo an agent works in, else its folder, else its session.
function projectFor(cwd, session) {
  if (!cwd) return sessionLabels.get(session) ?? "rex";
  if (projects.has(cwd)) return projects.get(cwd);
  let key = cwd;
  try {
    const r = Bun.spawnSync(["git", "rev-parse", "--show-toplevel"], { cwd, stdout: "pipe", stderr: "ignore", timeout: 5000 });
    const top = r.stdout.toString().trim();
    if (r.exitCode === 0 && top) key = top;
  } catch {}
  projects.set(cwd, key);
  return key;
}

// --- Results: a turn that made a commit reports it. HEAD is read when the turn starts and again
// once the server took the finished turn, off the event loop with a short timeout; a folder that
// isn't a git repo, or any git error, reports nothing. (No cheap, reliable signal exists here for
// "green" or "merged", so those are not reported.)
export async function headOf(cwd) {
  if (!cwd) return null;
  try {
    const proc = Bun.spawn(["git", "log", "-1", "--format=%H %ct"], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 3000 });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const [hash, time] = out.trim().split(" ");
    return code === 0 && hash ? { hash, at: Number(time) * 1000 } : null;
  } catch {
    return null;
  }
}
// The branch checked out, for quest variety; null when detached or not a repo.
export async function branchOf(cwd) {
  if (!cwd) return null;
  try {
    const proc = Bun.spawn(["git", "rev-parse", "--abbrev-ref", "HEAD"], { cwd, stdout: "pipe", stderr: "ignore", stdin: "ignore", timeout: 3000 });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    const name = out.trim();
    return code === 0 && name && name !== "HEAD" ? name : null;
  } catch {
    return null;
  }
}
// HEAD moved to a commit made since the turn started (not a checkout of an older one).
export const committed = (before, after, since) => Boolean(before && after && after.hash !== before.hash && after.at >= since - 1000);
function reportCommit(session, project, cwd, turn, finished) {
  Promise.all([turn.head, finished]).then(async ([before]) => {
    if (!before) return;
    const after = await headOf(cwd);
    if (!committed(before, after, turn.at)) return;
    log(`commit ${after.hash.slice(0, 8)} in ${projectLabel(project)}`);
    await sendFrom(session, "result", project, "commit");
  }).catch((error) => log(`commit check failed: ${error}`));
}

function entry(session, block) {
  let b = blocks.get(block);
  if (!b) {
    b = { session, records: new Map(), cwd: null, project: null, since: null, subPrev: {}, turn: null };
    blocks.set(block, b);
  }
  b.session = session;
  return b;
}
function refreshCwd(b, block, foreground) {
  const cwd = foreground?.cwd ?? blockCall(b.session, block, "process").value?.foreground?.cwd ?? null;
  if (cwd && cwd !== b.cwd) {
    b.cwd = cwd;
    // An agent keeps its project through a turn: `cd` inside one shouldn't move its XP. Between turns the
    // pane follows its folder, so a new agent started elsewhere doesn't keep (and share) the old mascot.
    if (b.project && b.turn) return;
    const project = projectFor(cwd, b.session);
    if (project !== b.project) seen.delete(block);
    b.project = project;
  }
}

// The root record is the agent; records with an id are its sub-agents.
const norm = (state) => (state === "done" || state === "error" ? "idle" : state);
const URGENCY = { blocked: 0, error: 0, done: 1, working: 2, idle: 3 };
function agentState(b) {
  const root = b.records.get("");
  if (root) return root.state;
  return [...b.records.values()].map((r) => r.state).sort((x, y) => URGENCY[x] - URGENCY[y])[0] ?? "idle";
}

function track(block, b) {
  if (!b.records.size) return;
  const now = Date.now();
  if (!b.project) refreshCwd(b, block);
  const project = b.project ?? projectFor(null, b.session);
  const root = b.records.get("");
  const app = root?.effective_app ?? root?.app ?? [...b.records.values()].find((r) => r.effective_app)?.effective_app ?? null;

  // What happened goes to the Pokedex server, which plays the rules; its news comes back as toasts.
  const send = (action, ...args) => sendFrom(b.session, action, ...args);
  {
    // An agent's project gets its mascot when the agent first shows up (it isn't caught for free).
    if (!seen.has(block)) {
      seen.add(block);
      if (!hasPartner(project)) send("savePartners", { [project]: partnerOf(project) });
    }
    const s = norm(agentState(b));
    const prev = b.since;
    if (prev?.s !== s) {
      // A turn starts with the first working state and lasts through blocked spells until idle.
      if (s === "working" && !b.turn) b.turn = { at: now, head: headOf(b.cwd), branch: branchOf(b.cwd) };
      // Done and idle count as one. A working agent going quiet finished a task.
      if (prev?.s === "working" && s === "idle") {
        log(`task finished in ${projectLabel(project)} after ${Math.round((now - prev.at) / 1000)}s (${app ?? "?"})`);
        const partner = partnerOf(project), ms = now - prev.at;
        const finished = Promise.resolve(b.turn?.branch ?? null).then((branch) => send("taskFinished", project, partner, ms, app, branch));
        if (b.turn) reportCommit(b.session, project, b.cwd, b.turn, finished);
      }
      if (s === "idle") b.turn = null;
      if (prev?.s === "blocked") send("unblocked", project, now - prev.at);
      b.since = { s, at: now };
    }
    // Sub-agents: a child record going from working to idle or done earns the smaller award.
    for (const [id, r] of b.records) {
      if (id === "") continue;
      const before = b.subPrev[id];
      b.subPrev[id] = r.state;
      if (before === "working" && (r.state === "idle" || r.state === "done")) send("subTaskFinished", project, partnerOf(project));
    }
  }
}

let dirty = false;
function publish() {
  dirty = false;
  const agents = [];
  for (const [block, b] of blocks) {
    if (!b.records.size) continue;
    const root = b.records.get("");
    const project = b.project ?? projectFor(null, b.session);
    const subs = [...b.records].filter(([id]) => id !== "").map(([id, r]) => ({ id, title: r.title ?? id, state: r.state === "error" ? "blocked" : r.state, msg: r.msg ?? "" }));
    agents.push({
      block, session: b.session, sessionLabel: sessionLabels.get(b.session) ?? "", window: blockInfo.get(block)?.window ?? null,
      label: blockInfo.get(block)?.label ?? "", app: root?.effective_app ?? root?.app ?? "",
      state: agentState(b) === "error" ? "blocked" : agentState(b), failed: root?.state === "error", kind: root?.kind ?? null,
      msg: root?.msg ?? "", title: root?.title ?? "", progress: root?.progress ?? null, since: b.since?.at ?? Date.now(),
      project, partner: partnerOf(project), cwd: b.cwd, subs,
    });
  }
  writeJson(AGENTS_FILE, {
    at: Date.now(), pid: process.pid, agents,
    sessions: [...sessionLabels].map(([id, label]) => ({ id, label })),
    windows: [...windowLabels].map(([id, w]) => ({ id, session: w.session, label: w.label })),
  });
  try { syncLabels(agents); } catch (error) { log(`labels failed: ${error}`); }
}
// --- Tab names. Rex's own sidebar can't be extended, but it shows each tab's label, so with
// { "labels": { "enabled": true } } in config.json a tab holding an agent is named after its
// mascot: "Meowth · rex". Only tabs still carrying Rex's default name ("Window 1a2b3c4d")
// or a name we gave are touched; a tab you named yourself is left alone, and a tab whose
// agents are gone gets its default name back.
const LABELS_FILE = path.join(STATE_DIR, "labels.json");
const windowLabels = new Map(); // window id -> { session, label }
const ours = new Map(Object.entries(readJson(LABELS_FILE, {}))); // window id -> { session, label } we set
const DEFAULT_LABEL = /^Window [0-9a-f]{8}$/;
function syncLabels(agents) {
  const enabled = settings().labels?.enabled === true;
  const want = new Map();
  if (enabled) {
    const byWindow = new Map();
    for (const a of agents) if (a.window) byWindow.set(a.window, [...(byWindow.get(a.window) ?? []), a]);
    for (const [win, list] of byWindow) {
      // One name per tab: its most urgent agent's project.
      const a = list.sort((x, y) => URGENCY[x.state] - URGENCY[y.state] || y.since - x.since)[0];
      const more = new Set(list.map((x) => x.project)).size - 1;
      want.set(win, { session: a.session, label: `${nameOf(a.partner)} · ${projectLabel(a.project)}${more > 0 ? ` +${more}` : ""}`.slice(0, 120) });
    }
  }
  let changed = false;
  for (const [win, w] of want) {
    const now = windowLabels.get(win)?.label;
    if (now === undefined || now === w.label) continue;
    if (!DEFAULT_LABEL.test(now) && ours.get(win)?.label !== now) continue; // named by the person
    if (!api(w.session, "session.set_window_label", { window_id: win, label: w.label }).ok) continue;
    windowLabels.set(win, { session: w.session, label: w.label });
    ours.set(win, w);
    changed = true;
  }
  for (const [win, o] of ours) {
    if (want.has(win)) continue;
    const now = windowLabels.get(win)?.label;
    // Still our name: give the default back. Renamed since, or closed: just forget it.
    if (now !== undefined && now === o.label) api(o.session, "session.set_window_label", { window_id: win, label: "" });
    ours.delete(win);
    changed = true;
  }
  if (changed) writeJson(LABELS_FILE, Object.fromEntries(ours));
}

const touch = () => {
  if (dirty) return;
  dirty = true;
  setTimeout(publish, 80);
};

function refreshSession(id) {
  const v = view(id);
  if (!v) return;
  sessionLabels.set(id, v.label ?? "");
  for (const [win, w] of windowLabels) if (w.session === id) windowLabels.delete(win);
  for (const win of v.windows ?? []) {
    windowLabels.set(win.window_id, { session: id, label: win.label ?? "" });
    for (const b of windowBlocks(win)) blockInfo.set(b.block, { window: win.window_id, label: labelOf(win, b.block) ?? "" });
  }
}
// --- The sidebar, always there. With { "sidebar": { "auto": true } } in config.json the tab
// a session is showing always has the Pokedex pane, so whichever session you switch to has
// it open. It is checked when the daemon starts, when a session appears and when a session
// shows another tab. Rex doesn't tell the server which session the app is looking at, so
// every session's current tab is kept ready instead.
const ensuring = new Map(); // window id -> timer
const fitting = new Map(); // session -> { window, until }: sidebars just opened, still settling
function refit(session) {
  const f = fitting.get(session);
  if (!f) return;
  if (Date.now() > f.until) return void fitting.delete(session);
  try { fitSidebar(session, f.window); } catch {}
}
function autoSidebar(session, windowId, delay = 0) {
  if (!sidebarPrefs().auto || !session) return;
  const key = windowId ?? session;
  if (ensuring.has(key)) return;
  ensuring.set(key, setTimeout(() => {
    ensuring.delete(key);
    try {
      const r = ensureSidebar(session, windowId);
      if (r.ok === false) log(`sidebar not opened in ${sessionLabels.get(session) ?? session}: ${r.error}`);
      // Rex may even out the panes just after the split. For the next three seconds every
      // layout change in that session puts the width straight back (see session_view_changed),
      // with a few timed tries in case no change is reported.
      else if (r.value === "opened") {
        fitting.set(session, { window: r.window, until: Date.now() + 3000 });
        for (const ms of [60, 200, 500, 1200]) setTimeout(() => refit(session), ms);
      }
    } catch (error) {
      log(`sidebar failed: ${error}`);
    }
  }, delay));
}

function scan() {
  for (const s of listSessions()) {
    sessionLabels.set(s.session_id, s.label ?? "");
    refreshSession(s.session_id);
    autoSidebar(s.session_id, null, 0);
    // Tabs in the background that already show a sidebar are brought in line with the settings too.
    for (const [win, w] of windowLabels) {
      if (w.session === s.session_id && [...blockInfo].some(([, b]) => b.window === win && b.label === "Pokedex")) autoSidebar(s.session_id, win, 0);
    }
    const list = rex(["block", "ls", "-s", s.session_id, "--json"]).value?.blocks ?? [];
    for (const blk of list) {
      if (blk.creator_name !== TERMINAL) continue;
      const records = blockCall(s.session_id, blk.block_id, "program_status").value?.records ?? [];
      if (!records.length) continue;
      const b = entry(s.session_id, blk.block_id);
      for (const r of records) b.records.set(r.id ?? "", r);
      track(blk.block_id, b);
    }
  }
  touch();
}

const SHELLS = new Set(["zsh", "bash", "fish", "sh", "dash", "ksh", "tcsh", "csh", "nu", "pwsh", "login"]);
function agentInForeground(session, block) {
  const name = blockCall(session, block, "process").value?.foreground?.name;
  return Boolean(name) && !SHELLS.has(name);
}

const pending = new Set();
function onEvent(ev) {
  if (ev.type === "session_created") {
    sessionLabels.set(ev.payload.session.session_id, ev.payload.session.label ?? "");
    autoSidebar(ev.payload.session.session_id, null, 800); // once its first pane has started
    return touch();
  }
  if (ev.type === "session_destroyed") {
    const id = ev.payload.session_id;
    sessionLabels.delete(id);
    for (const [block, b] of blocks) if (b.session === id) blocks.delete(block);
    return touch();
  }
  if (ev.type !== "session_event") return;
  const session = ev.payload.session_id;
  const inner = ev.payload.event;
  const p = inner.payload ?? {};
  switch (inner.type) {
    case "window_label_changed":
      windowLabels.set(p.window_id, { session, label: p.label ?? "" });
      return;
    case "session_label_changed":
      sessionLabels.set(session, p.label ?? "");
      return touch();
    case "active_window_changed":
      autoSidebar(session, p.window_id);
      return;
    case "session_view_changed":
      refit(session);
      // Layout changes come in bursts; one look at the view per burst is enough.
      if (pending.has(session)) return;
      pending.add(session);
      setTimeout(() => { pending.delete(session); refreshSession(session); touch(); }, 300);
      return;
    case "block_closed":
      blocks.delete(p.block_id);
      blockInfo.delete(p.block_id);
      seen.delete(p.block_id);
      return touch();
    case "block_event": {
      if (p.creator_name !== TERMINAL) return;
      const block = p.block_id;
      if (p.name === "process_changed") {
        const b = blocks.get(block);
        if (b && p.payload?.foreground?.cwd) refreshCwd(b, block, p.payload.foreground);
        return;
      }
      if (p.name === "program_status_changed") {
        const b = entry(session, block);
        b.records.set(p.payload.id ?? "", p.payload.record);
        track(block, b);
        return touch();
      }
      if (p.name === "program_status_removed") {
        const b = blocks.get(block);
        if (!b) return;
        // Rex drops a working record when it sees a shell prompt mark (OSC 133). Some agents' own
        // screens send one mid-turn (OMO does), so while the agent is still the foreground program
        // its turn goes on: the records are kept and the turn ends when it reports idle or done.
        if (p.payload?.reason === "prompt" && agentInForeground(session, block)) return;
        for (const id of p.payload.ids ?? []) {
          b.records.delete(id);
          delete b.subPrev[id];
        }
        // A record dropped mid-turn (the program exited) ends the turn without an award.
        if (!b.records.size) b.since = b.turn = null;
        else track(block, b);
        return touch();
      }
    }
  }
}

export async function runDaemon() {
  const other = daemonPid();
  if (other && other !== process.pid) {
    console.log(`pokedex daemon already running (pid ${other})`);
    return;
  }
  writeJson(PID_FILE, process.pid);
  const stop = () => {
    try { if (daemonPid() === process.pid) fs.unlinkSync(PID_FILE); } catch {}
    process.exit(0);
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  log(`pokedex daemon started (pid ${process.pid})`);
  // The game comes from the Pokedex server (started if it isn't running). News that Rex caused
  // is shown here, as a toast in the session it came from, once.
  let shown = Date.now();
  const onState = (state) => {
    for (const n of state.notes ?? []) {
      if (n.origin !== "rex" || n.at <= shown) continue;
      shown = n.at;
      // Agents working right now, live (agents.json lags a moment): the "smart" alert waits on them.
      const busy = [...blocks.values()].filter((b) => b.records.size && norm(agentState(b)) === "working").length;
      try { showNote(n.session, n, busy); } catch (error) { log(`toast failed: ${error}`); }
    }
  };
  if (!(await connect({ onState }))) log("Pokedex server not reachable yet; still trying");
  // Reports queued while the server was out of reach go out once it's back.
  flushOutbox();
  setInterval(() => flushOutbox(), 30000);

  // Follow the event stream for as long as the Rex server answers; reconnect when it restarts.
  for (;;) {
    const proc = Bun.spawn([REX, "events", "--all", "--json"], { stdout: "pipe", stderr: "ignore", stdin: "ignore" });
    blocks.clear();
    try { scan(); } catch (error) { log(`scan failed: ${error}`); }
    const decoder = new TextDecoder();
    let buf = "";
    for await (const chunk of proc.stdout) {
      buf += decoder.decode(chunk, { stream: true });
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try { onEvent(JSON.parse(line)); } catch (error) { log(`event failed: ${error}`); }
      }
    }
    await proc.exited;
    log("event stream ended; retrying in 5 s");
    writeJson(AGENTS_FILE, { at: Date.now(), pid: process.pid, agents: [], sessions: [] });
    await Bun.sleep(5000);
  }
}
