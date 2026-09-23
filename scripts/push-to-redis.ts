// Copies your local data (data/crm.json, or the older data/crm.db) into the Redis database.
//
//   Put KV_REST_API_URL and KV_REST_API_TOKEN in .env.local (Vercel → Storage → your database → .env.local tab), then:
//   npm run db:push
//
// Refuses to run if Redis already has leads (pass --force to replace them).
import fs from 'node:fs';
import path from 'node:path';
import { FileKV, MemoryKV, remoteKvFromEnv } from '../server/kv.ts';
import { copyKv, importSqlite, wipeKv } from '../server/migrate.ts';
import { K } from '../server/store.ts';

const remote = await remoteKvFromEnv();
if (!remote) {
  console.error('No Redis credentials found. Add KV_REST_API_URL and KV_REST_API_TOKEN to .env.local first.');
  process.exit(1);
}

const jsonFile = path.resolve('data/crm.json');
const dbFile = path.resolve('data/crm.db');
let local;
if (fs.existsSync(jsonFile)) local = new FileKV(jsonFile);
else if (fs.existsSync(dbFile)) {
  local = new MemoryKV();
  await importSqlite(dbFile, local);
} else {
  console.error('No local data found (data/crm.json or data/crm.db).');
  process.exit(1);
}

const existing = Object.keys(await remote.hgetall(K.leads)).length;
if (existing && !process.argv.includes('--force')) {
  console.error(`Redis already has ${existing} leads. Re-run with --force to replace them with your local data.`);
  process.exit(1);
}
await wipeKv(remote);
const n = await copyKv(local, remote);
const leads = Object.keys(await remote.hgetall(K.leads)).length;
console.log(`Done — copied ${n} keys (${leads} leads) to Redis.`);
