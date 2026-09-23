import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { openDb } from './db.ts';
import { createApp } from './app.ts';
import { seedDemo } from './seed.ts';

const db = openDb();
const { app, svc } = createApp(db);

// First run: load demo data so the app isn't empty.
const count = (db.prepare('SELECT COUNT(*) AS n FROM leads').get() as { n: number }).n;
const seeded = db.prepare(`SELECT 1 FROM settings WHERE key = 'seeded'`).get();
if (!count && !seeded && process.env.SEED_DEMO !== 'false') {
  seedDemo(db, svc);
  console.log('Loaded demo data.');
}
db.prepare(`INSERT OR IGNORE INTO settings (key, value) VALUES ('seeded', '1')`).run();

// Optional password protection for deployments (HTTP Basic auth; any username).
const password = process.env.APP_PASSWORD;
const root = express();
if (password) {
  root.use((req, res, next) => {
    const [, encoded = ''] = (req.headers.authorization ?? '').split(' ');
    const supplied = Buffer.from(encoded, 'base64').toString().split(':').slice(1).join(':');
    if (supplied === password) return next();
    res.set('WWW-Authenticate', 'Basic realm="Callbook"').status(401).send('Authentication required');
  });
}
root.use(app);

// In production, serve the built frontend.
const dist = path.resolve('dist');
if (fs.existsSync(dist)) {
  root.use(express.static(dist, { index: false, maxAge: '1h' }));
  root.get(/^\/(?!api\/).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

// In dev the API sits behind Vite's proxy on API_PORT; in production PORT serves everything.
const port = Number(process.env.NODE_ENV === 'production' ? (process.env.PORT ?? 3000) : (process.env.API_PORT ?? 3001));
root.listen(port, () => console.log(`Callbook API listening on http://localhost:${port}`));
