// Pokedex news as a small floating pane: level-ups, evolutions, badges, quests, items.
// It shows every fresh note that may pop up (not small news; a wild Pokemon only when the alert
// setting allows) and closes itself when the last one is old. The look matches pokemon-herdr's toasts:
// the dark screen in a red frame, a dot in the note's level colour before its title.
import { notes, sprite, toastable, NOTE_MS } from "../core.js";
import { C, runApp, clip, wrap } from "../term.js";

const TINT = { success: C.done, warning: C.amber, info: C.cyan };

export function runToast() {
  const started = Date.now();
  function render(s) {
    const W = s.cols, H = s.rows;
    const now = Date.now();
    const inner = Math.max(1, H - 2);
    const fresh = notes().filter((n) => now - n.at < NOTE_MS && toastable(n)).slice(-Math.max(1, Math.floor(inner / 3)));
    if (!fresh.length) {
      if (now - started > 1500) app.quit();
      return;
    }
    s.fill(0, 0, W, H, C.red, C.cream);
    s.fill(1, 1, W - 2, inner, C.green, C.cream);
    const each = Math.floor(inner / fresh.length);
    fresh.reverse().forEach((n, i) => {
      const y = 1 + i * each;
      let x = 3;
      if (n.id && each >= 3) {
        s.fill(3, y, 6, 3, C.lcd, C.ink);
        s.image(`n:${i}`, sprite(n.id), 3, y, 6, 3);
        x = 11;
      }
      s.put(x, y, "●", { fg: TINT[n.level] ?? C.cyan });
      s.pixel(`t:${i}`, x + 2, y, clip(n.title, W - x - 4), "cream");
      wrap(n.body, W - x - 2, each - 1).forEach((line, k) => s.put(x + 2, y + 1 + k, line, { fg: C.soft }));
    });
  }
  const app = runApp({ render, onEvent: (ev) => { if (ev.key || ev.mouse) app.quit(); }, tick: 500 });
}
