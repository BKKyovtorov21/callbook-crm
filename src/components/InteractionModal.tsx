import { useState } from 'react';
import { INTERACTION_RESULTS, INTERACTION_TYPES, LEAD_STATUSES, type Interaction, type InteractionType, type Lead, type LeadStatus } from '../../shared/types';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { cx } from '../lib/ui';
import { Field, Modal } from './primitives';
import { FollowUpPicker, useResolveFollowUp, type FollowUpChoice } from './FollowUpPicker';

/** Log (or edit) a call / email / SMS / meeting. New entries reschedule the follow-up from their date. */
export function InteractionModal({
  lead,
  interaction,
  onClose,
  onSaved,
}: {
  lead: Pick<Lead, 'id' | 'business_name'>;
  interaction?: Interaction;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const { now, settings, refresh } = useData();
  const resolve = useResolveFollowUp();
  const [type, setType] = useState<InteractionType>(interaction?.type ?? 'Phone Call');
  const [date, setDate] = useState(interaction?.date ?? now);
  const [result, setResult] = useState(interaction?.result ?? 'Spoke');
  const [notes, setNotes] = useState(interaction?.notes ?? '');
  const [status, setStatus] = useState<LeadStatus | ''>('');
  const [followUp, setFollowUp] = useState<FollowUpChoice>({ kind: 'days', days: settings.defaultFollowUpDays });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async () => {
    if (!date) return setError('Pick a date');
    setBusy(true);
    try {
      if (interaction) {
        await api.updateInteraction(interaction.id, { type, date, result, notes });
      } else {
        const fu = resolve(followUp, date.slice(0, 10));
        await api.addInteraction(lead.id, {
          type,
          date,
          result,
          notes,
          ...(status ? { status } : {}),
          followUpDate: fu,
          skipFollowUp: !fu,
        });
      }
      await refresh();
      onSaved?.();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`${interaction ? 'Edit' : 'Add'} interaction · ${lead.business_name}`}
      footer={
        <>
          {error && <span className="mr-auto text-sm text-rose-600">{error}</span>}
          <button className="btn btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button className="btn btn-primary" disabled={busy} onClick={save}>
            Save
          </button>
        </>
      }
    >
      <div
        className="space-y-4"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) save();
        }}
      >
        <div>
          <span className="label">Type</span>
          <div className="flex flex-wrap gap-1.5">
            {INTERACTION_TYPES.map((t) => (
              <button key={t} type="button" className={cx('chip', type === t && 'chip-active')} onClick={() => setType(t)}>
                {t}
              </button>
            ))}
          </div>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Date & time">
            <input className="input" type="datetime-local" value={date} max={now} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Result">
            <select className="input" value={result} onChange={(e) => setResult(e.target.value)}>
              {INTERACTION_RESULTS.map((r) => (
                <option key={r}>{r}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea className="input" rows={4} autoFocus value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Spoke with owner. Interested in a new website…" />
        </Field>
        {!interaction && (
          <>
            <Field label="Change status (optional)">
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value as LeadStatus | '')}>
                <option value="">Keep current status</option>
                {LEAD_STATUSES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            </Field>
            <div>
              <span className="label">Next follow-up (counted from this interaction)</span>
              <FollowUpPicker value={followUp} onChange={setFollowUp} from={date.slice(0, 10)} />
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
