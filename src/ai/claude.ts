import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { ExtractionSchema, type Extraction } from './schema';

export const MODEL = 'claude-opus-5-5';

const KEY_STORAGE = 'takeoff-ai:anthropic-api-key';

/** The user's own API key, kept in this browser only. */
export function getApiKey(): string | null {
  try {
    return localStorage.getItem(KEY_STORAGE);
  } catch {
    return null;
  }
}

export function setApiKey(key: string | null): void {
  try {
    if (key) localStorage.setItem(KEY_STORAGE, key);
    else localStorage.removeItem(KEY_STORAGE);
  } catch {
    // Storage unavailable (private window); the key just won't be remembered.
  }
}

function client(): Anthropic {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Add your Anthropic API key in AI settings first.');
  // The app runs on the user's own machine with their own key, so calling the API from the browser is intended.
  return new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
}

const SYSTEM = `You read construction drawings for a general contractor's quantity takeoff.

The sheet you are given is an assembly-type legend (wall, floor, roof or ceiling types). Extract every assembly type on it.

- Use the type tag exactly as printed (W1, EW3C, FR1, F2, R1).
- List every layer in the order printed. Keep the printed wording, including sizes and spacing.
- Record thickness and framing spacing in millimetres; convert inch dimensions.
- Put substitutions, extents ("assembly to U/S of structure"), fire ratings and acoustic ratings in notes.
- Only report what the sheet shows. Leave a value null when it is not printed rather than estimating it.

You receive the sheet as image tiles (left to right, top to bottom, slightly overlapping) and as its text layer. Each text line is prefixed with its y position and each run with its x position, in points from the sheet's top-left corner; use the positions to tell which column a layer belongs to. Treat the text layer as authoritative for spelling and numbers, and the images for layout.`;

export interface ReadResult {
  extraction: Extraction;
  /** Model that produced the answer; differs from MODEL when a fallback model answered. */
  model: string;
}

/** Sends one legend sheet to Claude and returns the assemblies it found. */
export async function readAssemblyLegend(
  tiles: string[],
  lines: string[],
  sheetName: string,
  signal?: AbortSignal,
): Promise<ReadResult> {
  const content: Anthropic.Beta.BetaContentBlockParam[] = [
    ...tiles.map(
      (data): Anthropic.Beta.BetaImageBlockParam => ({
        type: 'image',
        source: { type: 'base64', media_type: 'image/png', data },
      }),
    ),
    {
      type: 'text',
      text: `Sheet ${sheetName}. Text layer:\n\n${lines.join('\n')}\n\nExtract every assembly type on this sheet.`,
    },
  ];

  const stream = client().beta.messages.stream(
    {
      model: MODEL,
      max_tokens: 64000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort: 'high', format: betaZodOutputFormat(ExtractionSchema) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    },
    { signal },
  );
  const message = await stream.finalMessage();

  if (message.stop_reason === 'refusal') {
    throw new Error('Claude declined to read this sheet.');
  }
  if (message.stop_reason === 'max_tokens') {
    throw new Error('The answer was cut off because the sheet has too many types. Try again or split the sheet.');
  }
  if (!message.parsed_output) {
    throw new Error('Claude returned an answer that could not be read as assembly types.');
  }
  return { extraction: message.parsed_output, model: message.model };
}

/** Turns an API failure into a message a user can act on. */
export function describeError(error: unknown): string {
  if (error instanceof Anthropic.AuthenticationError) return 'The API key was rejected. Check it in AI settings.';
  if (error instanceof Anthropic.PermissionDeniedError) return 'This API key is not allowed to use this model.';
  if (error instanceof Anthropic.RateLimitError) return 'Rate limited by the API. Wait a minute and try again.';
  if (error instanceof Anthropic.APIConnectionError) return 'Could not reach the Anthropic API. Check your internet connection.';
  if (error instanceof Anthropic.APIError) return `API error ${error.status ?? ''}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}
