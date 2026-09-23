import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import {
  BarChart3,
  BellRing,
  FolderKanban,
  Keyboard,
  LayoutDashboard,
  Menu,
  Moon,
  PhoneCall,
  Plus,
  Search,
  Settings as SettingsIcon,
  Sun,
  Users,
  X,
} from 'lucide-react';
import { useData } from '../lib/store';
import { dashboardStats, deadlineAlerts, searchLeads } from '../lib/derive';
import { cx, isTypingTarget } from '../lib/ui';
import { formatPhone } from '../../shared/format';
import { DemoTag, Modal, StatusBadge } from './primitives';
import { useUI } from './UIProvider';
import { useBrowserNotifications } from '../lib/notifications';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, key: 'd' },
  { to: '/leads', label: 'Leads', icon: Users, key: 'l' },
  { to: '/call', label: 'Call Mode', icon: PhoneCall, key: 'c' },
  { to: '/follow-ups', label: 'Follow-ups', icon: BellRing, key: 'f' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, key: 'p' },
  { to: '/analytics', label: 'Analytics', icon: BarChart3, key: 'a' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, key: 's' },
] as const;

function Badge({ n, tone }: { n: number; tone: 'red' | 'amber' | 'blue' }) {
  if (!n) return null;
  const cls = { red: 'bg-rose-500 text-white', amber: 'bg-amber-400 text-amber-950', blue: 'bg-accent/15 text-accent' }[tone];
  return <span className={cx('ml-auto min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5', cls)}>{n}</span>;
}

export function Layout() {
  const { leads, reminders, projects, settings, today, setSettings, error } = useData();
  const { openAddLead } = useUI();
  const navigate = useNavigate();
  const [mobileNav, setMobileNav] = useState(false);
  const [help, setHelp] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  useBrowserNotifications();

  const stats = dashboardStats(leads, reminders, today, settings.upcomingWindowDays);
  const deadlines = deadlineAlerts(projects, today).length;
  const n = settings.notifications;
  const badges: Record<string, React.ReactNode> = {
    '/follow-ups': (
      <span className="ml-auto flex gap-1">
        {n.overdue && <Badge n={stats.overdue} tone="red" />}
        {n.today && <Badge n={stats.dueToday} tone="amber" />}
        {n.upcoming && <Badge n={stats.upcoming} tone="blue" />}
      </span>
    ),
    '/call': n.today ? <Badge n={stats.callToday} tone="amber" /> : null,
    '/projects': n.deadlines ? <Badge n={deadlines} tone="red" /> : null,
  };

  // Global keyboard shortcuts: N new lead, / search, G+key to navigate, ? help.
  useEffect(() => {
    let g = false;
    let gTimer: ReturnType<typeof setTimeout>;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (isTypingTarget(e.target) || e.metaKey || e.ctrlKey || e.altKey || document.querySelector('[role=dialog]')) return;
      if (g) {
        g = false;
        const item = NAV.find((x) => x.key === e.key.toLowerCase());
        if (item) {
          e.preventDefault();
          navigate(item.to);
        }
        return;
      }
      if (e.key === 'g') {
        g = true;
        clearTimeout(gTimer);
        gTimer = setTimeout(() => (g = false), 1200);
      } else if (e.key === 'n') {
        e.preventDefault();
        openAddLead();
      } else if (e.key === '/') {
        e.preventDefault();
        searchRef.current?.focus();
      } else if (e.key === '?') setHelp(true);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate, openAddLead]);

  const isDark = document.documentElement.classList.contains('dark');

  const sidebar = (
    <nav className="flex h-full flex-col gap-1 p-3">
      <div className="mb-3 flex items-center gap-2 px-2 pt-1">
        <div className="grid size-8 place-items-center rounded-lg bg-accent text-white">
          <PhoneCall className="size-4" />
        </div>
        <div>
          <div className="text-sm font-semibold leading-tight">Callbook</div>
          <div className="text-[11px] text-muted leading-tight">Cold-call CRM</div>
        </div>
      </div>
      <button className="btn btn-primary mb-2 w-full" onClick={() => { setMobileNav(false); openAddLead(); }}>
        <Plus className="size-4" /> Add lead <span className="kbd ml-auto !border-white/30 !bg-white/15 !text-white">N</span>
      </button>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          end={to === '/'}
          onClick={() => setMobileNav(false)}
          className={({ isActive }) =>
            cx(
              'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium transition-colors',
              isActive ? 'bg-surface-2 text-fg' : 'text-muted hover:bg-surface-2/60 hover:text-fg',
            )
          }
        >
          <Icon className="size-4" />
          {label}
          {badges[to]}
        </NavLink>
      ))}
      <div className="mt-auto flex items-center gap-1 border-t border-border pt-3">
        <button
          className="btn btn-ghost btn-sm"
          title="Toggle dark mode"
          onClick={() => setSettings({ theme: isDark ? 'light' : 'dark' })}
        >
          {isDark ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
        <button className="btn btn-ghost btn-sm" title="Keyboard shortcuts (?)" onClick={() => setHelp(true)}>
          <Keyboard className="size-4" />
        </button>
        <span className="ml-auto text-[11px] text-muted">{settings.timeZone}</span>
      </div>
    </nav>
  );

  return (
    <div className="min-h-dvh lg:pl-60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-60 border-r border-border bg-surface lg:block">{sidebar}</aside>
      {mobileNav && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMobileNav(false)} />
          <aside className="absolute inset-y-0 left-0 w-64 border-r border-border bg-surface">{sidebar}</aside>
        </div>
      )}
      <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-border bg-bg/85 px-4 backdrop-blur lg:px-6">
        <button className="btn btn-ghost !px-2 lg:hidden" onClick={() => setMobileNav(true)} aria-label="Menu">
          <Menu className="size-5" />
          {stats.overdue > 0 && <span className="absolute ml-5 -mt-5 size-2 rounded-full bg-rose-500" />}
        </button>
        <GlobalSearch inputRef={searchRef} />
        <NavLink to="/call" className="btn btn-secondary hidden sm:inline-flex">
          <PhoneCall className="size-4" /> Call Mode
        </NavLink>
        <button className="btn btn-primary !px-2.5 lg:hidden" onClick={openAddLead} aria-label="Add lead">
          <Plus className="size-4" />
        </button>
      </header>
      {error && (
        <div className="mx-4 mt-4 rounded-lg border border-rose-500/40 bg-rose-500/10 px-4 py-2 text-sm text-rose-700 lg:mx-6 dark:text-rose-300">
          Can’t reach the server: {error}
        </div>
      )}
      <main className="mx-auto max-w-[1400px] px-4 py-5 lg:px-6 lg:py-6">
        <Outlet />
      </main>

      <Modal open={help} onClose={() => setHelp(false)} title="Keyboard shortcuts" size="sm">
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
          {[
            ['N', 'Add lead'],
            ['/ or ⌘K', 'Search'],
            ['G then D/L/C/F/P/A/S', 'Go to page'],
            ['⌘ Enter', 'Save form'],
            ['?', 'This help'],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt><span className="kbd">{k}</span></dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
          <div className="col-span-2 mt-2 text-xs font-semibold uppercase tracking-wide text-muted">Call Mode</div>
          {[
            ['C', 'Call (dial)'],
            ['D', 'Called ✓'],
            ['X', 'No answer'],
            ['I', 'Interested'],
            ['R', 'Not interested'],
            ['L', 'Follow up later'],
            ['A', 'Add note'],
            ['→ / ←', 'Next / previous lead'],
          ].map(([k, v]) => (
            <div key={k} className="contents">
              <dt><span className="kbd">{k}</span></dt>
              <dd className="text-muted">{v}</dd>
            </div>
          ))}
        </dl>
      </Modal>
    </div>
  );
}

