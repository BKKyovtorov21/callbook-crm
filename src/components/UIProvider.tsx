import { createContext, useCallback, useContext, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, X } from 'lucide-react';
import type { Lead, QuickAction } from '../../shared/types';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { fmtWeekdayDate } from '../lib/ui';
import { Field, Modal } from './primitives';
import { FollowUpPicker, useResolveFollowUp, type FollowUpChoice } from './FollowUpPicker';
import { LeadFormModal } from './LeadForm';
import { InteractionModal } from './InteractionModal';

interface Toast {
  id: number;
  text: string;
  action?: { label: string; run: () => void };
  tone?: 'ok' | 'error';
}

type LeadRef = Pick<Lead, 'id' | 'business_name'>;

interface UI {
  toast: (text: string, opts?: Omit<Toast, 'id' | 'text'>) => void;
  confirm: (opts: { title: string; body?: ReactNode; confirmLabel?: string; danger?: boolean }) => Promise<boolean>;
  openAddLead: () => void;
  openInteraction: (lead: LeadRef, onDone?: () => void) => void;
  /** Runs a quick action, opening a dialog first when the action needs input. */
  runAction: (lead: LeadRef, action: QuickAction, opts?: { note?: string; onDone?: () => void }) => Promise<void>;
}

const UIContext = createContext<UI | null>(null);

type Pending =
  | { kind: 'interested' | 'follow_up_later' | 'note' | 'called_note'; lead: LeadRef; onDone?: () => void }
  | null;

