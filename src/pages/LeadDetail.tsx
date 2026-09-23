import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  BellRing,
  Briefcase,
  Globe,
  History,
  Mail,
  MessageSquare,
  Pencil,
  Phone,
  PhoneCall,
  Plus,
  StickyNote,
  Trash2,
  User,
  Users,
  Video,
} from 'lucide-react';
import { LEAD_STATUSES, type Interaction, type LeadDetail, type LeadStatus } from '../../shared/types';
import { diffDays } from '../../shared/dates';
import { formatPhone, telHref } from '../../shared/format';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { followUpLabel } from '../lib/derive';
import { cx, fmtDate, fmtDateTime, money, STATUS_STYLES } from '../lib/ui';
import { DemoTag, EmptyState, InfoRow, ProjectBadge, SectionCard, UrlRow } from '../components/primitives';
import { QuickActions } from '../components/QuickActions';
import { LeadFormModal } from '../components/LeadForm';
import { InteractionModal } from '../components/InteractionModal';
import { PaymentBar, ProjectModal, ProjectProgress } from '../components/ProjectBits';
import { SnoozeMenu } from '../components/ReminderItem';
import { FollowUpPicker, useResolveFollowUp, type FollowUpChoice } from '../components/FollowUpPicker';
import { useUI } from '../components/UIProvider';

const TYPE_ICONS: Record<string, typeof Phone> = { 'Phone Call': Phone, Email: Mail, SMS: MessageSquare, Meeting: Video, Other: StickyNote };

function resultTone(result: string) {
  if (/interested|won|agreed|booked/i.test(result) && !/not/i.test(result)) return 'text-emerald-600 dark:text-emerald-400';
  if (/no answer|voicemail/i.test(result)) return 'text-amber-600 dark:text-amber-400';
  if (/not interested/i.test(result)) return 'text-rose-600 dark:text-rose-400';
  return 'text-muted';
}

