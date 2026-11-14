// A wild Pokemon: the battle card that floats over the window. Throw a ball or run;
// after 60 s it flees on its own.
import { locked } from "herdr";
import { game, nameOf, throwBall, runAway, throwRate, ITEMS, ENCOUNTER_MS } from "../game.js";
import { sprite } from "../core.js";
import { C, runApp, clip, len } from "../term.js";

const BALLS = [["poke", "Poke Ball"], ["great", "Great Ball"], ["ultra", "Ultra Ball"]];

export function runEncounter() {
  let result = null; // { text, at, id }
  const first = game().encounter;
  if (!first || Date.now() - first.at > ENCOUNTER_MS) {
    console.log("No wild Pokemon right now.");
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  const finish = (text, id) => {
    result = { text, at: Date.now(), id };
    setTimeout(() => app.quit(), 2200);
  };

  function toss(ball) {
    if (result) return;
    const e = game().encounter;
    const id = e?.id ?? first.id;
    const outcome = locked(() => throwBall(ball));
    if (outcome === "caught") finish(`Gotcha! ${nameOf(id)} was caught!`, id);
    else if (outcome === "fled") finish(`${nameOf(id)} fled!`, id);
    else if (outcome === "gone") finish(`${nameOf(id)} is gone.`, id);
    else if (outcome === "empty") note = `No ${ball === "poke" ? "Poke Balls" : ITEMS[ball].name + "s"} left.`;
    else note = `${nameOf(id)} broke free!`;
  }
  let note = "";

  function render(s) {
    const W = s.cols, H = s.rows;
    const g = game();
    const e = g.encounter;
    const now = Date.now();
    const id = result?.id ?? e?.id ?? first.id;
    // Someone else answered it (another window's card), or time ran out.
    if (!result && (!e || now - e.at > ENCOUNTER_MS)) {
      if (e) locked(() => throwBall("poke")); // counts it as fled
      finish(`${nameOf(id)} fled!`, id);
    }
    const frame = !result && s.phase ? C.gold : C.red;
    s.fill(0, 0, W, H, frame, C.ink);
    s.fill(1, 1, W - 2, H - 2, C.cream, C.ink);
    const sw = Math.min(16, Math.max(8, Math.floor(W / 3) & ~1)), sh = sw / 2;
    const sy = Math.max(1, Math.floor((H - sh) / 2));
    s.image("wild", sprite(id), 3, sy, sw, sh, { dy: !result && s.phase ? 5 : 0 });
    const tx = sw + 6, tw = W - tx - 3;
    if (result) {
      s.pixel("result", tx, sy + 1, clip(result.text.toUpperCase(), tw), "ink");
      return;
    }
    const left = Math.max(0, Math.ceil((ENCOUNTER_MS - (now - e.at)) / 1000));
    if (s.phase) s.pixel("bang", tx, 2, "!", "flame");
    s.pixel("wild", tx + 2, 2, "WILD POKEMON", "band");
    s.pixel("name", tx, 3, clip(`${nameOf(id).toUpperCase()} APPEARED!`, tw), "ink");
    s.pixel("odds", tx, 5, clip(`CATCH ${Math.round(throwRate(e) * 100)}%${e.weak ? ` WEAK x${e.weak}` : ""}`, tw), "band");
    let y = 6;
    BALLS.forEach(([ball, label], i) => {
      const n = ball === "poke" ? e.balls : g.bag[ball] ?? 0;
      if (ball !== "poke" && !n) return;
      const text = ` ${i + 1} ${label.toUpperCase()} x${n} ${ball === "poke" ? "" : `${Math.round(throwRate(e, ball) * 100)}% `}`;
      s.fill(tx, y, Math.min(tw, len(text)), 1, n ? C.green : C.band, C.cream);
      s.pixel(`ball:${ball}`, tx, y, clip(text, tw), "cream");
      s.hit(tx, y, Math.min(tw, len(text)), 1, () => toss(ball));
      y++;
    });
    s.fill(tx, y, 7, 1, C.lcdDim, C.ink);
    s.pixel("run", tx, y, " R RUN ", "ink");
    s.hit(tx, y, 7, 1, () => run());
    if (note) s.pixel("note", tx, y + 1, clip(note.toUpperCase(), tw), "flame");
    const late = left <= 10;
    s.pixel("left", tx, H - 3, clip(`${left} S BEFORE IT FLEES`, tw), late ? "flame" : "band");
    s.bar(tx, H - 2, tw, left / (ENCOUNTER_MS / 1000), late ? C.flame : C.gold, C.lcdDim);
  }
  function run() {
    if (result) return;
    const id = game().encounter?.id ?? first.id;
    locked(() => runAway());
    finish(`Got away from ${nameOf(id)}.`, id);
  }
  function onEvent(ev) {
    if (ev.key === "1" || ev.key === "enter" || ev.key === " ") toss("poke");
    else if (ev.key === "2") toss("great");
    else if (ev.key === "3") toss("ultra");
    else if (ev.key === "r" || ev.key === "escape" || ev.key === "q") run();
  }
  const app = runApp({ render, onEvent, tick: 400 });
}
