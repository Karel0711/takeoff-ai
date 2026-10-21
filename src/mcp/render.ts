import type { Project, Pt, Sheet } from '../model';
import type { PDFPageProxy } from '../pdf';

/**
 * Part of a sheet as a PNG (base64), `scale` pixels per sheet point, with its takeoffs drawn
 * over it in their types' colours: what an AI looks at to read the drawing and check its work.
 */
export async function renderRegion(page: PDFPageProxy, sheet: Sheet, project: Project, region: [number, number, number, number], scale: number, withTakeoffs: boolean): Promise<string> {
  const [x0, y0, x1, y1] = region;
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round((x1 - x0) * scale));
  canvas.height = Math.max(1, Math.round((y1 - y0) * scale));
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, viewport: page.getViewport({ scale }), transform: [1, 0, 0, 1, -x0 * scale, -y0 * scale] }).promise;
  if (withTakeoffs) {
    ctx.setTransform(scale, 0, 0, scale, -x0 * scale, -y0 * scale);
    const px = 1 / scale;
    const types = new Map(project.types.map((t) => [t.id, t]));
    const ring = (pts: Pt[]) => {
      ctx.moveTo(pts[0][0], pts[0][1]);
      for (const p of pts.slice(1)) ctx.lineTo(p[0], p[1]);
      ctx.closePath();
    };
    for (const m of project.measurements) {
      if (m.sheetId !== sheet.id || !m.points.length) continue;
      const t = types.get(m.typeId);
      if (!t) continue;
      ctx.strokeStyle = t.color;
      ctx.fillStyle = t.color;
      ctx.setLineDash(m.source === 'ai' ? [6 * px, 4 * px] : []);
      if (t.kind === 'count') {
        for (const p of m.points) {
          ctx.beginPath();
          ctx.arc(p[0], p[1], 6 * px, 0, Math.PI * 2);
          ctx.globalAlpha = 0.8;
          ctx.fill();
          ctx.globalAlpha = 1;
        }
      } else if (t.kind === 'linear') {
        ctx.beginPath();
        ctx.moveTo(m.points[0][0], m.points[0][1]);
        for (const p of m.points.slice(1)) ctx.lineTo(p[0], p[1]);
        ctx.lineWidth = 3 * px;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.globalAlpha = 1;
      } else {
        ctx.beginPath();
        ring(m.points);
        for (const h of m.holes) if (h.length) ring(h);
        ctx.globalAlpha = 0.25;
        ctx.fill('evenodd');
        ctx.globalAlpha = 1;
        ctx.lineWidth = 2 * px;
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);
  }
  return canvas.toDataURL('image/png').split(',')[1];
}
