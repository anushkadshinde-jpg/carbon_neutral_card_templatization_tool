// PNG exporter. Browsers write PNGs without DPI or colour-space metadata, so
// we add a pHYs chunk (print resolution) and an sRGB chunk ourselves.

import { canvasToBlob } from '../util.js';

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const out = new Uint8Array(12 + data.length);
  const view = new DataView(out.buffer);
  view.setUint32(0, data.length);
  for (let i = 0; i < 4; i++) out[4 + i] = type.charCodeAt(i);
  out.set(data, 8);
  view.setUint32(8 + data.length, crc32(out.subarray(4, 8 + data.length)));
  return out;
}

export function withPngMetadata(pngBytes, dpi) {
  const ppm = Math.round(dpi / 0.0254);
  const phys = new Uint8Array(9);
  const dv = new DataView(phys.buffer);
  dv.setUint32(0, ppm);
  dv.setUint32(4, ppm);
  phys[8] = 1; // unit: metre
  const srgb = new Uint8Array([0]); // perceptual rendering intent

  // Signature (8) + IHDR chunk (25) come first; insert ours right after.
  const head = pngBytes.subarray(0, 33);
  const rest = pngBytes.subarray(33);
  const extra = [chunk('sRGB', srgb), chunk('pHYs', phys)];
  const size = head.length + rest.length + extra.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(size);
  let o = 0;
  out.set(head, o); o += head.length;
  for (const c of extra) { out.set(c, o); o += c.length; }
  out.set(rest, o);
  return out;
}

export const pngExporter = {
  id: 'png',
  label: 'PNG',
  ext: 'png',
  description: 'Current vendor preference. One image per card at exact print size.',
  async exportCard(canvas, { dpi }) {
    const blob = await canvasToBlob(canvas, 'image/png');
    const bytes = new Uint8Array(await blob.arrayBuffer());
    return new Blob([withPngMetadata(bytes, dpi)], { type: 'image/png' });
  },
};
