// Business logic for the CRM. Routes stay thin; everything that touches more
// than one table (follow-up scheduling, quick actions, projects) lives here.
// Create one CrmService per request: it memoizes settings for that request.
import type { Db, Row } from './db.ts';
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
import { normalizeUrl, phoneDigits } from '../shared/format.ts';

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

function toLead(r: Row): Lead {
  const { phone_digits: _digits, ...rest } = r;
  return { ...(rest as unknown as Lead), has_website: !!r.has_website, is_demo: !!r.is_demo };
}
const toReminder = (r: Row) => ({ ...(r as unknown as Reminder), completed: !!r.completed });

/** A result means we actually reached the person (vs. a failed attempt). */
const isReach = (result: string | undefined) => !/no answer|voicemail/i.test(result ?? '');

export type ReminderWithLead = Reminder & {
  business_name: string;
  phone: string;
  status: LeadStatus;
  contact_name: string;
  last_contacted_at: string | null;
};

export class CrmService {
  private settingsMemo?: Settings;

  constructor(private db: Db) {}

  // ─── settings ────────────────────────────────────────────────────────────

  async getSettings(): Promise<Settings & { timeZoneStored: boolean }> {
    if (!this.settingsMemo) {
      const row = await this.db.get<{ value: string }>(`SELECT value FROM settings WHERE key = 'app'`);
      const stored = row ? (JSON.parse(row.value) as Partial<Settings>) : {};
      this.settingsMemo = {
        ...DEFAULT_SETTINGS,
        ...stored,
        timeZone: stored.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC',
        notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
      };
      // Remember whether the time zone was chosen, so the browser can fill it in on a fresh server.
      (this.settingsMemo as Settings & { timeZoneStored?: boolean }).timeZoneStored = !!stored.timeZone;
    }
    return this.settingsMemo as Settings & { timeZoneStored: boolean };
  }

