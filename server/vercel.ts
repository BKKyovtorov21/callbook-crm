// Vercel serverless entry point. Bundled by scripts/build-vercel.mjs into
// .vercel/output/functions/api.func; every /api/* request is routed here.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { remoteKvFromEnv } from './kv.ts';
import { createApp } from './app.ts';

let appPromise: Promise<ReturnType<typeof createApp>> | undefined;

async function makeApp() {
  const kv = await remoteKvFromEnv();
  if (!kv)
    throw new Error(
      'No Redis database is connected. In Vercel → Storage, connect a Redis (Upstash) database to this project, then redeploy.',
    );
  return createApp(kv, { password: process.env.APP_PASSWORD });
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  // The route passes the original sub-path as ?__path=…; restore /api/<path>?<query> for Express.
  const url = new URL(req.url ?? '/', 'http://localhost');
  const sub = url.searchParams.get('__path');
  if (sub !== null) {
    url.searchParams.delete('__path');
    const qs = url.searchParams.toString();
    req.url = `/api/${sub}${qs ? `?${qs}` : ''}`;
  }
  try {
    // Reuse the app (and Redis client) across invocations of a warm function.
    const app = await (appPromise ??= makeApp());
    app(req as never, res as never);
  } catch (e) {
    appPromise = undefined;
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
