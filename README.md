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
- Live quantities panel and Excel export in the estimator's bid workbook layout:
  a Bid Summary (cost per division, editable markup, totals) linked to one tab
  per division with the columns Mark … Notes, blue GROUP rows per subtrade
  package, imperial pricing formulas, yellow input cells for rates, Height and
  Incl?, and a subtotal that skips GROUP rows; plus assembly materials and every
  measurement. Each takeoff type has an estimate division and subtrade package.
- Metric (m, m²) or imperial (ft, SF) projects.

**Phase 2 — AI setup (in progress)**

- **Read assembly types (done):** on a wall/floor/roof type legend sheet, click
  **✦ Read assembly types**. Claude reads every type (W1, EW3C, F1, R1, …) and
  its layers; you review them and add the ones you want as takeoff types with
  assembly items built from the layers (studs and track from framing spacing,
  board and membranes with 10% waste, slab and fill volumes, and so on). Tags
  printed on the sheet that the AI did not return are flagged, so nothing is
  silently missed. A type whose tag already exists is updated in place and keeps
  its measurements.
- **Score the AI (done):** after reading a legend, **Score against bid
  workbook…** compares the result with an estimator's transcription (any
  workbook with a `Type | Design / assembly name | Construction | Notes` table,
  sections headed with their sheet number). It reports types found, layers read
  exactly (sizes and spacings must match), framing spacings, overall thickness
  and category, and lists every difference. **Download AI result** saves the raw
  answer as JSON for deeper analysis.
- **Fill room (done):** pick an area type, click **Fill room**, click inside a
  room. The outline follows the inside face of the walls; furniture, text and
  door swings are ignored, and door openings are closed off along the wall face,
  so the opening is not part of the area. It works from the PDF's vector
  linework (no image model): the wall pen is found from parallel line pairs and
  line weight, wall gaps up to **Close openings up to** (3 m by default) are
  closed, and wider gaps close only where window glazing is drawn along them.
  Shift+click a neighbouring space to join it into the last fill, through the
  opening between them. Needs a vector PDF (not a scan).
- Next: finish schedules into room types, sheet titles, scale verification.

**Phase 3 — AI takeoff:** walls by type from the plan tags and PDF vector lines,
rooms with finishes, all as suggestions you accept or correct.

## Use it hosted

A hosted copy runs on claude.ai as a private artifact. AI features there use your
own Claude account, so no API key is needed. To update it, run
`npm run build:artifact` and republish `dist/artifact.html` with the files listed
in `dist/artifact-files.json` (see `docs/handoff.md`).

## Run it

Requires Node.js 20 or newer.

```bash
npm install
npm run dev
```

Then open the address it prints (usually http://localhost:5173).

### AI features

AI features use your own Anthropic API key (get one at console.anthropic.com).
Click **AI settings** in the top bar and paste it there. It is stored only in that
browser. When you use an AI feature, the sheet you chose (as images and its text)
is sent to Anthropic's API; nothing else leaves your computer. Reading one legend
sheet takes one to three minutes.

## Using it

1. **Upload drawings** (top right). Sheets appear on the left with their scale.
2. Pick a sheet. If its scale says *no scale* or *verify*, choose one from the
   **Scale** menu or use **Calibrate**: click both ends of a known dimension and
   type its length (`3.5`, `3500mm`, `12'6"`).
3. Click a **takeoff type** on the left, then click on the drawing:
   - Area / linear: click points, double-click or press Enter to finish.
     Hold Shift for straight lines, Backspace removes the last point, Esc cancels.
   - Count: click each item.
4. To take a room's area in one click: pick an area type, **Fill room**, click
   inside the room. If it leaks into the next space, lower **Close openings up
   to**; if it says the space isn't closed, raise it or draw by hand.
5. To cut a hole out of an area: **Select**, click the area, **Cutout**, draw the hole.
6. Click ✎ on a type to edit its name, height and assembly formulas.
7. **Export Excel** when done.

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
`src/ai/` (Claude request and extraction schema), `src/assemblyBuilder.ts`
(layers to assembly formulas),
`src/fill/` (room fill: vector linework, wall detection, opening bridges,
raster flood fill and outline tracing),
`src/components/Viewer.tsx` (PDF rendering and measuring tools).

PDF rendering uses the pdf.js *legacy* build because current pdf.js relies on
JavaScript features (`Math.sumPrecise`, `Map.prototype.getOrInsertComputed`)
that shipping browsers do not yet support.
