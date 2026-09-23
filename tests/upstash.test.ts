import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { fakeUpstash } from './fake-upstash.ts';
import { MemoryKV, upstashKV, type KV } from '../server/kv.ts';
import { createApp } from '../server/app.ts';
import { copyKv } from '../server/migrate.ts';
import { addDays, todayInTz } from '../shared/dates.ts';

const fake = fakeUpstash();
let kv: KV;
let app: ReturnType<typeof createApp>;

beforeAll(async () => {
  kv = await upstashKV(await fake.start(), 'test-token');
  app = createApp(kv);
  await request(app).put('/api/settings').send({ timeZone: 'UTC', workingDays: [0, 1, 2, 3, 4, 5, 6] }).expect(200);
});
afterAll(() => fake.stop());

describe('Upstash Redis backend', () => {
  it('runs the core workflow with few round trips', async () => {
    let before = fake.requests();
    const name = 'Заведения Фурнари — "Pizza" ✓';
    const { lead } = (await request(app).post('/api/leads').send({ business_name: name, phone: '5550109999' }).expect(200)).body;
    expect(lead.business_name).toBe(name);
    console.log('round trips — create lead:', fake.requests() - before);
    expect(fake.requests() - before).toBeLessThanOrEqual(4);

    before = fake.requests();
    const called = (await request(app).post(`/api/leads/${lead.id}/actions`).send({ action: 'called', note: 'Spoke to owner' }).expect(200)).body;
    console.log('round trips — mark called:', fake.requests() - before);
    expect(fake.requests() - before).toBeLessThanOrEqual(3);
    expect(called.lead.next_follow_up_at).toBe(addDays(todayInTz('UTC'), 7));
    expect(called.interactions[0].notes).toBe('Spoke to owner');

    const won = (await request(app).post(`/api/leads/${lead.id}/actions`).send({ action: 'won' }).expect(200)).body;
    expect(won.project.status).toBe('Not Started');
    expect((await request(app).get('/api/projects')).body).toHaveLength(1);
    expect((await request(app).get('/api/interactions')).body).toHaveLength(2);
    expect((await request(app).get('/api/analytics/ever-interested')).body).toEqual([lead.id]);

    // A fresh app (like a new serverless instance) reads the same data back.
    const reread = (await request(createApp(kv)).get(`/api/leads/${lead.id}`)).body;
    expect(reread.lead.status).toBe('Won');

    const copy = new MemoryKV();
    expect(await copyKv(kv, copy)).toBeGreaterThan(5);

    await request(app).delete(`/api/leads/${lead.id}`).expect(204);
    expect(fake.keys()).toEqual(['crm:seq', 'crm:settings']);
  });
});
