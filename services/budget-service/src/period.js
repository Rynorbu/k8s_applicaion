const DAY_MS = 86_400_000;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);

/** Returns the [start, end] (inclusive, YYYY-MM-DD) of the budget period containing `date`. */
export function periodFor(period, date) {
  const d = toDate(date);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth();
  if (period === 'weekly') {
    const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
    const start = new Date(d.getTime() - dow * DAY_MS);
    return { start: fmt(start), end: fmt(new Date(start.getTime() + 6 * DAY_MS)) };
  }
  if (period === 'yearly') return { start: `${y}-01-01`, end: `${y}-12-31` };
  return { start: fmt(new Date(Date.UTC(y, m, 1))), end: fmt(new Date(Date.UTC(y, m + 1, 0))) };
}

/** Previous period start for history (n periods back). */
export function shiftPeriod(period, date, n) {
  const d = toDate(date);
  if (period === 'weekly') return periodFor(period, fmt(new Date(d.getTime() - n * 7 * DAY_MS)));
  if (period === 'yearly') return periodFor(period, `${d.getUTCFullYear() - n}-06-15`);
  return periodFor(period, fmt(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - n, 15))));
}

export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / DAY_MS) + 1;

/** Computes usage metrics for a budget in a period. */
export function computeStatus({ amount, alertThreshold }, spent, { start, end }, today) {
  const percentage = amount > 0 ? Math.round((spent / amount) * 10_000) / 100 : 0;
  const totalDays = daysBetween(start, end);
  const clampedToday = today < start ? start : today > end ? end : today;
  const elapsedDays = daysBetween(start, clampedToday);
  const daysLeft = Math.max(0, totalDays - elapsedDays);
  const remaining = Math.round((amount - spent) * 100) / 100;
  const projected = elapsedDays > 0 ? Math.round((spent / elapsedDays) * totalDays * 100) / 100 : spent;
  let status = 'on_track';
  if (percentage >= 100) status = 'exceeded';
  else if (percentage >= alertThreshold) status = 'warning';
  return {
    periodStart: start,
    periodEnd: end,
    spent: Math.round(spent * 100) / 100,
    remaining,
    percentage,
    status,
    daysLeft,
    dailyAllowance: daysLeft > 0 && remaining > 0 ? Math.round((remaining / daysLeft) * 100) / 100 : 0,
    projectedSpend: projected,
    projectedToExceed: projected > amount,
  };
}

/** Decides which alert (if any) a usage level should trigger. */
export function alertLevel(percentage, alertThreshold) {
  if (percentage >= 100) return 'exceeded';
  if (percentage >= alertThreshold) return 'warning';
  return null;
}
