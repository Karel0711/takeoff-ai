// Cloudflare Pages Function at /api/ai. The logic and its tests live in worker/aiProxy.ts.
import { handle, type Env } from '../../worker/aiProxy';

export const onRequest = (context: { request: Request; env: Env }) => handle(context.request, context.env);
