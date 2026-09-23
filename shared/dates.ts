// Date helpers. All CRM dates are "local" to the configured time zone:
//   dates     → "YYYY-MM-DD"
//   datetimes → "YYYY-MM-DDTHH:mm"
// Working with plain strings keeps "today" unambiguous for a single user.

const pad = (n: number) => String(n).padStart(2, '0');

/** Current local datetime ("YYYY-MM-DDTHH:mm") in the given IANA time zone. */
export function nowInTz(timeZone: string, at: Date = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat('en-CA', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(at);
  } catch {
    return nowInTz('UTC', at);
  }
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '00';
  return `${get('year')}-${get('month')}-${get('day')}T${get('hour')}:${get('minute')}`;
}

export function todayInTz(timeZone: string, at: Date = new Date()): string {
  return nowInTz(timeZone, at).slice(0, 10);
}

/** Parse "YYYY-MM-DD" as a UTC date (no time-zone drift). */
function parseDate(date: string): Date {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function formatDate(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

export function addDays(date: string, days: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + days);
  return formatDate(d);
}

/** Whole days from `from` to `to` (positive when `to` is later). */
export function diffDays(from: string, to: string): number {
  return Math.round((parseDate(to).getTime() - parseDate(from).getTime()) / 86_400_000);
}

export function weekday(date: string): number {
  return parseDate(date).getUTCDay();
}

export function isValidDate(date: unknown): date is string {
  if (typeof date !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return false;
  return formatDate(parseDate(date)) === date;
}

/**
 * Next follow-up date: `days` after the contact date, pushed forward to the
 * next working day when `workingDays` is given (and non-empty).
 */
export function computeFollowUp(contactDate: string, days: number, workingDays?: number[]): string {
  let next = addDays(contactDate.slice(0, 10), days);
  if (workingDays && workingDays.length > 0 && workingDays.length < 7) {
    for (let i = 0; i < 7 && !workingDays.includes(weekday(next)); i++) next = addDays(next, 1);
  }
  return next;
}

export type DueBucket = 'overdue' | 'today' | 'upcoming' | 'later' | 'none';

export function dueBucket(due: string | null, today: string, upcomingWindow: number): DueBucket {
  if (!due) return 'none';
  const d = diffDays(today, due);
  if (d < 0) return 'overdue';
  if (d === 0) return 'today';
  if (d <= upcomingWindow) return 'upcoming';
  return 'later';
}

/** Monday-based start of the week containing `date`. */
export function startOfWeek(date: string): string {
  const wd = weekday(date);
  return addDays(date, -((wd + 6) % 7));
}

/** Human phrasing relative to today: "today", "tomorrow", "in 3 days", "2 days ago". */
export function relativeDay(date: string, today: string): string {
  const d = diffDays(today, date);
  if (d === 0) return 'today';
  if (d === 1) return 'tomorrow';
  if (d === -1) return 'yesterday';
  if (d > 0) return `in ${d} days`;
  return `${-d} days ago`;
}
