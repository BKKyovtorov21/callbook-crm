// Node entry point for local development, Docker and any always-on host.
// Uses Redis when configured (KV_REST_API_* / UPSTASH_REDIS_REST_* / REDIS_URL),
// otherwise a local JSON file (data/crm.json).
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { FileKV, MemoryKV, remoteKvFromEnv, type KV } from './kv.ts';
import { createApp } from './app.ts';
import { CrmService } from './service.ts';
import { seedDemo } from './seed.ts';
import { copyKv, importSqlite } from './migrate.ts';
import { K } from './store.ts';

async function openStore(): Promise<KV> {
  const remote = await remoteKvFromEnv();
  if (remote) {
    console.log('Using Redis.');
    return remote;
  }
  const dataDir = path.dirname(path.resolve(process.env.DATA_FILE ?? path.join('data', 'crm.json')));
  const file = path.resolve(process.env.DATA_FILE ?? path.join(dataDir, 'crm.json'));
  // One-time upgrade from the SQLite database used by earlier versions. Import into memory
  // first and only write the file once it succeeded, so a failed import is simply retried.
  const legacy = path.join(dataDir, 'crm.db');
  if (!FileKV.exists(file) && fs.existsSync(legacy)) {
    const imported = new MemoryKV();
    const n = await importSqlite(legacy, imported); // throws → server doesn't start, nothing written
    await copyKv(imported, new FileKV(file));
    console.log(`Imported ${n} leads from ${legacy} into ${file}.`);
  }
  return new FileKV(file);
}

const kv = await openStore();

// First run: load demo data so the app isn't empty.
const [leads, settings] = await kv.hgetallMany([K.leads, K.settings]);
if (!Object.keys(leads).length && !settings.seeded && process.env.SEED_DEMO !== 'false') {
  const svc = new CrmService(kv);
  await seedDemo(svc);
  await svc.commit();
  console.log('Loaded demo data.');
}
if (!settings.seeded) await kv.exec([{ op: 'hset', key: K.settings, field: 'seeded', value: '1' }]);

const root = express();
root.use(createApp(kv, { password: process.env.APP_PASSWORD }));

// In production, serve the built frontend.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  root.use(express.static(dist, { index: false, maxAge: '1h' }));
  root.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// In dev the API sits behind Vite's proxy on API_PORT; in production PORT serves everything.
const port = Number(process.env.NODE_ENV === 'production' ? (process.env.PORT ?? 3000) : (process.env.API_PORT ?? 3001));
root.listen(port, () => console.log(`Callbook API listening on http://localhost:${port}`));
