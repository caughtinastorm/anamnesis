import fs from 'fs';
import path from 'path';
import zlib from 'zlib';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

// --- CRC32 & PNG Encoding ---
function crc32(buf) {
  let table = new Int32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = ((c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1));
    }
    table[i] = c;
  }
  let crc = -1;
  for (let i = 0; i < buf.length; i++) {
    crc = (crc >>> 8) ^ table[(crc ^ buf[i]) & 0xFF];
  }
  return (crc ^ (-1)) >>> 0;
}

function createChunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const typeBuf = Buffer.from(type, 'ascii');
  const body = Buffer.concat([typeBuf, data]);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crcBuf]);
}

function encodePNG(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0; // compression
  ihdr[11] = 0; // filter
  ihdr[12] = 0; // interlace
  const ihdrChunk = createChunk('IHDR', ihdr);

  const stride = width * 4;
  const rawData = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    const rowOffset = y * (stride + 1);
    rawData[rowOffset] = 0; // filter None
    rgba.copy(rawData, rowOffset + 1, y * stride, (y + 1) * stride);
  }

  const compressed = zlib.deflateSync(rawData);
  const idatChunk = createChunk('IDAT', compressed);
  const iendChunk = createChunk('IEND', Buffer.alloc(0));

  return Buffer.concat([signature, ihdrChunk, idatChunk, iendChunk]);
}

function createICO(images) {
  // images: [{ width, height, data: Buffer }]
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0); // Reserved
  header.writeUInt16LE(1, 2); // ICO format
  header.writeUInt16LE(count, 4);

  let offset = 6 + count * 16;
  const entries = [];
  for (const img of images) {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(img.width === 256 ? 0 : img.width, 0);
    entry.writeUInt8(img.height === 256 ? 0 : img.height, 1);
    entry.writeUInt8(0, 2); // color count
    entry.writeUInt8(0, 3); // reserved
    entry.writeUInt16LE(1, 4); // planes
    entry.writeUInt16LE(32, 6); // bits per pixel
    entry.writeUInt32LE(img.data.length, 8); // size
    entry.writeUInt32LE(offset, 12); // offset
    entries.push(entry);
    offset += img.data.length;
  }

  return Buffer.concat([header, ...entries, ...images.map(img => img.data)]);
}

// --- 2D Pixel Buffer Drawing ---
class Canvas {
  constructor(size) {
    this.size = size;
    this.buffer = Buffer.alloc(size * size * 4, 0);
  }

  setPixel(x, y, r, g, b, a = 1.0) {
    if (x < 0 || x >= this.size || y < 0 || y >= this.size) return;
    const idx = (Math.floor(y) * this.size + Math.floor(x)) * 4;
    const srcA = a;
    const dstA = this.buffer[idx + 3] / 255;
    const outA = srcA + dstA * (1 - srcA);
    if (outA <= 0) return;

    const outR = Math.round((r * srcA + this.buffer[idx] * dstA * (1 - srcA)) / outA);
    const outG = Math.round((g * srcA + this.buffer[idx + 1] * dstA * (1 - srcA)) / outA);
    const outB = Math.round((b * srcA + this.buffer[idx + 2] * dstA * (1 - srcA)) / outA);

    this.buffer[idx] = Math.min(255, Math.max(0, outR));
    this.buffer[idx + 1] = Math.min(255, Math.max(0, outG));
    this.buffer[idx + 2] = Math.min(255, Math.max(0, outB));
    this.buffer[idx + 3] = Math.min(255, Math.max(0, Math.round(outA * 255)));
  }

  drawRoundedRect(rx, ry, rw, rh, radius, fillColor, strokeColor = null, strokeWidth = 1) {
    for (let y = 0; y < this.size; y++) {
      for (let x = 0; x < this.size; x++) {
        const px = x + 0.5;
        const py = y + 0.5;
        
        // Compute SDF (signed distance field) to rounded rectangle
        const dx = Math.abs(px - (rx + rw / 2)) - (rw / 2 - radius);
        const dy = Math.abs(py - (ry + rh / 2)) - (rh / 2 - radius);
        const outsideDist = Math.hypot(Math.max(0, dx), Math.max(0, dy));
        const insideDist = Math.min(0, Math.max(dx, dy));
        const dist = outsideDist + insideDist - radius;

        if (dist <= 0.5) {
          const alpha = Math.min(1, Math.max(0, 0.5 - dist));
          // Gradient from top to bottom
          const t = y / this.size;
          const r = Math.round(fillColor.r1 * (1 - t) + fillColor.r2 * t);
          const g = Math.round(fillColor.g1 * (1 - t) + fillColor.g2 * t);
          const b = Math.round(fillColor.b1 * (1 - t) + fillColor.b2 * t);
          this.setPixel(x, y, r, g, b, alpha);
        }

        if (strokeColor && Math.abs(dist) <= strokeWidth / 2 + 0.5) {
          const strokeAlpha = Math.min(1, Math.max(0, 0.5 - Math.abs(dist) + strokeWidth / 2));
          this.setPixel(x, y, strokeColor.r, strokeColor.g, strokeColor.b, strokeAlpha);
        }
      }
    }
  }

