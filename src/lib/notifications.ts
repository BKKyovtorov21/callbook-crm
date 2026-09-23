// Browser notifications: at most one per category per day, only when enabled,
// and (optionally) only during working hours on working days.
import { useEffect } from 'react';
import { weekday } from '../../shared/dates';
import { dashboardStats, deadlineAlerts } from './derive';
import { useData } from './store';

export const notificationsSupported = () => typeof window !== 'undefined' && 'Notification' in window;

function alreadySent(key: string): boolean {
  try {
    if (localStorage.getItem(key)) return true;
    localStorage.setItem(key, '1');
  } catch {
    /* storage unavailable: fall through and notify */
  }
  return false;
}

export function useBrowserNotifications() {
  const { leads, reminders, projects, settings, now, today, loaded } = useData();

  useEffect(() => {
    const n = settings.notifications;
    if (!loaded || !n.browser || !notificationsSupported() || Notification.permission !== 'granted') return;
    if (n.onlyWorkingHours) {
      const time = now.slice(11, 16);
      if (!settings.workingDays.includes(weekday(today)) || time < settings.workStart || time > settings.workEnd) return;
    }
    const s = dashboardStats(leads, reminders, today, settings.upcomingWindowDays);
    const deadlines = deadlineAlerts(projects, today).length;
    const items: [boolean, number, string, string][] = [
      [n.overdue, s.overdue, 'overdue', `${s.overdue} overdue follow-up${s.overdue === 1 ? '' : 's'}`],
      [n.today, s.dueToday, 'today', `${s.dueToday} call${s.dueToday === 1 ? '' : 's'} due today`],
      [n.upcoming, s.upcoming, 'upcoming', `${s.upcoming} follow-up${s.upcoming === 1 ? '' : 's'} coming up`],
      [n.deadlines, deadlines, 'deadlines', `${deadlines} project deadline${deadlines === 1 ? '' : 's'} within 3 days`],
    ];
    for (const [enabled, count, key, text] of items) {
      if (!enabled || !count || alreadySent(`notified:${key}:${today}`)) continue;
      const note = new Notification('Callbook', { body: text, tag: `callbook-${key}`, icon: '/favicon.svg' });
      note.onclick = () => {
        window.focus();
        window.location.assign(key === 'deadlines' ? '/projects' : '/follow-ups');
      };
    }
  }, [leads, reminders, projects, settings, now, today, loaded]);
}
