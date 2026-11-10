const DAY_MS = 86_400_000;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);

export function startOf(granularity, date) {
  const d = toDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (granularity === 'day') return date;
  if (granularity === 'week') return fmt(new Date(d.getTime() - ((d.getUTCDay() + 6) % 7) * DAY_MS));
  if (granularity === 'year') return `${y}-01-01`;
  return fmt(new Date(Date.UTC(y, m, 1)));
}

export function nextPeriod(granularity, periodStart) {
  const d = toDate(periodStart);
  if (granularity === 'day') return fmt(new Date(d.getTime() + DAY_MS));
  if (granularity === 'week') return fmt(new Date(d.getTime() + 7 * DAY_MS));
  if (granularity === 'year') return `${d.getUTCFullYear() + 1}-01-01`;
  return fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)));
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function labelFor(granularity, periodStart) {
  const d = toDate(periodStart);
  if (granularity === 'year') return String(d.getUTCFullYear());
  if (granularity === 'month') return `${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

/** Fills missing periods with zeros so charts have a continuous x-axis. */
export function fillSeries(rows, granularity, from, to) {
  const byPeriod = new Map(rows.map((r) => [r.period, r]));
  const series = [];
  let guard = 0;
  for (let p = startOf(granularity, from); p <= to && guard < 1000; p = nextPeriod(granularity, p), guard += 1) {
    const r = byPeriod.get(p) ?? { income: 0, expenses: 0 };
    const income = Math.round(r.income * 100) / 100;
    const expenses = Math.round(r.expenses * 100) / 100;
    series.push({ period: p, label: labelFor(granularity, p), income, expenses, net: Math.round((income - expenses) * 100) / 100 });
  }
  return series;
}

export const daysInclusive = (from, to) => Math.round((toDate(to) - toDate(from)) / DAY_MS) + 1;

export function monthRange(date, offsetMonths = 0) {
  const d = toDate(date);
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths, 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + offsetMonths + 1, 0));
  return { from: fmt(start), to: fmt(end) };
}

export const percentChange = (current, previous) =>
  previous === 0 ? (current === 0 ? 0 : null) : Math.round(((current - previous) / previous) * 10_000) / 100;
