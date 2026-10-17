# Web app with its own AI service

The web version runs on Cloudflare Pages: the app itself (`dist`) plus one small
function at `/api/ai` (`functions/api/ai.ts`, logic in `worker/aiProxy.ts`).

- Subs open a URL. No install, no API key.
- Each sub gets an **access code** (AI settings). The server holds the model key.
- Each code has a **daily cap** (`DAILY_LIMIT`, default 25 requests) and there is a
  cap across everyone (`GLOBAL_DAILY_LIMIT`, default 200), so a free tester cannot
  run up the bill. Set a monthly spend limit at the model provider as well.
- The model is a setting, not code: any OpenAI-compatible endpoint. OpenRouter
  (the default) reaches Gemini, Qwen-VL, GPT and Claude with one key.
- Drawings and takeoffs stay in the sub's browser. Only a sheet the sub sends to
  AI (Read with AI, Name sheets with AI) leaves their computer.
- AI is a fallback: assembly types are read from the drawing's own text first,
  and every other tool (fill, walls, rooms, doors, hatches, symbols) needs no AI.

## One-time setup

1. Cloudflare account (free plan is enough) and an OpenRouter account with a
   key and a monthly spend limit.
2. In this folder:

   ```bash
   npm install
   npx wrangler login
   npx wrangler pages project create takeoff-ai --production-branch main
   npx wrangler kv namespace create USAGE      # paste the id into wrangler.toml
   ```

3. In `wrangler.toml` set `AI_MODEL` to a vision model id from openrouter.ai/models.
   Optional: `AI_MODEL_SHEET_NAME` for a cheaper model just for reading sheet names.
   If the model rejects JSON mode, add `AI_JSON_MODE = "off"`.
4. Secrets:

   ```bash
   npx wrangler pages secret put AI_API_KEY      # the OpenRouter key
   npx wrangler pages secret put ACCESS_CODES    # k7Pq2xR9=Joe Drywall;m3Vt8wL4=Sam Ceilings
   ```

   Make codes long and random. To cut someone off, remove their code and put the
   secret again.

## Deploy

```bash
npm run deploy:web
```

It builds with `--mode web` (`.env.web` turns on the access-code route) and uploads
`dist` and `functions`. The address is printed (`takeoff-ai.pages.dev`; a custom
domain can be added in the Cloudflare dashboard).

## Picking the cheapest model that works

1. Deploy with a candidate model.
2. In the app: **More › Show bid workbook scoring**, open a legend sheet (Kelso A0.3),
   **Read with AI**, then **Score against bid workbook…** with the estimator's workbook.
3. Change `AI_MODEL`, redeploy, repeat. Keep the cheapest one that still scores near
   100% (Claude scored 23/23 types and 80/80 layers on A0.3).

## Try it locally

```bash
npm run build:web
printf 'AI_API_KEY=your-key\nACCESS_CODES=test=Me\n' > .dev.vars
npx wrangler pages dev dist --port 8788
```

Open http://localhost:8788, More › AI settings, code `test`. `.dev.vars` is git-ignored.
`test/aiProxy.test.ts` covers codes, caps, the day rollover, request limits and
provider errors without any network.
