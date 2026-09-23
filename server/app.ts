import express, { type NextFunction, type Request, type Response } from 'express';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { ZodError, type ZodType } from 'zod';
import type { Db } from './db.ts';
import { CrmService, HttpError } from './service.ts';
import { seedDemo } from './seed.ts';
import {
  interactionSchema,
  leadCreateSchema,
  leadUpdateSchema,
  projectSchema,
  quickActionSchema,
  settingsSchema,
  snoozeSchema,
} from './validation.ts';

type Handler = (req: Request, svc: CrmService) => unknown;

/** Wraps a handler: fresh service per request, JSON response, 204 for undefined, errors → JSON. */
const makeHandler = (db: Db) => (fn: Handler) => async (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = await fn(req, new CrmService(db));
    if (out === undefined) res.status(204).end();
    else res.json(out);
  } catch (e) {
    next(e);
  }
};

const parse = <T>(schema: ZodType<T>, body: unknown): T => schema.parse(body);
const id = (req: Request, key = 'id') => {
  const n = Number(req.params[key]);
  if (!Number.isInteger(n) || n <= 0) throw new HttpError(400, 'Invalid id');
  return n;
};

// ─── password protection ────────────────────────────────────────────────────

const COOKIE = 'cb_session';
const sessionToken = (password: string) => createHmac('sha256', password).update('callbook-session-v1').digest('hex');

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
}

function safeEqual(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

export interface AppOptions {
  /** When set, the API requires logging in with this password. */
  password?: string;
}

export function createApp(db: Db, opts: AppOptions = {}) {
  const app = express();
  app.set('trust proxy', true);
  app.use(express.json({ limit: '5mb' }));
  const h = makeHandler(db);
  const api = express.Router();
  const password = opts.password || undefined;
  const isAuthed = (req: Request) => !password || safeEqual(readCookie(req, COOKIE) ?? '', sessionToken(password));

  api.get('/health', (_req, res) => {
    res.json({ ok: true });
  });
  api.get('/session', (req, res) => {
    res.json({ authRequired: !!password, authenticated: isAuthed(req) });
  });
  api.post('/login', async (req, res) => {
    if (!password) return res.json({ ok: true });
    if (typeof req.body?.password !== 'string' || !safeEqual(req.body.password, password)) {
      await new Promise((r) => setTimeout(r, 600)); // slow down guessing
      return res.status(401).json({ error: 'Wrong password' });
    }
    res.cookie(COOKIE, sessionToken(password), {
      httpOnly: true,
      sameSite: 'lax',
      secure: req.secure,
      path: '/',
      maxAge: 1000 * 60 * 60 * 24 * 60, // 60 days
    });
    res.json({ ok: true });
  });
  api.post('/logout', (_req, res) => {
    res.clearCookie(COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  api.use((req, _res, next) => (isAuthed(req) ? next() : next(new HttpError(401, 'Please log in'))));

  // Settings
  api.get('/settings', h((_req, svc) => svc.getSettings()));
  api.put('/settings', h((req, svc) => svc.updateSettings(parse(settingsSchema, req.body) as never)));

  // Leads
  api.get('/leads', h((_req, svc) => svc.listLeads()));
  api.post('/leads', h((req, svc) => svc.createLead(parse(leadCreateSchema, req.body))));
  api.get('/leads/:id', h((req, svc) => svc.getLead(id(req))));
  api.patch('/leads/:id', h((req, svc) => svc.updateLead(id(req), parse(leadUpdateSchema, req.body))));
  api.delete('/leads/:id', h((req, svc) => svc.deleteLead(id(req))));
  api.post('/leads/:id/actions', h((req, svc) => svc.quickAction(id(req), parse(quickActionSchema, req.body))));

  // Interactions
  api.get('/interactions', h((_req, svc) => svc.listInteractions()));
  api.post('/leads/:id/interactions', h((req, svc) => svc.addInteraction(id(req), parse(interactionSchema, req.body))));
  api.patch('/interactions/:id', h((req, svc) => svc.updateInteraction(id(req), parse(interactionSchema.partial(), req.body))));
  api.delete('/interactions/:id', h((req, svc) => svc.deleteInteraction(id(req))));

  // Projects
  api.get('/projects', h((_req, svc) => svc.listProjects()));
  api.post('/leads/:id/project', h((req, svc) => svc.createProject(id(req), parse(projectSchema, req.body))));
  api.patch('/projects/:id', h((req, svc) => svc.updateProject(id(req), parse(projectSchema, req.body))));
  api.delete('/projects/:id', h((req, svc) => svc.deleteProject(id(req))));

  // Reminders
  api.get('/reminders', h((_req, svc) => svc.listReminders()));
  api.post('/reminders/:id/complete', h((req, svc) => svc.completeReminder(id(req))));
  api.post('/reminders/:id/snooze', h((req, svc) => svc.snoozeReminder(id(req), parse(snoozeSchema, req.body))));

  // Analytics & maintenance
  api.get('/analytics/ever-interested', h((_req, svc) => svc.everInterested()));
  api.get('/export', h((_req, svc) => svc.exportAll()));
  api.post('/demo', h(async (_req, svc) => (await seedDemo(db, svc), { ok: true })));
  api.delete('/demo', h(async (_req, svc) => ({ deleted: await svc.deleteDemoData() })));

  api.use((_req, _res, next) => next(new HttpError(404, 'Not found')));
  app.use('/api', api);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      const issue = err.issues[0];
      res.status(400).json({ error: issue?.message ?? 'Invalid input', field: issue?.path.join('.'), issues: err.issues });
    } else if (err instanceof HttpError) {
      res.status(err.status).json({ error: err.message });
    } else {
      console.error(err);
      res.status(500).json({ error: 'Internal server error' });
    }
  });

  return app;
}
