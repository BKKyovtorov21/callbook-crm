// Pure helpers that derive dashboard numbers, filters and search from the data.
import type { LeadStatus, LeadWithProject, ProjectStatus, ProjectWithLead, Settings } from '../../shared/types';
import { diffDays, dueBucket, relativeDay } from '../../shared/dates';
import { phoneDigits } from '../../shared/format';
import type { ReminderRow } from './api';

export const isActiveProject = (s: ProjectStatus | undefined | null) => !!s && s !== 'Completed';

export function reminderBuckets(reminders: ReminderRow[], today: string, window: number) {
  const out = { overdue: [] as ReminderRow[], today: [] as ReminderRow[], upcoming: [] as ReminderRow[], later: [] as ReminderRow[] };
  for (const r of reminders) {
    const b = dueBucket(r.due_date, today, window);
    if (b !== 'none') out[b].push(r);
  }
  return out;
}

export function dashboardStats(leads: LeadWithProject[], reminders: ReminderRow[], today: string, window: number) {
  const b = reminderBuckets(reminders, today, window);
  const count = (s: LeadStatus) => leads.filter((l) => l.status === s).length;
  return {
    total: leads.length,
    callToday: b.today.length + b.overdue.length,
    overdue: b.overdue.length,
    dueToday: b.today.length,
    upcoming: b.upcoming.length,
    interested: count('Interested') + count('Negotiating'),
    inProgress: leads.filter((l) => isActiveProject(l.project?.status)).length,
    completed: leads.filter((l) => l.project?.status === 'Completed').length,
    notInterested: count('Not Interested'),
  };
}

export function deadlineAlerts(projects: ProjectWithLead[], today: string, withinDays = 3) {
  return projects.filter((p) => isActiveProject(p.status) && p.deadline && diffDays(today, p.deadline) <= withinDays);
}

// ─── search ───────────────────────────────────────────────────────────────

export function matchesSearch(l: LeadWithProject, q: string): boolean {
  const query = q.trim().toLowerCase();
  if (!query) return true;
  const digits = phoneDigits(query);
  if (digits.length >= 3 && /^[\d\s()+.-]+$/.test(query) && l.phone && phoneDigits(l.phone).includes(digits)) return true;
  const hay = [l.business_name, l.contact_name, l.email, l.notes, l.location, l.category, l.phone, l.follow_up_notes, l.extra_info]
    .join(' ')
    .toLowerCase();
  return query.split(/\s+/).every((t) => hay.includes(t));
}

