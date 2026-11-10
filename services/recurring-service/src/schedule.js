const DAY_MS = 86_400_000;
const toDate = (s) => new Date(`${s}T00:00:00Z`);
const fmt = (d) => d.toISOString().slice(0, 10);
const daysInMonth = (y, m) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();

const STEP = {
  daily: { days: 1 },
  weekly: { days: 7 },
  biweekly: { days: 14 },
  monthly: { months: 1 },
  quarterly: { months: 3 },
  yearly: { months: 12 },
};

/** Adds months keeping the anchor day, clamped to the month's length (Jan 31 -> Feb 28/29 -> Mar 31). */
export function addMonths(date, months, anchorDay) {
  const d = toDate(date);
  const total = d.getUTCMonth() + months;
  const y = d.getUTCFullYear() + Math.floor(total / 12);
  const m = ((total % 12) + 12) % 12;
  return fmt(new Date(Date.UTC(y, m, Math.min(anchorDay, daysInMonth(y, m)))));
}

/** Next occurrence strictly after `date`. */
export function nextOccurrence({ frequency, intervalCount = 1, anchorDay }, date) {
  const step = STEP[frequency];
  if (!step) throw new Error(`Unknown frequency ${frequency}`);
  if (step.days) return fmt(new Date(toDate(date).getTime() + step.days * intervalCount * DAY_MS));
  return addMonths(date, step.months * intervalCount, anchorDay ?? toDate(date).getUTCDate());
}

export function isFinished(rule, date, generated) {
  if (rule.endDate && date > rule.endDate) return true;
  if (rule.maxOccurrences && generated >= rule.maxOccurrences) return true;
  return false;
}

/** Lists the occurrences of a rule falling within [from, until] (bounded by `limit`). */
export function occurrencesBetween(rule, from, until, limit = 100) {
  const dates = [];
  let date = rule.nextRunDate ?? rule.startDate;
  let generated = rule.occurrencesGenerated ?? 0;
  while (date && date <= until && dates.length < limit && !isFinished(rule, date, generated)) {
    if (date >= from) dates.push(date);
    generated += 1;
    date = nextOccurrence(rule, date);
  }
  return dates;
}

/** First occurrence on/after `date` (used when resuming a paused rule without back-filling). */
export function firstOnOrAfter(rule, date) {
  let current = rule.nextRunDate ?? rule.startDate;
  let guard = 0;
  while (current < date && guard < 10_000) {
    current = nextOccurrence(rule, current);
    guard += 1;
  }
  return current;
}

/** Human-readable schedule description. */
export function describeSchedule({ frequency, intervalCount = 1 }) {
  const unit = { daily: 'day', weekly: 'week', biweekly: '2 weeks', monthly: 'month', quarterly: 'quarter', yearly: 'year' }[frequency];
  return intervalCount === 1 ? `Every ${unit}` : `Every ${intervalCount} × ${unit}`;
}
