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

1. Run the AI legend reading on A0.2/A0.3 for real and tune it.
2. Match the Excel export to the estimator's bid workbook layout.
3. Finish schedules into room types; then automatic wall and room takeoff
   (wall tags + PDF vector geometry), checked against the bid quantities.
4. REA: analyse Autodesk Takeoff from a HAR capture recorded by the user (the
   cloud environment cannot reach autodesk.com, and Takeoff needs a login), and
   point REA at this app to test what it can recover.
