import { useEffect, useMemo, useState } from 'react';
import { Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { addDays, diffDays, startOfWeek } from '../../shared/dates';
import { api, type InteractionLite } from '../lib/api';
import { useData } from '../lib/store';
import { isActiveProject } from '../lib/derive';
import { fmtDate, money } from '../lib/ui';

function Tile({ label, value, sub }: { label: string; value: string | number; sub?: string }) {
  return (
    <div className="card px-4 py-3">
      <div className="text-xs font-medium text-muted">{label}</div>
      <div className="mt-1 text-2xl font-semibold tabular-nums tracking-tight">{value}</div>
      {sub && <div className="text-[11px] text-muted">{sub}</div>}
    </div>
  );
}

const WEEKS = 12;

export function Analytics() {
  const { leads, projects, settings, today } = useData();
  const [interactions, setInteractions] = useState<InteractionLite[]>([]);
  const [everInterested, setEverInterested] = useState<number[]>([]);
  const [showTable, setShowTable] = useState(false);

  useEffect(() => {
    Promise.all([api.interactions(), api.everInterested()]).then(([i, e]) => {
      setInteractions(i);
      setEverInterested(e);
    });
  }, [leads]);

  const m = useMemo(() => {
    const calls = interactions.filter((i) => i.type === 'Phone Call');
    const weekStart = startOfWeek(today);
    const monthStart = `${today.slice(0, 7)}-01`;
    const calledLeads = new Set(calls.map((c) => c.lead_id));
    const interestedSet = new Set(everInterested);
    for (const l of leads) if (['Interested', 'Negotiating', 'Won'].includes(l.status)) interestedSet.add(l.id);
    const won = leads.filter((l) => l.status === 'Won');
    const pipeline = leads.filter((l) => ['New', 'Contacted', 'Interested', 'Negotiating', 'Follow Up Later'].includes(l.status));
    const wonIds = new Set(won.map((l) => l.id));
    const wonRevenue = projects.filter((p) => wonIds.has(p.lead_id)).reduce((s, p) => s + (p.price ?? 0), 0);

    // Weekly series: calls made and leads added.
    const first = addDays(weekStart, -7 * (WEEKS - 1));
    const weeks = Array.from({ length: WEEKS }, (_, i) => {
      const start = addDays(first, i * 7);
      return { start, label: fmtDate(start, today), Calls: 0, 'New leads': 0 };
    });
    const slot = (date: string) => {
      const d = diffDays(first, date.slice(0, 10));
      return d >= 0 ? weeks[Math.floor(d / 7)] : undefined;
    };
    for (const c of calls) {
      const w = slot(c.date);
      if (w) w.Calls++;
    }
    for (const l of leads) {
      const w = slot(l.created_at);
      if (w) w['New leads']++;
    }

    return {
      totalCalls: calls.length,
      callsWeek: calls.filter((c) => c.date.slice(0, 10) >= weekStart).length,
      callsMonth: calls.filter((c) => c.date.slice(0, 10) >= monthStart).length,
      interested: leads.filter((l) => l.status === 'Interested' || l.status === 'Negotiating').length,
      won: won.length,
      notInterested: leads.filter((l) => l.status === 'Not Interested').length,
      contacted: leads.filter((l) => l.last_contacted_at || calledLeads.has(l.id)).length,
      building: projects.filter((p) => isActiveProject(p.status)).length,
      completed: projects.filter((p) => p.status === 'Completed').length,
      potential: pipeline.reduce((s, l) => s + (l.potential_value ?? 0), 0),
      wonRevenue,
      funnel: [
        { label: 'Called', n: leads.filter((l) => calledLeads.has(l.id) || l.last_contacted_at).length },
        { label: 'Interested', n: leads.filter((l) => interestedSet.has(l.id)).length },
        { label: 'Won', n: won.length },
      ],
      weeks,
    };
  }, [interactions, everInterested, leads, projects, today]);

  const conversion = m.contacted ? Math.round((m.won / m.contacted) * 1000) / 10 : 0;
  const top = Math.max(1, m.funnel[0].n);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Analytics</h1>
        <p className="text-sm text-muted">How your calling is turning into websites.</p>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        <Tile label="Total calls" value={m.totalCalls} />
        <Tile label="Calls this week" value={m.callsWeek} />
        <Tile label="Calls this month" value={m.callsMonth} />
        <Tile label="Interested leads" value={m.interested} sub="Interested + negotiating" />
        <Tile label="Won deals" value={m.won} />
        <Tile label="Not interested" value={m.notInterested} />
        <Tile label="Conversion rate" value={`${conversion}%`} sub="won ÷ contacted leads" />
        <Tile label="Websites being built" value={m.building} />
        <Tile label="Completed websites" value={m.completed} />
        <Tile label="Potential revenue" value={money(m.potential, settings.currency, true)} sub="open pipeline" />
        <Tile label="Won revenue" value={money(m.wonRevenue, settings.currency, true)} sub="project prices" />
      </div>

      <div className="grid gap-5 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <section className="card p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Calls & new leads per week</h2>
            <button className="text-xs font-medium text-accent hover:underline" onClick={() => setShowTable((s) => !s)}>
              {showTable ? 'Show chart' : 'Show table'}
            </button>
          </div>
          {showTable ? (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted">
                  <th className="py-1 font-medium">Week of</th>
                  <th className="py-1 text-right font-medium">Calls</th>
                  <th className="py-1 text-right font-medium">New leads</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border tabular-nums">
                {m.weeks.map((w) => (
                  <tr key={w.start}>
                    <td className="py-1.5">{w.label}</td>
                    <td className="py-1.5 text-right">{w.Calls}</td>
                    <td className="py-1.5 text-right">{w['New leads']}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={m.weeks} barGap={2} barCategoryGap="25%" margin={{ top: 4, right: 4, bottom: 0, left: -20 }}>
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="label" tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={{ stroke: 'var(--border)' }} interval="preserveStartEnd" />
                  <YAxis allowDecimals={false} tick={{ fontSize: 11, fill: 'var(--muted)' }} tickLine={false} axisLine={false} />
                  <Tooltip
                    cursor={{ fill: 'var(--surface-2)' }}
                    contentStyle={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, fontSize: 12, color: 'var(--text)' }}
                    labelFormatter={(l) => `Week of ${l}`}
                  />
                  <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12, color: 'var(--muted)' }} />
                  <Bar dataKey="Calls" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="New leads" fill="var(--series-2)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-4 text-sm font-semibold">Sales funnel</h2>
          <div className="space-y-4">
            {m.funnel.map((f, i) => {
              const prev = i > 0 ? m.funnel[i - 1].n : null;
              return (
                <div key={f.label}>
                  <div className="mb-1 flex items-baseline justify-between text-sm">
                    <span className="font-medium">{f.label}</span>
                    <span className="tabular-nums">
                      <span className="font-semibold">{f.n}</span>
                      {prev !== null && <span className="ml-2 text-xs text-muted">{prev ? Math.round((f.n / prev) * 100) : 0}% of previous</span>}
                    </span>
                  </div>
                  <div className="h-7 overflow-hidden rounded-md bg-surface-2">
                    <div className="h-full rounded-md bg-accent transition-all" style={{ width: `${Math.max(2, (f.n / top) * 100)}%`, opacity: 1 - i * 0.2 }} />
                  </div>
                </div>
              );
            })}
          </div>
          <p className="mt-4 text-xs text-muted">Interested counts every lead that reached Interested, Negotiating or Won at any point.</p>
        </section>
      </div>
    </div>
  );
}
