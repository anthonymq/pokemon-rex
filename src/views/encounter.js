// The tall grass: the wild Pokemon waiting for you (up to five, a day each), as a battle card
// that floats over the window. Pick one, throw a ball or run; closing leaves them waiting.
import { game, nameOf, throwRate, ITEMS, ENCOUNTER_MS, WILD_MAX } from "../game.js";
import { call } from "../client.js";
import { sprite, wildNow } from "../core.js";
import { C, runApp, clip, len } from "../term.js";

const BALLS = [["poke", "Poke Ball"], ["great", "Great Ball"], ["ultra", "Ultra Ball"]];
const same = (a, b) => a && b && a.id === b.id && a.at === b.at;
const until = (ms) => (ms >= 3600000 ? `${Math.floor(ms / 3600000)} H ${Math.floor((ms % 3600000) / 60000)} M` : `${Math.max(1, Math.ceil(ms / 60000))} M`);

export function runEncounter() {
  if (!wildNow(game()).length) {
    console.log("The tall grass is empty.");
    setTimeout(() => process.exit(0), 1200);
    return;
  }
  let pick = wildNow(game())[0]; // the chosen Pokemon, followed by identity: the queue moves under it
  let result = null; // { text, id }
  let note = "";
  let busy = false; // one ball in the air at a time

  // The chosen one's place in the queue now (what throwBall and runAway take), or -1 once it's gone.
  const indexOf = () => wildNow(game()).findIndex((e) => same(e, pick));
  const select = (i) => {
    const wild = wildNow(game());
    if (!wild.length) return;
    pick = wild[(i + wild.length) % wild.length];
    note = "";
  };
  // A result stays on the card a moment, then the next waiting Pokemon is up, or the card closes.
  const finish = (text, id) => {
    result = { text, id };
    setTimeout(() => {
      result = null;
      if (wildNow(game()).length) select(0);
      else app.quit();
    }, 2200);
  };

  function toss(ball) {
    if (result || busy) return;
    const index = indexOf();
    if (index < 0) return select(0);
    const id = pick.id;
    busy = true;
    call("throwBall", ball, index).then((outcome) => {
      if (outcome === "caught") finish(`Gotcha! ${nameOf(id)} was caught!`, id);
      else if (outcome === "fled") finish(`${nameOf(id)} fled!`, id);
      else if (outcome === "gone") finish(`${nameOf(id)} is gone.`, id);
      else if (outcome === "empty") note = `No ${ball === "poke" ? "Poke Balls" : ITEMS[ball].name + "s"} left.`;
      else note = `${nameOf(id)} broke free!`;
    }, (error) => { note = error.message; }).finally(() => { busy = false; });
  }
  function run() {
    if (result || busy) return;
    const index = indexOf();
    if (index < 0) return select(0);
    const id = pick.id;
    busy = true;
    call("runAway", index).then(() => finish(`Got away from ${nameOf(id)}.`, id), (error) => { note = error.message; }).finally(() => { busy = false; });
  }

  function render(s) {
    const W = s.cols, H = s.rows;
    const g = game();
    const now = Date.now();
    const wild = wildNow(g, now);
    // Caught from another window, or it waited too long: the next one is up.
    if (!result && !busy && indexOf() < 0) {
      if (!wild.length) return app.quit();
      select(0);
    }
    const e = wild.find((w) => same(w, pick)) ?? pick;
    const id = result?.id ?? e.id;
    s.fill(0, 0, W, H, C.red, C.ink);
    s.fill(1, 1, W - 2, H - 2, C.cream, C.ink);
    const top = H - 5; // rows above the tall grass strip
    const sw = Math.min(16, Math.max(8, Math.floor(W / 3) & ~1)), sh = sw / 2;
    const sy = Math.max(1, Math.floor((top - sh) / 2));
    s.image("wild", sprite(id), 3, sy, sw, sh, { dy: !result && s.phase ? 5 : 0 });
    const tx = sw + 6, tw = W - tx - 3;

    // The tall grass: one tile per waiting Pokemon, the chosen one underlined. Click to choose.
    s.pixel("grass", 3, top, clip(`TALL GRASS ${wild.length}/${WILD_MAX}`, W - 6), "band");
    wild.forEach((w, i) => {
      const x = 3 + i * 5, on = same(w, pick);
      s.fill(x, top + 1, 4, 2, on ? C.gold : C.lcd, C.ink);
      s.image(`q:${w.id}:${w.at}`, sprite(w.id), x, top + 1, 4, 2);
      if (on) s.put(x, top + 3, "▀".repeat(4), { fg: C.green });
      s.hit(x, top + 1, 4, 2, () => { if (!result) select(i); });
    });
    const hx = 3 + WILD_MAX * 5;
    if (W - hx - 2 > 6) {
      s.pixel("keys1", hx, top + 1, clip("← → CHOOSE", W - hx - 2), "band");
      s.pixel("keys2", hx, top + 2, clip("Q CLOSE", W - hx - 2), "band");
    }

    if (result) {
      s.pixel("result", tx, sy + 1, clip(result.text.toUpperCase(), tw), "ink");
      return;
    }
    s.pixel("wild", tx, 2, "WILD POKEMON", "band");
    s.pixel("name", tx, 3, clip(nameOf(id).toUpperCase(), tw), "ink");
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
    s.pixel("left", tx, top - 1, clip(`LEAVES IN ${until(ENCOUNTER_MS - (now - e.at))}`, tw), "band");
  }
  function onEvent(ev) {
    if (ev.key === "1" || ev.key === "enter" || ev.key === " ") toss("poke");
    else if (ev.key === "2") toss("great");
    else if (ev.key === "3") toss("ultra");
    else if (ev.key === "r") run();
    else if (!result && (ev.key === "right" || ev.key === "l" || ev.key === "tab")) select(Math.max(0, indexOf()) + 1);
    else if (!result && (ev.key === "left" || ev.key === "h")) select(Math.max(0, indexOf()) - 1);
    else if (ev.key === "escape" || ev.key === "q") app.quit();
  }
  const app = runApp({ render, onEvent, tick: 400 });
}
