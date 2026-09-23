// Data migration helpers: import the old SQLite database, copy between KV stores.
import type { KV, Op } from './kv.ts';
import { K } from './store.ts';

const CHUNK = 400; // keep each Redis transaction well under request-size limits

async function execChunked(kv: KV, ops: Op[]) {
  for (let i = 0; i < ops.length; i += CHUNK) await kv.exec(ops.slice(i, i + CHUNK));
}

/** Imports the SQLite database used by earlier versions (data/crm.db). Returns the number of leads. */
export async function importSqlite(file: string, kv: KV): Promise<number> {
  const { createClient } = await import('@libsql/client');
  const db = createClient({ url: `file:${file}` });
  const all = async (sql: string) => (await db.execute(sql)).rows.map((r) => ({ ...r }) as Record<string, unknown>);
  const ops: Op[] = [];
  const set = (key: string, field: unknown, value: unknown) => ops.push({ op: 'hset', key, field: String(field), value: JSON.stringify(value) });

  for (const s of await all('SELECT key, value FROM settings')) set(K.settings, s.key, s.key === 'app' ? JSON.parse(String(s.value)) : s.value);

  const leads = await all('SELECT * FROM leads');
  let maxId = 0;
  for (const { phone_digits: _d, ...l } of leads) {
    maxId = Math.max(maxId, Number(l.id));
    set(K.leads, l.id, { ...l, has_website: !!l.has_website, is_demo: !!l.is_demo });
    if (['Interested', 'Negotiating', 'Won'].includes(String(l.status))) set(K.everInterested, l.id, l.id);
  }
  for (const p of await all('SELECT * FROM projects')) set(K.projects, p.id, p);
  for (const r of await all('SELECT * FROM reminders')) {
    const row = { ...r, completed: !!r.completed };
    set(row.completed ? K.leadReminders(Number(r.lead_id)) : K.reminders, r.id, row);
  }
  for (const i of await all('SELECT * FROM interactions')) {
    set(K.leadInteractions(Number(i.lead_id)), i.id, i);
    set(K.calls, i.id, { id: i.id, lead_id: i.lead_id, type: i.type, date: i.date, result: i.result });
  }
  for (const a of await all('SELECT * FROM activities')) {
    set(K.leadActivities(Number(a.lead_id)), a.id, a);
    if (/→ (Interested|Negotiating|Won)$|status (Interested|Negotiating|Won)$/.test(String(a.text))) set(K.everInterested, a.lead_id, a.lead_id);
  }
  ops.push({ op: 'hset', key: K.seq, field: 'leads', value: String(maxId) });
  await execChunked(kv, ops);
  db.close();
  return leads.length;
}

/** Copies every crm:* hash from one store to another. */
export async function copyKv(from: KV, to: KV) {
  const keys = await from.keys('crm:*');
  const hashes = await from.hgetallMany(keys);
  const ops: Op[] = [];
  keys.forEach((key, i) => {
    for (const [field, value] of Object.entries(hashes[i])) ops.push({ op: 'hset', key, field, value });
  });
  await execChunked(to, ops);
  return keys.length;
}

/** Deletes every crm:* key. */
export async function wipeKv(kv: KV) {
  const keys = await kv.keys('crm:*');
  await execChunked(kv, keys.map((key) => ({ op: 'del' as const, key })));
}