/** Search results ranked: exact phone / name-prefix matches first. */
export function searchLeads(leads: LeadWithProject[], q: string, limit = 8) {
  const query = q.trim().toLowerCase();
  if (!query) return [];
  const digits = phoneDigits(query);
  return leads
    .filter((l) => matchesSearch(l, q))
    .map((l) => {
      let score = 0;
      if (digits.length >= 3 && phoneDigits(l.phone).endsWith(digits)) score += 10;
      if (l.business_name.toLowerCase().startsWith(query)) score += 5;
      if (l.business_name.toLowerCase().includes(query)) score += 2;
      if (l.contact_name.toLowerCase().includes(query)) score += 1;
      return { l, score };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.l);
}

// ─── lead filters (Leads page) ──────────────────────────────────────────────

export const QUICK_FILTERS = [
  { id: 'all', label: 'All' },
  { id: 'today', label: 'Call today' },
  { id: 'overdue', label: 'Overdue' },
  { id: 'new', label: 'New leads' },
  { id: 'interested', label: 'Interested' },
  { id: 'later', label: 'Follow up later' },
  { id: 'not-interested', label: 'Not interested' },
  { id: 'won', label: 'Won' },
  { id: 'in-progress', label: 'Website in progress' },
  { id: 'completed', label: 'Completed projects' },
  { id: 'cold', label: 'Gone cold' },
] as const;
export type QuickFilter = (typeof QUICK_FILTERS)[number]['id'];

export interface LeadFilters {
  q: string;
  quick: QuickFilter;
  status: LeadStatus | '';
  project: ProjectStatus | 'none' | 'any' | '';
  followUp: '' | 'overdue' | 'today' | 'upcoming' | 'scheduled' | 'none';
  category: string;
  location: string;
  added: '' | '7' | '30' | '90';
  lastContact: '' | 'never' | 'within7' | 'over7' | 'over30';
  sort: 'followup' | 'lastContact' | 'newest' | 'value' | 'name';
}

export const DEFAULT_FILTERS: LeadFilters = {
  q: '',
  quick: 'all',
  status: '',
  project: '',
  followUp: '',
  category: '',
  location: '',
  added: '',
  lastContact: '',
  sort: 'followup',
};

const OPEN_STATUSES: LeadStatus[] = ['New', 'Contacted', 'Interested', 'Negotiating', 'Follow Up Later'];

/** A lead "went cold": still open, but no contact for 30+ days and nothing scheduled. */
export function isCold(l: LeadWithProject, today: string) {
  if (!OPEN_STATUSES.includes(l.status) || l.status === 'New') return false;
  const last = l.last_contacted_at?.slice(0, 10);
  return !!last && diffDays(last, today) >= 30 && (!l.next_follow_up_at || diffDays(today, l.next_follow_up_at) > 30);
}

export function applyFilters(leads: LeadWithProject[], f: LeadFilters, s: Settings, today: string) {
  const bucket = (l: LeadWithProject) => dueBucket(l.next_follow_up_at, today, s.upcomingWindowDays);
  const quick: Record<QuickFilter, (l: LeadWithProject) => boolean> = {
    all: () => true,
    today: (l) => bucket(l) === 'today' || bucket(l) === 'overdue',
    overdue: (l) => bucket(l) === 'overdue',
    new: (l) => l.status === 'New',
    interested: (l) => l.status === 'Interested' || l.status === 'Negotiating',
    later: (l) => l.status === 'Follow Up Later',
    'not-interested': (l) => l.status === 'Not Interested',
    won: (l) => l.status === 'Won',
    'in-progress': (l) => isActiveProject(l.project?.status),
    completed: (l) => l.project?.status === 'Completed',
    cold: (l) => isCold(l, today),
  };
  const out = leads.filter((l) => {
    if (!quick[f.quick](l)) return false;
    if (f.status && l.status !== f.status) return false;
    if (f.project === 'none' && l.project) return false;
    if (f.project === 'any' && !l.project) return false;
    if (f.project && f.project !== 'none' && f.project !== 'any' && l.project?.status !== f.project) return false;
    if (f.followUp) {
      const b = bucket(l);
      if (f.followUp === 'scheduled' ? b === 'none' : f.followUp === 'upcoming' ? b !== 'upcoming' : b !== f.followUp) return false;
    }
    if (f.category && l.category !== f.category) return false;
    if (f.location && l.location !== f.location) return false;
    if (f.added && diffDays(l.created_at.slice(0, 10), today) > Number(f.added)) return false;
    if (f.lastContact) {
      const last = l.last_contacted_at?.slice(0, 10);
      const ago = last ? diffDays(last, today) : Infinity;
      if (f.lastContact === 'never' && last) return false;
      if (f.lastContact === 'within7' && ago > 7) return false;
      if (f.lastContact === 'over7' && (!last || ago <= 7)) return false;
      if (f.lastContact === 'over30' && (!last || ago <= 30)) return false;
    }
    return matchesSearch(l, f.q);
  });

  const cmpStr = (a: string | null, b: string | null, emptyLast = true) =>
    a === b ? 0 : !a ? (emptyLast ? 1 : -1) : !b ? (emptyLast ? -1 : 1) : a < b ? -1 : 1;
  const sorters: Record<LeadFilters['sort'], (a: LeadWithProject, b: LeadWithProject) => number> = {
    followup: (a, b) => cmpStr(a.next_follow_up_at, b.next_follow_up_at),
    lastContact: (a, b) => -cmpStr(a.last_contacted_at, b.last_contacted_at, false),
    newest: (a, b) => (a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : b.id - a.id),
    value: (a, b) => (b.potential_value ?? -1) - (a.potential_value ?? -1),
    name: (a, b) => a.business_name.localeCompare(b.business_name),
  };
  return out.sort(sorters[f.sort]);
}

export function followUpLabel(date: string | null, today: string): string {
  if (!date) return 'No follow-up';
  const d = diffDays(today, date);
  if (d < 0) return `Overdue ${-d}d`;
  return `Follow up ${relativeDay(date, today)}`;
}
