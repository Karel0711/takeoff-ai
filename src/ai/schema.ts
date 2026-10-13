import { z } from 'zod/v4';

/**
 * What the AI extracts from an assembly-type legend. It records only what is
 * printed on the sheet; turning layers into takeoff quantities is done by
 * assemblyBuilder.ts so the rules stay visible and testable.
 */
export const LayerSchema = z.object({
  material: z.string().describe('Layer text as printed, e.g. "16mm GYPSUM BOARD" or "92mm METAL STUDS @ 610mm O.C."'),
  role: z
    .enum(['board', 'framing', 'insulation', 'sheathing', 'membrane', 'cladding', 'finish', 'structure', 'fill', 'air_space', 'other'])
    .describe(
      'board: gypsum/cement board on a wall or ceiling face. framing: studs, joists, girts, furring. structure: concrete, masonry, ICF, CLT, deck. fill: granular or compacted fill. air_space: cavities and air gaps.',
    ),
  thickness_mm: z.number().nullable().describe('Layer thickness in millimetres, converted from inches if needed; null if not printed'),
  spacing_mm: z.number().nullable().describe('Centre-to-centre spacing in millimetres for framing ("@ 406mm O.C."); null otherwise'),
});

export const AssemblySchema = z.object({
  code: z.string().describe('Type tag exactly as printed, e.g. "W1", "EW3C", "F1", "R1"'),
  category: z.enum(['interior_wall', 'exterior_wall', 'floor', 'roof', 'ceiling', 'other']),
  title: z.string().describe('The type heading as printed, e.g. "TYPICAL INTERIOR WALL"'),
  layers: z.array(LayerSchema).describe('Every listed layer, in the order printed'),
  total_thickness_mm: z.number().nullable().describe('Overall assembly thickness if dimensioned on the sheet'),
  notes: z.array(z.string()).describe('Conditions printed with the type: substitutions, "assembly to U/S of structure", fire ratings, STC'),
});

export const ExtractionSchema = z.object({
  assemblies: z.array(AssemblySchema),
});

export type ExtractedLayer = z.infer<typeof LayerSchema>;
export type ExtractedAssembly = z.infer<typeof AssemblySchema>;
export type Extraction = z.infer<typeof ExtractionSchema>;
