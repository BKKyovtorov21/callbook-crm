import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Check, Copy, ExternalLink, Phone, X } from 'lucide-react';
import type { LeadStatus, ProjectStatus } from '../../shared/types';
import { formatPhone, normalizeUrl, telHref } from '../../shared/format';
import { useData } from '../lib/store';
import { cx, PROJECT_STYLES, STATUS_STYLES } from '../lib/ui';

export function StatusBadge({ status, className }: { status: LeadStatus; className?: string }) {
  const s = STATUS_STYLES[status];
  return (
    <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', s.badge, className)}>
      <span className={cx('size-1.5 rounded-full', s.dot)} />
      {status}
    </span>
  );
}

export function ProjectBadge({ status }: { status: ProjectStatus }) {
  return (
    <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', PROJECT_STYLES[status])}>
      {status}
    </span>
  );
}

export function DemoTag() {
  return (
    <span className="rounded bg-amber-400/15 px-1 py-px text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-300">
      Demo
    </span>
  );
}

export function PhoneLink({ phone, className, big }: { phone: string; className?: string; big?: boolean }) {
  const { settings } = useData();
  if (!phone) return <span className="text-muted">—</span>;
  return (
    <a
      href={telHref(phone, settings.phoneCountry)}
      onClick={(e) => e.stopPropagation()}
      className={cx('inline-flex items-center gap-1.5 font-medium tabular-nums hover:text-accent whitespace-nowrap', big && 'text-lg', className)}
    >
      <Phone className={big ? 'size-4' : 'size-3.5'} />
      {formatPhone(phone, settings.phoneCountry)}
    </a>
  );
}

export function CopyButton({ text, className }: { text: string; className?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      title="Copy link"
      className={cx('btn btn-ghost btn-sm !px-1.5', className)}
      onClick={async (e) => {
        e.stopPropagation();
        try {
          await navigator.clipboard.writeText(text);
          setCopied(true);
          setTimeout(() => setCopied(false), 1200);
        } catch {
          /* clipboard blocked */
        }
      }}
    >
      {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
    </button>
  );
}

/** Labelled external link with "open" and "copy" affordances. */
export function UrlRow({ label, url, action }: { label: string; url: string; action: string }) {
  const href = normalizeUrl(url);
  return (
    <div className="flex items-center justify-between gap-2 py-1.5">
      <div className="min-w-0">
        <div className="text-xs text-muted">{label}</div>
        {href ? (
          <div className="truncate text-sm">{href.replace(/^https?:\/\//, '')}</div>
        ) : (
          <div className="text-sm text-muted/70">Not set</div>
        )}
      </div>
      {href && (
        <div className="flex shrink-0 items-center gap-1">
          <a href={href} target="_blank" rel="noreferrer" className="btn btn-secondary btn-sm">
            <ExternalLink className="size-3.5" /> {action}
          </a>
          <CopyButton text={href} />
        </div>
      )}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Keep the latest onClose without re-running the focus effect on every render.
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', onKey);
    const prev = document.activeElement as HTMLElement | null;
    // Focus first field for fast entry.
    setTimeout(() => {
      const p = panel.current;
      if (!p || p.contains(document.activeElement)) return; // an autoFocus field already has it
      (p.querySelector<HTMLElement>('input, textarea, select') ?? p.querySelector<HTMLElement>('[data-modal-body] button'))?.focus();
    }, 0);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [open]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-start sm:pt-[8vh]">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={onClose} />
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        className={cx(
          'relative flex max-h-[92vh] w-full flex-col rounded-t-2xl border border-border bg-surface shadow-2xl sm:rounded-2xl',
          size === 'sm' ? 'sm:max-w-md' : size === 'md' ? 'sm:max-w-xl' : 'sm:max-w-3xl',
        )}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-3.5">
          <h2 className="text-base font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm !px-1.5" onClick={onClose} aria-label="Close">
            <X className="size-4" />
          </button>
        </div>
        <div data-modal-body className="overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="flex flex-wrap items-center justify-end gap-2 border-t border-border px-5 py-3">{footer}</div>}
      </div>
    </div>
  );
}

export function EmptyState({ icon, title, children }: { icon?: ReactNode; title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-10 text-center">
      {icon && <div className="text-muted">{icon}</div>}
      <div className="text-sm font-medium">{title}</div>
      {children && <div className="text-sm text-muted">{children}</div>}
    </div>
  );
}

export function SectionCard({
  title,
  icon,
  action,
  children,
  className,
}: {
  title: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={cx('card', className)}>
      <header className="flex items-center justify-between gap-2 border-b border-border px-4 py-3">
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          {icon}
          {title}
        </h3>
        {action}
      </header>
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Field({ label, error, children, className }: { label: string; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="label">{label}</span>
      {children}
      {error && <span className="mt-1 block text-xs text-rose-600 dark:text-rose-400">{error}</span>}
    </label>
  );
}

export function InfoRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <span className="shrink-0 text-muted">{label}</span>
      <span className="min-w-0 truncate text-right">{children}</span>
    </div>
  );
}
