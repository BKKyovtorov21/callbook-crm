import { useState } from 'react';
import { Bell, Clock, Database, Download, Palette, PhoneCall } from 'lucide-react';
import type { Settings } from '../../shared/types';
import { api } from '../lib/api';
import { useData } from '../lib/store';
import { notificationsSupported } from '../lib/notifications';
import { cx } from '../lib/ui';
import { Field, SectionCard } from '../components/primitives';
import { useUI } from '../components/UIProvider';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const CURRENCIES = ['USD', 'EUR', 'GBP', 'BGN', 'CAD', 'AUD', 'CHF', 'PLN', 'RON', 'SEK', 'NOK', 'DKK', 'CZK', 'HUF', 'TRY', 'INR', 'JPY'];
const COUNTRIES = ['US', 'CA', 'GB', 'IE', 'AU', 'NZ', 'BG', 'DE', 'FR', 'ES', 'IT', 'NL', 'BE', 'AT', 'CH', 'PL', 'RO', 'GR', 'PT', 'SE', 'NO', 'DK', 'FI', 'CZ', 'HU', 'TR', 'IN'];
const timeZones = (() => {
  try {
    return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

function Toggle({ checked, onChange, label, hint }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span>
        <span className="block text-sm font-medium">{label}</span>
        {hint && <span className="block text-xs text-muted">{hint}</span>}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        className={cx('relative h-5 w-9 shrink-0 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-border')}
      >
        <span className={cx('absolute top-0.5 size-4 rounded-full bg-white shadow transition-all', checked ? 'left-4.5' : 'left-0.5')} />
      </button>
    </label>
  );
}

export function SettingsPage() {
  const { settings, setSettings, refresh, authRequired, logout } = useData();
  const { toast, confirm } = useUI();
  const [permission, setPermission] = useState(notificationsSupported() ? Notification.permission : 'unsupported');

  const save = async (patch: Partial<Settings>) => {
    try {
      await setSettings(patch);
      toast('Settings saved');
    } catch (e) {
      toast((e as Error).message, { tone: 'error' });
    }
  };
  const notify = (patch: Partial<Settings['notifications']>) => save({ notifications: { ...settings.notifications, ...patch } });

  const enableBrowser = async (on: boolean) => {
    if (on && notificationsSupported() && Notification.permission !== 'granted') {
      const p = await Notification.requestPermission();
      setPermission(p);
      if (p !== 'granted') return toast('Notifications were blocked by the browser', { tone: 'error' });
    }
    notify({ browser: on });
  };

  const exportData = async () => {
    const data = await api.exportAll();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `callbook-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted">Changes save automatically.</p>
      </div>

      <SectionCard title="Follow-ups" icon={<PhoneCall className="size-4 text-muted" />}>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Default follow-up period">
            <select className="input" value={settings.defaultFollowUpDays} onChange={(e) => save({ defaultFollowUpDays: Number(e.target.value) })}>
              {[1, 2, 3, 5, 7, 10, 14, 21, 30].map((d) => (
                <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}{d === 7 ? ' (default)' : ''}</option>
              ))}
            </select>
          </Field>
          <Field label="After “No answer”, retry in">
            <select className="input" value={settings.noAnswerRetryDays} onChange={(e) => save({ noAnswerRetryDays: Number(e.target.value) })}>
              {[0, 1, 2, 3, 7].map((d) => (
                <option key={d} value={d}>{d === 0 ? 'Same day' : `${d} day${d > 1 ? 's' : ''}`}</option>
              ))}
            </select>
          </Field>
          <Field label="“Upcoming” window">
            <select className="input" value={settings.upcomingWindowDays} onChange={(e) => save({ upcomingWindowDays: Number(e.target.value) })}>
              {[3, 5, 7, 14, 30].map((d) => <option key={d} value={d}>Next {d} days</option>)}
            </select>
          </Field>
        </div>
        <Toggle
          checked={settings.skipNonWorkingDays}
          onChange={(v) => save({ skipNonWorkingDays: v })}
          label="Skip non-working days"
          hint="If a follow-up lands on a day off, move it to the next working day."
        />
      </SectionCard>

      <SectionCard title="Working schedule & region" icon={<Clock className="size-4 text-muted" />}>
        <div className="space-y-4">
          <div>
            <span className="label">Working days</span>
            <div className="flex flex-wrap gap-1.5">
              {DAYS.map((d, i) => {
                const on = settings.workingDays.includes(i);
                return (
                  <button
                    key={d}
                    className={cx('chip', on && 'chip-active')}
                    onClick={() => save({ workingDays: on ? settings.workingDays.filter((x) => x !== i) : [...settings.workingDays, i].sort() })}
                  >
                    {d}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Work starts">
              <input className="input" type="time" value={settings.workStart} onChange={(e) => e.target.value && save({ workStart: e.target.value })} />
            </Field>
            <Field label="Work ends">
              <input className="input" type="time" value={settings.workEnd} onChange={(e) => e.target.value && save({ workEnd: e.target.value })} />
            </Field>
            <Field label="Time zone">
              <select className="input" value={settings.timeZone} onChange={(e) => save({ timeZone: e.target.value })}>
                {timeZones.map((tz) => <option key={tz}>{tz}</option>)}
              </select>
              <button className="mt-1 text-xs text-accent hover:underline" onClick={() => save({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone })}>
                Use this device’s time zone
              </button>
            </Field>
            <Field label="Currency">
              <select className="input" value={settings.currency} onChange={(e) => save({ currency: e.target.value })}>
                {CURRENCIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="Phone number country (for formatting)">
              <select className="input" value={settings.phoneCountry} onChange={(e) => save({ phoneCountry: e.target.value })}>
                {COUNTRIES.map((c) => <option key={c}>{c}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </SectionCard>

      <SectionCard title="Notifications" icon={<Bell className="size-4 text-muted" />}>
        <p className="mb-2 text-xs text-muted">Choose which badges show in the sidebar. Browser notifications are sent at most once per day per type.</p>
        <Toggle checked={settings.notifications.overdue} onChange={(v) => notify({ overdue: v })} label="Overdue follow-ups" />
        <Toggle checked={settings.notifications.today} onChange={(v) => notify({ today: v })} label="Calls due today" />
        <Toggle checked={settings.notifications.upcoming} onChange={(v) => notify({ upcoming: v })} label="Upcoming follow-ups" />
        <Toggle checked={settings.notifications.deadlines} onChange={(v) => notify({ deadlines: v })} label="Project deadlines (within 3 days)" />
        <div className="my-2 border-t border-border" />
        <Toggle
          checked={settings.notifications.browser && permission === 'granted'}
          onChange={enableBrowser}
          label="Browser notifications"
          hint={permission === 'unsupported' ? 'Not supported in this browser.' : permission === 'denied' ? 'Blocked — allow notifications for this site in your browser settings.' : 'Get a desktop notification when something is due.'}
        />
        <Toggle checked={settings.notifications.onlyWorkingHours} onChange={(v) => notify({ onlyWorkingHours: v })} label="Only during working hours" />
      </SectionCard>

      <SectionCard title="Appearance" icon={<Palette className="size-4 text-muted" />}>
        <div className="flex gap-1.5">
          {(['system', 'light', 'dark'] as const).map((t) => (
            <button key={t} className={cx('chip capitalize', settings.theme === t && 'chip-active')} onClick={() => save({ theme: t })}>
              {t}
            </button>
          ))}
        </div>
      </SectionCard>

      <SectionCard title="Data" icon={<Database className="size-4 text-muted" />}>
        <div className="flex flex-wrap gap-2">
          <button className="btn btn-secondary" onClick={exportData}>
            <Download className="size-4" /> Export backup (JSON)
          </button>
          <button
            className="btn btn-secondary"
            onClick={async () => {
              await api.loadDemo();
              await refresh();
              toast('Demo data loaded');
            }}
          >
            Load demo data
          </button>
          <button
            className="btn btn-ghost !text-rose-600"
            onClick={async () => {
              if (!(await confirm({ title: 'Remove demo data?', body: 'Deletes every lead marked DEMO with its interactions and projects. Your own leads are not touched.', confirmLabel: 'Remove demo data', danger: true }))) return;
              const { deleted } = await api.deleteDemo();
              await refresh();
              toast(`Removed ${deleted} demo lead${deleted === 1 ? '' : 's'}`);
            }}
          >
            Remove demo data
          </button>
          {authRequired && (
            <button className="btn btn-secondary ml-auto" onClick={logout}>
              Log out
            </button>
          )}
        </div>
      </SectionCard>
    </div>
  );
}
