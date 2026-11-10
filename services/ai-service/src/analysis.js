/**
 * Pure, explainable financial analytics. No black boxes: every insight carries the
 * numbers that produced it, so the UI can explain *why* something was flagged.
 */
const r2 = (n) => Math.round(n * 100) / 100;

export function median(values) {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Robust anomaly detection using the modified z-score (median / MAD, Iglewicz & Hoaglin).
 * Resistant to the outliers it is trying to find, unlike mean/std-dev.
 */
export function detectAnomaly(amount, history, { minSamples = 5, threshold = 3.5, minRatio = 2 } = {}) {
  if (history.length < minSamples) return { isAnomaly: false, reason: 'insufficient_history', samples: history.length };
  const med = median(history);
  const mad = median(history.map((v) => Math.abs(v - med)));
  const ratio = med > 0 ? amount / med : Infinity;
  if (mad === 0) {
    const isAnomaly = med > 0 && ratio >= minRatio + 1;
    return { isAnomaly, score: null, median: r2(med), ratio: r2(ratio), samples: history.length };
  }
  const score = (0.6745 * (amount - med)) / mad;
  return { isAnomaly: score > threshold && ratio >= minRatio, score: r2(score), median: r2(med), ratio: r2(ratio), samples: history.length };
}

/** Month-over-month category changes worth surfacing. */
export function categoryTrends(current, previous, { minChangePct = 25, minAbsolute = 20 } = {}) {
  const prev = new Map(previous.map((c) => [c.categoryId, c]));
  const trends = [];
  for (const c of current) {
    const before = prev.get(c.categoryId)?.total ?? 0;
    const diff = c.total - before;
    if (Math.abs(diff) < minAbsolute) continue;
    const changePct = before > 0 ? (diff / before) * 100 : null;
    if (changePct !== null && Math.abs(changePct) < minChangePct) continue;
    trends.push({ categoryId: c.categoryId, name: c.name, current: r2(c.total), previous: r2(before), change: r2(diff), changePct: changePct === null ? null : r2(changePct), direction: diff > 0 ? 'up' : 'down' });
  }
  return trends.sort((a, b) => Math.abs(b.change) - Math.abs(a.change)).slice(0, 5);
}

/**
 * Month-end spending forecast: blends the current run-rate with the trailing average,
 * weighting the run-rate more as the month progresses.
 */
export function forecastMonthEnd({ spentSoFar, dayOfMonth, daysInMonth, trailingAverage }) {
  const runRate = dayOfMonth > 0 ? (spentSoFar / dayOfMonth) * daysInMonth : 0;
  const weight = Math.min(1, dayOfMonth / daysInMonth + 0.2);
  const projected = trailingAverage > 0 ? weight * runRate + (1 - weight) * Math.max(trailingAverage, spentSoFar) : runRate;
  const projectedTotal = Math.max(spentSoFar, projected);
  return {
    spentSoFar: r2(spentSoFar),
    projectedTotal: r2(projectedTotal),
    runRate: r2(runRate),
    trailingAverage: r2(trailingAverage),
    vsAverage: trailingAverage > 0 ? r2(((projectedTotal - trailingAverage) / trailingAverage) * 100) : null,
  };
}

/** Rule-based, explainable recommendations. */
export function recommendations({ income, expenses, categories, recurringShare = 0 }) {
  const recs = [];
  const savingsRate = income > 0 ? ((income - expenses) / income) * 100 : null;
  if (income === 0 && expenses > 0) {
    recs.push({ id: 'record-income', severity: 'info', title: 'Record your income', message: 'Add your income to unlock savings-rate tracking and more accurate insights.' });
  } else if (savingsRate !== null && savingsRate < 0) {
    recs.push({ id: 'negative-savings', severity: 'danger', title: 'Spending exceeds income', message: `You spent ${r2(-savingsRate)}% more than you earned over the last 90 days. Review your largest categories and set budgets.` });
  } else if (savingsRate !== null && savingsRate < 20) {
    recs.push({ id: 'low-savings', severity: 'warning', title: 'Boost your savings rate', message: `Your savings rate is ${r2(savingsRate)}%. The 50/30/20 rule suggests saving at least 20% of income — try automating a monthly transfer to a goal.` });
  } else if (savingsRate !== null) {
    recs.push({ id: 'healthy-savings', severity: 'success', title: 'Healthy savings rate', message: `You're saving ${r2(savingsRate)}% of your income. Consider directing the surplus to an emergency fund or investment goal.` });
  }
  const top = categories[0];
  if (top && expenses > 0 && top.total / expenses > 0.35 && !/housing/i.test(top.name)) {
    recs.push({ id: 'concentrated-spend', severity: 'warning', title: `${top.name} dominates your spending`, message: `${top.name} accounts for ${r2((top.total / expenses) * 100)}% of expenses. A category budget could help keep it in check.` });
  }
  const subs = categories.find((c) => /subscription/i.test(c.name));
  if (subs && subs.total > 0.08 * expenses) {
    recs.push({ id: 'subscriptions', severity: 'info', title: 'Review your subscriptions', message: `Subscriptions cost ${r2(subs.total)} over the period. Cancel the ones you no longer use.` });
  }
  if (recurringShare > 0.6) {
    recs.push({ id: 'fixed-costs', severity: 'info', title: 'High fixed costs', message: `${r2(recurringShare * 100)}% of spending is recurring. Renegotiating fixed bills has a lasting impact.` });
  }
  return recs;
}

/** 0-100 financial health score from savings rate, spending stability and diversification. */
export function healthScore({ income, expenses, monthlyExpenses, categories }) {
  const savingsRate = income > 0 ? (income - expenses) / income : -1;
  const savingsPoints = Math.max(0, Math.min(40, (savingsRate / 0.3) * 40));
  const mean = monthlyExpenses.length ? monthlyExpenses.reduce((a, b) => a + b, 0) / monthlyExpenses.length : 0;
  const sd = monthlyExpenses.length > 1 ? Math.sqrt(monthlyExpenses.reduce((a, b) => a + (b - mean) ** 2, 0) / monthlyExpenses.length) : 0;
  const cv = mean > 0 ? sd / mean : 0;
  const stabilityPoints = Math.max(0, 30 - cv * 60);
  const topShare = expenses > 0 && categories[0] ? categories[0].total / expenses : 0;
  const diversificationPoints = Math.max(0, 30 - Math.max(0, topShare - 0.3) * 75);
  const score = Math.round(income === 0 && expenses === 0 ? 0 : savingsPoints + stabilityPoints + diversificationPoints);
  const label = score >= 80 ? 'Excellent' : score >= 60 ? 'Good' : score >= 40 ? 'Fair' : 'Needs attention';
  return { score, label, components: { savings: Math.round(savingsPoints), stability: Math.round(stabilityPoints), diversification: Math.round(diversificationPoints) } };
}

/** Deterministic fallback narrative when no LLM is configured. */
export function templateNarrative({ health, forecast, trends, recs, currency }) {
  const parts = [`Your financial health score is ${health.score}/100 (${health.label}).`];
  if (forecast.projectedTotal > 0) {
    parts.push(`At your current pace you'll spend about ${forecast.projectedTotal.toFixed(2)} ${currency} this month${forecast.vsAverage !== null ? `, ${Math.abs(forecast.vsAverage)}% ${forecast.vsAverage >= 0 ? 'above' : 'below'} your recent average` : ''}.`);
  }
  if (trends[0]) parts.push(`${trends[0].name} spending is ${trends[0].direction} ${Math.abs(trends[0].change).toFixed(2)} ${currency} versus last month.`);
  if (recs[0]) parts.push(recs[0].message);
  return parts.join(' ');
}
