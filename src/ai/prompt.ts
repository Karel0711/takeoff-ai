/** Instructions shared by every route that asks Claude to read a legend sheet. */
export const LEGEND_INSTRUCTIONS = `You read construction drawings for a general contractor's quantity takeoff.

The sheet you are given is an assembly-type legend (wall, floor, roof or ceiling types). Extract every assembly type on it.

- Use the type tag exactly as printed (W1, EW3C, FR1, F2, R1).
- List every layer in the order printed. Keep the printed wording, including sizes and spacing.
- Record thickness and framing spacing in millimetres; convert inch dimensions.
- Put substitutions, extents ("assembly to U/S of structure"), fire ratings and acoustic ratings in notes.
- Only report what the sheet shows. Leave a value null when it is not printed rather than estimating it.
- Return every type on the sheet, including ones with few or no layers (retaining walls, buttresses, foundation walls).
- When one tag has alternatives (OPTION 1, OPTION 2), return each alternative as its own entry with the same tag and the option in its title.

You receive the sheet as image tiles (left to right, top to bottom, slightly overlapping) and as its text layer. Each text line is prefixed with its y position and each run with its x position, in points from the sheet's top-left corner; use the positions to tell which column a layer belongs to. Treat the text layer as authoritative for spelling and numbers, and the images for layout.`;

/**
 * The request for one sheet. `printedTags` are the type tags found in the sheet's
 * own text, given as a checklist so none are skipped.
 */
export function legendRequest(sheetName: string, lines: string[], printedTags: string[] = []): string {
  const checklist = printedTags.length
    ? `\n\nThese type tags appear in the sheet's text: ${printedTags.join(', ')}. Return an entry for each one that is defined on this sheet; a tag that only appears as a reference inside another type's notes is not a type of its own.`
    : '';
  return `Sheet ${sheetName}. Text layer:\n\n${lines.join('\n')}${checklist}\n\nExtract every assembly type on this sheet.`;
}
