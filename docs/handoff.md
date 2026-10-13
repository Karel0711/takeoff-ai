# Handoff notes

Where the project stands, for picking it up in a new session.

## Status

- **Phase 1 (done):** manual takeoff. PDF sets split into sheets, sheet numbers
  and scales detected, area/linear/count tools, formula assemblies, Excel export,
  local persistence.
- **Phase 2 (in progress):** AI reads assembly legends (A0.2/A0.3 style sheets)
  into takeoff types. Two routes, same prompt and schema (`src/ai/`):
  - Hosted on claude.ai as an artifact: uses the viewer's Claude account through
    the artifact `sample` capability. No API key. Images are downsized to about
    1.2 MP there, so the sheet's text layer carries the small print.
  - Run locally (`npm run dev`): uses the user's Anthropic API key from
    **AI settings**, `claude-opus-5-5`, structured outputs.
- **Fill room (done; the estimator checked it against their Autodesk Takeoff areas: exact):** one-click room
  areas from PDF vector linework (`src/fill/`). On A2.1 at 1:100 every labelled
  room fills; closed rooms snap to the wall lines with 0.0 mm edge error, e.g.
  Staff Office 10.57 m², Staff Room 56.72, Elevator 5.49, Storage 23.30, BF WR
  7.60, Ski Service 40.66, Receiving 25.91, Mechanical 26.48, Electrical 11.54,
  Rescue & Safety 23.04, Jan. Cl. 2.66; the open-plan lobby/rental hall is
  273.87 m². How it works: wall pen = heaviest pen with mostly paired parallel
  lines (A2.1: 0.57 pt walls, 0.51 tags/frames, 0.28 furniture/hatch); gaps on a
  wall line up to 3 m are bridged (doors), up to 10 m when glazing runs along
  them (windows); flood fill at up to 2 px/pt (3 gave the same areas to 0.01 m² at twice the time), hole filling, boundary trace,
  then edges snapped to the drawn lines. First click reads the sheet's operator
  list (~3–6 s), then 0.1–2 s per room.
