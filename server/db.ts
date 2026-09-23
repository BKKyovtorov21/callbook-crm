import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export type DB = Database.Database;

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

export function openDb(file = process.env.DATABASE_PATH ?? path.resolve('data', 'crm.db')): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}
