import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { AlarmClock, Check, ChevronDown, ExternalLink, Phone } from 'lucide-react';
import { diffDays, relativeDay } from '../../shared/dates';
import { telHref } from '../../shared/format';
import { api, type ReminderRow } from '../lib/api';
import { useData } from '../lib/store';
import { cx, fmtDate } from '../lib/ui';
import { PhoneLink, StatusBadge } from './primitives';
import { useUI } from './UIProvider';

export function dueText(due: string, today: string) {
  const d = diffDays(today, due);
  if (d < 0) return `Follow-up was due ${fmtDate(due, today)} (${-d}d ago)`;
  if (d === 0) return 'Follow-up today';
  return `Follow-up ${fmtDate(due, today)} · ${relativeDay(due, today)}`;
}

export function SnoozeMenu({ reminderId, onDone }: { reminderId: number; onDone?: () => void }) {
  const { refresh, today } = useData();
  const { toast } = useUI();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  const run = async (fn: () => Promise<unknown>, msg: string) => {
    setOpen(false);
    try {
      await fn();
      await refresh();
      toast(msg);
      onDone?.();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  };

  return (
    <div className="relative" ref={ref} onClick={(e) => e.stopPropagation()}>
      <button className="btn btn-secondary btn-sm" onClick={() => setOpen((o) => !o)} title="Complete or snooze">
        <AlarmClock className="size-3.5" /> <ChevronDown className="size-3" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-30 w-48 overflow-hidden rounded-xl border border-border bg-surface py-1 shadow-xl">
          <button className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => run(() => api.completeReminder(reminderId), 'Reminder completed')}>
            <Check className="size-4 text-emerald-500" /> Mark completed
          </button>
          <div className="my-1 border-t border-border" />
          {[1, 3, 7].map((d) => (
            <button key={d} className="block w-full px-3 py-2 text-left text-sm hover:bg-surface-2" onClick={() => run(() => api.snoozeReminder(reminderId, { days: d }), `Snoozed ${d} day${d > 1 ? 's' : ''}`)}>
              Snooze {d} day{d > 1 ? 's' : ''}
            </button>
          ))}
          <label className="block px-3 py-2 text-sm hover:bg-surface-2">
            <span className="text-muted">Custom date</span>
            <input
              type="date"
              min={today}
              className="input mt-1 !h-8"
              onChange={(e) => e.target.value && run(() => api.snoozeReminder(reminderId, { date: e.target.value }), 'Follow-up rescheduled')}
            />
          </label>
        </div>
      )}
    </div>
  );
}

/** A lead that needs contacting: phone, status, last contact, reason + quick buttons. */
export function ReminderItem({ r }: { r: ReminderRow }) {
  const { today, settings } = useData();
  const { runAction } = useUI();
  const navigate = useNavigate();
  const overdue = r.due_date < today;
  return (
    <div
      className="group flex cursor-pointer flex-col gap-2 px-4 py-3 transition-colors hover:bg-surface-2/60 sm:flex-row sm:items-center sm:gap-4"
      onClick={() => navigate(`/leads/${r.lead_id}`)}
    >
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <Link to={`/leads/${r.lead_id}`} className="truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
            {r.business_name}
          </Link>
          <StatusBadge status={r.status} />
        </div>
        <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
          <PhoneLink phone={r.phone} className="text-fg" />
          <span>Last contact: {r.last_contacted_at ? fmtDate(r.last_contacted_at, today) : 'never'}</span>
          <span className={cx(overdue && 'font-medium text-rose-600 dark:text-rose-400')}>{dueText(r.due_date, today)}</span>
        </div>
        {r.notes && <div className="mt-1 truncate text-xs text-fg/80">↳ {r.notes}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
        <a href={telHref(r.phone, settings.phoneCountry)} className="btn btn-secondary btn-sm" title="Call">
          <Phone className="size-3.5" /> Call
        </a>
        <button className="btn btn-primary btn-sm" onClick={() => runAction({ id: r.lead_id, business_name: r.business_name }, 'called')} title="Log call + schedule follow-up">
          <Check className="size-3.5" /> Mark called
        </button>
        <Link to={`/leads/${r.lead_id}`} className="btn btn-ghost btn-sm" title="Open lead">
          <ExternalLink className="size-3.5" />
        </Link>
        <SnoozeMenu reminderId={r.id} />
      </div>
    </div>
  );
}
