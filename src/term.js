// A small terminal UI kit: a cell buffer with true color, kitty-graphics pictures placed on
// cell boxes, keyboard and mouse input, and a redraw loop. No dependencies.
import fs from "node:fs";
import { STATE_DIR } from "./herdr.js";
import { cropSquare } from "./png.js";

// The Pokedex device palette, from pokemon-herdr's layout.
export const C = {
  red: "#9b293a", redDark: "#641b2b", body: "#812535", pink: "#e8797d", rose: "#f3bfba", cream: "#f7eed7",
  lcd: "#d9e8bc", lcdDim: "#b9cc9b", green: "#244438", band: "#355746", ink: "#17251f", cyan: "#71d5df",
  lens: "#298eaa", yellow: "#ffcc67", amber: "#ffd07a", gold: "#e8c35a", flame: "#b4472f", mute: "#819788",
  soft: "#b6c6b8", off: "#6e2930", done: "#b9dc92",
};

const rgb = (hex) => `${parseInt(hex.slice(1, 3), 16)};${parseInt(hex.slice(3, 5), 16)};${parseInt(hex.slice(5, 7), 16)}`;
const ESC = "\x1b";

export const clip = (text, w) => {
  const chars = [...String(text ?? "")];
  if (w <= 0) return "";
  return chars.length <= w ? chars.join("") : `${chars.slice(0, Math.max(0, w - 1)).join("")}…`;
};
export const pad = (text, w) => {
  const s = clip(text, w);
  return s + " ".repeat(Math.max(0, w - [...s].length));
};
export const len = (text) => [...String(text ?? "")].length;
export const ago = (ms) => {
  const m = Math.floor(ms / 60000);
  if (m < 1) return "<1m";
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h` : `${Math.floor(h / 24)}d`;
};
export const wrap = (text, w, max = 3) => {
  const lines = [];
  let line = "";
  for (const word of String(text ?? "").split(/\s+/).filter(Boolean)) {
    if (len(line) + len(word) + (line ? 1 : 0) > w && line) {
      lines.push(line);
      line = word;
    } else line = line ? `${line} ${word}` : word;
  }
  if (line) lines.push(line);
  return lines.slice(0, max).map((l) => clip(l, w));
};

export class Screen {
  constructor(out = process.stdout) {
    this.out = out;
    this.cols = out.columns || 80;
    this.rows = out.rows || 24;
    this.prevRows = [];
    this.images = new Map(); // file -> image id
    this.slots = new Map(); // slot -> { id, pid, sig }
    this.pids = new Map(); // slot -> placement id, kept so a redrawn picture replaces itself
    this.sent = new Set(); // image ids the terminal has been given since the last refresh
    this.wanted = new Map();
    this.nextImage = 1;
    this.nextPlacement = 1;
    this.phase = 0;
    this.hits = [];
    this.cells = [];
  }
  start() {
    this.out.write(`${ESC}[?1049h${ESC}[?25l${ESC}[?1000h${ESC}[?1006h${ESC}[?1004h${ESC}[2J`);
  }
  stop() {
    this.out.write(`${ESC}_Ga=d,d=A,q=2${ESC}\\${ESC}[?1004l${ESC}[?1006l${ESC}[?1000l${ESC}[?25h${ESC}[?1049l`);
  }
  resize() {
    this.cols = this.out.columns || 80;
    this.rows = this.out.rows || 24;
    this.out.write(`${ESC}_Ga=d,d=a,q=2${ESC}\\${ESC}[2J`);
    this.refresh();
  }
  // Forget what the terminal is believed to show, so the next flush sends everything again:
  // text, picture data and placements. Rex can drop a pane's pictures when its tab is hidden
  // and shown again (after a teleport, say) without telling the program, so views call this
  // on a timer and whenever the pane is resized or focused. Ids stay the same, so pictures
  // that are still there are replaced in place.
  refresh() {
    this.prevRows = [];
    this.slots.clear();
    this.sent.clear();
  }
  begin(bg = C.red, fg = C.cream) {
    this.base = { bg, fg };
    this.cells = Array.from({ length: this.rows }, () => Array.from({ length: this.cols }, () => ({ ch: " ", fg, bg, bold: false })));
    this.wanted = new Map();
    this.hits = [];
  }
  // Text at a cell. Style keys left out keep what the cell already has (its background, mostly).
  put(x, y, text, style = {}) {
    if (y < 0 || y >= this.rows) return;
    let i = 0;
    for (const ch of String(text)) {
      const cx = x + i++;
      if (cx < 0 || cx >= this.cols) continue;
      const cell = this.cells[y][cx];
      cell.ch = ch;
      if (style.fg) cell.fg = style.fg;
      if (style.bg) cell.bg = style.bg;
      cell.bold = !!style.bold;
    }
  }
  fill(x, y, w, h, bg, fg) {
    for (let r = Math.max(0, y); r < Math.min(this.rows, y + h); r++) {
      for (let c = Math.max(0, x); c < Math.min(this.cols, x + w); c++) {
        const cell = this.cells[r][c];
        cell.ch = " ";
        cell.bg = bg;
        if (fg) cell.fg = fg;
        cell.bold = false;
      }
    }
  }
  // A horizontal meter of `w` cells.
  bar(x, y, w, into, on, off) {
    const n = Math.round(Math.max(0, Math.min(1, into)) * w);
    this.put(x, y, "━".repeat(n), { fg: on });
    this.put(x + n, y, "━".repeat(Math.max(0, w - n)), { fg: off });
  }
  // A picture over a box of cells. `slot` names the place so a moved picture replaces itself.
  // The art is cropped square around its opaque pixels; `dy` nudges it down by pixels (bobbing).
  image(slot, file, x, y, cols, rows, { dy = 0, crop = true, min = 40 } = {}) {
    if (x < 0 || y < 0 || x + cols > this.cols || y + rows > this.rows) return;
    this.wanted.set(slot, { file, x, y, cols, rows, dy, crop: crop ? cropSquare(file, min) : null });
  }
  // A clickable box: `fn(ev)` runs on a mouse press inside it. Later boxes win.
  hit(x, y, w, h, fn) {
    this.hits.push({ x, y, w, h, fn });
  }
  click(ev) {
    for (let i = this.hits.length - 1; i >= 0; i--) {
      const h = this.hits[i];
      if (ev.x >= h.x && ev.x < h.x + h.w && ev.y >= h.y && ev.y < h.y + h.h) return h.fn(ev), true;
    }
    return false;
  }
  flush() {
    let out = "";
    this.pending = "";
    for (let y = 0; y < this.rows; y++) {
      let line = "", last = "";
      for (const cell of this.cells[y]) {
        const style = `${cell.bold ? "1" : "22"};38;2;${rgb(cell.fg)};48;2;${rgb(cell.bg)}`;
        if (style !== last) {
          line += `${ESC}[${style}m`;
          last = style;
        }
        line += cell.ch;
      }
      if (line !== this.prevRows[y]) {
        out += `${ESC}[${y + 1};1H${line}`;
        this.prevRows[y] = line;
      }
    }
    for (const [slot, old] of this.slots) {
      const want = this.wanted.get(slot);
      if (want && sig(want) === old.sig) continue;
      out += `${ESC}_Ga=d,d=i,i=${old.id},p=${old.pid},q=2${ESC}\\`;
      this.slots.delete(slot);
    }
    for (const [slot, want] of this.wanted) {
      if (this.slots.has(slot)) continue;
      const id = this.load(want.file);
      if (!id) continue;
      out += this.pending; // the picture's data, when the terminal doesn't have it yet
      this.pending = "";
      if (!this.pids.has(slot)) this.pids.set(slot, this.nextPlacement++);
      const pid = this.pids.get(slot);
      const crop = want.crop ? `,x=${want.crop.x},y=${want.crop.y},w=${want.crop.w},h=${want.crop.h}` : "";
      // z=-1 draws under text, so marks written on the same cells stay readable.
      out += `${ESC}[${want.y + 1};${want.x + 1}H${ESC}_Ga=p,i=${id},p=${pid},c=${want.cols},r=${want.rows}${crop}${want.dy ? `,Y=${want.dy}` : ""},z=-1,C=1,q=2${ESC}\\`;
      this.slots.set(slot, { id, pid, sig: sig(want) });
    }
    if (out) this.out.write(`${ESC}[?2026h${out}${ESC}[0m${ESC}[?2026l`);
  }
  // Sends a PNG to the terminal; placements refer to it by id afterwards. Returns the escape
  // text to send (empty when the terminal already has it) and the id.
  load(file) {
    let id = this.images.get(file);
    if (id === 0) return 0;
    if (id && this.sent.has(id)) return id;
    let data;
    try {
      data = fs.readFileSync(file).toString("base64");
    } catch {
      this.images.set(file, 0);
      return 0;
    }
    id ??= this.nextImage++;
    let out = "";
    for (let at = 0; at < data.length; at += 4096) {
      const more = at + 4096 < data.length ? 1 : 0;
      out += `${ESC}_G${at === 0 ? `a=t,f=100,i=${id},q=2,` : ""}m=${more};${data.slice(at, at + 4096)}${ESC}\\`;
    }
    this.pending += out;
    this.images.set(file, id);
    this.sent.add(id);
    return id;
  }
}
const sig = (w) => `${w.file}:${w.x}:${w.y}:${w.cols}:${w.rows}:${w.dy}:${w.crop ? `${w.crop.x},${w.crop.y},${w.crop.w}` : ""}`;

// Turns raw terminal input into events: { key } for keys, { mouse, x, y, button } for presses.
const KEYS = { "[A": "up", "[B": "down", "[C": "right", "[D": "left", "[H": "home", "[F": "end", "[5~": "pageup", "[6~": "pagedown", "[Z": "shift+tab", OA: "up", OB: "down", OC: "right", OD: "left" };
export function parseInput(data) {
  const events = [];
  let s = data;
  while (s.length) {
    let m;
    if ((m = /^\x1b\[<(\d+);(\d+);(\d+)([Mm])/.exec(s))) {
      const b = Number(m[1]);
      if (b & 64) events.push({ wheel: b & 1 ? 1 : -1, x: Number(m[2]) - 1, y: Number(m[3]) - 1 });
      else if (m[4] === "M" && !(b & 32)) events.push({ mouse: true, button: b & 3, x: Number(m[2]) - 1, y: Number(m[3]) - 1 });
      s = s.slice(m[0].length);
    } else if ((m = /^\x1b(\[[0-9;?]*[A-Za-z~]|O[A-D])/.exec(s))) {
      if (KEYS[m[1]]) events.push({ key: KEYS[m[1]] });
      else if (m[1] === "[I") events.push({ focus: true });
      s = s.slice(m[0].length);
    } else if ((m = /^\x1b[_P\]][^\x1b\x07]*(\x1b\\|\x07)/.exec(s))) {
      s = s.slice(m[0].length); // a terminal reply (graphics, colors): not for us
    } else if (s[0] === ESC) {
      events.push({ key: "escape" });
      s = s.slice(1);
    } else {
      const ch = [...s][0];
      const code = ch.codePointAt(0);
      if (ch === "\r" || ch === "\n") events.push({ key: "enter" });
      else if (ch === "\t") events.push({ key: "tab" });
      else if (code === 127 || code === 8) events.push({ key: "backspace" });
      else if (code === 3) events.push({ key: "ctrl+c" });
      else if (code === 4) events.push({ key: "ctrl+d" });
      else if (code >= 32) events.push({ key: ch, char: ch });
      s = s.slice(ch.length);
    }
  }
  return events;
}

// Runs a view: `render(screen)` draws a frame; `onEvent(ev)` handles a key, wheel or click that
// no hit box took. The frame is redrawn after input, when state files change, and every tick
// (the tick flips screen.phase, which is all the animation there is).
export function runApp({ render, onEvent, tick = 500, onTick }) {
  const screen = new Screen();
  let closed = false;
  const draw = () => {
    if (closed) return;
    try {
      screen.begin();
      render(screen);
      screen.flush();
    } catch (error) {
      quit(1, error);
    }
  };
  const quit = (code = 0, error = null) => {
    if (closed) return;
    closed = true;
    screen.stop();
    try { process.stdin.setRawMode?.(false); } catch {}
    if (error) console.error(error);
    process.exit(code);
  };
  if (!process.stdout.isTTY || !process.stdin.isTTY) {
    console.error("pokedex: this view needs a terminal");
    process.exit(1);
  }
  process.stdin.setRawMode(true);
  process.stdin.resume();
  screen.start();
  process.stdin.on("data", (d) => {
    for (const ev of parseInput(d.toString("utf8"))) {
      if (ev.key === "ctrl+c") return quit();
      if (ev.focus) { screen.refresh(); continue; }
      if (ev.mouse && screen.click(ev)) continue;
      onEvent?.(ev, screen);
    }
    draw();
  });
  process.stdout.on("resize", () => { screen.resize(); draw(); });
  process.on("SIGTERM", () => quit());
  process.on("SIGHUP", () => quit());
  let pending = null;
  try {
    fs.watch(STATE_DIR, () => {
      pending ??= setTimeout(() => { pending = null; draw(); }, 60);
    });
  } catch {}
  let ticks = 0;
  setInterval(() => {
    screen.phase ^= 1;
    if (++ticks % Math.max(1, Math.round(2500 / tick)) === 0) screen.refresh();
    onTick?.(screen);
    draw();
  }, tick);
  draw();
  return { screen, draw, quit };
}
