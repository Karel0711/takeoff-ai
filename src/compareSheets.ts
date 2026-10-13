import type { PDFPageProxy } from './pdf';

async function renderGray(page: PDFPageProxy, scale: number, w: number, h: number): Promise<Uint8ClampedArray> {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, w, h);
  await page.render({ canvas, viewport: page.getViewport({ scale }) }).promise;
  return ctx.getImageData(0, 0, w, h).data;
}

/**
 * Overlays two revisions of a sheet: linework only on the old one in red (removed),
 * only on the new one in blue (added), on both in light grey. Returns a PNG.
 */
export async function compareSheets(oldPage: PDFPageProxy, newPage: PDFPageProxy): Promise<Blob> {
  const base = newPage.getViewport({ scale: 1 });
  const scale = Math.min(2, 3000 / Math.max(base.width, base.height));
  const w = Math.ceil(base.width * scale);
  const h = Math.ceil(base.height * scale);
  const [a, b] = await Promise.all([renderGray(oldPage, scale, w, h), renderGray(newPage, scale, w, h)]);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const out = ctx.createImageData(w, h);
  const ink = (d: Uint8ClampedArray, i: number) => d[i] + d[i + 1] + d[i + 2] < 600;
  for (let i = 0; i < out.data.length; i += 4) {
    const inOld = ink(a, i);
    const inNew = ink(b, i);
    const [r, g, bl] = inOld && inNew ? [190, 190, 190] : inOld ? [225, 30, 30] : inNew ? [0, 90, 230] : [255, 255, 255];
    out.data[i] = r;
    out.data[i + 1] = g;
    out.data[i + 2] = bl;
    out.data[i + 3] = 255;
  }
  ctx.putImageData(out, 0, 0);
  return new Promise((resolve, reject) => canvas.toBlob((x) => (x ? resolve(x) : reject(new Error('Could not make the comparison.'))), 'image/png'));
}
