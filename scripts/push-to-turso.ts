// Copies everything from the local SQLite file (data/crm.db) into a Turso database.
//
//   TURSO_DATABASE_URL=libsql://… TURSO_AUTH_TOKEN=… npm run db:push
//
// Refuses to run if the Turso database already has leads (pass --force to replace them).
import path from 'node:path';
import { createClient, type InStatement } from '@libsql/client';
import { openDb, TABLES } from '../server/db.ts';

const url = process.env.TURSO_DATABASE_URL;
if (!url) {
  console.error('Set TURSO_DATABASE_URL and TURSO_AUTH_TOKEN first.');
  process.exit(1);
}
const force = process.argv.includes('--force');
const localFile = path.resolve(process.env.DATABASE_PATH ?? 'data/crm.db');

const local = await openDb(createClient({ url: `file:${localFile}` }));
const remoteClient = createClient({ url, authToken: process.env.TURSO_AUTH_TOKEN });
const remote = await openDb(remoteClient);

const existing = (await remote.get<{ n: number }>('SELECT COUNT(*) AS n FROM leads'))!.n;
if (existing && !force) {
  console.error(`Turso already has ${existing} leads. Re-run with --force to replace them with your local data.`);
  process.exit(1);
}

// Make sure the time zone travels with the data (the server on Vercel runs in UTC).
const app = await local.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'app'`);
const settings = app ? JSON.parse(app.value) : {};
settings.timeZone ??= Intl.DateTimeFormat().resolvedOptions().timeZone;

const statements: InStatement[] = [];
// Children first when deleting, parents first when inserting.
for (const t of [...TABLES].reverse()) statements.push(`DELETE FROM ${t}`);
statements.push(`DELETE FROM sqlite_sequence`);
for (const t of TABLES) {
  const rows = await local.all(`SELECT * FROM ${t}`);
  for (const row of rows) {
    if (t === 'settings' && row.key === 'app') row.value = JSON.stringify(settings);
    const cols = Object.keys(row);
    statements.push({
      sql: `INSERT INTO ${t} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
      args: cols.map((c) => row[c] as never),
    });
  }
  console.log(`${t}: ${rows.length} rows`);
}
if (!app) statements.push({ sql: `INSERT INTO settings (key, value) VALUES ('app', ?)`, args: [JSON.stringify(settings)] });

await remoteClient.batch(statements, 'write');
console.log(`Done — copied ${localFile} to Turso.`);
