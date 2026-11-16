// What the dialogs share with the sidebar: the housing-red plate with the lens, a title in
// the pixel font and the status lights, over the pink rule, and a red column down each side so
// the screen sits in a red frame (the footer closes it). Returns the first free row.
import { C, art, len } from "../term.js";

const plain = { crop: false };

export function plate(s, title, onClose) {
  const W = s.cols;
  s.fill(0, 0, W, 3, C.red, C.cream);
  s.image("lens", art("lens"), 1, 0, 4, 2, plain);
  // Twice the letter size when the title fits beside the lights and the close button.
  const big = 6 + len(title) * 2 + 18 <= W;
  s.pixel("title", 6, 0, title, "cream", big ? 2 : 1);
  if (W >= 30) {
    s.image("l1", art("light-off"), W - 16, 0, 2, 1, plain);
    s.image("l2", art("light-cyan"), W - 14, 0, 2, 1, plain);
    s.image("l3", art("light-lcd"), W - 12, 0, 2, 1, plain);
  }
  s.fill(W - 8, 0, 7, 1, C.redDark, C.cream);
  s.pixel("close", W - 7, 0, "ESC x", "cream");
  if (onClose) s.hit(W - 8, 0, 7, 1, onClose);
  s.put(0, 2, "▁".repeat(W), { fg: C.pink });
  s.fill(0, 3, 1, s.rows - 3, C.red, C.cream);
  s.fill(W - 1, 3, 1, s.rows - 3, C.red, C.cream);
  return 3;
}

// A section label on the dark green screen, with a rule to the right edge.
export function section(s, slot, x, y, label, w) {
  const used = s.pixel(slot, x, y, label, "cream");
  if (w - used - 1 > 0) s.put(x + used + 1, y, "─".repeat(w - used - 1), { fg: C.band });
}
