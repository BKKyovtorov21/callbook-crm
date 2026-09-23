import { useState } from 'react';
import { Check } from 'lucide-react';
import { PROJECT_STATUSES, type Lead, type Project, type ProjectStatus } from '../../shared/types';
import { isValidUrl } from '../../shared/format';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { cx, money, PROJECT_STAGES, stageIndex } from '../lib/ui';
import { Field, Modal } from './primitives';
import { useUI } from './UIProvider';

/** Gathering Info → Design → Development → Review → Live, with the current stage highlighted. */
export function ProjectProgress({ status, compact }: { status: ProjectStatus; compact?: boolean }) {
  const current = stageIndex(status);
  const done = status === 'Completed';
  return (
    <ol className="flex w-full items-center gap-1">
      {PROJECT_STAGES.map((s, i) => {
        const past = done || i < current;
        const active = !done && i === current;
        return (
          <li key={s.label} className="flex min-w-0 flex-1 flex-col gap-1">
            <div
              className={cx(
                'h-1.5 rounded-full',
                past ? 'bg-emerald-500' : active ? 'bg-accent' : 'bg-surface-2 ring-1 ring-inset ring-border',
              )}
            />
            {!compact && (
              <span className={cx('flex items-center gap-0.5 truncate text-[11px]', active ? 'font-semibold text-accent' : past ? 'text-fg' : 'text-muted')}>
                {past && <Check className="size-3 shrink-0 text-emerald-500" />}
                {s.label}
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}

export function PaymentBar({ price, paid }: { price: number | null; paid: number | null }) {
  const { settings } = useData();
  const pct = price ? Math.min(100, Math.round(((paid ?? 0) / price) * 100)) : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted">
          Paid <span className="font-medium text-fg">{money(paid ?? 0, settings.currency)}</span> of {money(price, settings.currency)}
        </span>
        <span className="font-medium">{money(Math.max(0, (price ?? 0) - (paid ?? 0)), settings.currency)} left</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
        <div className="h-full rounded-full bg-emerald-500" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function nextProjectStatus(s: ProjectStatus): ProjectStatus | null {
  const i = PROJECT_STATUSES.indexOf(s);
  return i >= 0 && i < PROJECT_STATUSES.length - 1 ? PROJECT_STATUSES[i + 1] : null;
}

/** Create or edit a website project. Links are stored on the lead. */
export function ProjectModal({
  lead,
  project,
  onClose,
}: {
  lead: Pick<Lead, 'id' | 'business_name' | 'preview_url' | 'live_url' | 'potential_value'>;
  project: Project | null;
  onClose: () => void;
}) {
  const { refresh, settings, today } = useData();
  const { confirm, toast } = useUI();
  const [f, setF] = useState({
    name: project?.name ?? `${lead.business_name} website`,
    status: project?.status ?? ('Not Started' as ProjectStatus),
    start_date: project?.start_date ?? today,
    deadline: project?.deadline ?? '',
    price: String(project?.price ?? lead.potential_value ?? ''),
    amount_paid: String(project?.amount_paid ?? 0),
    notes: project?.notes ?? '',
    preview_url: lead.preview_url,
    live_url: lead.live_url,
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const set = (k: keyof typeof f, v: string) => setF((p) => ({ ...p, [k]: v }));

  const save = async () => {
    const e: Record<string, string> = {};
    if (!isValidUrl(f.preview_url)) e.preview_url = 'Invalid URL';
    if (!isValidUrl(f.live_url)) e.live_url = 'Invalid URL';
    if (f.deadline && f.start_date && f.deadline < f.start_date) e.deadline = 'Deadline is before the start date';
    setErrors(e);
    if (Object.keys(e).length) return;
    const body = {
      ...f,
      start_date: f.start_date || null,
      deadline: f.deadline || null,
      price: f.price === '' ? null : Number(f.price),
      amount_paid: f.amount_paid === '' ? null : Number(f.amount_paid),
    };
    try {
      if (project) await api.updateProject(project.id, body);
      else await api.createProject(lead.id, body);
      await refresh();
      toast(project ? 'Project updated' : 'Project created');
      onClose();
    } catch (err) {
      setErrors({ form: (err as Error).message });
    }
  };

  const remove = async () => {
    if (!project) return;
    if (!(await confirm({ title: 'Delete project?', body: 'The lead stays; project details (price, payments, notes) are removed.', confirmLabel: 'Delete', danger: true }))) return;
    await api.deleteProject(project.id);
    await refresh();
    onClose();
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={project ? 'Edit website project' : 'Create website project'}
      footer={
        <>
          {errors.form && <span className="mr-auto text-sm text-rose-600">{errors.form}</span>}
          {project && (
            <button className="btn btn-ghost mr-auto !text-rose-600" onClick={remove}>
              Delete
            </button>
          )}
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Project name" className="sm:col-span-2">
          <input className="input" value={f.name} onChange={(e) => set('name', e.target.value)} />
        </Field>
        <Field label="Status" className="sm:col-span-2">
          <select className="input" value={f.status} onChange={(e) => set('status', e.target.value)}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <ProjectProgress status={f.status} />
        </div>
        <Field label="Preview URL" error={errors.preview_url}>
          <input className="input" value={f.preview_url} onChange={(e) => set('preview_url', e.target.value)} placeholder="preview.mysite.com/client" />
        </Field>
        <Field label="Live website URL" error={errors.live_url}>
          <input className="input" value={f.live_url} onChange={(e) => set('live_url', e.target.value)} />
        </Field>
        <Field label="Start date">
          <input className="input" type="date" value={f.start_date} onChange={(e) => set('start_date', e.target.value)} />
        </Field>
        <Field label="Deadline" error={errors.deadline}>
          <input className="input" type="date" value={f.deadline} onChange={(e) => set('deadline', e.target.value)} />
        </Field>
        <Field label={`Price (${settings.currency})`}>
          <input className="input" type="number" min={0} value={f.price} onChange={(e) => set('price', e.target.value)} />
        </Field>
        <Field label={`Amount paid (${settings.currency})`}>
          <input className="input" type="number" min={0} value={f.amount_paid} onChange={(e) => set('amount_paid', e.target.value)} />
        </Field>
        <div className="text-sm text-muted sm:col-span-2">
          Remaining:{' '}
          <span className="font-medium text-fg">{money(Math.max(0, (Number(f.price) || 0) - (Number(f.amount_paid) || 0)), settings.currency)}</span>
        </div>
        <Field label="Project notes" className="sm:col-span-2">
          <textarea className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} />
        </Field>
      </div>
    </Modal>
  );
}
