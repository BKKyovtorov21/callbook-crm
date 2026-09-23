// Business logic for the CRM. Routes stay thin; everything that touches more
// than one record (follow-up scheduling, quick actions, projects) lives here.
// Create one CrmService per request and call commit() when the request succeeds:
// all writes are buffered and applied atomically.
import type { KV } from './kv.ts';
import { K, Store } from './store.ts';
import {
  CLOSED_STATUSES,
  DEFAULT_SETTINGS,
  type Activity,
  type Interaction,
  type Lead,
  type LeadDetail,
  type LeadStatus,
  type LeadWithProject,
  type Project,
  type ProjectStatus,
  type ProjectWithLead,
  type QuickActionInput,
  type Reminder,
  type Settings,
} from '../shared/types.ts';
import { computeFollowUp, nowInTz } from '../shared/dates.ts';
import { normalizeUrl } from '../shared/format.ts';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface LeadInput {
  business_name?: string;
  contact_name?: string;
  phone?: string;
  email?: string;
  category?: string;
  location?: string;
  has_website?: boolean;
  existing_website?: string;
  preview_url?: string;
  live_url?: string;
  status?: LeadStatus;
  potential_value?: number | null;
  notes?: string;
  extra_info?: string;
  is_demo?: boolean;
  created_at?: string;
  /** Date ("YYYY-MM-DD") or datetime ("YYYY-MM-DDTHH:mm"). */
  last_contacted_at?: string | null;
  next_follow_up_at?: string | null;
  /** Used when next_follow_up_at is not given: days after the last contact. */
  follow_up_days?: number | null;
  follow_up_notes?: string;
  project_status?: ProjectStatus | null;
  project_notes?: string;
}

export interface InteractionInput {
  type: Interaction['type'];
  date?: string;
  notes?: string;
  result?: string;
  status?: LeadStatus;
  followUpDate?: string | null;
  followUpDays?: number | null;
  skipFollowUp?: boolean;
}

export interface ProjectInput {
  name?: string;
  status?: ProjectStatus;
  start_date?: string | null;
  deadline?: string | null;
  price?: number | null;
  amount_paid?: number | null;
  notes?: string;
  preview_url?: string;
  live_url?: string;
}

export type ReminderWithLead = Reminder & {
  business_name: string;
  phone: string;
  status: LeadStatus;
  contact_name: string;
  last_contacted_at: string | null;
};

type CallRecord = Pick<Interaction, 'id' | 'lead_id' | 'type' | 'date' | 'result'>;

const LEAD_TEXT_FIELDS = [
  'business_name',
  'contact_name',
  'phone',
  'email',
  'category',
  'location',
  'notes',
  'extra_info',
  'follow_up_notes',
] as const;
const LEAD_URL_FIELDS = ['existing_website', 'preview_url', 'live_url'] as const;
const INTERESTED_STATUSES: LeadStatus[] = ['Interested', 'Negotiating', 'Won'];

/** A result means we actually reached the person (vs. a failed attempt). */
const isReach = (result: string | undefined) => !/no answer|voicemail/i.test(result ?? '');

/** Comparator helpers: newest first by a string key, then by id. */
const desc = <T extends { id: number }>(key: (x: T) => string) => (a: T, b: T) =>
  key(a) < key(b) ? 1 : key(a) > key(b) ? -1 : b.id - a.id;

export class CrmService {
  readonly store: Store;
  private settingsMemo?: Settings & { timeZoneStored: boolean };

  constructor(kv: KV) {
    this.store = new Store(kv);
  }

  /** Applies every buffered write atomically. */
  commit() {
    return this.store.commit();
  }

  // ─── settings ────────────────────────────────────────────────────────────

