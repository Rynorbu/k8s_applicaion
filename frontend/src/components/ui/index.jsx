import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, ChevronLeft, ChevronRight, Inbox, Loader2, OctagonAlert, X } from 'lucide-react';
import { useEffect, useId, useRef } from 'react';

export function Spinner({ className }) {
  return <Loader2 className={clsx('h-5 w-5 animate-spin text-brand-600', className)} aria-label="Loading" />;
}

export function PageLoader() {
  return (
    <div className="flex h-64 items-center justify-center">
      <Spinner className="h-8 w-8" />
    </div>
  );
}

export function Card({ className, children, title, action, subtitle }) {
  return (
    <section className={clsx('card', className)}>
      {(title || action) && (
        <header className="mb-4 flex items-start justify-between gap-3">
          <div>
            {title && <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-sm text-slate-500 dark:text-slate-400">{subtitle}</p>}
          </div>
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function PageHeader({ title, description, actions }) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{title}</h1>
        {description && <p className="mt-1 text-sm text-slate-500 dark:text-slate-400">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Field({ label, error, hint, children, htmlFor }) {
  return (
    <div>
      {label && (
        <label className="label" htmlFor={htmlFor}>
          {label}
        </label>
      )}
      {children}
      {hint && !error && <p className="mt-1 text-xs text-slate-500">{hint}</p>}
      {error && <p className="mt-1 text-xs text-red-600">{error}</p>}
    </div>
  );
}

export function Input({ label, error, hint, className, ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} hint={hint} htmlFor={id}>
      <input id={id} className={clsx('input', className)} {...props} />
    </Field>
  );
}

export function Select({ label, error, options, className, placeholder, ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} htmlFor={id}>
      <select id={id} className={clsx('input', className)} {...props}>
        {placeholder !== undefined && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

export function Textarea({ label, error, className, ...props }) {
  const id = useId();
  return (
    <Field label={label} error={error} htmlFor={id}>
      <textarea id={id} className={clsx('input min-h-[80px]', className)} {...props} />
    </Field>
  );
}

const BADGE = {
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  green: 'bg-green-100 text-green-800 dark:bg-green-900/40 dark:text-green-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-900/40 dark:text-red-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-900/40 dark:text-amber-300',
  blue: 'bg-brand-100 text-brand-700 dark:bg-brand-500/20 dark:text-brand-100',
};

export function Badge({ color = 'gray', children, className }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', BADGE[color], className)}>{children}</span>;
}

export function CategoryBadge({ category }) {
  if (!category) return <Badge>Uncategorized</Badge>;
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-700 dark:bg-slate-800 dark:text-slate-300">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: category.color ?? '#94a3b8' }} aria-hidden />
      {category.name}
    </span>
  );
}

/** Status meter: color is never the only signal - every state also has an icon and a label. */
const STATUS = {
  on_track: { color: 'var(--status-good)', label: 'On track', Icon: CheckCircle2, text: 'text-green-700 dark:text-green-400' },
  warning: { color: 'var(--status-warning)', label: 'Warning', Icon: AlertTriangle, text: 'text-amber-700 dark:text-amber-400' },
  exceeded: { color: 'var(--status-critical)', label: 'Exceeded', Icon: OctagonAlert, text: 'text-red-700 dark:text-red-400' },
};

export function StatusLabel({ status }) {
  const s = STATUS[status] ?? STATUS.on_track;
  return (
    <span className={clsx('inline-flex items-center gap-1 text-xs font-semibold', s.text)}>
      <s.Icon className="h-3.5 w-3.5" aria-hidden />
      {s.label}
    </span>
  );
}

export function ProgressBar({ value, status = 'on_track', color, label }) {
  const pct = Math.max(0, Math.min(100, value ?? 0));
  return (
    <div
      className="h-2 w-full overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"
      role="progressbar"
      aria-valuenow={Math.round(value ?? 0)}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-label={label}
    >
      <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: color ?? STATUS[status]?.color }} />
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-300 px-6 py-12 text-center dark:border-slate-700">
      <Icon className="h-10 w-10 text-slate-400" aria-hidden />
      <h3 className="mt-3 font-semibold text-slate-900 dark:text-slate-100">{title}</h3>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({ message, onRetry }) {
  return (
    <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      <p>{message ?? 'Failed to load data.'}</p>
      {onRetry && (
        <button className="mt-2 font-semibold underline" onClick={onRetry}>
          Try again
        </button>
      )}
    </div>
  );
}

export function Modal({ open, onClose, title, children, size = 'md' }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', onKey);
    ref.current?.querySelector('input,select,textarea,button')?.focus();
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/50 p-0 backdrop-blur-sm sm:items-center sm:p-4" onMouseDown={onClose}>
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onMouseDown={(e) => e.stopPropagation()}
        className={clsx(
          'max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white p-6 shadow-2xl dark:bg-slate-900 sm:rounded-2xl',
          { sm: 'sm:max-w-sm', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl' }[size],
        )}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button onClick={onClose} className="rounded-lg p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800" aria-label="Close">
            <X className="h-5 w-5" />
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

export function ConfirmDialog({ open, title, message, confirmLabel = 'Delete', onConfirm, onClose, loading }) {
  return (
    <Modal open={open} onClose={onClose} title={title} size="sm">
      <p className="text-sm text-slate-600 dark:text-slate-300">{message}</p>
      <div className="mt-6 flex justify-end gap-2">
        <button className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-danger" onClick={onConfirm} disabled={loading}>
          {loading && <Spinner className="h-4 w-4 text-white" />}
          {confirmLabel}
        </button>
      </div>
    </Modal>
  );
}

export function Pagination({ pagination, onPage }) {
  if (!pagination || pagination.totalPages <= 1) return null;
  const { page, totalPages, total } = pagination;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-slate-500">
      <span>
        Page {page} of {totalPages} · {total} items
      </span>
      <div className="flex gap-2">
        <button className="btn-secondary px-2" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button className="btn-secondary px-2" disabled={page >= totalPages} onClick={() => onPage(page + 1)} aria-label="Next page">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

export function StatCard({ label, value, icon: Icon, change, changeLabel = 'vs last month', invertChange = false, accent = 'brand' }) {
  const good = change === null || change === undefined ? null : invertChange ? change <= 0 : change >= 0;
  const accents = {
    brand: 'bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-100',
    green: 'bg-green-50 text-green-600 dark:bg-green-500/10 dark:text-green-400',
    orange: 'bg-orange-50 text-orange-600 dark:bg-orange-500/10 dark:text-orange-400',
    blue: 'bg-sky-50 text-sky-600 dark:bg-sky-500/10 dark:text-sky-400',
  };
  return (
    <div className="card">
      <div className="flex items-start justify-between">
        <p className="text-sm font-medium text-slate-500 dark:text-slate-400">{label}</p>
        {Icon && (
          <span className={clsx('rounded-lg p-2', accents[accent])}>
            <Icon className="h-4 w-4" aria-hidden />
          </span>
        )}
      </div>
      <p className="mt-2 text-2xl font-bold tracking-tight text-slate-900 dark:text-white">{value}</p>
      {good !== null && (
        <p className={clsx('mt-1 text-xs font-medium', good ? 'text-green-700 dark:text-green-400' : 'text-red-700 dark:text-red-400')}>
          {change > 0 ? '▲' : change < 0 ? '▼' : '•'} {Math.abs(change).toFixed(1)}% <span className="font-normal text-slate-500">{changeLabel}</span>
        </p>
      )}
    </div>
  );
}

export function Tabs({ tabs, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-white p-1 dark:border-slate-700 dark:bg-slate-900" role="tablist">
      {tabs.map((t) => (
        <button
          key={t.value}
          role="tab"
          aria-selected={value === t.value}
          onClick={() => onChange(t.value)}
          className={clsx(
            'rounded-md px-3 py-1.5 text-sm font-medium transition',
            value === t.value ? 'bg-brand-600 text-white' : 'text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