  drawLine(x1, y1, x2, y2, color, thickness) {
    const minX = Math.floor(Math.min(x1, x2) - thickness);
    const maxX = Math.ceil(Math.max(x1, x2) + thickness);
    const minY = Math.floor(Math.min(y1, y2) - thickness);
    const maxY = Math.ceil(Math.max(y1, y2) + thickness);

    const lenSq = (x2 - x1) * (x2 - x1) + (y2 - y1) * (y2 - y1);
    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        let t = 0;
        if (lenSq > 0) {
          t = Math.max(0, Math.min(1, ((x - x1) * (x2 - x1) + (y - y1) * (y2 - y1)) / lenSq));
        }
        const projX = x1 + t * (x2 - x1);
        const projY = y1 + t * (y2 - y1);
        const dist = Math.hypot(x - projX, y - projY);
        if (dist <= thickness / 2 + 0.5) {
          const alpha = Math.min(1, Math.max(0, 0.5 - (dist - thickness / 2)));
          this.setPixel(x, y, color.r, color.g, color.b, alpha);
        }
      }
    }
  }
}

function renderIcon(size) {
  const canvas = new Canvas(size);
  const s = size / 32;

  // Background rounded square
  const pad = 0.5 * s;
  const radius = 7 * s;
  canvas.drawRoundedRect(
    pad, pad, size - pad * 2, size - pad * 2, radius,
    { r1: 28, g1: 29, b1: 34, r2: 11, g2: 12, b2: 16 },
    { r: 46, g: 48, b: 57 },
    1 * s
  );

  // Roof / Architrave
  canvas.drawLine(6 * s, 7.5 * s, 26 * s, 7.5 * s, { r: 244, g: 244, b: 246 }, 1.6 * s);
  canvas.drawLine(7.5 * s, 10 * s, 24.5 * s, 10 * s, { r: 209, g: 213, b: 219 }, 1.3 * s);

  // 4 Pillars of memory
  const blue = { r: 59, g: 130, b: 246 }; // #3b82f6
  const white = { r: 244, g: 244, b: 246 }; // #f4f4f6

  canvas.drawLine(9.5 * s, 11 * s, 9.5 * s, 21 * s, blue, 1.8 * s);
  canvas.drawLine(13.8 * s, 11 * s, 13.8 * s, 21 * s, white, 1.8 * s);
  canvas.drawLine(18.2 * s, 11 * s, 18.2 * s, 21 * s, white, 1.8 * s);
  canvas.drawLine(22.5 * s, 11 * s, 22.5 * s, 21 * s, blue, 1.8 * s);

  // Base / Plinth
  canvas.drawLine(7.5 * s, 22 * s, 24.5 * s, 22 * s, { r: 209, g: 213, b: 219 }, 1.3 * s);
  canvas.drawLine(5 * s, 24.5 * s, 27 * s, 24.5 * s, { r: 244, g: 244, b: 246 }, 1.6 * s);

  return canvas.buffer;
}

// Generate files
const sizes = [16, 32, 180, 192, 512];
const pngs = {};

for (const sz of sizes) {
  const rgba = renderIcon(sz);
  const png = encodePNG(sz, sz, rgba);
  pngs[sz] = png;
}

const iconsDir = path.join(rootDir, 'icons');
if (!fs.existsSync(iconsDir)) fs.mkdirSync(iconsDir, { recursive: true });

// Write PNGs
fs.writeFileSync(path.join(iconsDir, 'favicon-16x16.png'), pngs[16]);
fs.writeFileSync(path.join(iconsDir, 'favicon-32x32.png'), pngs[32]);
fs.writeFileSync(path.join(iconsDir, 'apple-touch-icon.png'), pngs[180]);
fs.writeFileSync(path.join(iconsDir, 'icon-192.png'), pngs[192]);
fs.writeFileSync(path.join(iconsDir, 'icon-512.png'), pngs[512]);

// Write ICO with 16x16 and 32x32 frames
const ico = createICO([
  { width: 16, height: 16, data: pngs[16] },
  { width: 32, height: 32, data: pngs[32] }
]);
fs.writeFileSync(path.join(rootDir, 'favicon.ico'), ico);
fs.writeFileSync(path.join(iconsDir, 'favicon.ico'), ico);

console.log('Successfully generated all browser favicons and app icons:');
console.log('  - favicon.svg (vector)');
console.log('  - favicon.ico (multi-res 16/32)');
console.log('  - icons/favicon-16x16.png');
console.log('  - icons/favicon-32x32.png');
console.log('  - icons/apple-touch-icon.png (180x180)');
console.log('  - icons/icon-192.png (192x192 true PNG)');
console.log('  - icons/icon-512.png (512x512 true PNG)');