export function UIProvider({ children }: { children: ReactNode }) {
  const { refresh, settings } = useData();
  const navigate = useNavigate();
  const resolve = useResolveFollowUp();
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [confirmState, setConfirmState] = useState<{
    title: string;
    body?: ReactNode;
    confirmLabel?: string;
    danger?: boolean;
    resolve: (v: boolean) => void;
  } | null>(null);
  const [addOpen, setAddOpen] = useState(0);
  const [interaction, setInteraction] = useState<{ lead: LeadRef; onDone?: () => void } | null>(null);
  const [pending, setPending] = useState<Pending>(null);
  const [choice, setChoice] = useState<FollowUpChoice>({ kind: 'days', days: 7 });
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const toastId = useRef(0);

  const toast = useCallback<UI['toast']>((text, opts) => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-3), { id, text, ...opts }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), opts?.action ? 6000 : 3500);
  }, []);

  const confirm = useCallback<UI['confirm']>(
    (opts) => new Promise<boolean>((res) => setConfirmState({ ...opts, resolve: res })),
    [],
  );

  const send = useCallback(
    async (lead: LeadRef, action: QuickAction, body: { note?: string; followUpDate?: string | null; skipFollowUp?: boolean } = {}) => {
      setBusy(true);
      try {
        const res = await api.action(lead.id, { action, ...body });
        await refresh();
        const fu = res.lead.next_follow_up_at;
        const next = fu ? ` · follow-up ${fmtWeekdayDate(fu)}` : '';
        const msgs: Record<QuickAction, string> = {
          called: `Call logged for ${lead.business_name}${next}`,
          no_answer: `No answer logged${next}`,
          interested: `${lead.business_name} marked Interested${next}`,
          not_interested: `${lead.business_name} marked Not Interested`,
          follow_up_later: `Will follow up with ${lead.business_name}${next}`,
          won: `🎉 ${lead.business_name} won — website project created`,
          note: 'Note added',
        };
        toast(msgs[action], action === 'won' ? { action: { label: 'Open project', run: () => navigate('/projects') } } : undefined);
        return true;
      } catch (e) {
        toast((e as Error).message, { tone: 'error' });
        return false;
      } finally {
        setBusy(false);
      }
    },
    [refresh, toast, navigate],
  );

  const runAction = useCallback<UI['runAction']>(
    async (lead, action, opts = {}) => {
      if (action === 'interested' || action === 'follow_up_later' || action === 'note') {
        setChoice(action === 'follow_up_later' ? { kind: 'days', days: 30 } : { kind: 'days', days: settings.defaultFollowUpDays });
        setNote(opts.note ?? '');
        setPending({ kind: action, lead, onDone: opts.onDone });
        return;
      }
      if (await send(lead, action, { note: opts.note })) opts.onDone?.();
    },
    [send, settings.defaultFollowUpDays],
  );

  const submitPending = async (skipFollowUp = false) => {
    if (!pending) return;
    const date = skipFollowUp ? null : resolve(choice);
    const action: QuickAction = pending.kind === 'called_note' ? 'called' : pending.kind;
    const ok = await send(pending.lead, action, { note, followUpDate: date, skipFollowUp: skipFollowUp || !date });
    if (ok) {
      pending.onDone?.();
      setPending(null);
    }
  };

  const ui: UI = {
    toast,
    confirm,
    openAddLead: () => setAddOpen((n) => n + 1),
    openInteraction: (lead, onDone) => setInteraction({ lead, onDone }),
    runAction,
  };

  const titles = {
    interested: 'Interested! Schedule a follow-up?',
    follow_up_later: 'Follow up later — when?',
    note: 'Add a note',
    called_note: 'Call logged',
  };

  return (
    <UIContext.Provider value={ui}>
      {children}

      {addOpen > 0 && (
        <LeadFormModal
          key={addOpen}
          open
          onClose={() => setAddOpen(0)}
          onSaved={(id, another) => {
            toast('Lead saved', { action: { label: 'Open', run: () => navigate(`/leads/${id}`) } });
            if (!another) navigate(`/leads/${id}`);
          }}
        />
      )}

      {interaction && (
        <InteractionModal
          lead={interaction.lead}
          onClose={() => setInteraction(null)}
          onSaved={() => {
            interaction.onDone?.();
            toast('Interaction added');
          }}
        />
      )}

      <Modal
        open={!!pending}
        onClose={() => setPending(null)}
        size="sm"
        title={pending ? titles[pending.kind] : ''}
        footer={
          pending?.kind === 'note' ? (
            <button className="btn btn-primary" disabled={busy || !note.trim()} onClick={() => submitPending(true)}>
              Save note
            </button>
          ) : (
            <>
              {pending?.kind === 'interested' && (
                <button className="btn btn-secondary" disabled={busy} onClick={() => submitPending(true)}>
                  No follow-up
                </button>
              )}
              <button className="btn btn-primary" disabled={busy} onClick={() => submitPending(false)}>
                {pending?.kind === 'follow_up_later' ? 'Schedule' : 'Save'}
              </button>
            </>
          )
        }
      >
        {pending && (
          <div
            className="space-y-4"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && (e.metaKey || e.ctrlKey || (e.target as HTMLElement).tagName === 'INPUT')) {
                e.preventDefault();
                submitPending(pending.kind === 'note');
              }
            }}
          >
            <p className="text-sm text-muted">{pending.lead.business_name}</p>
            {pending.kind !== 'note' && <FollowUpPicker value={choice} onChange={setChoice} allowNone={false} />}
            <Field label={pending.kind === 'note' ? 'Note' : 'Short note (optional)'}>
              <textarea className="input" rows={3} autoFocus value={note} onChange={(e) => setNote(e.target.value)} placeholder="What happened on the call?" />
            </Field>
          </div>
        )}
      </Modal>

      <Modal
        open={!!confirmState}
        size="sm"
        onClose={() => {
          confirmState?.resolve(false);
          setConfirmState(null);
        }}
        title={confirmState?.title}
        footer={
          <>
            <button
              className="btn btn-secondary"
              onClick={() => {
                confirmState?.resolve(false);
                setConfirmState(null);
              }}
            >
              Cancel
            </button>
            <button
              className={confirmState?.danger ? 'btn btn-danger' : 'btn btn-primary'}
              autoFocus
              onClick={() => {
                confirmState?.resolve(true);
                setConfirmState(null);
              }}
            >
              {confirmState?.confirmLabel ?? 'Confirm'}
            </button>
          </>
        }
      >
        <div className="text-sm text-muted">{confirmState?.body ?? 'Are you sure?'}</div>
      </Modal>

      <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 sm:items-end sm:pr-6">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex max-w-md items-center gap-3 rounded-xl border px-4 py-2.5 text-sm shadow-lg ${
              t.tone === 'error'
                ? 'border-rose-500/40 bg-rose-50 text-rose-800 dark:bg-rose-950 dark:text-rose-200'
                : 'border-border bg-surface'
            }`}
          >
            {t.tone !== 'error' && <CheckCircle2 className="size-4 shrink-0 text-emerald-500" />}
            <span>{t.text}</span>
            {t.action && (
              <button className="font-semibold text-accent hover:underline" onClick={t.action.run}>
                {t.action.label}
              </button>
            )}
            <button className="text-muted hover:text-fg" onClick={() => setToasts((x) => x.filter((y) => y.id !== t.id))}>
              <X className="size-3.5" />
            </button>
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}

export function useUI() {
  const ctx = useContext(UIContext);
  if (!ctx) throw new Error('useUI outside UIProvider');
  return ctx;
}
