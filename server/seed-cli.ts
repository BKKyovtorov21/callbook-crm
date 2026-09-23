// `npm run seed` — adds the demo businesses to the local data file.
import path from 'node:path';
import { FileKV } from './kv.ts';
import { CrmService } from './service.ts';
import { seedDemo } from './seed.ts';

const svc = new CrmService(new FileKV(path.resolve(process.env.DATA_FILE ?? 'data/crm.json')));
await seedDemo(svc);
await svc.commit();
console.log('Demo data added.');
