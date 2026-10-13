import type { Project, Pt, Sheet } from './model';
import type { PDFPageProxy } from './pdf';
import { measurementVars, primaryOf, primaryUnit } from './quantities';
import { formatQty } from './units';

const centroid = (pts: Pt[]): Pt => [pts.reduce((n, p) => n + p[0], 0) / pts.length, pts.reduce((n, p) => n + p[1], 0) / pts.length];

/**
 * The sheet as a PNG with its takeoffs drawn over it, coloured by type, and a legend
 * with each type's total on this sheet: for sending a sub or a reviewer what was taken off.
 */
export async function sheetImage(page: PDFPageProxy, sheet: Sheet, project: Project): Promise<Blob> {
  const base = page.getViewport({ scale: 1 });
  // About 4000 px across: sharp enough to read, small enough to email.
  const scale = Math.min(2, 4000 / Math.max(base.width, base.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(base.width * scale);
  canvas.height = Math.ceil(base.height * scale);
  await page.render({ canvas, viewport: page.getViewport({ scale }) }).promise;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);

  const types = new Map(project.types.map((t) => [t.id, t]));
  const ms = project.measurements.filter((m) => m.sheetId === sheet.id && types.has(m.typeId));
  const px = 1 / scale;
  const ring = (pts: Pt[]) => {
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
    ctx.closePath();
  };
  const labels: { at: Pt; text: string }[] = [];
  for (const m of ms) {
    const type = types.get(m.typeId)!;
    ctx.strokeStyle = type.color;
    ctx.fillStyle = type.color;
    const v = measurementVars(m, type, sheet, project.units);
    const qty = v ? `${formatQty(primaryOf(type.kind, v))} ${primaryUnit(type.kind, project.units)}` : '';
    if (type.kind === 'count') {
      ctx.beginPath();
      ctx.arc(m.points[0][0], m.points[0][1], 7 * px * 2, 0, Math.PI * 2);
      ctx.globalAlpha = 0.85;
      ctx.fill();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5 * px * 2;
      ctx.strokeStyle = '#fff';
      ctx.stroke();
    } else if (type.kind === 'linear') {
      ctx.beginPath();
      ctx.moveTo(m.points[0][0], m.points[0][1]);
      for (const p of m.points.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.lineWidth = 3 * px * 2;
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      ctx.globalAlpha = 0.85;
      ctx.stroke();
      ctx.globalAlpha = 1;
    } else {
      ctx.beginPath();
      ring(m.points);
      for (const h of m.holes) ring(h);
      ctx.globalAlpha = 0.28;
      ctx.fill('evenodd');
      ctx.globalAlpha = 1;
      ctx.lineWidth = 1.5 * px * 2;
      ctx.stroke();
      labels.push({ at: centroid(m.points), text: m.label ? `${m.label.split(' ')[0]} · ${qty}` : qty });
    }
  }
  // Labels on top, white-edged so they read over the linework.
  ctx.font = `600 ${11 * px * 2}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of labels) {
    ctx.lineWidth = 3 * px * 2;
    ctx.strokeStyle = '#fff';
    ctx.strokeText(l.text, l.at[0], l.at[1]);
    ctx.fillStyle = '#111';
    ctx.fillText(l.text, l.at[0], l.at[1]);
  }

  // Legend: each type on this sheet with its total.
  const rows = project.types.flatMap((t) => {
    const mine = ms.filter((m) => m.typeId === t.id);
    if (!mine.length) return [];
    let total = 0;
    for (const m of mine) {
      const v = measurementVars(m, t, sheet, project.units);
      if (v) total += primaryOf(t.kind, v);
    }
    // As drawn on this sheet; a typical floor's multiple is noted, the totals elsewhere include it.
    const times = sheet.repeat && sheet.repeat > 1 ? ` (×${sheet.repeat} in totals)` : '';
    return [{ color: t.color, text: `${t.name}`, qty: `${formatQty(total)} ${primaryUnit(t.kind, project.units)}${times}` }];
  });
  if (rows.length) {
    const f = 11 * px * 2;
    const lh = f * 1.6;
    const pad = f;
    const head = `${project.name} · ${sheet.name}${sheet.scaleLabel ? ` · ${sheet.scaleLabel}` : ''} · ${new Date().toLocaleDateString()}`;
    ctx.font = `${f}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    const width = Math.max(ctx.measureText(head).width, ...rows.map((r) => ctx.measureText(`${r.text}    ${r.qty}`).width + f * 1.8)) + pad * 2;
    const height = lh * (rows.length + 1) + pad * 2;
    const x0 = pad * 2;
    const y0 = base.height - height - pad * 2;
    ctx.globalAlpha = 0.94;
    ctx.fillStyle = '#fff';
    ctx.fillRect(x0, y0, width, height);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = px;
    ctx.strokeRect(x0, y0, width, height);
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#111';
    ctx.font = `600 ${f}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    ctx.fillText(head, x0 + pad, y0 + pad + lh / 2);
    ctx.font = `${f}px -apple-system, "Helvetica Neue", Arial, sans-serif`;
    rows.forEach((r, i) => {
      const y = y0 + pad + lh * (i + 1.5);
      ctx.fillStyle = r.color;
      ctx.beginPath();
      ctx.arc(x0 + pad + f * 0.5, y, f * 0.4, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#111';
      ctx.textAlign = 'left';
      ctx.fillText(r.text, x0 + pad + f * 1.4, y);
      ctx.textAlign = 'right';
      ctx.fillText(r.qty, x0 + width - pad, y);
    });
  }
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not make the image.'))), 'image/png'));
}

