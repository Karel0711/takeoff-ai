import type { PDFDocumentProxy } from './pdf';

/**
 * Drawing layers. Sets exported from CAD keep their layers as PDF optional content groups: an
 * engineer's ductwork, piping by service, lighting, power and fire alarm each on a layer of its
 * own, and the work to demolish or to keep on layers named for it ("Ductwork-Demo",
 * "Wat-Cold-Exist"). Read from the layers, a trade plan's runs and devices sort into new work,
 * removals and existing work to stay, as an estimator sorts them by eye.
 */

const cache = new WeakMap<object, Promise<Map<string, string>>>();

/** Layer names by group id ('117R' → 'Ductwork'); empty for a drawing with no layers. */
export function layerNames(pdf: PDFDocumentProxy): Promise<Map<string, string>> {
  let p = cache.get(pdf);
  if (!p) {
    p = (async () => {
      const out = new Map<string, string>();
      try {
        const cfg = await (pdf as unknown as { getOptionalContentConfig(): Promise<Iterable<[string, { name?: string | null }]> | null> }).getOptionalContentConfig();
        if (cfg && typeof (cfg as { [Symbol.iterator]?: unknown })[Symbol.iterator] === 'function') for (const [id, g] of cfg) if (g?.name) out.set(String(id), g.name);
      } catch {
        // No optional content: no layers.
      }
      return out;
    })();
    cache.set(pdf, p);
  }
  return p;
}

/** A layer's own name: past the drawing it came in with ("26223 Existing M6.1|Ductwork-Exist" → "Ductwork-Exist"). */
export const baseLayer = (name: string) => name.split('|').pop()!.trim();

/**
 * A layer that came in with a referenced drawing: the architect's plan under an engineer's work
 * ("2026-10-02-FloorPlan-LEVEL1FLOORPLAN|A-WALL") is background, not the trade's work. The
 * engineer's own earlier drawing of what is there now ("26223 Existing M6.1|Ductwork-Exist") is
 * the trade's, as existing work.
 */
export function isBackground(name: string): boolean {
  const base = baseLayer(name).toUpperCase();
  if (/^(A|I|Q|S|G|C|L)-/.test(base)) return true;
  if (/BACKGROUND|BACK-|^BACK$|^BG\b|BG-|BORDER|TITLE|^TB\b|STAMP|XREF|MASKING|^0$|DEFPOINTS|VIEWPORT|GRID/.test(base)) return true;
  if (/^P-SANR-FIXT$/.test(base) && name.includes('|')) return true;
  return false;
}

/** Whether a layer is work to demolish, existing work to stay, or new work (by its name). */
export type LayerStatus = 'new' | 'demo' | 'exist';

export function layerStatus(name: string): LayerStatus {
  const base = baseLayer(name).toUpperCase();
  if (/DEMO|REMOV|\bDEM\b|-D$|_D$/.test(base)) return 'demo';
  if (/EXIST|\bEXG\b|-EX$|_EX$|-E$|\bE-?X\b|HIDDEN EXIST/.test(base)) return 'exist';
  return 'new';
}

/** What a layer's linework is, for taking off: a duct, a pipe of one service, conduit, or devices of a system. */
export interface LayerService {
  key: string;
  /** What it is called in a takeoff ("Ductwork", "Domestic cold water"). */
  label: string;
  trade: 'M' | 'P' | 'E' | 'FP' | 'A';
  /** duct: drawn as two lines a duct's width apart; run: one line along the pipe or conduit; devices: symbols, counted, not measured; walls: architectural removals. */
  kind: 'duct' | 'run' | 'devices' | 'walls';
  division: string;
}