  async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const { timeZoneStored: _stored, ...current } = await this.getSettings();
    const next: Settings = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
    };
    await this.db.run(
      `INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
      [JSON.stringify(next)],
    );
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

  async listLeads(): Promise<LeadWithProject[]> {
    const rows = await this.db.all(
      `SELECT l.*, p.id AS p_id, p.status AS p_status, p.deadline AS p_deadline
         FROM leads l LEFT JOIN projects p ON p.lead_id = l.id
        ORDER BY l.created_at DESC, l.id DESC`,
    );
    return rows.map(({ p_id, p_status, p_deadline, ...r }) => ({
      ...toLead(r),
      project: p_id ? { id: p_id as number, status: p_status as ProjectStatus, deadline: p_deadline as string | null } : null,
    }));
  }

  private async leadRow(id: number): Promise<Lead> {
    const r = await this.db.get(`SELECT * FROM leads WHERE id = ?`, [id]);
    if (!r) throw new HttpError(404, 'Lead not found');
    return toLead(r);
  }

  async getLead(id: number): Promise<LeadDetail> {
    const lead = await this.leadRow(id);
    // Sequential on purpose: a transaction's connection handles one statement at a time.
    const project = await this.db.get<Project>(`SELECT * FROM projects WHERE lead_id = ?`, [id]);
    const interactions = await this.db.all<Interaction>(`SELECT * FROM interactions WHERE lead_id = ? ORDER BY date DESC, id DESC`, [id]);
    const reminders = await this.db.all(`SELECT * FROM reminders WHERE lead_id = ? ORDER BY completed ASC, due_date DESC, id DESC`, [id]);
    const activities = await this.db.all<Activity>(`SELECT * FROM activities WHERE lead_id = ? ORDER BY at DESC, id DESC`, [id]);
    return { lead, project: project ?? null, interactions, reminders: reminders.map(toReminder), activities };
  }

  private async log(leadId: number, kind: string, text: string, at?: string) {
    await this.db.run(`INSERT INTO activities (lead_id, at, kind, text) VALUES (?, ?, ?, ?)`, [
      leadId,
      at ?? (await this.now()),
      kind,
      text,
    ]);
  }

  /** Turns a date or datetime into a local datetime, using the current time for today. */
  private async toDateTime(value: string): Promise<string> {
    if (value.length > 10) return value.slice(0, 16);
    const now = await this.now();
    return value === now.slice(0, 10) ? now : `${value}T12:00`;
  }

  createLead(input: LeadInput): Promise<LeadDetail> {
    return this.db.transaction(async () => {
      const now = await this.now();
      const today = now.slice(0, 10);
      const status: LeadStatus = input.status ?? 'New';
      const lastContacted = input.last_contacted_at
        ? await this.toDateTime(input.last_contacted_at)
        : status === 'New'
          ? null
          : now;

      const info = await this.db.run(
        `INSERT INTO leads (business_name, contact_name, phone, phone_digits, email, category, location,
           has_website, existing_website, preview_url, live_url, status, potential_value, notes, extra_info,
           is_demo, created_at, last_contacted_at, follow_up_notes, updated_at)
         VALUES (:business_name, :contact_name, :phone, :phone_digits, :email, :category, :location,
           :has_website, :existing_website, :preview_url, :live_url, :status, :potential_value, :notes, :extra_info,
           :is_demo, :created_at, :last_contacted_at, :follow_up_notes, :updated_at)`,
        {
          business_name: (input.business_name ?? '').trim(),
          contact_name: (input.contact_name ?? '').trim(),
          phone: (input.phone ?? '').trim(),
          phone_digits: phoneDigits(input.phone),
          email: (input.email ?? '').trim(),
          category: (input.category ?? '').trim(),
          location: (input.location ?? '').trim(),
          has_website: input.has_website || !!input.existing_website ? 1 : 0,
          existing_website: normalizeUrl(input.existing_website),
          preview_url: normalizeUrl(input.preview_url),
          live_url: normalizeUrl(input.live_url),
          status,
          potential_value: input.potential_value ?? null,
          notes: input.notes ?? '',
          extra_info: input.extra_info ?? '',
          is_demo: input.is_demo ? 1 : 0,
          created_at: input.created_at ?? now,
          last_contacted_at: lastContacted,
          follow_up_notes: input.follow_up_notes ?? '',
          updated_at: now,
        },
      );
      const id = info.lastInsertRowid;
      await this.log(id, 'created', `Lead created with status ${status}`, input.created_at ?? now);

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
    });
  }

  updateLead(id: number, input: LeadInput): Promise<LeadDetail> {
    return this.db.transaction(async () => {
      const before = await this.leadRow(id);
      const sets: string[] = [];
      const params: Record<string, string | number | null> = { id };
      const set = (col: string, val: string | number | null) => {
        sets.push(`${col} = :${col}`);
        params[col] = val;
      };

      for (const f of LEAD_TEXT_FIELDS) if (input[f] !== undefined) set(f, (input[f] ?? '').trim());
      for (const f of LEAD_URL_FIELDS) if (input[f] !== undefined) set(f, normalizeUrl(input[f]));
      if (input.phone !== undefined) set('phone_digits', phoneDigits(input.phone));
      if (input.has_website !== undefined) set('has_website', input.has_website ? 1 : 0);
      if (input.existing_website && input.has_website === undefined) set('has_website', 1);
      if (input.potential_value !== undefined) set('potential_value', input.potential_value);
      if (input.last_contacted_at !== undefined)
        set('last_contacted_at', input.last_contacted_at ? await this.toDateTime(input.last_contacted_at) : null);
      if (input.status !== undefined) set('status', input.status);
      set('updated_at', await this.now());
      await this.db.run(`UPDATE leads SET ${sets.join(', ')} WHERE id = :id`, params);

      if (input.next_follow_up_at !== undefined && input.next_follow_up_at !== before.next_follow_up_at) {
        await this.scheduleFollowUp(id, input.next_follow_up_at || null, input.follow_up_notes ?? before.follow_up_notes);
      }
      if (input.status && input.status !== before.status) await this.onStatusChange(id, before.status, input.status);
      if (input.project_status || input.project_notes !== undefined) {
        const existing = await this.db.get<{ id: number }>(`SELECT id FROM projects WHERE lead_id = ?`, [id]);
        if (existing) await this.updateProject(existing.id, { status: input.project_status ?? undefined, notes: input.project_notes });
        else if (input.project_status) await this.ensureProject(id, { status: input.project_status, notes: input.project_notes });
      }
      return this.getLead(id);
    });
  }

  /** Deletes leads and everything attached to them (explicitly — FK cascades aren't guaranteed on every connection). */
  private async deleteLeadsWhere(where: string, args: (string | number)[]): Promise<number> {
    return this.db.transaction(async () => {
      for (const t of ['interactions', 'projects', 'reminders', 'activities'])
        await this.db.run(`DELETE FROM ${t} WHERE lead_id IN (SELECT id FROM leads WHERE ${where})`, args);
      return (await this.db.run(`DELETE FROM leads WHERE ${where}`, args)).changes;
    });
  }

  async deleteLead(id: number) {
    await this.leadRow(id);
    await this.deleteLeadsWhere('id = ?', [id]);
  }

  private async setStatus(id: number, status: LeadStatus) {
    const before = (await this.leadRow(id)).status;
    if (before === status) return;
    await this.db.run(`UPDATE leads SET status = ?, updated_at = ? WHERE id = ?`, [status, await this.now(), id]);
    await this.onStatusChange(id, before, status);
  }

  private async onStatusChange(id: number, from: LeadStatus, to: LeadStatus) {
    await this.log(id, 'status', `Status changed: ${from} → ${to}`);
    if (CLOSED_STATUSES.includes(to)) await this.scheduleFollowUp(id, null, '');
    if (to === 'Won') await this.ensureProject(id, {});
  }

  // ─── follow-ups & reminders ──────────────────────────────────────────────

  /**
   * Replaces the lead's open follow-up reminder. The lead's next_follow_up_at
   * always mirrors the single open follow-up reminder.
   */
  async scheduleFollowUp(leadId: number, date: string | null, notes: string) {
    const now = await this.now();
    await this.db.run(
      `UPDATE reminders SET completed = 1, completed_at = ? WHERE lead_id = ? AND completed = 0 AND type = 'follow_up'`,
      [now, leadId],
    );
    if (date) {
      await this.db.run(`INSERT INTO reminders (lead_id, due_date, type, notes, created_at) VALUES (?, ?, 'follow_up', ?, ?)`, [
        leadId,
        date,
        notes,
        now,
      ]);
    }
    await this.db.run(`UPDATE leads SET next_follow_up_at = ?, follow_up_notes = ?, updated_at = ? WHERE id = ?`, [
      date,
      date ? notes : '',
      now,
      leadId,
    ]);
    await this.log(leadId, 'follow_up', date ? `Follow-up scheduled for ${date}${notes ? ` — ${notes}` : ''}` : 'Follow-up cleared');
  }

  async listReminders(): Promise<ReminderWithLead[]> {
    const rows = await this.db.all(
      `SELECT r.*, l.business_name, l.phone, l.status, l.contact_name, l.last_contacted_at
         FROM reminders r JOIN leads l ON l.id = r.lead_id
        WHERE r.completed = 0
        ORDER BY r.due_date ASC, r.id ASC`,
    );
    return rows.map((r) => toReminder(r) as ReminderWithLead);
  }

  private async reminderRow(id: number): Promise<Reminder> {
    const r = await this.db.get(`SELECT * FROM reminders WHERE id = ?`, [id]);
    if (!r) throw new HttpError(404, 'Reminder not found');
    return toReminder(r);
  }

  completeReminder(id: number) {
    return this.db.transaction(async () => {
      const r = await this.reminderRow(id);
      const now = await this.now();
      await this.db.run(`UPDATE reminders SET completed = 1, completed_at = ? WHERE id = ?`, [now, id]);
      await this.db.run(
        `UPDATE leads SET next_follow_up_at = NULL, follow_up_notes = '', updated_at = ? WHERE id = ? AND next_follow_up_at = ?`,
        [now, r.lead_id, r.due_date],
      );
      await this.log(r.lead_id, 'follow_up', `Follow-up for ${r.due_date} marked completed`);
      return this.getLead(r.lead_id);
    });
  }

  snoozeReminder(id: number, opts: { days?: number; date?: string }) {
    return this.db.transaction(async () => {
      const r = await this.reminderRow(id);
      if (r.completed) throw new HttpError(400, 'Reminder already completed');
      const date = opts.date ?? computeFollowUp(await this.today(), opts.days ?? 1);
      await this.db.run(`UPDATE reminders SET due_date = ? WHERE id = ?`, [date, id]);
      await this.db.run(`UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ?`, [date, await this.now(), r.lead_id]);
      await this.log(r.lead_id, 'follow_up', `Follow-up snoozed to ${date}`);
      return this.getLead(r.lead_id);
    });
  }

  // ─── quick actions ───────────────────────────────────────────────────────

  quickAction(id: number, input: QuickActionInput): Promise<LeadDetail> {
    return this.db.transaction(async () => {
      const lead = await this.leadRow(id);
      const s = await this.getSettings();
      const now = await this.now();
      const today = now.slice(0, 10);
      const note = (input.note ?? '').trim();
      const followUp = async (defaultDays: number) =>
        input.followUpDate || (await this.followUpFrom(today, input.followUpDays ?? defaultDays));
      const touch = () => this.db.run(`UPDATE leads SET last_contacted_at = ?, updated_at = ? WHERE id = ?`, [now, now, id]);
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
    });
  }

  // ─── interactions ────────────────────────────────────────────────────────

  private async insertInteraction(leadId: number, i: { type: string; date: string; notes: string; result: string }) {
    const info = await this.db.run(
      `INSERT INTO interactions (lead_id, type, date, notes, result, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      [leadId, i.type, i.date, i.notes, i.result, await this.now()],
    );
    return info.lastInsertRowid;
  }

  addInteraction(leadId: number, input: InteractionInput): Promise<LeadDetail> {
    return this.db.transaction(async () => {
      const lead = await this.leadRow(leadId);
      const date = input.date ? await this.toDateTime(input.date) : await this.now();
      await this.insertInteraction(leadId, { type: input.type, date, notes: input.notes ?? '', result: input.result ?? '' });
      await this.log(leadId, 'interaction', `${input.type} logged${input.result ? ` — ${input.result}` : ''}`);

      const isLatest = !lead.last_contacted_at || date >= lead.last_contacted_at;
      const reached = isReach(input.result) && input.result !== 'Note';
      if (reached && isLatest) {
        await this.db.run(`UPDATE leads SET last_contacted_at = ?, updated_at = ? WHERE id = ?`, [date, await this.now(), leadId]);
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
    });
  }

  async updateInteraction(id: number, input: Partial<InteractionInput>): Promise<LeadDetail> {
    const row = await this.db.get<Interaction>(`SELECT * FROM interactions WHERE id = ?`, [id]);
    if (!row) throw new HttpError(404, 'Interaction not found');
    await this.db.run(`UPDATE interactions SET type = ?, date = ?, notes = ?, result = ? WHERE id = ?`, [
      input.type ?? row.type,
      input.date ? await this.toDateTime(input.date) : row.date,
      input.notes ?? row.notes,
      input.result ?? row.result,
      id,
    ]);
    return this.getLead(row.lead_id);
  }

  async deleteInteraction(id: number): Promise<LeadDetail> {
    const row = await this.db.get<{ lead_id: number }>(`SELECT lead_id FROM interactions WHERE id = ?`, [id]);
    if (!row) throw new HttpError(404, 'Interaction not found');
    await this.db.run(`DELETE FROM interactions WHERE id = ?`, [id]);
    return this.getLead(row.lead_id);
  }

  // ─── projects ────────────────────────────────────────────────────────────

  listProjects(): Promise<ProjectWithLead[]> {
    return this.db.all<ProjectWithLead>(
      `SELECT p.*, l.business_name, l.contact_name, l.phone, l.preview_url, l.live_url, l.status AS lead_status
         FROM projects p JOIN leads l ON l.id = p.lead_id
        ORDER BY CASE WHEN p.status = 'Completed' THEN 1 ELSE 0 END, p.deadline IS NULL, p.deadline, p.id DESC`,
    );
  }

  /** Creates the lead's website project if it doesn't exist yet (idempotent). */
  async ensureProject(leadId: number, input: ProjectInput): Promise<Project> {
    const existing = await this.db.get<Project>(`SELECT * FROM projects WHERE lead_id = ?`, [leadId]);
    if (existing) {
      if (input.status && input.status !== existing.status) return this.updateProject(existing.id, { status: input.status });
      return existing;
    }
    const lead = await this.leadRow(leadId);
    const now = await this.now();
    const info = await this.db.run(
      `INSERT INTO projects (lead_id, name, status, start_date, deadline, price, amount_paid, notes, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        leadId,
        input.name?.trim() || `${lead.business_name} website`,
        input.status ?? 'Not Started',
        input.start_date ?? now.slice(0, 10),
        input.deadline ?? null,
        input.price ?? lead.potential_value ?? null,
        input.amount_paid ?? 0,
        input.notes ?? '',
        now,
        now,
      ],
    );
    if (input.preview_url !== undefined || input.live_url !== undefined) await this.setLeadLinks(leadId, input);
    await this.log(leadId, 'project', `Website project created (${input.status ?? 'Not Started'})`);
    return (await this.db.get<Project>(`SELECT * FROM projects WHERE id = ?`, [info.lastInsertRowid]))!;
  }

  createProject(leadId: number, input: ProjectInput): Promise<Project> {
    return this.db.transaction(async () => {
      if (await this.db.get(`SELECT 1 AS x FROM projects WHERE lead_id = ?`, [leadId]))
        throw new HttpError(409, 'This lead already has a project');
      return this.ensureProject(leadId, input);
    });
  }

  private async setLeadLinks(leadId: number, input: ProjectInput) {
    if (input.preview_url !== undefined)
      await this.db.run(`UPDATE leads SET preview_url = ? WHERE id = ?`, [normalizeUrl(input.preview_url), leadId]);
    if (input.live_url !== undefined)
      await this.db.run(`UPDATE leads SET live_url = ? WHERE id = ?`, [normalizeUrl(input.live_url), leadId]);
  }

  updateProject(id: number, input: ProjectInput): Promise<Project> {
    return this.db.transaction(async () => {
      const p = await this.db.get<Project>(`SELECT * FROM projects WHERE id = ?`, [id]);
      if (!p) throw new HttpError(404, 'Project not found');
      const next = {
        name: input.name?.trim() || p.name,
        status: input.status ?? p.status,
        start_date: input.start_date !== undefined ? input.start_date || null : p.start_date,
        deadline: input.deadline !== undefined ? input.deadline || null : p.deadline,
        price: input.price !== undefined ? input.price : p.price,
        amount_paid: input.amount_paid !== undefined ? input.amount_paid : p.amount_paid,
        notes: input.notes ?? p.notes,
      };
      await this.db.run(
        `UPDATE projects SET name = :name, status = :status, start_date = :start_date, deadline = :deadline,
           price = :price, amount_paid = :amount_paid, notes = :notes, updated_at = :updated_at WHERE id = :id`,
        { ...next, updated_at: await this.now(), id },
      );
      await this.setLeadLinks(p.lead_id, input);
      if (next.status !== p.status) await this.log(p.lead_id, 'project', `Project status: ${p.status} → ${next.status}`);
      return (await this.db.get<Project>(`SELECT * FROM projects WHERE id = ?`, [id]))!;
    });
  }

  async deleteProject(id: number) {
    const p = await this.db.get<{ lead_id: number }>(`SELECT lead_id FROM projects WHERE id = ?`, [id]);
    if (!p) throw new HttpError(404, 'Project not found');
    await this.db.run(`DELETE FROM projects WHERE id = ?`, [id]);
    await this.log(p.lead_id, 'project', 'Website project deleted');
  }

  // ─── analytics ───────────────────────────────────────────────────────────

  /** All interactions (lightweight) for analytics charts. */
  listInteractions() {
    return this.db.all<Pick<Interaction, 'id' | 'lead_id' | 'type' | 'date' | 'result'>>(
      `SELECT id, lead_id, type, date, result FROM interactions ORDER BY date`,
    );
  }

  /** Lead ids that ever reached Interested (or later) according to history. */
  async everInterested(): Promise<number[]> {
    const rows = await this.db.all<{ lead_id: number }>(
      `SELECT DISTINCT lead_id FROM activities
        WHERE text LIKE '%→ Interested' OR text LIKE '%→ Negotiating' OR text LIKE '%→ Won'
           OR text LIKE '%status Interested' OR text LIKE '%status Negotiating' OR text LIKE '%status Won'`,
    );
    return rows.map((r) => r.lead_id);
  }

  // ─── maintenance ─────────────────────────────────────────────────────────

  deleteDemoData(): Promise<number> {
    return this.deleteLeadsWhere('is_demo = 1', []);
  }

  async exportAll() {
    const all = (t: string) => this.db.all(`SELECT * FROM ${t}`);
    return {
      exported_at: await this.now(),
      settings: await this.getSettings(),
      leads: await all('leads'),
      interactions: await all('interactions'),
      projects: await all('projects'),
      reminders: await all('reminders'),
      activities: await all('activities'),
    };
  }
}
