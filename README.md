# Takeoff AI

An AI-native construction takeoff tool for general contractors. It runs in your
browser on your own computer: drawings and takeoffs are stored locally and
nothing is uploaded anywhere.

## Status

**Interface:** a light, Mac-style window: segmented tools, a scale picker with
metric and imperial scales on every sheet, a Takeoffs list for quick deletes,
undo/redo, and an activity log of every change.

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
- **Wall takeoff (done):** on a plan with a scale, **✦ Wall takeoff** measures
  every tagged wall on the centreline, by type. Walls are found from the PDF's
  vector linework (pairs of wall lines a wall-thickness apart, carried through
  doors); each type tag's leader is followed to the wall it points at; walls
  are split at junctions, and a type carries on along its wall, round corners
  and into untagged walls of the same thickness that run into it (nearest tag
  wins). Review lengths per type, choose which takeoff type each goes to (new
  types are built from the AI-read assembly legend when there is one), then add
  them as linear measurements. A tag whose leader lands on a wall drawn in
  light lines (shown above or below, curtain walls) measures the line it points
  at, up to the walls that meet it, flagged "check". Partitions can be measured
  through door openings or not (exterior walls always run through openings). **Score against bid
  workbook…** compares lengths per type with the workbook's rows for that sheet.
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

The window works like a Mac document: sheets and takeoff types on the left, the
drawing in the middle, and an inspector (Quantities, Takeoffs, History) on the
right. Tools sit in the title bar.

1. **Add drawings** (title bar). Every PDF page becomes a sheet, named from its
   title block, with its scale read from the sheet where it can be.
2. Pick a sheet. The **scale pill** in the title bar shows its scale; an amber
   **Check** means it was read from the sheet. Click it to pick any metric or
   imperial scale (whatever the project's units), type another one (`1:150`,
   `3/32" = 1'-0"`), or **Calibrate from a dimension**: click both ends of a
   known dimension and type its length (`3.5`, `3500mm`, `12'6"`).
3. Click a **takeoff type** on the left, then **Measure** (M):
   - Area and length: click points; double-click or Return finishes. Shift keeps
     lines straight, Backspace removes the last point, Esc cancels.
   - Count: click each item.
4. **Fill room** (R): pick an area type and click inside a room. If it leaks into
   the next space, lower **Close openings up to**; if it says the space isn't
   closed, raise it or draw by hand.
5. **Wall takeoff**: on a plan with a scale, measures every tagged wall by type;
   check the lengths and where each type goes, then **Add**. Running it again on
   a sheet replaces its earlier wall takeoff.
6. **Cutout** (C): select an area, then draw the hole.
7. Hover a type on the left to edit (pencil) or delete (bin) it.
8. **Export** saves the takeoff to Excel, including the activity log.

Deleting: select a takeoff and press Delete, use **Delete takeoff** on the
selection card, or open **Takeoffs** in the inspector to delete one row, a whole
type or everything on the sheet. Every delete shows an **Undo** button;
⌘Z / ⇧⌘Z undo and redo (200 steps).

History: every takeoff, type, scale and drawing change is recorded with its time,
sheet and quantity, saved in the browser's database beside the project, shown in
the **History** tab and exported as the **Activity** sheet.

Navigation: scroll to zoom, drag or Space-drag to pan, F fits the sheet.
**More → Keyboard shortcuts** lists them all.

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
raster flood fill and outline tracing), `src/walls/` (wall takeoff: wall bands,
tag leaders, junctions and type carrying), `src/eval/wallKey.ts` (wall lengths
from a bid workbook),
`src/components/Viewer.tsx` (PDF rendering and measuring tools).

PDF rendering uses the pdf.js *legacy* build because current pdf.js relies on
JavaScript features (`Math.sumPrecise`, `Map.prototype.getOrInsertComputed`)
that shipping browsers do not yet support.
