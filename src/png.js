// Just enough PNG reading to find where a sprite's art is: its size and the box around its
// opaque pixels. The picture itself is drawn by the terminal (kitty graphics), not by us.
import fs from "node:fs";
import zlib from "node:zlib";

const CHANNELS = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
const cache = new Map();

export function pngInfo(file) {
  if (cache.has(file)) return cache.get(file);
  let info = null;
  try {
    info = read(fs.readFileSync(file));
  } catch {}
  cache.set(file, info);
  return info;
}

function read(buf) {
  let pos = 8, width = 0, height = 0, depth = 8, type = 6, interlace = 0, trns = null;
  const idat = [];
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos), kind = buf.toString("latin1", pos + 4, pos + 8), data = buf.subarray(pos + 8, pos + 8 + len);
    if (kind === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      depth = data[8];
      type = data[9];
      interlace = data[12];
    } else if (kind === "tRNS") trns = data;
    else if (kind === "IDAT") idat.push(data);
    pos += 12 + len;
  }
  const full = { width, height, box: { x: 0, y: 0, w: width, h: height } };
  // Without per-pixel transparency (or interlaced, which sprites aren't) the box is the picture.
  if (interlace || depth === 16 || type === 0 || type === 2) return full;
  const channels = CHANNELS[type];
  const bpp = Math.max(1, (channels * depth) >> 3), stride = Math.ceil((width * channels * depth) / 8);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const row = Buffer.alloc(stride), prev = Buffer.alloc(stride);
  let x0 = width, y0 = height, x1 = -1, y1 = -1;
  for (let y = 0; y < height; y++) {
    const at = y * (stride + 1), filter = raw[at];
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? row[i - bpp] : 0, b = prev[i], c = i >= bpp ? prev[i - bpp] : 0;
      let v = raw[at + 1 + i];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c, pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      row[i] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      let alpha;
      if (type === 3) {
        const bit = x * depth, index = (row[bit >> 3] >> (8 - depth - (bit & 7))) & ((1 << depth) - 1);
        alpha = trns && index < trns.length ? trns[index] : 255;
      } else alpha = row[x * channels + channels - 1];
      if (alpha > 16) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    row.copy(prev);
  }
  if (x1 < 0) return full;
  return { width, height, box: { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 } };
}

// A square crop around the art, at least `min` wide, kept inside the picture. Sprites have
// wide empty margins; cropping them lets a small cell box show the Pokemon, not the margin.
export function cropSquare(file, min = 40) {
  const info = pngInfo(file);
  if (!info) return null;
  const { width, height, box } = info;
  const side = Math.min(width, height, Math.max(min, box.w, box.h) + 2);
  const cx = box.x + box.w / 2, cy = box.y + box.h / 2;
  const x = Math.round(Math.max(0, Math.min(width - side, cx - side / 2)));
  // Keep feet on the ground: bias the crop to the art's bottom edge.
  const y = Math.round(Math.max(0, Math.min(height - side, Math.min(cy - side / 2, box.y + box.h + 1 - side))));
  return { x, y: Math.max(0, y), w: side, h: side };
}
