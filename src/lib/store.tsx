import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DEFAULT_SETTINGS, type LeadWithProject, type ProjectWithLead, type Settings } from '../../shared/types';
import { nowInTz } from '../../shared/dates';
import { api, type ReminderRow } from './api';

interface DataState {
  leads: LeadWithProject[];
  projects: ProjectWithLead[];
  reminders: ReminderRow[];
  settings: Settings;
  loaded: boolean;
  /** The server has a password and this browser isn't logged in. */
  needsLogin: boolean;
  authRequired: boolean;
  login: (password: string) => Promise<void>;
  logout: () => Promise<void>;
  error: string | null;
  /** Local "YYYY-MM-DD" in the configured time zone (ticks over at midnight). */
  today: string;
  now: string;
  refresh: () => Promise<void>;
  setSettings: (patch: Partial<Settings>) => Promise<void>;
  /** Optimistically patch a lead in the list (e.g. kanban drag). */
  patchLeadLocal: (id: number, patch: Partial<LeadWithProject>) => void;
}

const DataContext = createContext<DataState | null>(null);

export function applyTheme(theme: Settings['theme']) {
  const dark = theme === 'dark' || (theme === 'system' && matchMedia('(prefers-color-scheme: dark)').matches);
  document.documentElement.classList.toggle('dark', dark);
  try {
    localStorage.setItem('theme', theme);
  } catch {
    /* storage unavailable */
  }
}

export function DataProvider({ children }: { children: ReactNode }) {
  const [leads, setLeads] = useState<LeadWithProject[]>([]);
  const [projects, setProjects] = useState<ProjectWithLead[]>([]);
  const [reminders, setReminders] = useState<ReminderRow[]>([]);
  const [settings, setSettingsState] = useState<Settings>(DEFAULT_SETTINGS);
  const [loaded, setLoaded] = useState(false);
  const [needsLogin, setNeedsLogin] = useState(false);
  const [authRequired, setAuthRequired] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => nowInTz(settings.timeZone));

  const refresh = useCallback(async () => {
    try {
      const [l, p, r] = await Promise.all([api.leads(), api.projects(), api.reminders()]);
      setLeads(l);
      setProjects(p);
      setReminders(r);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const boot = useCallback(async () => {
    try {
      const session = await api.session();
      setAuthRequired(session.authRequired);
      if (session.authRequired && !session.authenticated) {
        setNeedsLogin(true);
        setLoaded(true);
        return;
      }
      setNeedsLogin(false);
      let s = await api.settings();
      // Fresh server (e.g. Vercel runs in UTC): adopt this browser's time zone once.
      if (!s.timeZoneStored) s = await api.saveSettings({ timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone });
      setSettingsState(s);
      applyTheme(s.theme);
      setNow(nowInTz(s.timeZone));
      await refresh();
    } catch (e) {
      setError((e as Error).message);
    }
    setLoaded(true);
  }, [refresh]);

  useEffect(() => {
    boot();
  }, [boot]);

  useEffect(() => {
    const onUnauthorized = () => setNeedsLogin(true);
    window.addEventListener('callbook:unauthorized', onUnauthorized);
    return () => window.removeEventListener('callbook:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(
    async (password: string) => {
      await api.login(password);
      await boot();
    },
    [boot],
  );

  const logout = useCallback(async () => {
    await api.logout();
    setLeads([]);
    setProjects([]);
    setReminders([]);
    setNeedsLogin(true);
  }, []);

  // Keep "now" fresh and refetch when the tab regains focus.
  useEffect(() => {
    const tick = setInterval(() => setNow(nowInTz(settings.timeZone)), 30_000);
    const onFocus = () => {
      setNow(nowInTz(settings.timeZone));
      refresh();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(tick);
      window.removeEventListener('focus', onFocus);
    };
  }, [settings.timeZone, refresh]);

  useEffect(() => {
    if (settings.theme !== 'system') return;
    const mq = matchMedia('(prefers-color-scheme: dark)');
    const on = () => applyTheme('system');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, [settings.theme]);

  const setSettings = useCallback(async (patch: Partial<Settings>) => {
    const s = await api.saveSettings(patch);
    setSettingsState(s);
    applyTheme(s.theme);
    setNow(nowInTz(s.timeZone));
  }, []);

  const patchLeadLocal = useCallback((id: number, patch: Partial<LeadWithProject>) => {
    setLeads((ls) => ls.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const value = useMemo<DataState>(
    () => ({
      leads,
      projects,
      reminders,
      settings,
      loaded,
      needsLogin,
      authRequired,
      login,
      logout,
      error,
      today: now.slice(0, 10),
      now,
      refresh,
      setSettings,
      patchLeadLocal,
    }),
    [leads, projects, reminders, settings, loaded, needsLogin, authRequired, login, logout, error, now, refresh, setSettings, patchLeadLocal],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData outside DataProvider');
  return ctx;
}
