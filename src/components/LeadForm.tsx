import { useMemo, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { ChevronDown } from 'lucide-react';
import { LEAD_STATUSES, PROJECT_STATUSES, type Lead, type LeadStatus, type Project, type ProjectStatus } from '../../shared/types';
import { formatPhone, isPossiblePhone, isValidEmail, isValidUrl, phoneDigits } from '../../shared/format';
import { api, ApiError } from '../lib/api';
import { useData } from '../lib/store';
import { cx } from '../lib/ui';
import { Field, Modal } from './primitives';
import { FollowUpPicker, useResolveFollowUp, type FollowUpChoice } from './FollowUpPicker';

type Form = {
  business_name: string;
  phone: string;
  status: LeadStatus;
  notes: string;
  category: string;
  location: string;
  has_website: boolean;
  existing_website: string;
  contact_name: string;
  email: string;
  potential_value: string;
  last_contacted_at: string;
  follow_up_notes: string;
  project_status: ProjectStatus | '';
  preview_url: string;
  live_url: string;
  project_notes: string;
  extra_info: string;
};

function initialForm(lead?: Lead, project?: Project | null): Form {
  return {
    business_name: lead?.business_name ?? '',
    phone: lead?.phone ?? '',
    status: lead?.status ?? 'New',
    notes: lead?.notes ?? '',
    category: lead?.category ?? '',
    location: lead?.location ?? '',
    has_website: lead?.has_website ?? false,
    existing_website: lead?.existing_website ?? '',
    contact_name: lead?.contact_name ?? '',
    email: lead?.email ?? '',
    potential_value: lead?.potential_value != null ? String(lead.potential_value) : '',
    last_contacted_at: lead?.last_contacted_at?.slice(0, 10) ?? '',
    follow_up_notes: lead?.follow_up_notes ?? '',
    project_status: project?.status ?? '',
    preview_url: lead?.preview_url ?? '',
    live_url: lead?.live_url ?? '',
    project_notes: project?.notes ?? '',
    extra_info: lead?.extra_info ?? '',
  };
}

/** Add / edit lead. The top five fields cover a live phone call; the rest is optional. */
export function LeadFormModal({
  open,
  onClose,
  lead,
  project,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  lead?: Lead;
  project?: Project | null;
  onSaved?: (id: number, another: boolean) => void;
}) {
  const { leads, settings, today, refresh } = useData();
  const resolve = useResolveFollowUp();
  const editing = !!lead;
  const [f, setF] = useState<Form>(() => initialForm(lead, project));
  const [followUp, setFollowUp] = useState<FollowUpChoice>(() =>
    lead?.next_follow_up_at ? { kind: 'date', date: lead.next_follow_up_at } : lead ? { kind: 'none' } : { kind: 'today' },
  );
  const [followUpTouched, setFollowUpTouched] = useState(false);
  const [more, setMore] = useState(editing);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF((p) => ({ ...p, [k]: v }));
    setErrors((e) => ({ ...e, [k]: '' }));
  };

  // New leads default to "call today"; once contacted, default to the configured period.
  const setStatus = (s: LeadStatus) => {
    set('status', s);
    if (!editing && !followUpTouched) {
      if (s === 'New') setFollowUp({ kind: 'today' });
      else if (s === 'Won' || s === 'Not Interested' || s === 'Lost') setFollowUp({ kind: 'none' });
      else setFollowUp({ kind: 'days', days: settings.defaultFollowUpDays });
    }
  };

  const duplicate = useMemo(() => {
    const d = phoneDigits(f.phone);
    if (d.length < 6) return null;
    return leads.find((l) => l.id !== lead?.id && phoneDigits(l.phone).endsWith(d.slice(-9))) ?? null;
  }, [f.phone, leads, lead?.id]);

  const validate = () => {
    const e: Record<string, string> = {};
    if (!f.business_name.trim()) e.business_name = 'Business name is required';
    if (!f.phone.trim()) e.phone = 'Phone number is required';
    else if (!isPossiblePhone(f.phone, settings.phoneCountry)) e.phone = 'This doesn’t look like a valid phone number';
    if (!isValidEmail(f.email)) e.email = 'Invalid email address';
    for (const k of ['existing_website', 'preview_url', 'live_url'] as const) if (!isValidUrl(f[k])) e[k] = 'Invalid URL (e.g. example.com)';
    if (f.potential_value && !(Number(f.potential_value) >= 0)) e.potential_value = 'Enter a positive number';
    if (followUp.kind === 'date' && !followUp.date) e.followUp = 'Pick a date';
    setErrors(e);
    if (Object.keys(e).some((k) => ['existing_website', 'preview_url', 'live_url', 'email', 'potential_value'].includes(k))) setMore(true);
    return Object.keys(e).length === 0;
  };

  const submit = async (e: FormEvent | null, another = false) => {
    e?.preventDefault();
    if (!validate()) return;
    setSaving(true);
    const contactFrom = f.last_contacted_at || today;
    const body = {
      business_name: f.business_name.trim(),
      phone: formatPhone(f.phone, settings.phoneCountry),
      status: f.status,
      notes: f.notes,
      category: f.category,
      location: f.location,
      has_website: f.has_website || !!f.existing_website,
      existing_website: f.existing_website,
      contact_name: f.contact_name,
      email: f.email,
      potential_value: f.potential_value ? Number(f.potential_value) : null,
      last_contacted_at: editing
        ? f.last_contacted_at === (lead!.last_contacted_at?.slice(0, 10) ?? '')
          ? undefined
          : f.last_contacted_at || null
        : f.last_contacted_at || undefined,
      next_follow_up_at: resolve(followUp, contactFrom) ?? null,
      follow_up_notes: f.follow_up_notes,
      preview_url: f.preview_url,
      live_url: f.live_url,
      extra_info: f.extra_info,
      ...(f.project_status || project ? { project_status: f.project_status || null, project_notes: f.project_notes } : {}),
    };
    try {
      const res = editing ? await api.updateLead(lead!.id, body) : await api.createLead(body);
      await refresh();
      onSaved?.(res.lead.id, another);
      if (another) {
        setF(initialForm());
        setFollowUp({ kind: 'today' });
        setFollowUpTouched(false);
      } else onClose();
    } catch (err) {
      if (err instanceof ApiError && err.field) setErrors({ [err.field]: err.message });
      else setErrors({ form: (err as Error).message });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={editing ? `Edit ${lead!.business_name}` : 'Add lead'}
      footer={
        <>
          {errors.form && <span className="mr-auto text-sm text-rose-600">{errors.form}</span>}
          <span className="mr-auto hidden text-xs text-muted sm:inline">
            <span className="kbd">⌘</span> <span className="kbd">Enter</span> to save
          </span>
          <button className="btn btn-secondary" onClick={onClose} type="button">
            Cancel
          </button>
          {!editing && (
            <button className="btn btn-secondary" disabled={saving} onClick={() => submit(null, true)} type="button">
              Save & add another
            </button>
          )}
          <button className="btn btn-primary" disabled={saving} onClick={() => submit(null)} type="button">
            {editing ? 'Save changes' : 'Save lead'}
          </button>
        </>
      }
    >
      <form
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) submit(null);
        }}
        className="space-y-4"
      >
        {/* The fast path: Business → Phone → Status → Follow-up → Notes */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Business name *" error={errors.business_name}>
            <input className="input" autoFocus value={f.business_name} onChange={(e) => set('business_name', e.target.value)} placeholder="e.g. Mike's Barbershop" />
          </Field>
          <Field label="Phone number *" error={errors.phone}>
            <input
              className="input tabular-nums"
              type="tel"
              inputMode="tel"
              value={f.phone}
              onChange={(e) => set('phone', e.target.value)}
              onBlur={() => f.phone && set('phone', formatPhone(f.phone, settings.phoneCountry))}
              placeholder="(555) 123-4567"
            />
            {duplicate && (
              <span className="mt-1 block text-xs text-amber-600 dark:text-amber-400">
                Same number as{' '}
                <Link to={`/leads/${duplicate.id}`} onClick={onClose} className="font-medium underline">
                  {duplicate.business_name}
                </Link>
              </span>
            )}
          </Field>
        </div>

        <div>
          <span className="label">Status</span>
          <div className="flex flex-wrap gap-1.5">
            {LEAD_STATUSES.map((s) => (
              <button key={s} type="button" className={cx('chip', f.status === s && 'chip-active')} onClick={() => setStatus(s)}>
                {s}
              </button>
            ))}
          </div>
        </div>

        <div>
          <span className="label">Next follow-up</span>
          <FollowUpPicker
            value={followUp}
            from={f.last_contacted_at || today}
            allowToday
            onChange={(v) => {
              setFollowUp(v);
              setFollowUpTouched(true);
              setErrors((e) => ({ ...e, followUp: '' }));
            }}
          />
          {errors.followUp && <span className="mt-1 block text-xs text-rose-600">{errors.followUp}</span>}
        </div>

        <Field label="Notes">
          <textarea className="input" rows={3} value={f.notes} onChange={(e) => set('notes', e.target.value)} placeholder="What did they say? Who to ask for? Best time to call?" />
        </Field>

        <button type="button" className="flex w-full items-center gap-2 text-sm font-medium text-muted hover:text-fg" onClick={() => setMore((m) => !m)}>
          <ChevronDown className={cx('size-4 transition-transform', more && 'rotate-180')} />
          More details
          <span className="h-px flex-1 bg-border" />
        </button>

        {more && (
          <div className="space-y-5">
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Business</legend>
              <Field label="Category">
                <input className="input" list="categories" value={f.category} onChange={(e) => set('category', e.target.value)} placeholder="Restaurant, Plumber…" />
              </Field>
              <Field label="Location">
                <input className="input" list="locations" value={f.location} onChange={(e) => set('location', e.target.value)} placeholder="City / area" />
              </Field>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={f.has_website} onChange={(e) => set('has_website', e.target.checked)} className="size-4 accent-[var(--accent)]" />
                Has an existing website
              </label>
              <Field label="Existing website URL" error={errors.existing_website} className="sm:col-span-2">
                <input className="input" value={f.existing_website} onChange={(e) => set('existing_website', e.target.value)} placeholder="theirsite.com" />
              </Field>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Contact</legend>
              <Field label="Contact person">
                <input className="input" value={f.contact_name} onChange={(e) => set('contact_name', e.target.value)} />
              </Field>
              <Field label="Email" error={errors.email}>
                <input className="input" type="email" value={f.email} onChange={(e) => set('email', e.target.value)} />
              </Field>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Sales & follow-up</legend>
              <Field label={`Potential deal value (${settings.currency})`} error={errors.potential_value}>
                <input className="input" type="number" min={0} step="50" value={f.potential_value} onChange={(e) => set('potential_value', e.target.value)} />
              </Field>
              <Field label="Last contact date">
                <input className="input" type="date" max={today} value={f.last_contacted_at} onChange={(e) => set('last_contacted_at', e.target.value)} />
              </Field>
              <Field label="Follow-up notes / reason" className="sm:col-span-2">
                <input className="input" value={f.follow_up_notes} onChange={(e) => set('follow_up_notes', e.target.value)} placeholder="e.g. Call after lunch, ask for owner" />
              </Field>
            </fieldset>

            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Website project</legend>
              <Field label="Project status">
                <select className="input" value={f.project_status} onChange={(e) => set('project_status', e.target.value as ProjectStatus | '')}>
                  <option value="">{project ? project.status : '— No project yet —'}</option>
                  {PROJECT_STATUSES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </Field>
              <Field label="Preview website URL" error={errors.preview_url}>
                <input className="input" value={f.preview_url} onChange={(e) => set('preview_url', e.target.value)} placeholder="preview.mysite.com/client" />
              </Field>
              <Field label="Final website URL" error={errors.live_url}>
                <input className="input" value={f.live_url} onChange={(e) => set('live_url', e.target.value)} />
              </Field>
              <Field label="Project notes" className="sm:col-span-2">
                <textarea className="input" rows={2} value={f.project_notes} onChange={(e) => set('project_notes', e.target.value)} disabled={!f.project_status && !project} placeholder={!f.project_status && !project ? 'Choose a project status first' : ''} />
              </Field>
            </fieldset>

            <Field label="Additional information">
              <textarea className="input" rows={2} value={f.extra_info} onChange={(e) => set('extra_info', e.target.value)} placeholder="Opening hours, social links, competitors…" />
            </Field>
          </div>
        )}
        <datalist id="categories">
          {[...new Set(leads.map((l) => l.category).filter(Boolean))].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <datalist id="locations">
          {[...new Set(leads.map((l) => l.location).filter(Boolean))].map((c) => (
            <option key={c} value={c} />
          ))}
        </datalist>
        <button type="submit" hidden />
      </form>
    </Modal>
  );
}
