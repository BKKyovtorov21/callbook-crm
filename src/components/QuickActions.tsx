import { CalendarClock, Check, PhoneMissed, ThumbsDown, ThumbsUp, Trophy } from 'lucide-react';
import type { Lead, QuickAction } from '../../shared/types';
import { cx } from '../lib/ui';
import { useUI } from './UIProvider';

const ACTIONS: { action: QuickAction; label: string; icon: typeof Check; cls: string; title: string }[] = [
  { action: 'called', label: 'Called', icon: Check, cls: 'btn-primary', title: 'Log a call today and schedule the default follow-up' },
  { action: 'no_answer', label: 'No answer', icon: PhoneMissed, cls: 'btn-secondary', title: 'Log an unsuccessful call and retry soon' },
  { action: 'interested', label: 'Interested', icon: ThumbsUp, cls: 'btn-secondary', title: 'Mark as interested' },
  { action: 'follow_up_later', label: 'Follow up later', icon: CalendarClock, cls: 'btn-secondary', title: 'Not now — pick a date' },
  { action: 'not_interested', label: 'Not interested', icon: ThumbsDown, cls: 'btn-secondary', title: 'They declined' },
  { action: 'won', label: 'Won', icon: Trophy, cls: 'btn-success', title: 'Deal won — creates a website project' },
];

export function QuickActions({ lead, size = 'md', only }: { lead: Pick<Lead, 'id' | 'business_name' | 'status'>; size?: 'sm' | 'md'; only?: QuickAction[] }) {
  const { runAction } = useUI();
  return (
    <div className="flex flex-wrap gap-1.5">
      {ACTIONS.filter((a) => !only || only.includes(a.action))
        .filter((a) => !(a.action === 'won' && lead.status === 'Won'))
        .map(({ action, label, icon: Icon, cls, title }) => (
          <button
            key={action}
            title={title}
            className={cx('btn', cls, size === 'sm' && 'btn-sm')}
            onClick={(e) => {
              e.stopPropagation();
              runAction(lead, action);
            }}
          >
            <Icon className={size === 'sm' ? 'size-3.5' : 'size-4'} />
            {label}
          </button>
        ))}
    </div>
  );
}
