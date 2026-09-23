// `npm run seed` — adds the demo businesses to the current local database.
import path from 'node:path';
import { createClient } from '@libsql/client';
import { openDb } from './db.ts';
import { CrmService } from './service.ts';
import { seedDemo } from './seed.ts';

const db = await openDb(createClient({ url: `file:${path.resolve(process.env.DATABASE_PATH ?? 'data/crm.db')}` }));
await seedDemo(db, new CrmService(db));
console.log('Demo data added.');
