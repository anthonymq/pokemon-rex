// Thin wrappers over the `rex` CLI. Every call is one short-lived process.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { ROOT } from "./herdr.js";

const CANDIDATES = [
  process.env.REX_BIN,
  path.join(os.homedir(), "Library/Application Support/com.superlogical.rex/RexServer/Versions/Current/Rex Server.app/Contents/MacOS/rex"),
  "/usr/local/bin/rex",
  "/opt/homebrew/bin/rex",
  "/usr/bin/rex",
];
export const REX = Bun.which("rex") ?? CANDIDATES.find((p) => p && fs.existsSync(p)) ?? "rex";
export const BUN = process.execPath;
export const CLI = path.join(ROOT, "bin", "pokedex.js");
export const TERMINAL = "com.superlogical.terminal";

export function rex(args, { json = true, timeout = 8000 } = {}) {
  const r = Bun.spawnSync([REX, ...args], { stdout: "pipe", stderr: "pipe", timeout });
  const out = r.stdout.toString();
  if (r.exitCode !== 0) return { ok: false, error: r.stderr.toString().trim() || `rex exited ${r.exitCode}` };
  if (!json) return { ok: true, value: out };
  try {
    return { ok: true, value: out.trim() ? JSON.parse(out) : null };
  } catch {
    return { ok: true, value: out };
  }
}
export const api = (session, method, args = {}) => rex(["api", "call", "-s", session, method, JSON.stringify(args)]);
export const blockCall = (session, block, method, args) =>
  rex(["block", "call", "-s", session, "-b", block, method, ...(args ? [JSON.stringify(args)] : [])]);

export const sessions = () => rex(["ls", "--json"]).value?.sessions ?? [];
export const view = (session) => api(session, "session.view").value;

// Every tiled or floating block of a window with its rect, as fractions of the window.
export function windowBlocks(win) {
  const out = [];
  const walk = (node, layer) => {
    if (!node) return;
    if (node.block_id) out.push({ block: node.block_id, rect: node.rect, layer: layer.layer_id, kind: layer.kind });
    if (node.split) {
      walk(node.split.before, layer);
      walk(node.split.after, layer);
    }
  };
  for (const layer of win.layers ?? []) walk(layer.layout, layer);
  return out;
}
export const labelOf = (win, block) => {
  for (const layer of win.layers ?? []) for (const b of layer.blocks ?? []) if (b.block_id === block) return b.label;
  return null;
};
export function findWindow(v, { window, block } = {}) {
  const wins = v?.windows ?? [];
  if (block) {
    const hit = wins.find((w) => windowBlocks(w).some((b) => b.block === block));
    if (hit) return hit;
  }
  return wins.find((w) => w.window_id === window) ?? wins.find((w) => w.window_id === v?.active_window_id) ?? wins[0];
}

// A window's size in terminal cells, worked out from one of its tiled terminals.
export function windowCells(session, win) {
  for (const b of windowBlocks(win)) {
    if (b.kind !== "tiled" || !b.rect?.[2] || !b.rect?.[3]) continue;
    const size = blockCall(session, b.block, "size").value;
    if (size?.columns) return { cols: Math.round(size.columns / b.rect[2]), rows: Math.round(size.rows / b.rect[3]) };
  }
  return { cols: 160, rows: 48 };
}

const command = (view, args = []) => ({
  flavor: `${TERMINAL}.shell`,
  label: LABELS[view] ?? "Pokedex",
  options: { command: [BUN, CLI, view, ...args], shell: "none", cwd: ROOT },
});
export const LABELS = { sidebar: "Pokedex", collection: "Kanto Dex", trainer: "Trainer Card", encounter: "Wild Pokemon", toast: "Pokedex News" };
const SIZES = { collection: [100, 34], trainer: [78, 34], encounter: [52, 15], toast: [48, 7] };

// Opens a view as a floating pane over a window, sized in cells and placed like a dialog
// (centered), a banner (top center) or a toast (top right).
export function openFloat(session, win, name, { args = [], focus = true, place = "center" } = {}) {
  const cells = windowCells(session, win);
  const [wantW, wantH] = SIZES[name] ?? [80, 24];
  const w = Math.min(0.96, wantW / cells.cols), h = Math.min(0.94, wantH / cells.rows);
  const x = place === "right" ? 1 - w - 0.01 : (1 - w) / 2;
  const y = place === "center" ? (1 - h) / 2 : 0.03;
  return api(session, "session.new_layer", {
    window_id: win.window_id, bounds: [x, y, w, h], focus, layout: { block: command(name, args) },
  });
}

// The sidebar is a full-height pane on the left of a window. Opening it again closes it.
export function toggleSidebar(session, target) {
  const v = view(session);
  const win = findWindow(v, target);
  if (!win) return { ok: false, error: "no window" };
  const open = windowBlocks(win).filter((b) => labelOf(win, b.block) === LABELS.sidebar);
  if (open.length) {
    for (const b of open) api(session, "block.close", { block_id: b.block });
    return { ok: true, value: "closed" };
  }
  const tiled = (win.layers ?? []).find((l) => l.kind === "tiled");
  const anchor = tiled?.layout?.split?.split_id ?? tiled?.layout?.block_id;
  if (!anchor) return { ok: false, error: "no tiled pane to split" };
  const cells = windowCells(session, win);
  const ratio = Math.max(0.1, Math.min(0.4, 36 / cells.cols));
  return api(session, "session.new_split", {
    anchor_id: anchor, direction: "horizontal", side: "before", ratio, focus: false, layout: { block: command("sidebar") },
  });
}
