import type { LeadStatus, ProjectStatus } from '../../shared/types';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export function money(v: number | null | undefined, currency: string, compact = false): string {
  if (v == null) return '—';
  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      maximumFractionDigits: compact || Number.isInteger(v) ? 0 : 2,
      notation: compact && Math.abs(v) >= 10_000 ? 'compact' : 'standard',
    }).format(v);
  } catch {
    return `${v} ${currency}`;
  }
}

/** "Sep 23" (adds the year when it differs from `today`'s). */
export function fmtDate(date: string | null | undefined, today?: string): string {
  if (!date) return '—';
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const sameYear = !today || today.slice(0, 4) === String(y);
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: sameYear ? undefined : 'numeric', timeZone: 'UTC' });
}

export function fmtWeekdayDate(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).toLocaleDateString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  });
}

export function fmtDateTime(dt: string | null | undefined, today?: string): string {
  if (!dt) return '—';
  const time = dt.length > 10 ? dt.slice(11, 16) : '';
  return `${fmtDate(dt, today)}${time ? `, ${time}` : ''}`;
}

export const STATUS_STYLES: Record<LeadStatus, { badge: string; dot: string; col: string }> = {
  New: { badge: 'bg-slate-500/10 text-slate-700 ring-slate-500/25 dark:text-slate-300', dot: 'bg-slate-400', col: 'border-t-slate-400' },
  Contacted: { badge: 'bg-blue-500/10 text-blue-700 ring-blue-500/25 dark:text-blue-300', dot: 'bg-blue-500', col: 'border-t-blue-500' },
  Interested: { badge: 'bg-violet-500/10 text-violet-700 ring-violet-500/25 dark:text-violet-300', dot: 'bg-violet-500', col: 'border-t-violet-500' },
  Negotiating: { badge: 'bg-amber-500/12 text-amber-700 ring-amber-500/30 dark:text-amber-300', dot: 'bg-amber-500', col: 'border-t-amber-500' },
  Won: { badge: 'bg-emerald-500/12 text-emerald-700 ring-emerald-500/30 dark:text-emerald-300', dot: 'bg-emerald-500', col: 'border-t-emerald-500' },
  'Follow Up Later': { badge: 'bg-cyan-500/10 text-cyan-700 ring-cyan-500/25 dark:text-cyan-300', dot: 'bg-cyan-500', col: 'border-t-cyan-500' },
  'Not Interested': { badge: 'bg-rose-500/10 text-rose-700 ring-rose-500/25 dark:text-rose-300', dot: 'bg-rose-500', col: 'border-t-rose-500' },
  Lost: { badge: 'bg-zinc-500/10 text-zinc-600 ring-zinc-500/25 dark:text-zinc-400', dot: 'bg-zinc-500', col: 'border-t-zinc-500' },
};

export const PROJECT_STYLES: Record<ProjectStatus, string> = {
  'Not Started': 'bg-zinc-500/10 text-zinc-600 dark:text-zinc-400 ring-zinc-500/25',
  'Gathering Information': 'bg-sky-500/10 text-sky-700 dark:text-sky-300 ring-sky-500/25',
  Designing: 'bg-fuchsia-500/10 text-fuchsia-700 dark:text-fuchsia-300 ring-fuchsia-500/25',
  Development: 'bg-indigo-500/10 text-indigo-700 dark:text-indigo-300 ring-indigo-500/25',
  'Client Review': 'bg-amber-500/12 text-amber-700 dark:text-amber-300 ring-amber-500/30',
  Revisions: 'bg-orange-500/12 text-orange-700 dark:text-orange-300 ring-orange-500/30',
  'Ready to Launch': 'bg-teal-500/10 text-teal-700 dark:text-teal-300 ring-teal-500/25',
  Live: 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300 ring-emerald-500/30',
  Completed: 'bg-emerald-600/15 text-emerald-800 dark:text-emerald-200 ring-emerald-600/35',
};

/** The five visual stages of a website project. */
export const PROJECT_STAGES: { label: string; statuses: ProjectStatus[] }[] = [
  { label: 'Gathering Info', statuses: ['Gathering Information'] },
  { label: 'Design', statuses: ['Designing'] },
  { label: 'Development', statuses: ['Development'] },
  { label: 'Review', statuses: ['Client Review', 'Revisions', 'Ready to Launch'] },
  { label: 'Live', statuses: ['Live', 'Completed'] },
];

export function stageIndex(status: ProjectStatus): number {
  if (status === 'Not Started') return -1;
  return PROJECT_STAGES.findIndex((s) => s.statuses.includes(status));
}

export function isTypingTarget(el: EventTarget | null) {
  const t = el as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
}