- **Wall takeoff:** `src/walls/`. Latest score across A2.0–A2.3 against the
  workbook: 10.7% total difference (A2.0 2%, A2.1 8%, A2.2 15%, A2.3 22%); 8.2% with W2 set to stop at doors (`CUT=W2 score4.sh`), which is how the estimator measures W2 but not W1;
  re-score with the per-sheet keys after any change to the carry rules (each
  rule change was kept only if the four-sheet total improved). Rules now: walls
  join across breaks up to 2.5× thickness; thick walls meet round corner
  columns; exterior/foundation types follow thickness changes up to 20% and can
  stack (EW6A over EW6B BELOW); furring does not run straight past a junction; a furring tag pointing
  into a column goes to the furring wrapped round it (a ring of walls ≤ 6 m
  round, found by rays from the piece it lands on), and a wrap side on a
  furring line that runs past the column carries both types (A2.1 FR2 24.2 vs
  24.6 m, was 11.7). Free wall ends facing each other on nearly one line (a
  pier between, faces stepping by up to 1.5 pt / 30% of thickness, thickness
  within 35%) meet in the middle and carry types straight through, and so do
  two collinear walls ending at one junction (A2.0 EW1 71.4 vs 73.5, was 63.6).
  A2.3 (roof) is still off: roof hatching reads as walls there. EW7A/EW7B on A2.2 (5 and 6 m in the workbook) have no tags
  on the sheet.
  Earlier notes: Centreline lengths by
  wall type from vector linework and type tags. Against the estimator's ACC
  takeoff (workbook rows per sheet): A2.1 total difference 11%; EW3A 42.76 vs
  42.76 m, FR1 96.9 vs 98.3, W1 66.9 vs 68.7, CB3 18.7 vs 19.0, W3 1.98 vs 2.05,
  EW1 41.2 vs 39.7; A2.2 W1 17.5 vs 19.1, W3 10.1 vs 9.9, W5 10.7 vs 10.7, W6B 7.8
  vs 7.6, EW5A 41.7 vs 43.3. Walls drawn "below/above" in light pens are measured
  from the line the tag's leader lands on, up to the walls meeting it (A2.2:
  FR1 11.7 vs 11.3, EW3A 9.2 vs 12.0, EW1A 8.2 vs 10.8). The estimator does not
  measure partitions through doors; the option to cut partitions at doors gets W2
  right (A2.1 26.0 vs 25.8, A2.2 78.8 vs 80.9) but takes W1 and CB2 well under the
  workbook, so measuring through stays the default. Known gaps: where
  a tag's type stops on untagged walls is a guess (nearest tag along the walls),
  which over-counts W2 on both sheets and FR2 on A2.2; the workbook lists EW3B
  (11.9 m) and EW1B on A2.1 where the drawing tags less. How it works: rays from
  every wall line find the parallel line a wall-thickness away (bands),
  collinear pieces merge across short breaks, ends join at corners (centreline
  intersection) and tees (to the other wall's centreline), walls split at
  junctions; tag symbols are the closed loop around the text (per pen, so
  furniture under a tag does not confuse it) and leaders run from a symbol
  corner; types carry by kind (partition, exterior, furring, foundation).
- **Room finishes:** `Measurement.finishes` maps floor/base/walls/ceiling to
  takeoff types; `contributions()` in `src/quantities.ts` adds each room to its
  finish types (area for floor and ceiling, perimeter for base and walls) and
  everything (quantities, Excel division rows, Measurements sheet) reads from
  it. `src/finishSchedule.ts` reads a room finish schedule from sheet text (no
  sample in this drawing set; tested on a synthetic table).
- **Hatch match (ceilings, finish plans):** `src/fill/marks.ts` groups segments
  into shapes (subpaths) with a class (pen, dot / line at an angle / shape
  size; filled lettering is excluded); `src/fill/similar.ts` picks the class
  many times denser inside the sample than on the sheet (lines weigh by
  length; a perpendicular line class of the same pen joins it as a grid),
  labels every space the walls enclose on one sheet-wide raster, takes spaces
  the pattern covers (≥50% of cells, ≥35% of the sample's density) to their
  walls with `fillRoom`, and outlines partly hatched spaces (dot patterns only).
  The RCPs here (A6.1/A6.2, PDF pages 34–35) have no text layer (text is drawn
  as outlines), so their sheet names read "Page 34/35" and tags can't be read.
  GWB ceiling (stipple, pen 0.54 dots): A6.1 79.6 vs 81.7 m² workbook, A6.2
  112.9 vs 127.2. ACT grid (0.30 lines) finds the matching rooms plus a false
  hit over the entry stair. RCP walls are 1.44 (exterior) and 0.84 (interior),
  so wall pen detection now keeps every paired pen ≥55% of the heaviest and
  relaxes the paired share to 40% when no pen reaches 50% (the 1.44 pen also
  draws the sheet border).
- **Count symbols:** `src/fill/symbols.ts`. Takes the lines inside the dragged
  box as the sample, picks its rarest long line (by length and pen) as the
  anchor, and at every sheet line matching the anchor (4 quarter turns, both
  ends) checks that ≥85% of the sample's lines are there too (endpoint
  tolerance 1% of the box, min 0.35 pt). A6.1 CAN light: 32 found, 0.3 s.
- **More from the night shift:**
  - **Trace** (`src/fill/trace.ts`): follows same-pen strokes end to end (dash
    gaps ≤ 4 pt) and goes on at forks only straight ahead.
  - **Door tags** (`findDoorTags` in `src/fill/rooms.ts`): a 3–4 digit number in
    a closed non-rectangular symbol; letter-prefixed tags get their own type.
  - **Bare room numbers**: when a sheet has no boxed numbers, a number with a
    name block directly above counts.
  - **Scale check** (`src/scaleCheck.ts`): pairs dimension figures with the line
    they sit on, votes, and snaps to a standard scale (±2%); a confirmed
    detected scale becomes `scaleSource: 'verified'`.
  - **On all sheets** (symbols and hatches): other sheets are read uncached
    (`segmentsOnce`), skipped when their scale (set, or read from their
    dimensions) differs, and for hatches when they carry little of the
    pattern.
  - **Point editing** in `Viewer.tsx` (drag handles, edge midpoints insert,
    Option-click removes); the drag keeps its points in a ref, since React's
    StrictMode runs state updaters twice.
  - **Starting types** (`starter-types` key), **backups** (a zip of .takeoff
    files), **sheet image** (`src/sheetImage.ts`), **Quick start**,
    **duplicate type**, Quantities per sheet.
  - Segment and wall-model caches keep the four most recent sheets.
  - **Revisions** (`offerRevision` in App): new sheets matching an existing
    sheet's name and page size take over its takeoffs; the old one is renamed
    "(superseded)". `compareSheets.ts` renders both at ~3000 px and colours
    ink only on the old (red), only on the new (blue), on both (grey).
  - **Door tags on all sheets**: only tags inside the sheet's room-number range
    (±20) count, and other sheets need ≥4 of them, which leaves out level
    markers (4000, 8570) on sections and elevations.
  - **Stops at doors** per wall type (`stopAtDoors` option, saved as
    `TakeoffType.stopsAtDoors`).
  - Tried and dropped (made verified results worse): glass-partition pairs as
    room boundaries (A2.1 Staff Room 56.72 → 56.65 m², A2.2 unchanged); a
    grid-direction mix test for hatch matching (lost a real ACT area, kept the
    false one).
- **Interface (redesigned):** light, Mac-style (system font, segmented tools,
  source-list sidebar, inspector with Quantities / Takeoffs / History). State
  changes go through `commit()` in `App.tsx`, which keeps undo/redo stacks and
  diffs each change into the activity log (`src/activity.ts`, saved under the
  `activity` key in IndexedDB, exported as the Activity sheet). Typing in one
  field within 4 s counts as one change.
- **Not yet verified:** the real model's extraction quality on real sheets. The
  end-to-end tests intercepted the AI call with a hand-written answer.

## Hosted version

`npm run build:artifact` builds `dist/artifact.html` plus `dist/assets/*`
(listed in `dist/artifact-files.json`) for publishing as a claude.ai artifact
with capabilities `{sample: {images: true}, downloads: true}`. The build script
escapes raw control characters and U+FFFD in bundled libraries because the
publisher refuses them. Hosted pages cannot use `alert/confirm/prompt` (see
`src/components/Dialogs.tsx`) or start downloads themselves (Excel goes through
the `downloads` capability).

## Test data (not in the repo; client documents)

- Architectural set for Kelso Glen Eden – West Beginner Lodge (51 sheets, Arch D,
  metric). Plans A2.x at 1:100, verified against dimension strings. Legends:
  A0.2 (EW1–EW7B exterior walls, R1–R3B roofs) and A0.3 (W1–W7D, FR1–FR3, F1–F3).
- The estimator's real bid takeoff for the same project (consolidated by
  division, grouped by subtrade package). Its quantities come from the
  estimator's own Autodesk Construction Cloud takeoff, so it is the answer key
  for checking AI takeoff results and the model for the Excel export layout.

