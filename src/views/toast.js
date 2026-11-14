// Pokedex news as a small floating pane: level-ups, evolutions, badges, quests, items.
// It shows every fresh note and closes itself when the last one is old.
import { notes, sprite, NOTE_MS } from "../core.js";
import { C, runApp, clip, wrap } from "../term.js";

const TINT = { success: C.done, warning: C.amber, info: C.cyan };

export function runToast() {
  const started = Date.now();
  function render(s) {
    const W = s.cols, H = s.rows;
    const now = Date.now();
    const fresh = notes().filter((n) => !n.encounter && now - n.at < NOTE_MS).slice(-Math.max(1, Math.floor(H / 3)));
    if (!fresh.length) {
      if (now - started > 1500) app.quit();
      return;
    }
    s.fill(0, 0, W, H, C.ink, C.lcd);
    const each = Math.floor(H / fresh.length);
    fresh.reverse().forEach((n, i) => {
      const y = i * each;
      s.fill(0, y, 1, each, TINT[n.level] ?? C.cyan);
      let x = 2;
      if (n.id && each >= 3) {
        s.fill(2, y, 6, 3, C.lcd, C.ink);
        s.image(`n:${n.at}`, sprite(n.id), 2, y, 6, 3);
        x = 9;
      }
      s.put(x, y, clip(n.title, W - x - 1), { fg: C.cream, bold: true });
      wrap(n.body, W - x - 1, each - 1).forEach((line, k) => s.put(x, y + 1 + k, line, { fg: C.soft }));
    });
  }
  const app = runApp({ render, onEvent: (ev) => { if (ev.key || ev.mouse) app.quit(); }, tick: 500 });
}
