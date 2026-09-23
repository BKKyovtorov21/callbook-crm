import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { MemoryKV } from '../server/kv.ts';
import { createApp } from '../server/app.ts';
import { addDays, computeFollowUp, todayInTz } from '../shared/dates.ts';

let app: ReturnType<typeof createApp>;
const memoryDb = async () => new MemoryKV();
const today = () => todayInTz('UTC');

beforeEach(async () => {
  app = createApp(await memoryDb());
  // Every day is a working day so follow-ups land exactly N days later.
  await request(app).put('/api/settings').send({ timeZone: 'UTC', workingDays: [0, 1, 2, 3, 4, 5, 6] }).expect(200);
});

const createLead = (body: object = {}) =>
  request(app).post('/api/leads').send({ business_name: 'Test Plumbing', phone: '555-010-2000', ...body });

describe('dates', () => {
  it('schedules 7 days after the contact date', () => {
    expect(computeFollowUp('2026-09-23', 7)).toBe('2026-09-30');
  });
  it('pushes follow-ups off non-working days', () => {
    // 2026-09-26 is a Saturday → +7 = Saturday → moved to Monday
    expect(computeFollowUp('2026-09-26', 7, [1, 2, 3, 4, 5])).toBe('2026-10-05');
  });
});

describe('primary workflow', () => {
  it('create → call → follow-up → interested → won → project → links → complete', async () => {
    // 1. create
    const created = await createLead({ notes: 'Found on maps' }).expect(200);
    const id = created.body.lead.id;
    expect(created.body.lead.status).toBe('New');
    expect(created.body.lead.next_follow_up_at).toBe(today()); // new leads are due today

    // 2+3. record a call → follow-up in 7 days
    const called = await request(app).post(`/api/leads/${id}/actions`).send({ action: 'called', note: 'Spoke to owner' }).expect(200);
    expect(called.body.lead.status).toBe('Contacted');
    expect(called.body.lead.last_contacted_at.slice(0, 10)).toBe(today());
    expect(called.body.lead.next_follow_up_at).toBe(addDays(today(), 7));
    expect(called.body.interactions[0]).toMatchObject({ type: 'Phone Call', result: 'Spoke', notes: 'Spoke to owner' });

    // 4. exactly one open reminder, due on that date
    const reminders = (await request(app).get('/api/reminders')).body;
    expect(reminders).toHaveLength(1);
    expect(reminders[0]).toMatchObject({ lead_id: id, due_date: addDays(today(), 7), completed: false });

    // snooze + custom follow-up
    const snoozed = await request(app).post(`/api/reminders/${reminders[0].id}/snooze`).send({ days: 3 }).expect(200);
    expect(snoozed.body.lead.next_follow_up_at).toBe(addDays(today(), 3));

    // 5. pipeline moves (kanban drag = PATCH status)
    await request(app).post(`/api/leads/${id}/actions`).send({ action: 'interested' }).expect(200);
    const neg = await request(app).patch(`/api/leads/${id}`).send({ status: 'Negotiating' }).expect(200);
    expect(neg.body.lead.status).toBe('Negotiating');

    // 6. won → project created automatically
    const won = await request(app).post(`/api/leads/${id}/actions`).send({ action: 'won' }).expect(200);
    expect(won.body.lead.status).toBe('Won');
    expect(won.body.project).toMatchObject({ status: 'Not Started', name: 'Test Plumbing website' });

    // 7. links stored on the lead via the project
    const proj = await request(app)
      .patch(`/api/projects/${won.body.project.id}`)
      .send({ status: 'Development', preview_url: 'preview.test-plumbing.com', price: 1500, amount_paid: 500 })
      .expect(200);
    expect(proj.body.status).toBe('Development');
    const detail = (await request(app).get(`/api/leads/${id}`)).body;
    expect(detail.lead.preview_url).toBe('https://preview.test-plumbing.com');

    await request(app).patch(`/api/projects/${proj.body.id}`).send({ status: 'Completed', live_url: 'https://test-plumbing.com' }).expect(200);
    const projects = (await request(app).get('/api/projects')).body;
    expect(projects[0]).toMatchObject({ status: 'Completed', live_url: 'https://test-plumbing.com' });

    // timeline has the full story
    const final = (await request(app).get(`/api/leads/${id}`)).body;
    expect(final.activities.map((a: { text: string }) => a.text).join('\n')).toMatch(/Contacted → Interested/);
  });

  it('no answer schedules a retry and keeps the status', async () => {
    const id = (await createLead()).body.lead.id;
    const r = await request(app).post(`/api/leads/${id}/actions`).send({ action: 'no_answer' }).expect(200);
    expect(r.body.lead.status).toBe('New');
    expect(r.body.lead.next_follow_up_at).toBe(addDays(today(), 1));
    expect(r.body.lead.last_contacted_at).toBeNull();
  });

  it('not interested clears follow-ups', async () => {
    const id = (await createLead()).body.lead.id;
    const r = await request(app).post(`/api/leads/${id}/actions`).send({ action: 'not_interested' }).expect(200);
    expect(r.body.lead.next_follow_up_at).toBeNull();
    expect((await request(app).get('/api/reminders')).body).toHaveLength(0);
  });

  it('logging an interaction recalculates the follow-up from the new contact date', async () => {
    const id = (await createLead()).body.lead.id;
    const date = addDays(today(), -2);
    const r = await request(app)
      .post(`/api/leads/${id}/interactions`)
      .send({ type: 'Email', date, result: 'Sent info', notes: 'Sent pricing', followUpDays: 3 })
      .expect(200);
    expect(r.body.lead.next_follow_up_at).toBe(addDays(date, 3));
    expect(r.body.lead.last_contacted_at.slice(0, 10)).toBe(date);
  });

  it('follow up later requires a date', async () => {
    const id = (await createLead()).body.lead.id;
    await request(app).post(`/api/leads/${id}/actions`).send({ action: 'follow_up_later' }).expect(400);
    const later = addDays(today(), 30);
    const r = await request(app).post(`/api/leads/${id}/actions`).send({ action: 'follow_up_later', followUpDate: later }).expect(200);
    expect(r.body.lead).toMatchObject({ status: 'Follow Up Later', next_follow_up_at: later });
  });
});

