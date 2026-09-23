// `npm run seed` — adds the demo businesses to the current database.
import { openDb } from './db.ts';
import { CrmService } from './service.ts';
import { seedDemo } from './seed.ts';

const db = openDb();
seedDemo(db, new CrmService(db));
console.log('Demo data added.');
