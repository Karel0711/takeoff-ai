/**
 * The AI service for the hosted web app. The browser never holds a model key: it sends
 * the sheet images and prompt here with the user's access code, and this forwards them
 * to whichever model is configured (any OpenAI-compatible endpoint: OpenRouter by
 * default, so Gemini Flash, Qwen-VL, GPT or Claude are a config change, not a code change).
 *
 * Each access code has a daily request cap, and there is a cap across all codes, so a
 * free tester can never run up the bill. Counts live in a KV namespace.
 */

/** The slice of Cloudflare's KV namespace this uses (kept local so no Cloudflare types are needed). */
export interface UsageStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

export interface Env {
  /** Key for the model provider. Set as a secret, never in wrangler.toml. */
  AI_API_KEY?: string;
  /** OpenAI-compatible base URL. Default: OpenRouter. */
  AI_BASE_URL?: string;
  /** Model for reading assembly legends (needs vision). */
  AI_MODEL?: string;
  /** Optional cheaper model for reading sheet names from title blocks. Default: AI_MODEL. */
  AI_MODEL_SHEET_NAME?: string;
  /** "off" when the model rejects response_format: json_object. */
  AI_JSON_MODE?: string;
  /** Who may use it: "code=Name;code2=Name 2". Set as a secret. */
  ACCESS_CODES?: string;
  /** Requests per access code per day (UTC). Default 25. */
  DAILY_LIMIT?: string;
  /** Requests across every code per day (UTC). Default 200. */
  GLOBAL_DAILY_LIMIT?: string;
  USAGE?: UsageStore;
}

export type Task = 'legend' | 'sheet-name';

export interface AiRequest {
  task: Task;
  system?: string;
  prompt: string;
  /** Base64 PNGs, without the data: prefix. */
  images?: string[];
  maxTokens?: number;
}

export interface AiResponse {
  text: string;
  model: string;
  used: number;
  limit: number;
}

const MAX_IMAGES = 8;
const MAX_IMAGE_CHARS = 8_000_000;
const MAX_TOTAL_IMAGE_CHARS = 24_000_000;
const MAX_PROMPT_CHARS = 400_000;
const MAX_TOKENS = 16_000;
const DAY_TTL = 2 * 24 * 3600;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } });

const fail = (status: number, error: string, message: string) => json({ error, message }, status);

/** "abc=Joe Drywall; xyz=Sam" → Map(abc → Joe Drywall). A code with no name is named by itself. */
export function parseCodes(raw: string | undefined): Map<string, string> {
  const codes = new Map<string, string>();
  for (const part of (raw ?? '').split(/[;\n,]/)) {
    const [code, ...name] = part.split('=');
    const c = code?.trim();
    if (c) codes.set(c, name.join('=').trim() || c);
  }
  return codes;
}

