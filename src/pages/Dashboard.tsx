import { Link } from 'react-router-dom';
import { AlertTriangle, CalendarDays, Construction, Flame, PhoneCall, Plus } from 'lucide-react';
import { diffDays } from '../../shared/dates';
import { useData } from '../lib/store';
import { dashboardStats, isActiveProject, reminderBuckets } from '../lib/derive';
import { cx, fmtDate, fmtWeekdayDate, money } from '../lib/ui';
import { EmptyState } from '../components/primitives';
import { ReminderItem } from '../components/ReminderItem';
import { ProjectProgress } from '../components/ProjectBits';
import { useUI } from '../components/UIProvider';

function Stat({ label, value, to, tone, sub }: { label: string; value: number; to: string; tone?: string; sub?: string }) {
  return (
    <Link to={to} className="card group flex flex-col gap-1 px-4 py-3 transition-colors hover:border-accent/50">
      <span className="text-xs font-medium text-muted">{label}</span>
      <span className={cx('text-2xl font-semibold tabular-nums tracking-tight', tone)}>{value}</span>
      {sub && <span className="text-[11px] text-muted">{sub}</span>}
    </Link>
  );
}

function Section({ icon, title, count, tone, children, action }: { icon: React.ReactNode; title: string; count: number; tone: string; children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <section className="card overflow-hidden">
      <header className="flex items-center gap-2 border-b border-border px-4 py-3">
        <span className={cx('grid size-7 place-items-center rounded-lg', tone)}>{icon}</span>
        <h2 className="text-sm font-semibold uppercase tracking-wide">{title}</h2>
        <span className="rounded-full bg-surface-2 px-2 text-xs font-semibold tabular-nums">{count}</span>
        <div className="ml-auto">{action}</div>
      </header>
      {children}
    </section>
  );
}

export function Dashboard() {
  const { leads, reminders, projects, settings, today } = useData();
  const { openAddLead } = useUI();
  const s = dashboardStats(leads, reminders, today, settings.upcomingWindowDays);
  const b = reminderBuckets(reminders, today, settings.upcomingWindowDays);
  const active = projects.filter((p) => isActiveProject(p.status));
  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{greeting} 👋</h1>
          <p className="text-sm text-muted">
            {fmtWeekdayDate(today)} ·{' '}
            {s.callToday ? (
              <>
                <span className="font-medium text-fg">{s.callToday} call{s.callToday > 1 ? 's' : ''}</span> to make today
                {s.overdue > 0 && <span className="text-rose-600 dark:text-rose-400"> ({s.overdue} overdue)</span>}
              </>
            ) : (
              'Nothing due — add new leads or get ahead on upcoming follow-ups.'
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn btn-secondary" onClick={openAddLead}>
            <Plus className="size-4" /> Add lead
          </button>
          <Link to="/call" className="btn btn-primary">
            <PhoneCall className="size-4" /> Start calling
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-7">
        <Stat label="Total leads" value={s.total} to="/leads" />
        <Stat label="To call today" value={s.callToday} to="/leads?filter=today" tone="text-amber-600 dark:text-amber-400" sub={s.overdue ? `incl. ${s.overdue} overdue` : undefined} />
        <Stat label="Follow-ups due" value={s.upcoming} to="/follow-ups" sub={`next ${settings.upcomingWindowDays} days`} />
        <Stat label="Interested" value={s.interested} to="/leads?filter=interested" tone="text-violet-600 dark:text-violet-400" />
        <Stat label="Websites in progress" value={s.inProgress} to="/projects" tone="text-indigo-600 dark:text-indigo-400" />
        <Stat label="Websites completed" value={s.completed} to="/leads?filter=completed" tone="text-emerald-600 dark:text-emerald-400" />
        <Stat label="Not interested" value={s.notInterested} to="/leads?filter=not-interested" tone="text-rose-600 dark:text-rose-400" />
      </div>

      <Section
        icon={<Flame className="size-4" />}
        title="Call now"
        count={b.today.length}
        tone="bg-amber-500/15 text-amber-600 dark:text-amber-400"
        action={
          b.today.length > 0 && (
            <Link to="/call" className="btn btn-primary btn-sm">
              <PhoneCall className="size-3.5" /> Call Mode
            </Link>
          )
        }
      >
        {b.today.length === 0 ? (
          <EmptyState title="No calls scheduled for today">
            <button className="btn btn-secondary btn-sm mt-2" onClick={openAddLead}>
              <Plus className="size-3.5" /> Add a lead to call
            </button>
          </EmptyState>
        ) : (
          <div className="divide-y divide-border">{b.today.map((r) => <ReminderItem key={r.id} r={r} />)}</div>
        )}
      </Section>

      {b.overdue.length > 0 && (
        <Section icon={<AlertTriangle className="size-4" />} title="Overdue" count={b.overdue.length} tone="bg-rose-500/15 text-rose-600 dark:text-rose-400">
          <div className="divide-y divide-border">{b.overdue.map((r) => <ReminderItem key={r.id} r={r} />)}</div>
        </Section>
      )}

      <div className="grid gap-6 xl:grid-cols-2">
        <Section
          icon={<CalendarDays className="size-4" />}
          title="Upcoming"
          count={b.upcoming.length}
          tone="bg-blue-500/15 text-blue-600 dark:text-blue-400"
          action={<Link to="/follow-ups" className="text-xs font-medium text-accent hover:underline">All follow-ups</Link>}
        >
          {b.upcoming.length === 0 ? (
            <EmptyState title={`Nothing in the next ${settings.upcomingWindowDays} days`} />
          ) : (
            <div className="divide-y divide-border">
              {b.upcoming.slice(0, 8).map((r) => (
                <Link key={r.id} to={`/leads/${r.lead_id}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2/60">
                  <span className="w-20 shrink-0 text-xs font-medium tabular-nums text-muted">{fmtWeekdayDate(r.due_date)}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{r.business_name}</span>
                  <span className="hidden truncate text-xs text-muted sm:block">{r.notes}</span>
                </Link>
              ))}
            </div>
          )}
        </Section>

        <Section
          icon={<Construction className="size-4" />}
          title="Active projects"
          count={active.length}
          tone="bg-indigo-500/15 text-indigo-600 dark:text-indigo-400"
          action={<Link to="/projects" className="text-xs font-medium text-accent hover:underline">All projects</Link>}
        >
          {active.length === 0 ? (
            <EmptyState title="No websites in progress">Win a deal to start one.</EmptyState>
          ) : (
            <div className="divide-y divide-border">
              {active.map((p) => {
                const left = p.deadline ? diffDays(today, p.deadline) : null;
                return (
                  <Link key={p.id} to={`/leads/${p.lead_id}`} className="block space-y-2 px-4 py-3 hover:bg-surface-2/60">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-sm font-medium">{p.business_name}</span>
                      <span className="flex shrink-0 items-center gap-2 text-xs text-muted">
                        {money(p.price, settings.currency)}
                        {p.deadline && (
                          <span className={cx(left! < 0 ? 'text-rose-600' : left! <= 3 ? 'text-amber-600 dark:text-amber-400' : '')}>
                            due {fmtDate(p.deadline, today)}
                          </span>
                        )}
                      </span>
                    </div>
                    <ProjectProgress status={p.status} />
                  </Link>
                );
              })}
            </div>
          )}
        </Section>
      </div>
    </div>
  );
}
