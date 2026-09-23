// Vercel serverless entry point. Bundled by scripts/build-vercel.mjs into
// .vercel/output/functions/api.func; every /api/* request is routed here.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createClient } from '@libsql/client/web';
import { openDb } from './db.ts';
import { createApp } from './app.ts';

let appPromise: Promise<ReturnType<typeof createApp>> | undefined;

function getApp() {
  const url = process.env.TURSO_DATABASE_URL;
  if (!url) throw new Error('TURSO_DATABASE_URL is not set. Add it (and TURSO_AUTH_TOKEN) in Vercel → Settings → Environment Variables.');
  // Reuse the connection across invocations of a warm function.
  appPromise ??= openDb(createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN })).then((db) =>
    createApp(db, { password: process.env.APP_PASSWORD }),
  );
  return appPromise;
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
    const app = await getApp();
    app(req as never, res as never);
  } catch (e) {
    appPromise = undefined;
    console.error(e);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: (e as Error).message }));
  }
}