const limitOf = (v: string | undefined, fallback: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const today = (now: Date) => now.toISOString().slice(0, 10);

async function count(store: UsageStore | undefined, key: string): Promise<number> {
  if (!store) return 0;
  return Number(await store.get(key)) || 0;
}

function bearer(request: Request): string | null {
  const h = request.headers.get('authorization') ?? '';
  const m = /^Bearer\s+(.+)$/i.exec(h.trim());
  return m ? m[1].trim() : null;
}

function validate(body: unknown): AiRequest | string {
  if (typeof body !== 'object' || body === null) return 'The request was not JSON.';
  const b = body as Partial<AiRequest>;
  if (b.task !== 'legend' && b.task !== 'sheet-name') return 'Unknown task.';
  if (typeof b.prompt !== 'string' || !b.prompt) return 'The request has no prompt.';
  if (b.prompt.length + (b.system?.length ?? 0) > MAX_PROMPT_CHARS) return 'This sheet has too much text to send in one request.';
  if (b.system !== undefined && typeof b.system !== 'string') return 'Bad system prompt.';
  const images = b.images ?? [];
  if (!Array.isArray(images) || images.some((i) => typeof i !== 'string')) return 'Bad images.';
  if (images.length > MAX_IMAGES) return `At most ${MAX_IMAGES} images per request.`;
  if (images.some((i) => i.length > MAX_IMAGE_CHARS) || images.reduce((s, i) => s + i.length, 0) > MAX_TOTAL_IMAGE_CHARS) {
    return 'The sheet images are too large.';
  }
  return { task: b.task, system: b.system, prompt: b.prompt, images, maxTokens: b.maxTokens };
}

/**
 * GET: checks an access code and reports today's use (the settings screen calls it).
 * POST: runs one AI request.
 */
export async function handle(request: Request, env: Env, fetchFn: typeof fetch = fetch, now = new Date()): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return fail(405, 'method', 'Use GET or POST.');

  const codes = parseCodes(env.ACCESS_CODES);
  const code = bearer(request);
  const name = code ? codes.get(code) : undefined;
  if (!code || !name) return fail(401, 'access_code', 'That access code is not valid.');

  const limit = limitOf(env.DAILY_LIMIT, 25);
  const globalLimit = limitOf(env.GLOBAL_DAILY_LIMIT, 200);
  const day = today(now);
  const userKey = `day:${day}:code:${code}`;
  const allKey = `day:${day}:all`;
  const used = await count(env.USAGE, userKey);
  const model = env.AI_MODEL;

  if (request.method === 'GET') return json({ ok: true, name, used, limit, model: model ?? null });

  if (!env.AI_API_KEY || !model) return fail(503, 'not_configured', 'The AI service is not set up yet.');
  if (used >= limit) return fail(429, 'daily_limit', `You have used today's ${limit} AI requests. Try again tomorrow.`);
  const usedAll = await count(env.USAGE, allKey);
  if (usedAll >= globalLimit) return fail(429, 'global_limit', 'The AI service is busy today. Try again tomorrow.');

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return fail(400, 'bad_request', 'The request was not JSON.');
  }
  const req = validate(body);
  if (typeof req === 'string') return fail(400, 'bad_request', req);

  // Counted before the call, so a burst of parallel requests cannot all slip under the cap.
  await env.USAGE?.put(userKey, String(used + 1), { expirationTtl: DAY_TTL });
  await env.USAGE?.put(allKey, String(usedAll + 1), { expirationTtl: DAY_TTL });

  const useModel = req.task === 'sheet-name' ? env.AI_MODEL_SHEET_NAME || model : model;
  const base = (env.AI_BASE_URL || 'https://openrouter.ai/api/v1').replace(/\/+$/, '');
  const content = [
    ...(req.images ?? []).map((data) => ({ type: 'image_url', image_url: { url: `data:image/png;base64,${data}` } })),
    { type: 'text', text: req.prompt },
  ];
  const payload: Record<string, unknown> = {
    model: useModel,
    max_tokens: Math.min(Math.max(1, Math.floor(req.maxTokens ?? 4000)), MAX_TOKENS),
    temperature: 0,
    messages: [...(req.system ? [{ role: 'system', content: req.system }] : []), { role: 'user', content }],
  };
  if (env.AI_JSON_MODE !== 'off') payload.response_format = { type: 'json_object' };

  let upstream: Response;
  try {
    upstream = await fetchFn(`${base}/chat/completions`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.AI_API_KEY}`, 'x-title': 'Takeoff AI' },
      body: JSON.stringify(payload),
    });
  } catch {
    return fail(502, 'upstream', 'Could not reach the AI model. Try again.');
  }
  if (!upstream.ok) {
    const detail = (await upstream.text().catch(() => '')).slice(0, 300);
    return fail(502, 'upstream', `The AI model returned an error (${upstream.status}). ${detail}`.trim());
  }
  const data = (await upstream.json().catch(() => null)) as {
    model?: string;
    choices?: { message?: { content?: string | { type: string; text?: string }[] }; finish_reason?: string }[];
  } | null;
  const choice = data?.choices?.[0];
  const raw = choice?.message?.content;
  const text = typeof raw === 'string' ? raw : Array.isArray(raw) ? raw.map((p) => p.text ?? '').join('') : '';
  if (!text) return fail(502, 'empty', 'The AI model sent back nothing. Try again.');
  if (choice?.finish_reason === 'length') return fail(502, 'cut_off', 'The answer was cut off because the sheet has too many types.');

  const out: AiResponse = { text, model: data?.model ?? useModel, used: used + 1, limit };
  return json(out);
}