## Next

1. Run the AI legend reading on A0.2/A0.3 for real and tune it. The scorer
   (`src/eval/`, **Score against bid workbook…** in the review screen) grades it
   against the estimator's "Schedules A0.2 A0.3" tab: 25 entries on A0.2 and 23 on
   A0.3. A perfect answer scores 100% and deliberately damaged ones lose exactly
   the expected points (checked on the real workbook).
   - **First real run, A0.3 (hosted, the user's Claude account):** 23/23 types,
     80/80 layers exact, 15/15 framing spacings, 19/19 overall thicknesses, 23/23
     categories. The estimator also checked it against the drawing. Two fixes came
     out of it: the scorer accepts a layer split at "W/" (W7B/W7C framing with
     insulation), and "2 LAYERS" of board now doubles the board quantity (W1B).
   - **Real runs, A0.2:** 23 types, which the estimator confirmed is complete: EW1C
     and R1 option 2 were removed by the latest addendum (their text stays in the
     PDF, so the tag check lists them; the AI correctly left them out). The
     workbook still lists them because it predates that addendum. First run notes: 15/15 framing spacings; every
     overall thickness the AI gave matches the dimension printed on the drawing.
     The workbook differs from the drawing on wood siding (Addendum 7: 17.5mm
     siding replaced the 10mm veneer on EW3B/EW4B/EW5B/EW6A/EW6C) and on five
     "Overall" notes (EW3A, EW3C, EW4A, EW4B, EW6A), where the drawing agrees with
     the AI. Fix: the request now lists the tags found in the sheet text as a
     checklist and asks for one entry per option; the review screen handles
     repeated tags. Re-run A0.2 to confirm.
   - Addenda are not read: the AI reads the drawing as issued. Supporting
     addendum documents is a future feature.
2. ~~Match the Excel export to the estimator's bid workbook layout~~ (done;
   formulas verified by recalculating an export in LibreOffice).
3. ~~Compare Fill room areas with the estimator's Autodesk Takeoff areas~~
   (done: they match).
4. Wall takeoff: walls drawn in light pens ("below"), and a better rule for
   where a type stops on untagged walls (room-by-room for furring and finishes).
   Then finish schedules into room types.
5. REA: analyse Autodesk Takeoff from a HAR capture recorded by the user (the
   cloud environment cannot reach autodesk.com, and Takeoff needs a login), and
   point REA at this app to test what it can recover.