function GlobalSearch({ inputRef }: { inputRef: React.RefObject<HTMLInputElement | null> }) {
  const { leads, settings } = useData();
  const navigate = useNavigate();
  const [q, setQ] = useState('');
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState(0);
  const results = useMemo(() => searchLeads(leads, q), [leads, q]);

  const go = (id: number) => {
    navigate(`/leads/${id}`);
    setQ('');
    setOpen(false);
    inputRef.current?.blur();
  };

  return (
    <div className="relative max-w-xl flex-1">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted" />
      <input
        ref={inputRef}
        className="input !h-9 !pl-9 !pr-16"
        placeholder="Search name, phone, email, notes…"
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setOpen(true);
          setSel(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setSel((s) => Math.min(s + 1, results.length - 1));
          else if (e.key === 'ArrowUp') setSel((s) => Math.max(s - 1, 0));
          else if (e.key === 'Enter' && results[sel]) go(results[sel].id);
          else if (e.key === 'Enter' && q.trim()) {
            navigate(`/leads?q=${encodeURIComponent(q.trim())}`);
            setOpen(false);
          } else if (e.key === 'Escape') {
            setQ('');
            inputRef.current?.blur();
          }
        }}
      />
      {q ? (
        <button className="absolute right-2 top-1/2 -translate-y-1/2 text-muted hover:text-fg" onClick={() => setQ('')}>
          <X className="size-4" />
        </button>
      ) : (
        <span className="kbd pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 sm:inline-flex">/</span>
      )}
      {open && q.trim() && (
        <div className="absolute inset-x-0 top-11 z-50 overflow-hidden rounded-xl border border-border bg-surface shadow-xl">
          {results.length === 0 ? (
            <div className="px-4 py-3 text-sm text-muted">No leads match “{q}”.</div>
          ) : (
            results.map((l, i) => (
              <button
                key={l.id}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => go(l.id)}
                onMouseEnter={() => setSel(i)}
                className={cx('flex w-full items-center gap-3 px-4 py-2.5 text-left', i === sel && 'bg-surface-2')}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5 truncate text-sm font-medium">
                    {l.business_name} {l.is_demo && <DemoTag />}
                  </div>
                  <div className="truncate text-xs text-muted">
                    {[l.contact_name, formatPhone(l.phone, settings.phoneCountry), l.location].filter(Boolean).join(' · ')}
                  </div>
                </div>
                <StatusBadge status={l.status} />
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}
