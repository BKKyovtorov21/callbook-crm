import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { DndContext, PointerSensor, TouchSensor, useDraggable, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { Check, Columns3, ExternalLink, Filter, Plus, Rows3, Search, X } from 'lucide-react';
import { LEAD_STATUSES, PROJECT_STATUSES, type LeadStatus, type LeadWithProject } from '../../shared/types';
import { dueBucket } from '../../shared/dates';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { applyFilters, DEFAULT_FILTERS, followUpLabel, QUICK_FILTERS, type LeadFilters, type QuickFilter } from '../lib/derive';
import { cx, fmtDate, money, STATUS_STYLES } from '../lib/ui';
import { DemoTag, EmptyState, PhoneLink, ProjectBadge, StatusBadge } from '../components/primitives';
import { useUI } from '../components/UIProvider';

function readView(): 'table' | 'kanban' {
  try {
    return localStorage.getItem('leadsView') === 'kanban' ? 'kanban' : 'table';
  } catch {
    return 'table';
  }
}

export function LeadsPage() {
  const { leads, settings, today } = useData();
  const { openAddLead } = useUI();
  const [params, setParams] = useSearchParams();
  const [view, setView] = useState(readView);
  const [showFilters, setShowFilters] = useState(false);
  const [f, setF] = useState<LeadFilters>(() => ({
    ...DEFAULT_FILTERS,
    q: params.get('q') ?? '',
    quick: (QUICK_FILTERS.some((x) => x.id === params.get('filter')) ? params.get('filter') : 'all') as QuickFilter,
  }));

  // Follow links like /leads?filter=today from the dashboard.
  useEffect(() => {
    const quick = params.get('filter');
    const q = params.get('q');
    setF((p) => ({
      ...p,
      ...(quick && QUICK_FILTERS.some((x) => x.id === quick) ? { quick: quick as QuickFilter } : {}),
      ...(q !== null ? { q } : {}),
    }));
  }, [params]);

  const setFilter = <K extends keyof LeadFilters>(k: K, v: LeadFilters[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    if (k === 'quick' || k === 'q') {
      const next = new URLSearchParams(params);
      if (k === 'quick') v === 'all' ? next.delete('filter') : next.set('filter', String(v));
      if (k === 'q') v ? next.set('q', String(v)) : next.delete('q');
      setParams(next, { replace: true });
    }
  };
  const switchView = (v: 'table' | 'kanban') => {
    setView(v);
    try {
      localStorage.setItem('leadsView', v);
    } catch {
      /* ignore */
    }
  };

  const filtered = useMemo(() => applyFilters(leads, f, settings, today), [leads, f, settings, today]);
  const categories = useMemo(() => [...new Set(leads.map((l) => l.category).filter(Boolean))].sort(), [leads]);
  const locations = useMemo(() => [...new Set(leads.map((l) => l.location).filter(Boolean))].sort(), [leads]);
  const advancedCount = (['status', 'project', 'followUp', 'category', 'location', 'added', 'lastContact'] as const).filter((k) => f[k]).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Leads</h1>
          <p className="text-sm text-muted">
            {filtered.length} of {leads.length} leads
          </p>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-lg border border-border bg-surface p-0.5">
            <button className={cx('btn btn-sm', view === 'table' ? 'bg-surface-2 text-fg' : 'btn-ghost')} onClick={() => switchView('table')}>
              <Rows3 className="size-3.5" /> Table
            </button>
            <button className={cx('btn btn-sm', view === 'kanban' ? 'bg-surface-2 text-fg' : 'btn-ghost')} onClick={() => switchView('kanban')}>
              <Columns3 className="size-3.5" /> Kanban
            </button>
          </div>
          <button className="btn btn-primary" onClick={openAddLead}>
            <Plus className="size-4" /> Add lead
          </button>
        </div>
      </div>

      <div className="card space-y-3 p-3">
        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-52 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
            <input className="input !pl-9" placeholder="Search business, contact, phone, email, notes, location…" value={f.q} onChange={(e) => setFilter('q', e.target.value)} />
          </div>
          <select className="input !w-auto" value={f.sort} onChange={(e) => setFilter('sort', e.target.value as LeadFilters['sort'])} title="Sort">
            <option value="followup">Sort: Next follow-up</option>
            <option value="lastContact">Sort: Last contacted</option>
            <option value="newest">Sort: Newest</option>
            <option value="value">Sort: Potential value</option>
            <option value="name">Sort: Name (A–Z)</option>
          </select>
          <button className={cx('btn btn-secondary', advancedCount > 0 && '!border-accent !text-accent')} onClick={() => setShowFilters((s) => !s)}>
            <Filter className="size-4" /> Filters{advancedCount > 0 && ` (${advancedCount})`}
          </button>
        </div>
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5">
          {QUICK_FILTERS.map((q) => (
            <button key={q.id} className={cx('chip shrink-0', f.quick === q.id && 'chip-active')} onClick={() => setFilter('quick', q.id)}>
              {q.label}
            </button>
          ))}
        </div>
        {showFilters && (
          <div className="grid gap-2 border-t border-border pt-3 sm:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7">
            <select className="input" value={f.status} onChange={(e) => setFilter('status', e.target.value as LeadStatus | '')}>
              <option value="">Any status</option>
              {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="input" value={f.project} onChange={(e) => setFilter('project', e.target.value as LeadFilters['project'])}>
              <option value="">Any project status</option>
              <option value="none">No project</option>
              <option value="any">Has a project</option>
              {PROJECT_STATUSES.map((s) => <option key={s}>{s}</option>)}
            </select>
            <select className="input" value={f.followUp} onChange={(e) => setFilter('followUp', e.target.value as LeadFilters['followUp'])}>
              <option value="">Any follow-up</option>
              <option value="overdue">Overdue</option>
              <option value="today">Due today</option>
              <option value="upcoming">Next {settings.upcomingWindowDays} days</option>
              <option value="scheduled">Has follow-up</option>
              <option value="none">No follow-up</option>
            </select>
            <select className="input" value={f.category} onChange={(e) => setFilter('category', e.target.value)}>
              <option value="">Any category</option>
              {categories.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="input" value={f.location} onChange={(e) => setFilter('location', e.target.value)}>
              <option value="">Any location</option>
              {locations.map((c) => <option key={c}>{c}</option>)}
            </select>
            <select className="input" value={f.added} onChange={(e) => setFilter('added', e.target.value as LeadFilters['added'])}>
              <option value="">Added: any time</option>
              <option value="7">Added: last 7 days</option>
              <option value="30">Added: last 30 days</option>
              <option value="90">Added: last 90 days</option>
            </select>
            <select className="input" value={f.lastContact} onChange={(e) => setFilter('lastContact', e.target.value as LeadFilters['lastContact'])}>
              <option value="">Last contact: any</option>
              <option value="never">Never contacted</option>
              <option value="within7">Within 7 days</option>
              <option value="over7">More than 7 days ago</option>
              <option value="over30">More than 30 days ago</option>
            </select>
            {advancedCount > 0 && (
              <button
                className="btn btn-ghost sm:col-span-2 lg:col-span-4 xl:col-span-7 justify-self-start"
                onClick={() => setF((p) => ({ ...DEFAULT_FILTERS, q: p.q, quick: p.quick, sort: p.sort }))}
              >
                <X className="size-4" /> Clear filters
              </button>
            )}
          </div>
        )}
      </div>

      {view === 'table' ? <LeadTable leads={filtered} /> : <Kanban leads={filtered} />}
    </div>
  );
}

function StatusSelect({ lead }: { lead: LeadWithProject }) {
  const { refresh, patchLeadLocal } = useData();
  const { toast } = useUI();
  return (
    <select
      value={lead.status}
      onClick={(e) => e.stopPropagation()}
      onChange={async (e) => {
        const status = e.target.value as LeadStatus;
        patchLeadLocal(lead.id, { status });
        try {
          await api.updateLead(lead.id, { status });
          toast(`${lead.business_name} → ${status}${status === 'Won' ? ' · project created' : ''}`);
        } catch (err) {
          toast((err as Error).message, { tone: 'error' });
        }
        refresh();
      }}
      className={cx('cursor-pointer appearance-none rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset focus:outline-none', STATUS_STYLES[lead.status].badge)}
      title="Change status"
    >
      {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
    </select>
  );
}

function FollowUpCell({ date }: { date: string | null }) {
  const { today, settings } = useData();
  const b = dueBucket(date, today, settings.upcomingWindowDays);
  return (
    <span
      className={cx(
        'whitespace-nowrap text-xs',
        b === 'overdue' && 'font-medium text-rose-600 dark:text-rose-400',
        b === 'today' && 'font-medium text-amber-600 dark:text-amber-400',
        b === 'none' && 'text-muted',
      )}
      title={date ?? ''}
    >
      {date ? `${fmtDate(date, today)} · ${followUpLabel(date, today).replace('Follow up ', '')}` : '—'}
    </span>
  );
}

function LeadTable({ leads }: { leads: LeadWithProject[] }) {
  const { today, settings } = useData();
  const { runAction } = useUI();
  const navigate = useNavigate();
  if (leads.length === 0) return <div className="card"><EmptyState icon={<Search className="size-6" />} title="No leads match these filters" /></div>;

  return (
    <>
      {/* Desktop table */}
      <div className="card hidden overflow-x-auto md:block">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs font-medium text-muted">
              {['Business', 'Contact', 'Phone', 'Location', 'Status', 'Last contact', 'Next follow-up', 'Project', 'Website', 'Notes', ''].map((h) => (
                <th key={h} className="whitespace-nowrap px-3 py-2.5 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {leads.map((l) => (
              <tr key={l.id} className="cursor-pointer hover:bg-surface-2/60" onClick={() => navigate(`/leads/${l.id}`)}>
                <td className="max-w-56 px-3 py-2.5">
                  <div className="flex items-center gap-1.5">
                    <Link to={`/leads/${l.id}`} className="truncate font-medium hover:underline" onClick={(e) => e.stopPropagation()}>{l.business_name}</Link>
                    {l.is_demo && <DemoTag />}
                  </div>
                  <div className="truncate text-xs text-muted">{l.category}{l.potential_value ? ` · ${money(l.potential_value, settings.currency)}` : ''}</div>
                </td>
                <td className="max-w-36 truncate px-3 py-2.5">{l.contact_name || <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2.5"><PhoneLink phone={l.phone} /></td>
                <td className="max-w-32 truncate px-3 py-2.5 text-muted">{l.location || '—'}</td>
                <td className="px-3 py-2.5"><StatusSelect lead={l} /></td>
                <td className="whitespace-nowrap px-3 py-2.5 text-xs text-muted">{l.last_contacted_at ? fmtDate(l.last_contacted_at, today) : 'Never'}</td>
                <td className="px-3 py-2.5"><FollowUpCell date={l.next_follow_up_at} /></td>
                <td className="px-3 py-2.5">{l.project ? <ProjectBadge status={l.project.status} /> : <span className="text-muted">—</span>}</td>
                <td className="px-3 py-2.5">
                  {(l.live_url || l.preview_url || l.existing_website) ? (
                    <a href={l.live_url || l.preview_url || l.existing_website} target="_blank" rel="noreferrer" onClick={(e) => e.stopPropagation()} className="inline-flex items-center gap-1 text-xs text-accent hover:underline">
                      <ExternalLink className="size-3" /> {l.live_url ? 'Live' : l.preview_url ? 'Preview' : 'Current'}
                    </a>
                  ) : <span className="text-muted">—</span>}
                </td>
                <td className="max-w-56 truncate px-3 py-2.5 text-xs text-muted" title={l.notes}>{l.notes.replace(/^\[DEMO\]\s*/, '') || '—'}</td>
                <td className="px-3 py-2.5">
                  <button className="btn btn-secondary btn-sm" title="Called — log call and schedule follow-up" onClick={(e) => { e.stopPropagation(); runAction(l, 'called'); }}>
                    <Check className="size-3.5" /> Called
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Mobile cards */}
      <div className="space-y-2 md:hidden">
        {leads.map((l) => (
          <div key={l.id} className="card space-y-2 p-3" onClick={() => navigate(`/leads/${l.id}`)}>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex items-center gap-1.5 truncate font-medium">{l.business_name} {l.is_demo && <DemoTag />}</div>
                <div className="truncate text-xs text-muted">{[l.contact_name, l.location].filter(Boolean).join(' · ')}</div>
              </div>
              <StatusBadge status={l.status} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <PhoneLink phone={l.phone} />
              <FollowUpCell date={l.next_follow_up_at} />
            </div>
            <div className="flex gap-1.5">
              <button className="btn btn-primary btn-sm flex-1" onClick={(e) => { e.stopPropagation(); runAction(l, 'called'); }}>
                <Check className="size-3.5" /> Called
              </button>
              <button className="btn btn-secondary btn-sm flex-1" onClick={(e) => { e.stopPropagation(); runAction(l, 'no_answer'); }}>
                No answer
              </button>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}

// ─── Kanban ──────────────────────────────────────────────────────────────────

const KANBAN_ORDER: LeadStatus[] = ['New', 'Contacted', 'Interested', 'Negotiating', 'Won', 'Not Interested', 'Follow Up Later', 'Lost'];

function KanbanCard({ lead }: { lead: LeadWithProject }) {
  const { settings } = useData();
  const navigate = useNavigate();
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({ id: lead.id });
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={() => navigate(`/leads/${lead.id}`)}
      style={transform ? { transform: `translate3d(${transform.x}px, ${transform.y}px, 0)` } : undefined}
      className={cx(
        'cursor-grab touch-manipulation rounded-lg border border-border bg-surface p-2.5 text-sm shadow-sm transition-shadow hover:border-accent/40 active:cursor-grabbing',
        isDragging && 'relative z-50 rotate-1 shadow-xl ring-2 ring-accent/40',
      )}
    >
      <div className="flex items-start justify-between gap-1">
        <span className="font-medium leading-snug">{lead.business_name}</span>
        {lead.is_demo && <DemoTag />}
      </div>
      <div className="mt-1 text-xs text-muted">{[lead.contact_name, lead.category].filter(Boolean).join(' · ') || ' '}</div>
      <div className="mt-2 flex items-center justify-between gap-2">
        <PhoneLink phone={lead.phone} className="text-xs" />
        {lead.potential_value ? <span className="text-xs font-medium tabular-nums">{money(lead.potential_value, settings.currency, true)}</span> : null}
      </div>
      {(lead.next_follow_up_at || lead.project) && (
        <div className="mt-2 flex flex-wrap items-center justify-between gap-1 border-t border-border pt-2">
          {lead.next_follow_up_at ? <FollowUpCell date={lead.next_follow_up_at} /> : <span />}
          {lead.project && <ProjectBadge status={lead.project.status} />}
        </div>
      )}
    </div>
  );
}

function KanbanColumn({ status, leads }: { status: LeadStatus; leads: LeadWithProject[] }) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const { settings } = useData();
  const total = leads.reduce((s, l) => s + (l.potential_value ?? 0), 0);
  return (
    <div ref={setNodeRef} className={cx('flex w-72 shrink-0 flex-col rounded-xl border border-t-2 border-border bg-surface-2/50', STATUS_STYLES[status].col, isOver && 'bg-accent/5 ring-2 ring-accent/30')}>
      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="flex items-center gap-2 text-sm font-semibold">
          {status} <span className="rounded-full bg-surface px-1.5 text-xs text-muted">{leads.length}</span>
        </span>
        {total > 0 && <span className="text-xs text-muted">{money(total, settings.currency, true)}</span>}
      </div>
      <div className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {leads.map((l) => <KanbanCard key={l.id} lead={l} />)}
      </div>
    </div>
  );
}

function Kanban({ leads }: { leads: LeadWithProject[] }) {
  const { patchLeadLocal, refresh } = useData();
  const { toast } = useUI();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 8 } }),
  );
  const byStatus = useMemo(() => {
    const m = new Map<LeadStatus, LeadWithProject[]>(KANBAN_ORDER.map((s) => [s, []]));
    for (const l of leads) m.get(l.status)?.push(l);
    return m;
  }, [leads]);

  const onDragEnd = async (e: DragEndEvent) => {
    const id = Number(e.active.id);
    const status = e.over?.id as LeadStatus | undefined;
    const lead = leads.find((l) => l.id === id);
    if (!lead || !status || lead.status === status) return;
    patchLeadLocal(id, { status });
    try {
      await api.updateLead(id, { status });
      toast(`${lead.business_name} → ${status}${status === 'Won' ? ' · website project created' : ''}`);
    } catch (err) {
      toast((err as Error).message, { tone: 'error' });
    }
    refresh();
  };

  return (
    <DndContext sensors={sensors} onDragEnd={onDragEnd}>
      <div className="-mx-4 flex gap-3 overflow-x-auto px-4 pb-4 lg:-mx-6 lg:px-6">
        {KANBAN_ORDER.map((s) => <KanbanColumn key={s} status={s} leads={byStatus.get(s)!} />)}
      </div>
    </DndContext>
  );
}
