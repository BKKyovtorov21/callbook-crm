// Business logic for the CRM. Routes stay thin; everything that touches more
// than one table (follow-up scheduling, quick actions, projects) lives here.
import type { DB } from './db.ts';
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

type Row = Record<string, unknown>;

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

export class CrmService {
  constructor(private db: DB) {}

  // ─── settings ────────────────────────────────────────────────────────────

  getSettings(): Settings {
    const row = this.db.prepare(`SELECT value FROM settings WHERE key = 'app'`).get() as { value: string } | undefined;
    const stored = row ? (JSON.parse(row.value) as Partial<Settings>) : {};
    const timeZone = stored.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone ?? 'UTC';
    return {
      ...DEFAULT_SETTINGS,
      ...stored,
      timeZone,
      notifications: { ...DEFAULT_SETTINGS.notifications, ...stored.notifications },
    };
  }

  updateSettings(patch: Partial<Settings>): Settings {
    const current = this.getSettings();
    const next: Settings = {
      ...current,
      ...patch,
      notifications: { ...current.notifications, ...patch.notifications },
    };
    this.db
      .prepare(`INSERT INTO settings (key, value) VALUES ('app', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify(next));
    return next;
  }

  now(): string {
    return nowInTz(this.getSettings().timeZone);
  }

  today(): string {
    return this.now().slice(0, 10);
  }

  /** Default next follow-up counted from a contact date. */
  followUpFrom(date: string, days?: number | null): string {
    const s = this.getSettings();
    return computeFollowUp(date, days ?? s.defaultFollowUpDays, s.skipNonWorkingDays ? s.workingDays : undefined);
  }

  // ─── leads ───────────────────────────────────────────────────────────────

  listLeads(): LeadWithProject[] {
    const rows = this.db
      .prepare(
        `SELECT l.*, p.id AS p_id, p.status AS p_status, p.deadline AS p_deadline
           FROM leads l LEFT JOIN projects p ON p.lead_id = l.id
          ORDER BY l.created_at DESC, l.id DESC`,
      )
      .all() as Row[];
    return rows.map(({ p_id, p_status, p_deadline, ...r }) => ({
      ...toLead(r),
      project: p_id ? { id: p_id as number, status: p_status as ProjectStatus, deadline: p_deadline as string | null } : null,
    }));
  }

  private leadRow(id: number): Lead {
    const r = this.db.prepare(`SELECT * FROM leads WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new HttpError(404, 'Lead not found');
    return toLead(r);
  }

  getLead(id: number): LeadDetail {
    const lead = this.leadRow(id);
    const project = (this.db.prepare(`SELECT * FROM projects WHERE lead_id = ?`).get(id) as Project | undefined) ?? null;
    const interactions = this.db
      .prepare(`SELECT * FROM interactions WHERE lead_id = ? ORDER BY date DESC, id DESC`)
      .all(id) as Interaction[];
    const reminders = (
      this.db.prepare(`SELECT * FROM reminders WHERE lead_id = ? ORDER BY completed ASC, due_date DESC, id DESC`).all(id) as Row[]
    ).map(toReminder);
    const activities = this.db
      .prepare(`SELECT * FROM activities WHERE lead_id = ? ORDER BY at DESC, id DESC`)
      .all(id) as Activity[];
    return { lead, project, interactions, reminders, activities };
  }

  private log(leadId: number, kind: string, text: string, at = this.now()) {
    this.db.prepare(`INSERT INTO activities (lead_id, at, kind, text) VALUES (?, ?, ?, ?)`).run(leadId, at, kind, text);
  }

  /** Turns a date or datetime into a local datetime, using the current time for today. */
  private toDateTime(value: string): string {
    if (value.length > 10) return value.slice(0, 16);
    const now = this.now();
    return value === now.slice(0, 10) ? now : `${value}T12:00`;
  }

  createLead(input: LeadInput): LeadDetail {
    return this.db.transaction(() => {
      const now = this.now();
      const status: LeadStatus = input.status ?? 'New';
      const lastContacted = input.last_contacted_at
        ? this.toDateTime(input.last_contacted_at)
        : status === 'New'
          ? null
          : now;

      const info = this.db
        .prepare(
          `INSERT INTO leads (business_name, contact_name, phone, phone_digits, email, category, location,
             has_website, existing_website, preview_url, live_url, status, potential_value, notes, extra_info,
             is_demo, created_at, last_contacted_at, follow_up_notes, updated_at)
           VALUES (@business_name, @contact_name, @phone, @phone_digits, @email, @category, @location,
             @has_website, @existing_website, @preview_url, @live_url, @status, @potential_value, @notes, @extra_info,
             @is_demo, @created_at, @last_contacted_at, @follow_up_notes, @updated_at)`,
        )
        .run({
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
        });
      const id = Number(info.lastInsertRowid);
      this.log(id, 'created', `Lead created with status ${status}`, input.created_at ?? now);

      if (lastContacted && status !== 'New') {
        this.insertInteraction(id, {
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
        followUp = input.follow_up_days != null ? this.followUpFrom(this.today(), input.follow_up_days) : this.today();
        reason ||= 'New lead — first call';
      } else {
        followUp = this.followUpFrom((lastContacted ?? now).slice(0, 10), input.follow_up_days);
        reason ||= 'Follow-up after call';
      }
      if (followUp) this.scheduleFollowUp(id, followUp, reason);

      if (status === 'Won' || input.project_status) {
        this.ensureProject(id, { status: input.project_status ?? 'Not Started', notes: input.project_notes ?? '' });
      }
      return this.getLead(id);
    })();
  }

  updateLead(id: number, input: LeadInput): LeadDetail {
    return this.db.transaction(() => {
      const before = this.leadRow(id);
      const sets: string[] = [];
      const params: Record<string, unknown> = { id };
      const set = (col: string, val: unknown) => {
        sets.push(`${col} = @${col}`);
        params[col] = val;
      };

      for (const f of LEAD_TEXT_FIELDS) if (input[f] !== undefined) set(f, (input[f] ?? '').trim());
      for (const f of LEAD_URL_FIELDS) if (input[f] !== undefined) set(f, normalizeUrl(input[f]));
      if (input.phone !== undefined) set('phone_digits', phoneDigits(input.phone));
      if (input.has_website !== undefined) set('has_website', input.has_website ? 1 : 0);
      if (input.existing_website && input.has_website === undefined) set('has_website', 1);
      if (input.potential_value !== undefined) set('potential_value', input.potential_value);
      if (input.last_contacted_at !== undefined)
        set('last_contacted_at', input.last_contacted_at ? this.toDateTime(input.last_contacted_at) : null);
      if (input.status !== undefined) set('status', input.status);
      set('updated_at', this.now());
      this.db.prepare(`UPDATE leads SET ${sets.join(', ')} WHERE id = @id`).run(params);

      if (input.next_follow_up_at !== undefined && input.next_follow_up_at !== before.next_follow_up_at) {
        this.scheduleFollowUp(id, input.next_follow_up_at || null, input.follow_up_notes ?? before.follow_up_notes);
      }
      if (input.status && input.status !== before.status) this.onStatusChange(id, before.status, input.status);
      if (input.project_status || input.project_notes !== undefined) {
        const existing = this.db.prepare(`SELECT id FROM projects WHERE lead_id = ?`).get(id) as { id: number } | undefined;
        if (existing) this.updateProject(existing.id, { status: input.project_status ?? undefined, notes: input.project_notes });
        else if (input.project_status) this.ensureProject(id, { status: input.project_status, notes: input.project_notes });
      }
      return this.getLead(id);
    })();
  }

  deleteLead(id: number) {
    this.leadRow(id);
    this.db.prepare(`DELETE FROM leads WHERE id = ?`).run(id);
  }

  private setStatus(id: number, status: LeadStatus) {
    const before = this.leadRow(id).status;
    if (before === status) return;
    this.db.prepare(`UPDATE leads SET status = ?, updated_at = ? WHERE id = ?`).run(status, this.now(), id);
    this.onStatusChange(id, before, status);
  }

  private onStatusChange(id: number, from: LeadStatus, to: LeadStatus) {
    this.log(id, 'status', `Status changed: ${from} → ${to}`);
    if (CLOSED_STATUSES.includes(to)) this.scheduleFollowUp(id, null, '');
    if (to === 'Won') this.ensureProject(id, {});
  }

  // ─── follow-ups & reminders ──────────────────────────────────────────────

  /**
   * Replaces the lead's open follow-up reminder. The lead's next_follow_up_at
   * always mirrors the single open follow-up reminder.
   */
  scheduleFollowUp(leadId: number, date: string | null, notes: string) {
    const now = this.now();
    this.db
      .prepare(`UPDATE reminders SET completed = 1, completed_at = ? WHERE lead_id = ? AND completed = 0 AND type = 'follow_up'`)
      .run(now, leadId);
    if (date) {
      this.db
        .prepare(`INSERT INTO reminders (lead_id, due_date, type, notes, created_at) VALUES (?, ?, 'follow_up', ?, ?)`)
        .run(leadId, date, notes, now);
    }
    this.db
      .prepare(`UPDATE leads SET next_follow_up_at = ?, follow_up_notes = ?, updated_at = ? WHERE id = ?`)
      .run(date, date ? notes : '', now, leadId);
    this.log(leadId, 'follow_up', date ? `Follow-up scheduled for ${date}${notes ? ` — ${notes}` : ''}` : 'Follow-up cleared');
  }

  listReminders(): (Reminder & { business_name: string; phone: string; status: LeadStatus; contact_name: string; last_contacted_at: string | null })[] {
    return (
      this.db
        .prepare(
          `SELECT r.*, l.business_name, l.phone, l.status, l.contact_name, l.last_contacted_at
             FROM reminders r JOIN leads l ON l.id = r.lead_id
            WHERE r.completed = 0
            ORDER BY r.due_date ASC, r.id ASC`,
        )
        .all() as Row[]
    ).map((r) => toReminder(r) as never);
  }

  private reminderRow(id: number): Reminder {
    const r = this.db.prepare(`SELECT * FROM reminders WHERE id = ?`).get(id) as Row | undefined;
    if (!r) throw new HttpError(404, 'Reminder not found');
    return toReminder(r);
  }

  completeReminder(id: number) {
    return this.db.transaction(() => {
      const r = this.reminderRow(id);
      const now = this.now();
      this.db.prepare(`UPDATE reminders SET completed = 1, completed_at = ? WHERE id = ?`).run(now, id);
      this.db
        .prepare(`UPDATE leads SET next_follow_up_at = NULL, follow_up_notes = '', updated_at = ? WHERE id = ? AND next_follow_up_at = ?`)
        .run(now, r.lead_id, r.due_date);
      this.log(r.lead_id, 'follow_up', `Follow-up for ${r.due_date} marked completed`);
      return this.getLead(r.lead_id);
    })();
  }

  snoozeReminder(id: number, opts: { days?: number; date?: string }) {
    return this.db.transaction(() => {
      const r = this.reminderRow(id);
      if (r.completed) throw new HttpError(400, 'Reminder already completed');
      const date = opts.date ?? computeFollowUp(this.today(), opts.days ?? 1);
      this.db.prepare(`UPDATE reminders SET due_date = ? WHERE id = ?`).run(date, id);
      this.db.prepare(`UPDATE leads SET next_follow_up_at = ?, updated_at = ? WHERE id = ?`).run(date, this.now(), r.lead_id);
      this.log(r.lead_id, 'follow_up', `Follow-up snoozed to ${date}`);
      return this.getLead(r.lead_id);
    })();
  }

  // ─── quick actions ───────────────────────────────────────────────────────

  quickAction(id: number, input: QuickActionInput): LeadDetail {
    return this.db.transaction(() => {
      const lead = this.leadRow(id);
      const s = this.getSettings();
      const now = this.now();
      const today = now.slice(0, 10);
      const note = (input.note ?? '').trim();
      const followUp = (defaultDays: number) =>
        input.followUpDate || this.followUpFrom(today, input.followUpDays ?? defaultDays);
      const touch = () => this.db.prepare(`UPDATE leads SET last_contacted_at = ?, updated_at = ? WHERE id = ?`).run(now, now, id);
      const call = (result: string) => this.insertInteraction(id, { type: 'Phone Call', date: now, notes: note, result });

      switch (input.action) {
        case 'called':
          call('Spoke');
          touch();
          if (lead.status === 'New') this.setStatus(id, 'Contacted');
          if (!input.skipFollowUp) this.scheduleFollowUp(id, followUp(s.defaultFollowUpDays), 'Follow-up after call');
          break;
        case 'no_answer':
          call('No answer');
          if (!input.skipFollowUp) this.scheduleFollowUp(id, followUp(s.noAnswerRetryDays), 'Retry — no answer last time');
          break;
        case 'interested':
          call('Interested');
          touch();
          this.setStatus(id, 'Interested');
          if (!input.skipFollowUp) this.scheduleFollowUp(id, followUp(s.defaultFollowUpDays), 'Interested — follow up');
          else this.scheduleFollowUp(id, null, '');
          break;
        case 'not_interested':
          call('Not interested');
          touch();
          this.setStatus(id, 'Not Interested');
          this.scheduleFollowUp(id, null, '');
          break;
        case 'follow_up_later':
          if (!input.followUpDate && !input.followUpDays) throw new HttpError(400, 'Pick a follow-up date');
          call('Call back later');
          touch();
          this.setStatus(id, 'Follow Up Later');
          this.scheduleFollowUp(id, followUp(s.defaultFollowUpDays), note || 'Asked to call back later');
          break;
        case 'won':
          call('Agreed to work together');
          touch();
          this.setStatus(id, 'Won');
          this.scheduleFollowUp(id, input.followUpDate ?? null, input.followUpDate ? 'Project kick-off' : '');
          break;
        case 'note':
          if (!note) throw new HttpError(400, 'Note is empty');
          this.insertInteraction(id, { type: 'Other', date: now, notes: note, result: 'Note' });
          break;
      }
      return this.getLead(id);
    })();
  }

  // ─── interactions ────────────────────────────────────────────────────────

  private insertInteraction(leadId: number, i: { type: string; date: string; notes: string; result: string }) {
    const info = this.db
      .prepare(`INSERT INTO interactions (lead_id, type, date, notes, result, created_at) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(leadId, i.type, i.date, i.notes, i.result, this.now());
    return Number(info.lastInsertRowid);
  }

  addInteraction(leadId: number, input: InteractionInput): LeadDetail {
    return this.db.transaction(() => {
      const lead = this.leadRow(leadId);
      const date = input.date ? this.toDateTime(input.date) : this.now();
      this.insertInteraction(leadId, { type: input.type, date, notes: input.notes ?? '', result: input.result ?? '' });
      this.log(leadId, 'interaction', `${input.type} logged${input.result ? ` — ${input.result}` : ''}`);

      const isLatest = !lead.last_contacted_at || date >= lead.last_contacted_at;
      const reached = isReach(input.result) && input.result !== 'Note';
      if (reached && isLatest) {
        this.db.prepare(`UPDATE leads SET last_contacted_at = ?, updated_at = ? WHERE id = ?`).run(date, this.now(), leadId);
        if (lead.status === 'New' && !input.status) this.setStatus(leadId, 'Contacted');
      }
      if (input.status) this.setStatus(leadId, input.status);

      const closed = CLOSED_STATUSES.includes(input.status ?? lead.status);
      if (!input.skipFollowUp && isLatest && !closed) {
        // Next follow-up is always counted from the new contact date.
        const next = input.followUpDate || this.followUpFrom(date.slice(0, 10), input.followUpDays);
        this.scheduleFollowUp(leadId, next, reached ? 'Follow-up after contact' : 'Retry — no answer last time');
      }
      return this.getLead(leadId);
    })();
  }

  updateInteraction(id: number, input: Partial<InteractionInput>): LeadDetail {
    const row = this.db.prepare(`SELECT * FROM interactions WHERE id = ?`).get(id) as Interaction | undefined;
    if (!row) throw new HttpError(404, 'Interaction not found');
    this.db
      .prepare(`UPDATE interactions SET type = ?, date = ?, notes = ?, result = ? WHERE id = ?`)
      .run(
        input.type ?? row.type,
        input.date ? this.toDateTime(input.date) : row.date,
        input.notes ?? row.notes,
        input.result ?? row.result,
        id,
      );
    return this.getLead(row.lead_id);
  }

  deleteInteraction(id: number): LeadDetail {
    const row = this.db.prepare(`SELECT lead_id FROM interactions WHERE id = ?`).get(id) as { lead_id: number } | undefined;
    if (!row) throw new HttpError(404, 'Interaction not found');
    this.db.prepare(`DELETE FROM interactions WHERE id = ?`).run(id);
    return this.getLead(row.lead_id);
  }

  // ─── projects ────────────────────────────────────────────────────────────

  listProjects(): ProjectWithLead[] {
    return this.db
      .prepare(
        `SELECT p.*, l.business_name, l.contact_name, l.phone, l.preview_url, l.live_url, l.status AS lead_status
           FROM projects p JOIN leads l ON l.id = p.lead_id
          ORDER BY CASE WHEN p.status = 'Completed' THEN 1 ELSE 0 END, p.deadline IS NULL, p.deadline, p.id DESC`,
      )
      .all() as ProjectWithLead[];
  }

  /** Creates the lead's website project if it doesn't exist yet (idempotent). */
  ensureProject(leadId: number, input: ProjectInput): Project {
    const existing = this.db.prepare(`SELECT * FROM projects WHERE lead_id = ?`).get(leadId) as Project | undefined;
    if (existing) {
      if (input.status && input.status !== existing.status) return this.updateProject(existing.id, { status: input.status });
      return existing;
    }
    const lead = this.leadRow(leadId);
    const now = this.now();
    const info = this.db
      .prepare(
        `INSERT INTO projects (lead_id, name, status, start_date, deadline, price, amount_paid, notes, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
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
      );
    if (input.preview_url !== undefined || input.live_url !== undefined) this.setLeadLinks(leadId, input);
    this.log(leadId, 'project', `Website project created (${input.status ?? 'Not Started'})`);
    return this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(Number(info.lastInsertRowid)) as Project;
  }

  createProject(leadId: number, input: ProjectInput): Project {
    return this.db.transaction(() => {
      if (this.db.prepare(`SELECT 1 FROM projects WHERE lead_id = ?`).get(leadId))
        throw new HttpError(409, 'This lead already has a project');
      return this.ensureProject(leadId, input);
    })();
  }

  private setLeadLinks(leadId: number, input: ProjectInput) {
    if (input.preview_url !== undefined)
      this.db.prepare(`UPDATE leads SET preview_url = ? WHERE id = ?`).run(normalizeUrl(input.preview_url), leadId);
    if (input.live_url !== undefined)
      this.db.prepare(`UPDATE leads SET live_url = ? WHERE id = ?`).run(normalizeUrl(input.live_url), leadId);
  }

  updateProject(id: number, input: ProjectInput): Project {
    return this.db.transaction(() => {
      const p = this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Project | undefined;
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
      this.db
        .prepare(
          `UPDATE projects SET name = @name, status = @status, start_date = @start_date, deadline = @deadline,
             price = @price, amount_paid = @amount_paid, notes = @notes, updated_at = @updated_at WHERE id = @id`,
        )
        .run({ ...next, updated_at: this.now(), id });
      this.setLeadLinks(p.lead_id, input);
      if (next.status !== p.status) this.log(p.lead_id, 'project', `Project status: ${p.status} → ${next.status}`);
      return this.db.prepare(`SELECT * FROM projects WHERE id = ?`).get(id) as Project;
    })();
  }

  deleteProject(id: number) {
    const p = this.db.prepare(`SELECT lead_id FROM projects WHERE id = ?`).get(id) as { lead_id: number } | undefined;
    if (!p) throw new HttpError(404, 'Project not found');
    this.db.prepare(`DELETE FROM projects WHERE id = ?`).run(id);
    this.log(p.lead_id, 'project', 'Website project deleted');
  }

  // ─── analytics ───────────────────────────────────────────────────────────

  /** All interactions (lightweight) for analytics charts. */
  listInteractions(): Pick<Interaction, 'id' | 'lead_id' | 'type' | 'date' | 'result'>[] {
    return this.db.prepare(`SELECT id, lead_id, type, date, result FROM interactions ORDER BY date`).all() as never;
  }

  /** Lead ids that ever reached Interested (or later) according to history. */
  everInterested(): number[] {
    return (
      this.db
        .prepare(
          `SELECT DISTINCT lead_id FROM activities
            WHERE text LIKE '%→ Interested' OR text LIKE '%→ Negotiating' OR text LIKE '%→ Won'
               OR text LIKE '%status Interested' OR text LIKE '%status Negotiating' OR text LIKE '%status Won'`,
        )
        .all() as { lead_id: number }[]
    ).map((r) => r.lead_id);
  }

  // ─── maintenance ─────────────────────────────────────────────────────────

  deleteDemoData(): number {
    return this.db.prepare(`DELETE FROM leads WHERE is_demo = 1`).run().changes;
  }

  exportAll() {
    const all = (t: string) => this.db.prepare(`SELECT * FROM ${t}`).all();
    return {
      exported_at: this.now(),
      settings: this.getSettings(),
      leads: all('leads'),
      interactions: all('interactions'),
      projects: all('projects'),
      reminders: all('reminders'),
      activities: all('activities'),
    };
  }
}
