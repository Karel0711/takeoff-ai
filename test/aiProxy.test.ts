import { describe, expect, it } from 'vitest';
import { handle, parseCodes, type Env, type UsageStore } from '../worker/aiProxy';
import { firstJsonObject } from '../src/ai/service';

function memoryStore(): UsageStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return { data, get: async (k) => data.get(k) ?? null, put: async (k, v) => void data.set(k, v) };
}

const env = (over: Partial<Env> = {}): Env => ({
  AI_API_KEY: 'provider-key',
  AI_MODEL: 'vision-model',
  ACCESS_CODES: 'good=Joe Drywall; other=Sam',
  DAILY_LIMIT: '2',
  GLOBAL_DAILY_LIMIT: '3',
  USAGE: memoryStore(),
  ...over,
});

const post = (code: string | null, body: unknown = { task: 'legend', prompt: 'read it', images: ['AAAA'] }) =>
  new Request('https://x/api/ai', {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(code ? { authorization: `Bearer ${code}` } : {}) },
    body: JSON.stringify(body),
  });

/** A provider that answers every call and records what it was sent. */
function provider(answer = '{"assemblies":[]}', status = 200) {
  const calls: { url: string; body: Record<string, unknown>; auth: string | null }[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string), auth: new Headers(init.headers).get('authorization') });
    return new Response(JSON.stringify({ model: 'vision-model-v2', choices: [{ message: { content: answer }, finish_reason: 'stop' }] }), {
      status,
    });
  }) as unknown as typeof fetch;
  return { calls, fetchFn };
}

describe('AI proxy', () => {
  it('reads access codes with names', () => {
    expect([...parseCodes('a=Joe; b = Sam Ceilings ;c')]).toEqual([
      ['a', 'Joe'],
      ['b', 'Sam Ceilings'],
      ['c', 'c'],
    ]);
  });

  it('turns away a missing or wrong access code without calling the model', async () => {
    const p = provider();
    expect((await handle(post(null), env(), p.fetchFn)).status).toBe(401);
    expect((await handle(post('nope'), env(), p.fetchFn)).status).toBe(401);
    expect(p.calls).toHaveLength(0);
  });

  it('forwards the request with the server key, images first, and returns the answer', async () => {
    const p = provider();
    const res = await handle(post('good', { task: 'legend', system: 'sys', prompt: 'read it', images: ['AAAA'], maxTokens: 99999 }), env(), p.fetchFn);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: '{"assemblies":[]}', model: 'vision-model-v2', used: 1, limit: 2 });
    const call = p.calls[0];
    expect(call.url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(call.auth).toBe('Bearer provider-key');
    expect(call.body.model).toBe('vision-model');
    expect(call.body.max_tokens).toBe(16000);
    expect(call.body.response_format).toEqual({ type: 'json_object' });
    const messages = call.body.messages as { role: string; content: unknown }[];
    expect(messages[0]).toEqual({ role: 'system', content: 'sys' });
    expect(messages[1].content).toEqual([
      { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } },
      { type: 'text', text: 'read it' },
    ]);
  });

  it('uses the cheaper model for sheet names when one is set', async () => {
    const p = provider('{"number":"A6.1"}');
    await handle(post('good', { task: 'sheet-name', prompt: 'name it', images: [] }), env({ AI_MODEL_SHEET_NAME: 'tiny-model' }), p.fetchFn);
    expect(p.calls[0].body.model).toBe('tiny-model');
  });

  it('stops each code at its daily limit, and everyone at the global limit', async () => {
    const e = env();
    const p = provider();
    expect((await handle(post('good'), e, p.fetchFn)).status).toBe(200);
    expect((await handle(post('good'), e, p.fetchFn)).status).toBe(200);
    const third = await handle(post('good'), e, p.fetchFn);
    expect(third.status).toBe(429);
    expect((await third.json()).error).toBe('daily_limit');
    expect((await handle(post('other'), e, p.fetchFn)).status).toBe(200);
    const global = await handle(post('other'), e, p.fetchFn);
    expect((await global.json()).error).toBe('global_limit');
    expect(p.calls).toHaveLength(3);
  });

  it('counts per UTC day', async () => {
    const e = env();
    const p = provider();
    const d1 = new Date('2026-10-16T12:00:00Z');
    const d2 = new Date('2026-10-17T12:00:00Z');
    await handle(post('good'), e, p.fetchFn, d1);
    await handle(post('good'), e, p.fetchFn, d1);
    expect((await handle(post('good'), e, p.fetchFn, d1)).status).toBe(429);
    expect((await handle(post('good'), e, p.fetchFn, d2)).status).toBe(200);
  });

  it('reports a code and its use on GET', async () => {
    const res = await handle(new Request('https://x/api/ai', { headers: { authorization: 'Bearer good' } }), env());
    expect(await res.json()).toEqual({ ok: true, name: 'Joe Drywall', used: 0, limit: 2, model: 'vision-model' });
  });

  it('refuses oversized or malformed requests before calling the model', async () => {
    const p = provider();
    const many = Array.from({ length: 9 }, () => 'AA');
    expect((await handle(post('good', { task: 'legend', prompt: 'x', images: many }), env(), p.fetchFn)).status).toBe(400);
    expect((await handle(post('good', { task: 'chat', prompt: 'x' }), env(), p.fetchFn)).status).toBe(400);
    expect((await handle(post('good', { task: 'legend', prompt: '' }), env(), p.fetchFn)).status).toBe(400);
    expect(p.calls).toHaveLength(0);
  });

  it('says so when the service has no model key yet', async () => {
    const res = await handle(post('good'), env({ AI_API_KEY: undefined }), provider().fetchFn);
    expect(res.status).toBe(503);
  });

  it('passes on provider errors as a 502 with the status', async () => {
    const res = await handle(post('good'), env(), provider('nope', 402).fetchFn);
    expect(res.status).toBe(502);
    expect((await res.json()).message).toContain('402');
  });

  it('can leave out JSON mode for models that reject it', async () => {
    const p = provider();
    await handle(post('good'), env({ AI_JSON_MODE: 'off' }), p.fetchFn);
    expect(p.calls[0].body.response_format).toBeUndefined();
  });
});

describe('reading the model answer', () => {
  it('takes plain JSON, fenced JSON or JSON inside a sentence', () => {
    expect(firstJsonObject('{"a":1}')).toEqual({ a: 1 });
    expect(firstJsonObject('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(firstJsonObject('Here it is: {"a":{"b":2}} done')).toEqual({ a: { b: 2 } });
    expect(() => firstJsonObject('no json here')).toThrow();
  });
});
