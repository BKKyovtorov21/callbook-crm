import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, ArrowRight, CalendarClock, Check, ExternalLink, Globe, MapPin, Pencil, Phone, PhoneMissed, Tag, ThumbsDown, ThumbsUp, Trophy, User } from 'lucide-react';
import type { LeadWithProject, QuickAction } from '../../shared/types';
import { dueBucket } from '../../shared/dates';
import { formatPhone, telHref } from '../../shared/format';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { cx, fmtDate, isTypingTarget } from '../lib/ui';
import { EmptyState, StatusBadge } from '../components/primitives';
import { FollowUpPicker, useResolveFollowUp, type FollowUpChoice } from '../components/FollowUpPicker';
import { useUI } from '../components/UIProvider';
import { dueText } from '../components/ReminderItem';

type Queue = 'due' | 'new' | 'open';
const QUEUES: { id: Queue; label: string }[] = [
  { id: 'due', label: 'Due now (overdue + today)' },
  { id: 'new', label: 'New leads (never called)' },
  { id: 'open', label: 'All open leads' },
];

export function CallMode() {
  const { leads, settings, today, refresh } = useData();
  const { runAction, toast } = useUI();
  const resolve = useResolveFollowUp();
  const [queue, setQueue] = useState<Queue>('due');
  // Snapshot of ids so leads don't jump around as follow-ups get rescheduled.
  const [ids, setIds] = useState<number[] | null>(null);
  const [index, setIndex] = useState(0);
  const [done, setDone] = useState<Record<number, string>>({});
  const [step, setStep] = useState<null | 'called'>(null);
  const [note, setNote] = useState('');
  const [choice, setChoice] = useState<FollowUpChoice>({ kind: 'days', days: settings.defaultFollowUpDays });
  const [busy, setBusy] = useState(false);

  const build = (q: Queue) => {
    const open = leads.filter((l) => !['Won', 'Not Interested', 'Lost'].includes(l.status));
    let list: LeadWithProject[];
    if (q === 'due') {
      list = leads
        .filter((l) => ['overdue', 'today'].includes(dueBucket(l.next_follow_up_at, today, settings.upcomingWindowDays)))
        .sort((a, b) => (a.next_follow_up_at! < b.next_follow_up_at! ? -1 : 1));
    } else if (q === 'new') list = open.filter((l) => l.status === 'New').sort((a, b) => (a.created_at < b.created_at ? -1 : 1));
    else list = open.sort((a, b) => (a.next_follow_up_at ?? '9999') < (b.next_follow_up_at ?? '9999') ? -1 : 1);
    return list.map((l) => l.id);
  };

  useEffect(() => {
    if (ids === null) setIds(build(queue));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids, queue]);

  const current = useMemo(() => (ids ? leads.find((l) => l.id === ids[index]) : undefined), [ids, index, leads]);
  const total = ids?.length ?? 0;
  const results = Object.values(done);
  const tally = {
    calls: results.length,
    interested: results.filter((r) => r === 'interested').length,
    noAnswer: results.filter((r) => r === 'no_answer').length,
  };

  const next = () => {
    setStep(null);
    setNote('');
    setIndex((i) => Math.min(i + 1, total));
  };
  const prev = () => {
    setStep(null);
    setIndex((i) => Math.max(i - 1, 0));
  };

  const act = (action: QuickAction) => {
    if (!current) return;
    if (action === 'called') {
      setStep('called');
      setChoice({ kind: 'days', days: settings.defaultFollowUpDays });
      return;
    }
    const mark = () => {
      setDone((d) => ({ ...d, [current.id]: action }));
      if (action !== 'note') next();
    };
    runAction(current, action, { note, onDone: mark });
  };

  const saveCalled = async () => {
    if (!current || busy) return;
    setBusy(true);
    try {
      const date = resolve(choice);
      await api.action(current.id, { action: 'called', note, followUpDate: date, skipFollowUp: !date });
      setDone((d) => ({ ...d, [current.id]: 'called' }));
      toast(`Logged · follow-up ${date ? fmtDate(date, today) : 'none'}`);
      refresh();
      next();
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  // Keyboard shortcuts.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (document.querySelector('[role=dialog]') || e.metaKey || e.ctrlKey || e.altKey) return;
      if (step === 'called') {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          saveCalled();
        } else if (e.key === 'Escape') setStep(null);
        return;
      }
      if (isTypingTarget(e.target) || !current) return;
      const map: Record<string, () => void> = {
        c: () => (window.location.href = telHref(current.phone, settings.phoneCountry)),
        d: () => act('called'),
        x: () => act('no_answer'),
        i: () => act('interested'),
        r: () => act('not_interested'),
        l: () => act('follow_up_later'),
        a: () => act('note'),
        ArrowRight: next,
        ArrowLeft: prev,
      };
      const fn = map[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const header = (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Call Mode</h1>
        <p className="text-sm text-muted">
          {tally.calls} logged this session · {tally.interested} interested · {tally.noAnswer} no answer
        </p>
      </div>
      <select
        className="input !w-auto"
        value={queue}
        onChange={(e) => {
          setQueue(e.target.value as Queue);
          setIds(null);
          setIndex(0);
          setStep(null);
        }}
      >
        {QUEUES.map((q) => <option key={q.id} value={q.id}>{q.label}</option>)}
      </select>
    </div>
  );

  if (!ids) return header;

  if (total === 0 || index >= total || !current) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card">
          <EmptyState icon={<Check className="size-8 text-emerald-500" />} title={total === 0 ? 'Nothing in this queue' : 'Queue finished 🎉'}>
            {total > 0 && <p>You worked through {total} lead{total > 1 ? 's' : ''}.</p>}
            <div className="mt-3 flex justify-center gap-2">
              {total > 0 && <button className="btn btn-secondary" onClick={() => setIndex(0)}>Start over</button>}
              {queue !== 'new' && <button className="btn btn-secondary" onClick={() => { setQueue('new'); setIds(null); setIndex(0); }}>Call new leads</button>}
              <Link to="/" className="btn btn-primary">Back to dashboard</Link>
            </div>
          </EmptyState>
        </div>
      </div>
    );
  }

  const l = current;
  const outcome = done[l.id];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      {header}

      <div className="flex items-center gap-3">
        <button className="btn btn-secondary btn-sm" onClick={prev} disabled={index === 0}><ArrowLeft className="size-3.5" /></button>
        <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2">
          <div className="h-full bg-accent transition-all" style={{ width: `${(index / total) * 100}%` }} />
        </div>
        <span className="text-xs font-medium tabular-nums text-muted">{index + 1} / {total}</span>
        <button className="btn btn-secondary btn-sm" onClick={next}>Skip <ArrowRight className="size-3.5" /></button>
      </div>

      <div className="card overflow-hidden">
        <div className="space-y-4 p-6 sm:p-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-3xl font-bold tracking-tight">{l.business_name}</h2>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <StatusBadge status={l.status} />
                {l.next_follow_up_at && <span className="text-xs text-muted">{dueText(l.next_follow_up_at, today)}</span>}
                {outcome && <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">✓ {outcome.replace('_', ' ')}</span>}
              </div>
            </div>
            <Link to={`/leads/${l.id}`} className="btn btn-ghost btn-sm"><ExternalLink className="size-3.5" /> Open lead</Link>
          </div>

          <a href={telHref(l.phone, settings.phoneCountry)} className="block text-4xl font-semibold tabular-nums tracking-tight text-accent hover:underline">
            {formatPhone(l.phone, settings.phoneCountry)}
          </a>

          <div className="grid gap-2 text-sm sm:grid-cols-2">
            {l.contact_name && <div className="flex items-center gap-2"><User className="size-4 text-muted" /> {l.contact_name}</div>}
            {l.category && <div className="flex items-center gap-2"><Tag className="size-4 text-muted" /> {l.category}</div>}
            {l.location && <div className="flex items-center gap-2"><MapPin className="size-4 text-muted" /> {l.location}</div>}
            <div className="flex items-center gap-2">
              <Globe className="size-4 text-muted" />
              {l.existing_website ? (
                <a href={l.existing_website} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">{l.existing_website.replace(/^https?:\/\//, '')}</a>
              ) : (
                <span className="text-muted">No website</span>
              )}
            </div>
            {l.preview_url && (
              <div className="flex items-center gap-2 sm:col-span-2">
                <ExternalLink className="size-4 text-muted" /> Preview:{' '}
                <a href={l.preview_url} target="_blank" rel="noreferrer" className="truncate text-accent hover:underline">{l.preview_url.replace(/^https?:\/\//, '')}</a>
              </div>
            )}
          </div>

          {(l.notes || l.follow_up_notes) && (
            <div className="rounded-lg bg-surface-2/70 p-3 text-sm">
              {l.follow_up_notes && <div className="font-medium">↳ {l.follow_up_notes}</div>}
              {l.notes && <div className="whitespace-pre-wrap text-fg/85">{l.notes}</div>}
            </div>
          )}
          <div className="text-xs text-muted">Last contact: {l.last_contacted_at ? fmtDate(l.last_contacted_at, today) : 'never'}</div>
        </div>

        <div className="border-t border-border bg-surface-2/40 p-4 sm:p-6">
          {step === 'called' ? (
            <div className="space-y-3">
              <div className="text-sm font-semibold">✓ Called — add a short note</div>
              <textarea
                autoFocus
                className="input"
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Spoke with owner, send examples… (Enter to save, Shift+Enter new line)"
              />
              <FollowUpPicker value={choice} onChange={setChoice} compact={false} />
              <div className="flex justify-end gap-2">
                <button className="btn btn-ghost" onClick={() => setStep(null)}>Cancel</button>
                <button className="btn btn-primary btn-lg" disabled={busy} onClick={saveCalled}>
                  Save & next <ArrowRight className="size-4" />
                </button>
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <a href={telHref(l.phone, settings.phoneCountry)} className="btn btn-lg col-span-2 h-14 bg-emerald-600 text-lg text-white hover:bg-emerald-500 sm:col-span-3">
                <Phone className="size-5" /> CALL <span className="kbd ml-2 !border-white/30 !bg-white/15 !text-white">C</span>
              </a>
              <BigButton icon={Check} label="Called" k="D" primary onClick={() => act('called')} />
              <BigButton icon={PhoneMissed} label="No answer" k="X" onClick={() => act('no_answer')} />
              <BigButton icon={ThumbsUp} label="Interested" k="I" onClick={() => act('interested')} />
              <BigButton icon={ThumbsDown} label="Not interested" k="R" onClick={() => act('not_interested')} />
              <BigButton icon={CalendarClock} label="Follow up later" k="L" onClick={() => act('follow_up_later')} />
              <BigButton icon={Pencil} label="Add note" k="A" onClick={() => act('note')} />
              {(l.status === 'Interested' || l.status === 'Negotiating') && (
                <button className="btn btn-success btn-lg col-span-2 h-12 sm:col-span-3" onClick={() => act('won')}>
                  <Trophy className="size-5" /> Won — start website project
                </button>
              )}
            </div>
          )}
        </div>
      </div>
      <p className="text-center text-xs text-muted">
        Shortcuts: <span className="kbd">C</span> call · <span className="kbd">D</span> called · <span className="kbd">X</span> no answer · <span className="kbd">I</span> interested · <span className="kbd">R</span> not interested · <span className="kbd">L</span> later · <span className="kbd">A</span> note · <span className="kbd">→</span> skip
      </p>
    </div>
  );
}

function BigButton({ icon: Icon, label, k, onClick, primary }: { icon: typeof Check; label: string; k: string; onClick: () => void; primary?: boolean }) {
  return (
    <button className={cx('btn btn-lg h-12 justify-start', primary ? 'btn-primary' : 'btn-secondary')} onClick={onClick}>
      <Icon className="size-5" /> {label}
      <span className={cx('kbd ml-auto', primary && '!border-white/30 !bg-white/15 !text-white')}>{k}</span>
    </button>
  );
}