export function LeadDetailPage() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const { leads, reminders, today, settings, refresh } = useData();
  const { confirm, toast, openInteraction } = useUI();
  const resolve = useResolveFollowUp();
  const [data, setData] = useState<LeadDetail | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [editing, setEditing] = useState(false);
  const [projectOpen, setProjectOpen] = useState(false);
  const [editInteraction, setEditInteraction] = useState<Interaction | null>(null);
  const [notes, setNotes] = useState('');
  const [fuChoice, setFuChoice] = useState<FollowUpChoice | null>(null);

  const load = useCallback(async () => {
    try {
      const d = await api.lead(id);
      setData(d);
      setNotes(d.lead.notes);
    } catch {
      setNotFound(true);
    }
  }, [id]);

  // Reload whenever the shared lists change (quick actions refresh them).
  useEffect(() => {
    load();
  }, [load, leads, reminders]);

  // Keyboard: E edit, I add interaction, C call.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(t.tagName) || e.metaKey || e.ctrlKey || document.querySelector('[role=dialog]')) return;
      if (e.key === 'e') setEditing(true);
      if (e.key === 'i' && data) openInteraction(data.lead);
      if (e.key === 'c' && data?.lead.phone) window.location.href = telHref(data.lead.phone, settings.phoneCountry);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [data, openInteraction, settings.phoneCountry]);

  if (notFound)
    return (
      <EmptyState title="Lead not found">
        <Link to="/leads" className="text-accent hover:underline">Back to leads</Link>
      </EmptyState>
    );
  if (!data) return <div className="py-20 text-center text-sm text-muted">Loading…</div>;

  const { lead, project, interactions, activities } = data;
  const openReminder = data.reminders.find((r) => !r.completed);
  const overdue = lead.next_follow_up_at && lead.next_follow_up_at < today;

  const setStatus = async (status: LeadStatus) => {
    await api.updateLead(lead.id, { status });
    await refresh();
    toast(`Status → ${status}${status === 'Won' && !project ? ' · website project created' : ''}`);
  };

  const saveNotes = async () => {
    if (notes === lead.notes) return;
    await api.updateLead(lead.id, { notes });
    await refresh();
    toast('Notes saved');
  };

  const saveFollowUp = async () => {
    if (!fuChoice) return;
    const date = resolve(fuChoice, lead.last_contacted_at?.slice(0, 10) ?? today);
    await api.updateLead(lead.id, { next_follow_up_at: date ?? '' });
    setFuChoice(null);
    await refresh();
    toast(date ? `Follow-up set for ${fmtDate(date, today)}` : 'Follow-up cleared');
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete ${lead.business_name}?`,
      body: 'This permanently deletes the lead with its interactions, reminders and project. This can’t be undone.',
      confirmLabel: 'Delete lead',
      danger: true,
    });
    if (!ok) return;
    await api.deleteLead(lead.id);
    await refresh();
    toast('Lead deleted');
    navigate('/leads');
  };

  const removeInteraction = async (i: Interaction) => {
    if (!(await confirm({ title: 'Delete this interaction?', confirmLabel: 'Delete', danger: true }))) return;
    await api.deleteInteraction(i.id);
    await refresh();
  };

  const daysSince = lead.last_contacted_at ? diffDays(lead.last_contacted_at.slice(0, 10), today) : null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="space-y-4">
        <button onClick={() => navigate(-1)} className="inline-flex items-center gap-1 text-sm text-muted hover:text-fg">
          <ArrowLeft className="size-4" /> Back
        </button>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{lead.business_name}</h1>
              {lead.is_demo && <DemoTag />}
              <select
                value={lead.status}
                onChange={(e) => setStatus(e.target.value as LeadStatus)}
                className={cx('cursor-pointer appearance-none rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset focus:outline-none', STATUS_STYLES[lead.status].badge)}
                title="Change status"
              >
                {LEAD_STATUSES.map((s) => <option key={s}>{s}</option>)}
              </select>
            </div>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted">
              {lead.phone && (
                <a href={telHref(lead.phone, settings.phoneCountry)} className="inline-flex items-center gap-1.5 text-base font-semibold tabular-nums text-fg hover:text-accent">
                  <Phone className="size-4" /> {formatPhone(lead.phone, settings.phoneCountry)}
                </a>
              )}
              {lead.contact_name && <span className="inline-flex items-center gap-1.5"><User className="size-4" /> {lead.contact_name}</span>}
              {lead.category && <span>{lead.category}</span>}
              {lead.location && <span>{lead.location}</span>}
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <a href={telHref(lead.phone, settings.phoneCountry)} className="btn btn-primary"><PhoneCall className="size-4" /> Call</a>
            {lead.email && <a href={`mailto:${lead.email}`} className="btn btn-secondary"><Mail className="size-4" /> Email</a>}
            <button className="btn btn-secondary" onClick={() => setEditing(true)}><Pencil className="size-4" /> Edit</button>
            <button className="btn btn-secondary" onClick={() => openInteraction(lead)}><Plus className="size-4" /> Add interaction</button>
          </div>
        </div>
        <div className="card flex flex-wrap items-center gap-3 p-3">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted">Quick actions</span>
          <QuickActions lead={lead} size="sm" />
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.25fr)]">
        {/* Left column */}
        <div className="space-y-5">
          <SectionCard
            title="Follow-up"
            icon={<BellRing className="size-4 text-muted" />}
            className={cx(overdue && 'border-rose-500/50')}
            action={openReminder && <SnoozeMenu reminderId={openReminder.id} />}
          >
            <div className="space-y-3">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className={cx('text-lg font-semibold', overdue ? 'text-rose-600 dark:text-rose-400' : lead.next_follow_up_at === today ? 'text-amber-600 dark:text-amber-400' : '')}>
                    {lead.next_follow_up_at ? fmtDate(lead.next_follow_up_at, today) : 'Not scheduled'}
                  </div>
                  <div className="text-xs text-muted">{followUpLabel(lead.next_follow_up_at, today)}{lead.follow_up_notes && ` · ${lead.follow_up_notes}`}</div>
                </div>
                <div className="text-right text-xs text-muted">
                  Last contact
                  <div className="text-sm font-medium text-fg">{lead.last_contacted_at ? fmtDateTime(lead.last_contacted_at, today) : 'Never'}</div>
                  {daysSince !== null && <div>{daysSince === 0 ? 'today' : `${daysSince} days ago`}</div>}
                </div>
              </div>
              {fuChoice ? (
                <div className="space-y-3 rounded-lg bg-surface-2/60 p-3">
                  <FollowUpPicker value={fuChoice} onChange={setFuChoice} from={lead.last_contacted_at?.slice(0, 10) ?? today} />
                  <div className="flex justify-end gap-2">
                    <button className="btn btn-ghost btn-sm" onClick={() => setFuChoice(null)}>Cancel</button>
                    <button className="btn btn-primary btn-sm" onClick={saveFollowUp}>Save follow-up</button>
                  </div>
                </div>
              ) : (
                <button className="btn btn-secondary btn-sm" onClick={() => setFuChoice({ kind: 'days', days: settings.defaultFollowUpDays })}>
                  <BellRing className="size-3.5" /> {lead.next_follow_up_at ? 'Change follow-up' : 'Schedule follow-up'}
                </button>
              )}
            </div>
          </SectionCard>

          <SectionCard title="Contact information" icon={<Users className="size-4 text-muted" />}>
            <InfoRow label="Contact person">{lead.contact_name || '—'}</InfoRow>
            <InfoRow label="Phone">{lead.phone ? <a className="hover:text-accent" href={telHref(lead.phone, settings.phoneCountry)}>{formatPhone(lead.phone, settings.phoneCountry)}</a> : '—'}</InfoRow>
            <InfoRow label="Email">{lead.email ? <a className="hover:text-accent" href={`mailto:${lead.email}`}>{lead.email}</a> : '—'}</InfoRow>
            <InfoRow label="Category">{lead.category || '—'}</InfoRow>
            <InfoRow label="Location">{lead.location || '—'}</InfoRow>
          </SectionCard>

          <SectionCard title="Sales information" icon={<Briefcase className="size-4 text-muted" />}>
            <InfoRow label="Status">{lead.status}</InfoRow>
            <InfoRow label="Potential value">{money(lead.potential_value, settings.currency)}</InfoRow>
            <InfoRow label="Added">{fmtDate(lead.created_at, today)}</InfoRow>
            <InfoRow label="Interactions">{interactions.length}</InfoRow>
          </SectionCard>

          <SectionCard title="Website" icon={<Globe className="size-4 text-muted" />}>
            <div className="divide-y divide-border">
              <UrlRow label={lead.has_website || lead.existing_website ? 'Existing website' : 'Existing website (none)'} url={lead.existing_website} action="Visit website" />
              <UrlRow label="My website / preview" url={lead.preview_url} action="Open preview" />
              <UrlRow label="Final / live website" url={lead.live_url} action="Open website" />
            </div>
          </SectionCard>

          <SectionCard
            title="Website project"
            icon={<Briefcase className="size-4 text-muted" />}
            action={
              <button className="btn btn-secondary btn-sm" onClick={() => setProjectOpen(true)}>
                {project ? <><Pencil className="size-3.5" /> Edit</> : <><Plus className="size-3.5" /> Create</>}
              </button>
            }
          >
            {project ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-sm font-medium">{project.name}</span>
                  <ProjectBadge status={project.status} />
                </div>
                <ProjectProgress status={project.status} />
                <PaymentBar price={project.price} paid={project.amount_paid} />
                <div className="grid grid-cols-2 gap-x-4 text-sm">
                  <InfoRow label="Start">{fmtDate(project.start_date, today)}</InfoRow>
                  <InfoRow label="Deadline">
                    <span className={cx(project.deadline && project.status !== 'Completed' && project.deadline < today && 'text-rose-600')}>{fmtDate(project.deadline, today)}</span>
                  </InfoRow>
                </div>
                {project.notes && <p className="whitespace-pre-wrap rounded-lg bg-surface-2/60 p-3 text-sm">{project.notes}</p>}
              </div>
            ) : (
              <p className="text-sm text-muted">No project yet. Marking the lead as <b>Won</b> creates one automatically.</p>
            )}
          </SectionCard>
        </div>

        {/* Right column */}
        <div className="space-y-5">
          <SectionCard title="Notes" icon={<StickyNote className="size-4 text-muted" />} action={notes !== lead.notes && <button className="btn btn-primary btn-sm" onClick={saveNotes}>Save</button>}>
            <textarea
              className="input min-h-28"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              onBlur={saveNotes}
              placeholder="Anything worth remembering about this business…"
            />
            {lead.extra_info && <p className="mt-3 whitespace-pre-wrap text-sm text-muted">{lead.extra_info}</p>}
          </SectionCard>

          <SectionCard title="Interaction history" icon={<Phone className="size-4 text-muted" />}>
            <button className="btn btn-primary btn-lg mb-4 w-full" onClick={() => openInteraction(lead)}>
              <Plus className="size-5" /> Add interaction
            </button>
            {interactions.length === 0 ? (
              <EmptyState title="No interactions yet">Use “Called” or “Add interaction” to log one.</EmptyState>
            ) : (
              <ol className="relative space-y-4 border-l border-border pl-5">
                {interactions.map((i) => {
                  const Icon = TYPE_ICONS[i.type] ?? StickyNote;
                  return (
                    <li key={i.id} className="group relative">
                      <span className="absolute -left-[31px] grid size-5 place-items-center rounded-full border border-border bg-surface">
                        <Icon className="size-3 text-muted" />
                      </span>
                      <div className="flex flex-wrap items-baseline justify-between gap-2">
                        <div className="text-sm">
                          <span className="font-semibold">{fmtDateTime(i.date, today)}</span>
                          <span className="text-muted"> · {i.type}</span>
                          {i.result && <span className={cx('font-medium', resultTone(i.result))}> — {i.result}</span>}
                        </div>
                        <div className="flex gap-1 opacity-0 transition-opacity group-hover:opacity-100">
                          <button className="btn btn-ghost btn-sm !px-1.5" onClick={() => setEditInteraction(i)} title="Edit"><Pencil className="size-3.5" /></button>
                          <button className="btn btn-ghost btn-sm !px-1.5" onClick={() => removeInteraction(i)} title="Delete"><Trash2 className="size-3.5" /></button>
                        </div>
                      </div>
                      {i.notes && <p className="mt-0.5 whitespace-pre-wrap text-sm text-fg/85">{i.notes}</p>}
                    </li>
                  );
                })}
              </ol>
            )}
          </SectionCard>

          <SectionCard title="Activity timeline" icon={<History className="size-4 text-muted" />}>
            <ol className="space-y-2">
              {activities.slice(0, 30).map((a) => (
                <li key={a.id} className="flex gap-3 text-sm">
                  <span className="w-24 shrink-0 text-xs tabular-nums text-muted">{fmtDateTime(a.at, today)}</span>
                  <span className="text-fg/85">{a.text}</span>
                </li>
              ))}
            </ol>
          </SectionCard>

          <div className="flex justify-end">
            <button className="btn btn-ghost !text-rose-600" onClick={remove}>
              <Trash2 className="size-4" /> Delete lead
            </button>
          </div>
        </div>
      </div>

      {editing && <LeadFormModal open lead={lead} project={project} onClose={() => setEditing(false)} onSaved={() => toast('Lead updated')} />}
      {projectOpen && <ProjectModal lead={lead} project={project} onClose={() => setProjectOpen(false)} />}
      {editInteraction && <InteractionModal lead={lead} interaction={editInteraction} onClose={() => setEditInteraction(null)} />}
    </div>
  );
}
