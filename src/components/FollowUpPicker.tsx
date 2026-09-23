import { CalendarClock } from 'lucide-react';
import { computeFollowUp, diffDays } from '../../shared/dates';
import { useData } from '../lib/store';
import { cx, fmtWeekdayDate } from '../lib/ui';

const PRESETS = [1, 3, 7, 14, 30];

export type FollowUpChoice = { kind: 'days'; days: number } | { kind: 'date'; date: string } | { kind: 'none' } | { kind: 'today' };

/** Resolves a choice to a concrete date, counting from `from` and honouring working days. */
export function useResolveFollowUp() {
  const { settings, today } = useData();
  return (choice: FollowUpChoice, from = today): string | null => {
    if (choice.kind === 'none') return null;
    if (choice.kind === 'today') return today;
    if (choice.kind === 'date') return choice.date || null;
    return computeFollowUp(from, choice.days, settings.skipNonWorkingDays ? settings.workingDays : undefined);
  };
}

export function FollowUpPicker({
  value,
  onChange,
  from,
  allowNone = true,
  allowToday = false,
  compact = false,
}: {
  value: FollowUpChoice;
  onChange: (v: FollowUpChoice) => void;
  /** Contact date the follow-up is counted from (defaults to today). */
  from?: string;
  allowNone?: boolean;
  allowToday?: boolean;
  compact?: boolean;
}) {
  const { today } = useData();
  const resolve = useResolveFollowUp();
  const date = resolve(value, from ?? today);
  const inDays = date ? diffDays(today, date) : null;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {allowToday && (
          <button type="button" className={cx('chip', value.kind === 'today' && 'chip-active')} onClick={() => onChange({ kind: 'today' })}>
            Today
          </button>
        )}
        {PRESETS.map((d) => (
          <button
            key={d}
            type="button"
            className={cx('chip', value.kind === 'days' && value.days === d && 'chip-active')}
            onClick={() => onChange({ kind: 'days', days: d })}
          >
            {d} {d === 1 ? 'day' : 'days'}
          </button>
        ))}
        <label className={cx('chip relative cursor-pointer', value.kind === 'date' && 'chip-active')}>
          <CalendarClock className="size-3.5" />
          {value.kind === 'date' && value.date ? fmtWeekdayDate(value.date) : 'Custom'}
          <input
            type="date"
            className="absolute inset-0 cursor-pointer opacity-0"
            min={today}
            value={value.kind === 'date' ? value.date : ''}
            onChange={(e) => onChange({ kind: 'date', date: e.target.value })}
            onClick={(e) => (e.currentTarget as HTMLInputElement).showPicker?.()}
          />
        </label>
        {allowNone && (
          <button type="button" className={cx('chip', value.kind === 'none' && 'chip-active')} onClick={() => onChange({ kind: 'none' })}>
            No follow-up
          </button>
        )}
      </div>
      {!compact && (
        <p className="text-xs text-muted">
          {date ? (
            <>
              <span className="font-medium text-fg">
                {inDays === 0 ? 'Follow up today' : inDays! < 0 ? `Follow-up ${-inDays!} days ago` : `Follow up in ${inDays} ${inDays === 1 ? 'day' : 'days'}`}
              </span>{' '}
              · {fmtWeekdayDate(date)} — a reminder will be created.
            </>
          ) : (
            'No reminder will be created.'
          )}
        </p>
      )}
    </div>
  );
}
