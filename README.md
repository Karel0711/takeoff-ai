# Takeoff AI

An AI-native construction takeoff tool for general contractors. It runs in your
browser on your own computer: drawings and takeoffs are stored locally and
nothing is uploaded anywhere.

## Status

**Phase 1 — manual takeoff (done)**

- Upload PDF drawing sets; every page becomes a sheet.
- Sheet numbers (A2.1, A0.3, …) are read from the title block automatically.
- Drawing scales (1:100, 1:50, …) are detected from the sheet text and applied
  when a sheet has exactly one; detected scales are flagged "verify".
- Set scales from metric or imperial presets, or calibrate from a known dimension.
- Area (with cutouts), linear and count measurements, coloured by takeoff type.
- Assemblies: each takeoff type has material lines driven by formulas, e.g.
  studs = `ceil(L / 0.61) + N`, drywall = `2 * A * 1.1`.
- Live quantities panel and Excel export (Summary, Assemblies, Detail).
- Metric (m, m²) or imperial (ft, SF) projects.

**Phase 2 — AI setup (next):** read wall-type legends and finish schedules into
assemblies, sheet titles, scale verification.

**Phase 3 — AI takeoff:** walls by type from the plan tags and PDF vector lines,
rooms with finishes, all as suggestions you accept or correct.

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

## Using it

1. **Upload drawings** (top right). Sheets appear on the left with their scale.
2. Pick a sheet. If its scale says *no scale* or *verify*, choose one from the
   **Scale** menu or use **Calibrate**: click both ends of a known dimension and
   type its length (`3.5`, `3500mm`, `12'6"`).
3. Click a **takeoff type** on the left, then click on the drawing:
   - Area / linear: click points, double-click or press Enter to finish.
     Hold Shift for straight lines, Backspace removes the last point, Esc cancels.
   - Count: click each item.
4. To cut a hole out of an area: **Select**, click the area, **Cutout**, draw the hole.
5. Click ✎ on a type to edit its name, height and assembly formulas.
6. **Export Excel** when done.

Navigation: scroll to zoom, drag (in Select mode), middle-drag or Space-drag to
pan, F to fit the sheet. Delete removes the selected measurement.

### Assembly formula variables

| Variable | Meaning |
| --- | --- |
| `L` | total length of the type's linear measurements |
| `H` | the type's height |
| `A` | area: measured area for area types, `L × H` for linear types |
| `P` | perimeter of area measurements, including cutouts |
| `N` | number of measurements (runs, rooms or counted items) |

Functions: `ceil`, `floor`, `round`, `min`, `max`, `abs`.

## Development

```bash
npm test          # unit tests
npm run typecheck
npm run build
```

Code layout: `src/units.ts` (scales, units), `src/geometry.ts`,
`src/formula.ts` (safe formula evaluator), `src/quantities.ts` (rollups),
`src/sheetInfo.ts` (sheet number and scale detection), `src/exportExcel.ts`,
`src/components/Viewer.tsx` (PDF rendering and measuring tools).

PDF rendering uses the pdf.js *legacy* build because current pdf.js relies on
JavaScript features (`Math.sumPrecise`, `Map.prototype.getOrInsertComputed`)
that shipping browsers do not yet support.
