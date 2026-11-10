export function formatMoney(amount, currency = 'USD', { compact = false, signed = false } = {}) {
  const value = Number(amount ?? 0);
  try {
    const text = new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency,
      notation: compact ? 'compact' : 'standard',
      maximumFractionDigits: compact ? 1 : 2,
      signDisplay: signed ? 'exceptZero' : 'auto',
    }).format(value);
    return text;
  } catch {
    return `${value.toFixed(2)} ${currency}`;
  }
}

export function formatDate(date, opts = { day: 'numeric', month: 'short', year: 'numeric' }) {
  if (!date) return '—';
  const d = typeof date === 'string' && date.length === 10 ? new Date(`${date}T00:00:00`) : new Date(date);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString(undefined, opts);
}

export function timeAgo(date) {
  const seconds = Math.round((Date.now() - new Date(date).getTime()) / 1000);
  const units = [
    ['year', 31_536_000],
    ['month', 2_592_000],
    ['day', 86_400],
    ['hour', 3600],
    ['minute', 60],
  ];
  const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
  for (const [unit, size] of units) if (Math.abs(seconds) >= size) return rtf.format(-Math.round(seconds / size), unit);
  return 'just now';
}

export const formatPercent = (n, digits = 1) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(digits)}%`);

export const todayIso = () => {
  const d = new Date();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
};

export const monthStartIso = () => `${todayIso().slice(0, 7)}-01`;

export function shiftIso(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export const formatBytes = (bytes) =>
  bytes < 1024 ? `${bytes} B` : bytes < 1_048_576 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1_048_576).toFixed(1)} MB`;
