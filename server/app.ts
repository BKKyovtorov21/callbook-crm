import express, { type NextFunction, type Request, type Response } from 'express';
import { ZodError, type ZodType } from 'zod';
import type { DB } from './db.ts';
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

type Handler = (req: Request) => unknown;

/** Wraps a sync handler: JSON response, 204 for undefined, errors → JSON. */
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => {
  try {
    const out = fn(req);
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

export function createApp(db: DB) {
  const svc = new CrmService(db);
  const app = express();
  app.use(express.json({ limit: '2mb' }));

  const api = express.Router();

  api.get('/health', h(() => ({ ok: true })));

  // Settings
  api.get('/settings', h(() => svc.getSettings()));
  api.put('/settings', h((req) => svc.updateSettings(parse(settingsSchema, req.body) as never)));

  // Leads
  api.get('/leads', h(() => svc.listLeads()));
  api.post('/leads', h((req) => svc.createLead(parse(leadCreateSchema, req.body))));
  api.get('/leads/:id', h((req) => svc.getLead(id(req))));
  api.patch('/leads/:id', h((req) => svc.updateLead(id(req), parse(leadUpdateSchema, req.body))));
  api.delete('/leads/:id', h((req) => svc.deleteLead(id(req))));
  api.post('/leads/:id/actions', h((req) => svc.quickAction(id(req), parse(quickActionSchema, req.body))));

  // Interactions
  api.get('/interactions', h(() => svc.listInteractions()));
  api.post('/leads/:id/interactions', h((req) => svc.addInteraction(id(req), parse(interactionSchema, req.body))));
  api.patch('/interactions/:id', h((req) => svc.updateInteraction(id(req), parse(interactionSchema.partial(), req.body))));
  api.delete('/interactions/:id', h((req) => svc.deleteInteraction(id(req))));

  // Projects
  api.get('/projects', h(() => svc.listProjects()));
  api.post('/leads/:id/project', h((req) => svc.createProject(id(req), parse(projectSchema, req.body))));
  api.patch('/projects/:id', h((req) => svc.updateProject(id(req), parse(projectSchema, req.body))));
  api.delete('/projects/:id', h((req) => svc.deleteProject(id(req))));

  // Reminders
  api.get('/reminders', h(() => svc.listReminders()));
  api.post('/reminders/:id/complete', h((req) => svc.completeReminder(id(req))));
  api.post('/reminders/:id/snooze', h((req) => svc.snoozeReminder(id(req), parse(snoozeSchema, req.body))));

  // Analytics & maintenance
  api.get('/analytics/ever-interested', h(() => svc.everInterested()));
  api.get('/export', h(() => svc.exportAll()));
  api.post('/demo', h(() => (seedDemo(db, svc), { ok: true })));
  api.delete('/demo', h(() => ({ deleted: svc.deleteDemoData() })));

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

  return { app, svc };
}
