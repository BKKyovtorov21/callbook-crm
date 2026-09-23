// Database access over libSQL: a local SQLite file in development, Turso in production.
// All queries go through the small `Db` interface so the service layer never sees the driver.
import { AsyncLocalStorage } from 'node:async_hooks';
import type { Client, InArgs, Transaction } from '@libsql/client';

export type Row = Record<string, unknown>;

export interface Db {
  all<T = Row>(sql: string, args?: InArgs): Promise<T[]>;
  get<T = Row>(sql: string, args?: InArgs): Promise<T | undefined>;
  run(sql: string, args?: InArgs): Promise<{ changes: number; lastInsertRowid: number }>;
  /** Runs `fn` in a write transaction. Nested calls join the outer transaction. */
  transaction<T>(fn: () => Promise<T>): Promise<T>;
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS leads (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  business_name     TEXT    NOT NULL,
  contact_name      TEXT    NOT NULL DEFAULT '',
  phone             TEXT    NOT NULL DEFAULT '',
  phone_digits      TEXT    NOT NULL DEFAULT '',
  email             TEXT    NOT NULL DEFAULT '',
  category          TEXT    NOT NULL DEFAULT '',
  location          TEXT    NOT NULL DEFAULT '',
  has_website       INTEGER NOT NULL DEFAULT 0,
  existing_website  TEXT    NOT NULL DEFAULT '',
  preview_url       TEXT    NOT NULL DEFAULT '',
  live_url          TEXT    NOT NULL DEFAULT '',
  status            TEXT    NOT NULL DEFAULT 'New',
  potential_value   REAL,
  notes             TEXT    NOT NULL DEFAULT '',
  extra_info        TEXT    NOT NULL DEFAULT '',
  is_demo           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT    NOT NULL,
  last_contacted_at TEXT,
  next_follow_up_at TEXT,
  follow_up_notes   TEXT    NOT NULL DEFAULT '',
  updated_at        TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_leads_status   ON leads(status);
CREATE INDEX IF NOT EXISTS idx_leads_followup ON leads(next_follow_up_at);
CREATE INDEX IF NOT EXISTS idx_leads_phone    ON leads(phone_digits);

CREATE TABLE IF NOT EXISTS interactions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id    INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  type       TEXT    NOT NULL,
  date       TEXT    NOT NULL,
  notes      TEXT    NOT NULL DEFAULT '',
  result     TEXT    NOT NULL DEFAULT '',
  created_at TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_interactions_lead ON interactions(lead_id, date);

CREATE TABLE IF NOT EXISTS projects (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id     INTEGER NOT NULL UNIQUE REFERENCES leads(id) ON DELETE CASCADE,
  name        TEXT    NOT NULL,
  status      TEXT    NOT NULL DEFAULT 'Not Started',
  start_date  TEXT,
  deadline    TEXT,
  price       REAL,
  amount_paid REAL,
  notes       TEXT    NOT NULL DEFAULT '',
  created_at  TEXT    NOT NULL,
  updated_at  TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS reminders (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id      INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  due_date     TEXT    NOT NULL,
  type         TEXT    NOT NULL DEFAULT 'follow_up',
  completed    INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT,
  notes        TEXT    NOT NULL DEFAULT '',
  created_at   TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reminders_open ON reminders(completed, due_date);
CREATE INDEX IF NOT EXISTS idx_reminders_lead ON reminders(lead_id);

CREATE TABLE IF NOT EXISTS activities (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  lead_id INTEGER NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  at      TEXT    NOT NULL,
  kind    TEXT    NOT NULL,
  text    TEXT    NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_activities_lead ON activities(lead_id, at);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`;

export const TABLES = ['settings', 'leads', 'interactions', 'projects', 'reminders', 'activities'] as const;

/** Wraps a libSQL client (from `@libsql/client` or `@libsql/client/web`) and ensures the schema exists. */
export async function openDb(client: Client): Promise<Db> {
  const active = new AsyncLocalStorage<Transaction>();
  const exec = (sql: string, args: InArgs = []) => (active.getStore() ?? client).execute({ sql, args });
  const plain = (rows: object[]) => rows.map((r) => ({ ...r }));

  const db: Db = {
    async all<T>(sql: string, args?: InArgs) {
      return plain((await exec(sql, args)).rows) as T[];
    },
    async get<T>(sql: string, args?: InArgs) {
      return plain((await exec(sql, args)).rows)[0] as T | undefined;
    },
    async run(sql, args) {
      const rs = await exec(sql, args);
      return { changes: rs.rowsAffected, lastInsertRowid: Number(rs.lastInsertRowid ?? 0) };
    },
    async transaction(fn) {
      if (active.getStore()) return fn();
      const tx = await client.transaction('write');
      try {
        const out = await active.run(tx, fn);
        await tx.commit();
        return out;
      } catch (e) {
        await tx.rollback().catch(() => {});
        throw e;
      } finally {
        tx.close();
      }
    },
  };

  await client.execute('PRAGMA foreign_keys = ON').catch(() => {});
  await client.executeMultiple(SCHEMA);
  return db;
}
