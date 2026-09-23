import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import { FileKV, MemoryKV } from '../server/kv.ts';
import { K, Store } from '../server/store.ts';
import { createApp } from '../server/app.ts';

describe('Store', () => {
  it('shows buffered writes to later reads and only persists on commit', async () => {
    const kv = new MemoryKV();
    const s = new Store(kv);
    s.set(K.leads, 1, { id: 1, name: 'A' });
    s.set(K.leads, 2, { id: 2, name: 'B' });
    s.del(K.leads, 2);
    expect(await s.values(K.leads)).toEqual([{ id: 1, name: 'A' }]); // loaded after the writes
    expect(await kv.hgetall(K.leads)).toEqual({}); // nothing written yet
    await s.commit();
    expect(Object.keys(await kv.hgetall(K.leads))).toEqual(['1']);
  });

  it('generates unique increasing ids', () => {
    const s = new Store(new MemoryKV());
    const ids = Array.from({ length: 1000 }, () => s.nextId());
    expect(new Set(ids).size).toBe(1000);
    expect([...ids].sort((a, b) => a - b)).toEqual(ids);
    expect(Math.max(...ids)).toBeLessThan(Number.MAX_SAFE_INTEGER);
  });

  it('a failed request writes nothing', async () => {
    const kv = new MemoryKV();
    const app = createApp(kv);
    const id = (await request(app).post('/api/leads').send({ business_name: 'X', phone: '5550102000' })).body.lead.id;
    const before = JSON.stringify(await kv.hgetallMany([K.leads, K.reminders]));
    await request(app).post(`/api/leads/${id}/actions`).send({ action: 'follow_up_later' }).expect(400);
    expect(JSON.stringify(await kv.hgetallMany([K.leads, K.reminders]))).toBe(before);
  });

  it('FileKV survives a restart', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'cb-')), 'crm.json');
    const app = createApp(new FileKV(file));
    await request(app).post('/api/leads').send({ business_name: 'Persisted Plumbing', phone: '5550102000' }).expect(200);
    const again = createApp(new FileKV(file)); // fresh process reading the same file
    const leads = (await request(again).get('/api/leads')).body;
    expect(leads.map((l: { business_name: string }) => l.business_name)).toEqual(['Persisted Plumbing']);
  });
});
