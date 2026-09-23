import { useState } from 'react';
import { AlertTriangle, CalendarDays, CalendarRange, Flame } from 'lucide-react';
import { useData } from '../lib/store';
import { reminderBuckets } from '../lib/derive';
import { cx } from '../lib/ui';
import { EmptyState } from '../components/primitives';
import { ReminderItem } from '../components/ReminderItem';
import type { ReminderRow } from '../lib/api';

function Group({ title, icon, tone, items, empty }: { title: string; icon: React.ReactNode; tone: string; items: ReminderRow[]; empty: string }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className={cx('grid size-7 place-items-center rounded-lg', tone)}>{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold tabular-nums">{items.length}</span>
      </header>
      {items.length === 0 ? <EmptyState title={empty} /> : <div className="divide-y divide-border">{items.map((r) => <ReminderItem key={r.id} r={r} />)}</div>}
    </section>
  );
}

export function FollowUps() {
  const { reminders, settings, today } = useData();
  const [showLater, setShowLater] = useState(false);
  const b = reminderBuckets(reminders, today, settings.upcomingWindowDays);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Follow-ups</h1>
        <p className="text-sm text-muted">
          Every open reminder. Use the <span className="font-medium text-fg">⏰</span> menu to complete or snooze (1, 3, 7 days or a custom date).
        </p>
      </div>
      <Group title="Overdue" icon={<AlertTriangle className="size-4" />} tone="bg-rose-500/15 text-rose-600 dark:text-rose-400" items={b.overdue} empty="Nothing overdue — nice." />
      <Group title="Today" icon={<Flame className="size-4" />} tone="bg-amber-500/15 text-amber-600 dark:text-amber-400" items={b.today} empty="No follow-ups today." />
      <Group title={`Upcoming · next ${settings.upcomingWindowDays} days`} icon={<CalendarDays className="size-4" />} tone="bg-blue-500/15 text-blue-600 dark:text-blue-400" items={b.upcoming} empty="Nothing coming up." />
      {b.later.length > 0 &&
        (showLater ? (
          <Group title="Later" icon={<CalendarRange className="size-4" />} tone="bg-surface-2 text-muted" items={b.later} empty="" />
        ) : (
          <button className="btn btn-secondary w-full" onClick={() => setShowLater(true)}>
            Show {b.later.length} later follow-up{b.later.length > 1 ? 's' : ''}
          </button>
        ))}
    </div>
  );
}