  async getSettings(): Promise<Settings & { timeZoneStored: boolean }> {
    if (!this.settingsMemo) {
      const stored = (await this.store.get<Partial<Settings>>(K.settings, 'app')) ?? {};
      this.settingsMemo = {
        ...DEFAULT_SETTINGS,
        ...stored,
        timeZone: stored.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
        // Tells the browser to fill in its time zone on a fresh server (Vercel runs in UTC).
        timeZoneStored: !!stored.timeZone,
      };
    }
    return this.settingsMemo;
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const { timeZoneStored: _stored, ...current } = await this.getSettings();
    const next: Settings = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
    };
    this.store.set(K.settings, 'app', next);
    this.settingsMemo = undefined;
    return this.getSettings();
  }

  async now(): Promise<string> {
    return nowInTz((await this.getSettings()).timeZone);
  }

  async today(): Promise<string> {
    return (await this.now()).slice(0, 10);
  }

  /** Default next follow-up counted from a contact date. */
  async followUpFrom(date: string, days?: number | null): Promise<string> {
    const s = await this.getSettings();
    return computeFollowUp(date, days ?? s.defaultFollowUpDays, s.skipNonWorkingDays ? s.workingDays : undefined);
  }

  // ─── leads ───────────────────────────────────────────────────────────────

  /** Loads the small shared hashes most operations touch, in one round trip. */
  private core(...extra: string[]) {
    return this.store.load(K.settings, K.leads, K.reminders, K.projects, ...extra);
  }

  private async allLeads() {
    return this.store.values<Lead>(K.leads);
  }

  private async projectOf(leadId: number): Promise<Project | undefined> {
    return (await this.store.values<Project>(K.projects)).find((p) => p.lead_id === leadId);
  }

  async listLeads(): Promise<LeadWithProject[]> {
    await this.store.load(K.leads, K.projects);
    const byLead = new Map((await this.store.values<Project>(K.projects)).map((p) => [p.lead_id, p]));
    return (await this.allLeads())
      .map((l) => {
        const p = byLead.get(l.id);
        return { ...l, project: p ? { id: p.id, status: p.status, deadline: p.deadline } : null };
      })
      .sort(desc((l) => l.created_at));
  }

  private async leadRow(id: number): Promise<Lead> {
    const lead = await this.store.get<Lead>(K.leads, id);
    if (!lead) throw new HttpError(404, 'Lead not found');
    return lead;
  }

  private saveLead(lead: Lead) {
    this.store.set(K.leads, lead.id, lead);
  }

  private async patchLead(id: number, patch: Partial<Lead>) {
    const lead = { ...(await this.leadRow(id)), ...patch, updated_at: await this.now() };
    this.saveLead(lead);
    return lead;
  }

  async getLead(id: number): Promise<LeadDetail> {
    await this.core(K.leadInteractions(id), K.leadActivities(id), K.leadReminders(id));
    const lead = await this.leadRow(id);
    const interactions = (await this.store.values<Interaction>(K.leadInteractions(id))).sort(desc((i) => i.date));
    const open = (await this.store.values<Reminder>(K.reminders)).filter((r) => r.lead_id === id);
    const done = await this.store.values<Reminder>(K.leadReminders(id));
    const reminders = [...open.sort(desc((r) => r.due_date)), ...done.sort(desc((r) => r.due_date))];
    const activities = (await this.store.values<Activity>(K.leadActivities(id))).sort(desc((a) => a.at));
    return { lead, project: (await this.projectOf(id)) ?? null, interactions, reminders, activities };
  }

  private async log(leadId: number, kind: string, text: string, at?: string) {
    const a: Activity = { id: this.store.nextId(), lead_id: leadId, at: at ?? (await this.now()), kind, text };
    this.store.set(K.leadActivities(leadId), a.id, a);
  }

  /** Turns a date or datetime into a local datetime, using the current time for today. */
  private async toDateTime(value: string): Promise<string> {
    if (value.length > 10) return value.slice(0, 16);
    const now = await this.now();
    return value === now.slice(0, 10) ? now : `${value}T12:00`;
  }

  private markInterested(leadId: number, status: LeadStatus) {
    if (INTERESTED_STATUSES.includes(status)) this.store.set(K.everInterested, leadId, leadId);
  }

  async createLead(input: LeadInput): Promise<LeadDetail> {
    await this.core();
    const now = await this.now();
    const today = now.slice(0, 10);
    const status: LeadStatus = input.status ?? 'New';
    const lastContacted = input.last_contacted_at
      ? await this.toDateTime(input.last_contacted_at)
      : status === 'New'
        ? null
        : now;

    const id = await this.store.nextLeadId();
    this.saveLead({
      id,
      business_name: (input.business_name ?? '').trim(),
      contact_name: (input.contact_name ?? '').trim(),
      phone: (input.phone ?? '').trim(),
      email: (input.email ?? '').trim(),
      category: (input.category ?? '').trim(),
      location: (input.location ?? '').trim(),
      has_website: !!input.has_website || !!input.existing_website,
      existing_website: normalizeUrl(input.existing_website),
      preview_url: normalizeUrl(input.preview_url),
      live_url: normalizeUrl(input.live_url),
      status,
      potential_value: input.potential_value ?? null,
      notes: input.notes ?? '',
      extra_info: input.extra_info ?? '',
      is_demo: !!input.is_demo,
      created_at: input.created_at ?? now,
      last_contacted_at: lastContacted,
      next_follow_up_at: null,
      follow_up_notes: input.follow_up_notes ?? '',
      updated_at: now,
    });
    await this.log(id, 'created', `Lead created with status ${status}`, input.created_at ?? now);
    this.markInterested(id, status);

    if (lastContacted && status !== 'New') {
      await this.insertInteraction(id, {
        type: 'Phone Call',
        date: lastContacted,
        notes: input.notes ?? '',
        result: status === 'Interested' ? 'Interested' : status === 'Not Interested' ? 'Not interested' : 'Spoke',
      });
    }

    // Follow-up: explicit date → explicit days → sensible default for the status.
    let followUp: string | null = null;
    let reason = input.follow_up_notes ?? '';
    if (input.next_follow_up_at !== undefined && input.next_follow_up_at !== '') {
      followUp = input.next_follow_up_at;
    } else if (CLOSED_STATUSES.includes(status) || status === 'Won') {
      followUp = null;
    } else if (status === 'New' && !lastContacted) {
      followUp = input.follow_up_days != null ? await this.followUpFrom(today, input.follow_up_days) : today;
      reason ||= 'New lead — first call';
    } else {
      followUp = await this.followUpFrom((lastContacted ?? now).slice(0, 10), input.follow_up_days);
      reason ||= 'Follow-up after call';
    }
    if (followUp) await this.scheduleFollowUp(id, followUp, reason);

    if (status === 'Won' || input.project_status) {
      await this.ensureProject(id, { status: input.project_status ?? 'Not Started', notes: input.project_notes ?? '' });
    }
    return this.getLead(id);
  }

  async updateLead(id: number, input: LeadInput): Promise<LeadDetail> {
    await this.core(K.leadInteractions(id), K.leadActivities(id), K.leadReminders(id));
    const before = await this.leadRow(id);
    const patch: Partial<Lead> = {};
    for (const f of LEAD_TEXT_FIELDS) if (input[f] !== undefined) patch[f] = (input[f] ?? '').trim();
    for (const f of LEAD_URL_FIELDS) if (input[f] !== undefined) patch[f] = normalizeUrl(input[f]);
    if (input.has_website !== undefined) patch.has_website = input.has_website;
    if (input.existing_website && input.has_website === undefined) patch.has_website = true;
    if (input.potential_value !== undefined) patch.potential_value = input.potential_value;
    if (input.last_contacted_at !== undefined)
      patch.last_contacted_at = input.last_contacted_at ? await this.toDateTime(input.last_contacted_at) : null;
    if (input.status !== undefined) patch.status = input.status;
    await this.patchLead(id, patch);

    if (input.next_follow_up_at !== undefined && input.next_follow_up_at !== before.next_follow_up_at) {
      await this.scheduleFollowUp(id, input.next_follow_up_at || null, input.follow_up_notes ?? before.follow_up_notes);
    }
    if (input.status && input.status !== before.status) await this.onStatusChange(id, before.status, input.status);
    if (input.project_status || input.project_notes !== undefined) {
      const existing = await this.projectOf(id);
      if (existing) await this.updateProject(existing.id, { status: input.project_status ?? undefined, notes: input.project_notes });
      else if (input.project_status) await this.ensureProject(id, { status: input.project_status, notes: input.project_notes });
    }
    return this.getLead(id);
  }

  async deleteLead(id: number) {
    await this.core(K.calls);
    await this.leadRow(id);
    this.store.del(K.leads, id);
    const project = await this.projectOf(id);
    if (project) this.store.del(K.projects, project.id);
    for (const r of await this.store.values<Reminder>(K.reminders)) if (r.lead_id === id) this.store.del(K.reminders, r.id);
    for (const c of await this.store.values<CallRecord>(K.calls)) if (c.lead_id === id) this.store.del(K.calls, c.id);
    this.store.del(K.everInterested, id);
    this.store.delKey(K.leadInteractions(id));
    this.store.delKey(K.leadActivities(id));
    this.store.delKey(K.leadReminders(id));
  }

  private async setStatus(id: number, status: LeadStatus) {
    const before = (await this.leadRow(id)).status;
    if (before === status) return;
    await this.patchLead(id, { status });
    await this.onStatusChange(id, before, status);
  }

  private async onStatusChange(id: number, from: LeadStatus, to: LeadStatus) {
    await this.log(id, 'status', `Status changed: ${from} → ${to}`);
    this.markInterested(id, to);
    if (CLOSED_STATUSES.includes(to)) await this.scheduleFollowUp(id, null, '');
    if (to === 'Won') await this.ensureProject(id, {});
  }

  // ─── follow-ups & reminders ──────────────────────────────────────────────

  private async archiveReminder(r: Reminder, completedAt: string) {
    this.store.del(K.reminders, r.id);
    this.store.set(K.leadReminders(r.lead_id), r.id, { ...r, completed: true, completed_at: completedAt });
  }

  /**
   * Replaces the lead's open follow-up reminder. The lead's next_follow_up_at
   * always mirrors the single open follow-up reminder.
   */
  async scheduleFollowUp(leadId: number, date: string | null, notes: string) {
    const now = await this.now();
    for (const r of await this.store.values<Reminder>(K.reminders))
      if (r.lead_id === leadId && r.type === 'follow_up') await this.archiveReminder(r, now);
    if (date) {
      const r: Reminder = { id: this.store.nextId(), lead_id: leadId, due_date: date, type: 'follow_up', completed: false, completed_at: null, notes, created_at: now };
      this.store.set(K.reminders, r.id, r);
    }
    await this.patchLead(leadId, { next_follow_up_at: date, follow_up_notes: date ? notes : '' });
    await this.log(leadId, 'follow_up', date ? `Follow-up scheduled for ${date}${notes ? ` — ${notes}` : ''}` : 'Follow-up cleared');
  }

  async listReminders(): Promise<ReminderWithLead[]> {
    await this.store.load(K.reminders, K.leads);
    const out: ReminderWithLead[] = [];
    for (const r of await this.store.values<Reminder>(K.reminders)) {
      const l = await this.store.get<Lead>(K.leads, r.lead_id);
      if (l)
        out.push({ ...r, business_name: l.business_name, phone: l.phone, status: l.status, contact_name: l.contact_name, last_contacted_at: l.last_contacted_at });
    }
    return out.sort((a, b) => (a.due_date < b.due_date ? -1 : a.due_date > b.due_date ? 1 : a.id - b.id));
  }

  private async openReminder(id: number): Promise<Reminder> {
    const r = await this.store.get<Reminder>(K.reminders, id);
    if (!r) throw new HttpError(404, 'Reminder not found or already completed');
    return r;
  }

  async completeReminder(id: number) {
    await this.core();
    const r = await this.openReminder(id);
    const now = await this.now();
    await this.archiveReminder(r, now);
    const lead = await this.leadRow(r.lead_id);
    if (lead.next_follow_up_at === r.due_date) await this.patchLead(r.lead_id, { next_follow_up_at: null, follow_up_notes: '' });
    await this.log(r.lead_id, 'follow_up', `Follow-up for ${r.due_date} marked completed`);
    return this.getLead(r.lead_id);
  }

  async snoozeReminder(id: number, opts: { days?: number; date?: string }) {
    await this.core();
    const r = await this.openReminder(id);
    const date = opts.date ?? computeFollowUp(await this.today(), opts.days ?? 1);
    this.store.set(K.reminders, r.id, { ...r, due_date: date });
    await this.patchLead(r.lead_id, { next_follow_up_at: date });
    await this.log(r.lead_id, 'follow_up', `Follow-up snoozed to ${date}`);
    return this.getLead(r.lead_id);
  }

  // ─── quick actions ───────────────────────────────────────────────────────

  async quickAction(id: number, input: QuickActionInput): Promise<LeadDetail> {
    await this.core(K.leadInteractions(id), K.leadActivities(id), K.leadReminders(id));
    const lead = await this.leadRow(id);
    const s = await this.getSettings();
    const now = await this.now();
    const today = now.slice(0, 10);
    const note = (input.note ?? '').trim();
    const followUp = async (defaultDays: number) => input.followUpDate || (await this.followUpFrom(today, input.followUpDays ?? defaultDays));
    const touch = () => this.patchLead(id, { last_contacted_at: now });
    const call = (result: string) => this.insertInteraction(id, { type: 'Phone Call', date: now, notes: note, result });

    switch (input.action) {
      case 'called':
        await call('Spoke');
        await touch();
        if (lead.status === 'New') await this.setStatus(id, 'Contacted');
        if (!input.skipFollowUp) await this.scheduleFollowUp(id, await followUp(s.defaultFollowUpDays), 'Follow-up after call');
        break;
      case 'no_answer':
        await call('No answer');
        if (!input.skipFollowUp) await this.scheduleFollowUp(id, await followUp(s.noAnswerRetryDays), 'Retry — no answer last time');
        break;
      case 'interested':
        await call('Interested');
        await touch();
        await this.setStatus(id, 'Interested');
        if (!input.skipFollowUp) await this.scheduleFollowUp(id, await followUp(s.defaultFollowUpDays), 'Interested — follow up');
        else await this.scheduleFollowUp(id, null, '');
        break;
      case 'not_interested':
        await call('Not interested');
        await touch();
        await this.setStatus(id, 'Not Interested');
        await this.scheduleFollowUp(id, null, '');
        break;
      case 'follow_up_later':
        if (!input.followUpDate && !input.followUpDays) throw new HttpError(400, 'Pick a follow-up date');
        await call('Call back later');
        await touch();
        await this.setStatus(id, 'Follow Up Later');
        await this.scheduleFollowUp(id, await followUp(s.defaultFollowUpDays), note || 'Asked to call back later');
        break;
      case 'won':
        await call('Agreed to work together');
        await touch();
        await this.setStatus(id, 'Won');
        await this.scheduleFollowUp(id, input.followUpDate ?? null, input.followUpDate ? 'Project kick-off' : '');
        break;
      case 'note':
        if (!note) throw new HttpError(400, 'Note is empty');
        await this.insertInteraction(id, { type: 'Other', date: now, notes: note, result: 'Note' });
        break;
    }
    return this.getLead(id);
  }

  // ─── interactions ────────────────────────────────────────────────────────

  /** Stores an interaction (also used by the demo seed to write back-dated history). */
  async insertInteraction(leadId: number, i: { type: string; date: string; notes: string; result: string }) {
    const row = { id: this.store.nextId(), lead_id: leadId, ...i, created_at: await this.now() } as Interaction;
    this.store.set(K.leadInteractions(leadId), row.id, row);
    this.store.set(K.calls, row.id, { id: row.id, lead_id: leadId, type: row.type, date: row.date, result: row.result });
    return row.id;
  }

  /** Removes all of a lead's interactions (demo seed uses it to replace the auto-created one). */
  async clearInteractions(leadId: number) {
    for (const i of await this.store.values<Interaction>(K.leadInteractions(leadId))) {
      this.store.del(K.leadInteractions(leadId), i.id);
      this.store.del(K.calls, i.id);
    }
  }

  async addInteraction(leadId: number, input: InteractionInput): Promise<LeadDetail> {
    await this.core(K.leadInteractions(leadId), K.leadActivities(leadId), K.leadReminders(leadId));
    const lead = await this.leadRow(leadId);
    const date = input.date ? await this.toDateTime(input.date) : await this.now();
    await this.insertInteraction(leadId, { type: input.type, date, notes: input.notes ?? '', result: input.result ?? '' });
    await this.log(leadId, 'interaction', `${input.type} logged${input.result ? ` — ${input.result}` : ''}`);

    const isLatest = !lead.last_contacted_at || date >= lead.last_contacted_at;
    const reached = isReach(input.result) && input.result !== 'Note';
    if (reached && isLatest) {
      await this.patchLead(leadId, { last_contacted_at: date });
      if (lead.status === 'New' && !input.status) await this.setStatus(leadId, 'Contacted');
    }
    if (input.status) await this.setStatus(leadId, input.status);

    const closed = CLOSED_STATUSES.includes(input.status ?? lead.status);
    if (!input.skipFollowUp && isLatest && !closed) {
      // Next follow-up is always counted from the new contact date.
      const next = input.followUpDate || (await this.followUpFrom(date.slice(0, 10), input.followUpDays));
      await this.scheduleFollowUp(leadId, next, reached ? 'Follow-up after contact' : 'Retry — no answer last time');
    }
    return this.getLead(leadId);
  }

  private async findInteraction(id: number): Promise<Interaction> {
    const rec = await this.store.get<CallRecord>(K.calls, id);
    const row = rec && (await this.store.get<Interaction>(K.leadInteractions(rec.lead_id), id));
    if (!row) throw new HttpError(404, 'Interaction not found');
    return row;
  }

  async updateInteraction(id: number, input: Partial<InteractionInput>): Promise<LeadDetail> {
    const row = await this.findInteraction(id);
    const next: Interaction = {
      ...row,
      type: input.type ?? row.type,
      date: input.date ? await this.toDateTime(input.date) : row.date,
      notes: input.notes ?? row.notes,
      result: input.result ?? row.result,
    };
    this.store.set(K.leadInteractions(row.lead_id), id, next);
    this.store.set(K.calls, id, { id, lead_id: row.lead_id, type: next.type, date: next.date, result: next.result });
    return this.getLead(row.lead_id);
  }

  async deleteInteraction(id: number): Promise<LeadDetail> {
    const row = await this.findInteraction(id);
    this.store.del(K.leadInteractions(row.lead_id), id);
    this.store.del(K.calls, id);
    return this.getLead(row.lead_id);
  }

  // ─── projects ────────────────────────────────────────────────────────────

  async listProjects(): Promise<ProjectWithLead[]> {
    await this.store.load(K.projects, K.leads);
    const out: ProjectWithLead[] = [];
    for (const p of await this.store.values<Project>(K.projects)) {
      const l = await this.store.get<Lead>(K.leads, p.lead_id);
      if (l)
        out.push({ ...p, business_name: l.business_name, contact_name: l.contact_name, phone: l.phone, preview_url: l.preview_url, live_url: l.live_url, lead_status: l.status });
    }
    // Active first, then by deadline (none last), newest first.
    const rank = (p: Project) => `${p.status === 'Completed' ? 1 : 0}${p.deadline ? `0${p.deadline}` : '1'}`;
    return out.sort((a, b) => (rank(a) < rank(b) ? -1 : rank(a) > rank(b) ? 1 : b.id - a.id));
  }

  /** Creates the lead's website project if it doesn't exist yet (idempotent). */
  async ensureProject(leadId: number, input: ProjectInput): Promise<Project> {
    const existing = await this.projectOf(leadId);
    if (existing) {
      if (input.status && input.status !== existing.status) return this.updateProject(existing.id, { status: input.status });
      return existing;
    }
    const lead = await this.leadRow(leadId);
    const now = await this.now();
    const project: Project = {
      id: this.store.nextId(),
      lead_id: leadId,
      name: input.name?.trim() || `${lead.business_name} website`,
      status: input.status ?? 'Not Started',
      start_date: input.start_date ?? now.slice(0, 10),
      deadline: input.deadline ?? null,
      price: input.price ?? lead.potential_value ?? null,
      amount_paid: input.amount_paid ?? 0,
      notes: input.notes ?? '',
      created_at: now,
      updated_at: now,
    };
    this.store.set(K.projects, project.id, project);
    if (input.preview_url !== undefined || input.live_url !== undefined) await this.setLeadLinks(leadId, input);
    await this.log(leadId, 'project', `Website project created (${project.status})`);
    return project;
  }

  async createProject(leadId: number, input: ProjectInput): Promise<Project> {
    await this.leadRow(leadId);
    if (await this.projectOf(leadId)) throw new HttpError(409, 'This lead already has a project');
    return this.ensureProject(leadId, input);
  }

  private async setLeadLinks(leadId: number, input: ProjectInput) {
    const patch: Partial<Lead> = {};
    if (input.preview_url !== undefined) patch.preview_url = normalizeUrl(input.preview_url);
    if (input.live_url !== undefined) patch.live_url = normalizeUrl(input.live_url);
    if (Object.keys(patch).length) await this.patchLead(leadId, patch);
  }

  async updateProject(id: number, input: ProjectInput): Promise<Project> {
    await this.core();
    const p = await this.store.get<Project>(K.projects, id);
    if (!p) throw new HttpError(404, 'Project not found');
    const next: Project = {
      ...p,
      name: input.name?.trim() || p.name,
      status: input.status ?? p.status,
      start_date: input.start_date !== undefined ? input.start_date || null : p.start_date,
      deadline: input.deadline !== undefined ? input.deadline || null : p.deadline,
      price: input.price !== undefined ? input.price : p.price,
      amount_paid: input.amount_paid !== undefined ? input.amount_paid : p.amount_paid,
      notes: input.notes ?? p.notes,
      updated_at: await this.now(),
    };
    this.store.set(K.projects, id, next);
    await this.setLeadLinks(p.lead_id, input);
    if (next.status !== p.status) await this.log(p.lead_id, 'project', `Project status: ${p.status} → ${next.status}`);
    return next;
  }

  async deleteProject(id: number) {
    const p = await this.store.get<Project>(K.projects, id);
    if (!p) throw new HttpError(404, 'Project not found');
    this.store.del(K.projects, id);
    await this.log(p.lead_id, 'project', 'Website project deleted');
  }

  // ─── analytics ───────────────────────────────────────────────────────────

  /** All interactions (lightweight) for analytics charts. */
  async listInteractions(): Promise<CallRecord[]> {
    return (await this.store.values<CallRecord>(K.calls)).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  }

  /** Lead ids that ever reached Interested (or later). */
  async everInterested(): Promise<number[]> {
    return this.store.values<number>(K.everInterested);
  }

  // ─── maintenance ─────────────────────────────────────────────────────────

  async deleteDemoData(): Promise<number> {
    const demo = (await this.allLeads()).filter((l) => l.is_demo);
    for (const l of demo) await this.deleteLead(l.id);
    return demo.length;
  }

  async exportAll() {
    const leads = await this.allLeads();
    const perLead = await this.store.kv.hgetallMany(leads.flatMap((l) => [K.leadInteractions(l.id), K.leadActivities(l.id), K.leadReminders(l.id)]));
    const parse = (h: Record<string, string>) => Object.values(h).map((v) => JSON.parse(v));
    return {
      exported_at: await this.now(),
      settings: await this.getSettings(),
      leads,
      projects: await this.store.values<Project>(K.projects),
      interactions: perLead.filter((_, i) => i % 3 === 0).flatMap(parse),
      activities: perLead.filter((_, i) => i % 3 === 1).flatMap(parse),
      reminders: [...(await this.store.values<Reminder>(K.reminders)), ...perLead.filter((_, i) => i % 3 === 2).flatMap(parse)],
    };
  }
}