describe('validation', () => {
  it('requires business name and phone', async () => {
    await request(app).post('/api/leads').send({ phone: '5550102000' }).expect(400);
    const r = await request(app).post('/api/leads').send({ business_name: 'X' }).expect(400);
    expect(r.body.field).toBe('phone');
  });
  it('rejects invalid URLs and emails', async () => {
    expect((await createLead({ existing_website: 'not a url' }).expect(400)).body.field).toBe('existing_website');
    expect((await createLead({ email: 'nope' }).expect(400)).body.field).toBe('email');
  });
  it('lead deletion cascades', async () => {
    const id = (await createLead()).body.lead.id;
    await request(app).delete(`/api/leads/${id}`).expect(204);
    expect((await request(app).get('/api/reminders')).body).toHaveLength(0);
    await request(app).get(`/api/leads/${id}`).expect(404);
  });
});

describe('demo data', () => {
  it('seeds and removes demo businesses', async () => {
    await request(app).post('/api/demo').expect(200);
    const leads = (await request(app).get('/api/leads')).body;
    expect(leads.length).toBeGreaterThanOrEqual(10);
    expect(new Set(leads.map((l: { status: string }) => l.status)).size).toBeGreaterThanOrEqual(7);
    await request(app).delete('/api/demo').expect(200);
    expect((await request(app).get('/api/leads')).body).toHaveLength(0);
  });
});

describe('password protection', () => {
  it('requires login when a password is set', async () => {
    const secured = createApp(await memoryDb(), { password: 'hunter2' });
    await request(secured).get('/api/leads').expect(401);
    expect((await request(secured).get('/api/session')).body).toEqual({ authRequired: true, authenticated: false });
    await request(secured).post('/api/login').send({ password: 'wrong' }).expect(401);
    const login = await request(secured).post('/api/login').send({ password: 'hunter2' }).expect(200);
    const cookie = login.headers['set-cookie'];
    await request(secured).get('/api/leads').set('Cookie', cookie).expect(200);
    await request(secured).get('/api/leads').set('Cookie', 'cb_session=forged').expect(401);
  });
});
