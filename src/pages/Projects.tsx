import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight, CalendarClock, FolderKanban, Pencil } from 'lucide-react';
import type { Lead, ProjectWithLead } from '../../shared/types';
import { diffDays } from '../../shared/dates';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { isActiveProject } from '../lib/derive';
import { cx, fmtDate, money } from '../lib/ui';
import { EmptyState, ProjectBadge, UrlRow } from '../components/primitives';
import { nextProjectStatus, PaymentBar, ProjectModal, ProjectProgress } from '../components/ProjectBits';
import { useUI } from '../components/UIProvider';

type Tab = 'active' | 'completed' | 'all';

export function Projects() {
  const { projects, leads, settings, today, refresh } = useData();
  const { toast } = useUI();
  const [tab, setTab] = useState<Tab>('active');
  const [editing, setEditing] = useState<ProjectWithLead | null>(null);

  const list = projects.filter((p) => (tab === 'all' ? true : tab === 'active' ? isActiveProject(p.status) : !isActiveProject(p.status)));
  const active = projects.filter((p) => isActiveProject(p.status));
  const outstanding = projects.reduce((s, p) => s + Math.max(0, (p.price ?? 0) - (p.amount_paid ?? 0)), 0);
  const collected = projects.reduce((s, p) => s + (p.amount_paid ?? 0), 0);

  const advance = async (p: ProjectWithLead) => {
    const next = nextProjectStatus(p.status);
    if (!next) return;
    await api.updateProject(p.id, { status: next });
    await refresh();
    toast(`${p.business_name}: ${next}`);
  };

  const leadFor = (p: ProjectWithLead): Lead => leads.find((l) => l.id === p.lead_id)!;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Projects</h1>
          <p className="text-sm text-muted">
            {active.length} in progress · {money(collected, settings.currency)} collected · {money(outstanding, settings.currency)} outstanding
          </p>
        </div>
        <div className="flex rounded-lg border border-border bg-surface p-0.5">
          {(['active', 'completed', 'all'] as Tab[]).map((t) => (
            <button key={t} className={cx('btn btn-sm capitalize', tab === t ? 'bg-surface-2 text-fg' : 'btn-ghost')} onClick={() => setTab(t)}>
              {t === 'active' ? 'In progress' : t}
            </button>
          ))}
        </div>
      </div>

      {list.length === 0 ? (
        <div className="card">
          <EmptyState icon={<FolderKanban className="size-6" />} title="No projects here">
            Mark a lead as <b>Won</b> to create its website project.
          </EmptyState>
        </div>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {list.map((p) => {
            const left = p.deadline ? diffDays(today, p.deadline) : null;
            const next = nextProjectStatus(p.status);
            return (
              <article key={p.id} className="card flex flex-col gap-4 p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link to={`/leads/${p.lead_id}`} className="block truncate font-semibold hover:underline">{p.name}</Link>
                    <div className="truncate text-xs text-muted">{p.business_name}{p.contact_name && ` · ${p.contact_name}`}</div>
                  </div>
                  <ProjectBadge status={p.status} />
                </div>
                <ProjectProgress status={p.status} />
                <PaymentBar price={p.price} paid={p.amount_paid} />
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted">
                  <span>Started {fmtDate(p.start_date, today)}</span>
                  {p.deadline && (
                    <span className={cx('inline-flex items-center gap-1', isActiveProject(p.status) && left! < 0 ? 'font-medium text-rose-600' : isActiveProject(p.status) && left! <= 3 ? 'font-medium text-amber-600 dark:text-amber-400' : '')}>
                      <CalendarClock className="size-3.5" /> Deadline {fmtDate(p.deadline, today)}
                      {isActiveProject(p.status) && (left! < 0 ? ` (${-left!}d late)` : left === 0 ? ' (today)' : ` (${left}d)`)}
                    </span>
                  )}
                </div>
                <div className="divide-y divide-border rounded-lg border border-border px-3">
                  <UrlRow label="Preview" url={p.preview_url} action="Open preview" />
                  <UrlRow label="Live website" url={p.live_url} action="Open website" />
                </div>
                {p.notes && <p className="line-clamp-3 whitespace-pre-wrap text-sm text-fg/80">{p.notes}</p>}
                <div className="mt-auto flex flex-wrap gap-2">
                  {next && (
                    <button className="btn btn-primary btn-sm" onClick={() => advance(p)}>
                      Move to {next} <ArrowRight className="size-3.5" />
                    </button>
                  )}
                  <button className="btn btn-secondary btn-sm" onClick={() => setEditing(p)}>
                    <Pencil className="size-3.5" /> Edit
                  </button>
                  <span className="ml-auto self-center text-sm font-semibold">{money(p.price, settings.currency)}</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
      {editing && <ProjectModal lead={leadFor(editing)} project={editing} onClose={() => setEditing(null)} />}
    </div>
  );
}