const SERVICES: { re: RegExp; s: Omit<LayerService, 'key'> & { key: string } }[] = [
  { re: /DUCT.*(CENT|CNTR|CL\b)/, s: { key: 'duct-cl', label: 'Ductwork (centreline)', trade: 'M', kind: 'run', division: '20-25 Mechanical' } },
  { re: /DUCT(?!.*(ANNO|TEXT|IDEN|TAG|SYMB|NOTE|DIM))/, s: { key: 'duct', label: 'Ductwork', trade: 'M', kind: 'duct', division: '20-25 Mechanical' } },
  { re: /WAT.*COLD|\bDCW\b|CWTR|DOMW?-?C|COLD.?WAT/, s: { key: 'dcw', label: 'Domestic cold water piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /WAT.*RECIRC|RECIRC|DHWR|HWRC/, s: { key: 'dhwr', label: 'Domestic hot water recirculation piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /WAT.*HOT|\bDHW\b|HWTR|DOMW?-?H|HOT.?WAT/, s: { key: 'dhw', label: 'Domestic hot water piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /\bSAN\b|SAN-|SANI|SOIL|WASTE|SANR-PIPE|SANR-?(A|B)/, s: { key: 'san', label: 'Sanitary piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /\bVENT\b|^VENT|-VENT/, s: { key: 'vent', label: 'Vent piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /\bSTM\b|STM-|STORM|STRM|RAIN|\bRWL\b/, s: { key: 'storm', label: 'Storm piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /GAS/, s: { key: 'gas', label: 'Gas piping', trade: 'P', kind: 'run', division: '20-25 Mechanical' } },
  { re: /HEATING|HYDR|\bHWS\b|\bHWR\b|\bHHW\b|GLYCOL/, s: { key: 'heating', label: 'Heating water piping', trade: 'M', kind: 'run', division: '20-25 Mechanical' } },
  { re: /CHW|CHILL/, s: { key: 'chw', label: 'Chilled water piping', trade: 'M', kind: 'run', division: '20-25 Mechanical' } },
  { re: /REFRIG|\bRFG\b|\bREF\b|REF-|\bRL\b|\bRS\b/, s: { key: 'refrig', label: 'Refrigerant piping', trade: 'M', kind: 'run', division: '20-25 Mechanical' } },
  { re: /COND(ENSATE)?-?DR|\bCD\b/, s: { key: 'condensate', label: 'Condensate drain piping', trade: 'M', kind: 'run', division: '20-25 Mechanical' } },
  { re: /ALARM|\bFA\b|FIRE.?AL/, s: { key: 'alarm', label: 'Fire alarm', trade: 'E', kind: 'devices', division: '26 Electrical' } },
  { re: /FIRE|SPRK|SPRINK|\bFP\b|FP-|STANDPIPE/, s: { key: 'fire', label: 'Fire protection piping', trade: 'FP', kind: 'run', division: '20-25 Mechanical' } },
  { re: /PIPING|PIPE/, s: { key: 'piping', label: 'Piping (other)', trade: 'M', kind: 'run', division: '20-25 Mechanical' } },
  { re: /CONDUIT/, s: { key: 'conduit', label: 'Conduit', trade: 'E', kind: 'run', division: '26 Electrical' } },
  { re: /LIGHT|LITE|EMERG/, s: { key: 'lighting', label: 'Lighting', trade: 'E', kind: 'devices', division: '26 Electrical' } },
  { re: /POWER|POWR|RECEP/, s: { key: 'power', label: 'Power', trade: 'E', kind: 'devices', division: '26 Electrical' } },
  { re: /COMM|DATA|TELE/, s: { key: 'comm', label: 'Communications', trade: 'E', kind: 'devices', division: '26 Electrical' } },
  { re: /SECUR|ACCESS|CCTV/, s: { key: 'security', label: 'Security', trade: 'E', kind: 'devices', division: '26 Electrical' } },
  { re: /^MECH|EQUIP/, s: { key: 'mech', label: 'Mechanical equipment', trade: 'M', kind: 'devices', division: '20-25 Mechanical' } },
];

/** What a layer is, by its name; null for background, notes and anything not taken off. */
export function layerService(name: string): LayerService | null {
  const base = baseLayer(name).toUpperCase();
  if (/^A-.*DEMO|WALL.?DEMO/.test(base)) return { key: 'arch-demo', label: 'Demolition', trade: 'A', kind: 'walls', division: '02 Existing Conditions' };
  if (isBackground(name)) return null;
  if (/TEXT|ANNO|NOTE|IDEN|NAMES?\b|TAG|DIM|SYMB|HATCH|^DETAIL|WIRE/.test(base)) return null;
  for (const { re, s } of SERVICES) if (re.test(base)) return s;
  return null;
}
