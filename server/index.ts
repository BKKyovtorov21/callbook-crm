// Node entry point for local development, Docker and any always-on host.
// Uses Turso when TURSO_DATABASE_URL is set, otherwise a local SQLite file.
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { createClient } from '@libsql/client';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { CrmService } from './service.ts';
import { seedDemo } from './seed.ts';

function databaseUrl() {
  if (process.env.TURSO_DATABASE_URL) return process.env.TURSO_DATABASE_URL;
  const file = path.resolve(process.env.DATABASE_PATH ?? path.join('data', 'crm.db'));
  fs.mkdirSync(path.dirname(file), { recursive: true });
  return `file:${file}`;
}

const db = await openDb(createClient({ url: databaseUrl(), authToken: process.env.TURSO_AUTH_TOKEN }));

// First run: load demo data so the app isn't empty.
const count = (await db.get<{ n: number }>('SELECT COUNT(*) AS n FROM leads'))!.n;
const seeded = await db.get(`SELECT 1 AS x FROM settings WHERE key = 'seeded'`);
if (!count && !seeded && process.env.SEED_DEMO !== 'false') {
  await seedDemo(db, new CrmService(db));
  console.log('Loaded demo data.');
}
await db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded', '1')`);

const root = express();
root.use(createApp(db, { password: process.env.APP_PASSWORD }));

// In production, serve the built frontend.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  root.use(express.static(dist, { index: false, maxAge: '1h' }));
  root.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// In dev the API sits behind Vite's proxy on API_PORT; in production PORT serves everything.
const port = Number(process.env.NODE_ENV === 'production' ? (process.env.PORT ?? 3000) : (process.env.API_PORT ?? 3001));
root.listen(port, () => console.log(`Callbook API listening on http://localhost:${port}`));
