export const MILESTONES = [25, 50, 75, 100];
const DAY_MS = 86_400_000;
const r2 = (n) => Math.round(n * 100) / 100;

/** Milestones newly crossed when progress moves from `before` to `after` (amounts). */
export function crossedMilestones(target, before, after) {
  const pctBefore = (before / target) * 100;
  const pctAfter = (after / target) * 100;
  return MILESTONES.filter((m) => pctBefore < m && pctAfter >= m);
}

/**
 * Goal progress analytics: percentage, required monthly saving to hit the target date,
 * whether the goal is on track versus linear expected progress, and a projected
 * completion date based on the average monthly contribution so far.
 */
export function computeProgress({ targetAmount, currentAmount, targetDate, createdAt }, today = new Date()) {
  const remaining = r2(Math.max(0, targetAmount - currentAmount));
  const percentage = r2(Math.min(100, (currentAmount / targetAmount) * 100));
  const start = new Date(createdAt ?? today);
  const elapsedMonths = Math.max((today - start) / (30.44 * DAY_MS), 0);
  const avgMonthly = elapsedMonths >= 0.5 ? currentAmount / elapsedMonths : null;
  let monthsLeft = null;
  let requiredMonthly = null;
  let onTrack = null;
  if (targetDate) {
    const end = new Date(`${targetDate}T00:00:00Z`);
    monthsLeft = r2(Math.max(0, (end - today) / (30.44 * DAY_MS)));
    requiredMonthly = monthsLeft > 0 ? r2(remaining / monthsLeft) : remaining;
    const totalSpan = end - start;
    const expectedPct = totalSpan > 0 ? Math.min(100, ((today - start) / totalSpan) * 100) : 100;
    onTrack = percentage >= expectedPct - 5;
  }
  let projectedCompletionDate = null;
  if (remaining === 0) projectedCompletionDate = today.toISOString().slice(0, 10);
  else if (avgMonthly && avgMonthly > 0) {
    projectedCompletionDate = new Date(today.getTime() + (remaining / avgMonthly) * 30.44 * DAY_MS).toISOString().slice(0, 10);
  }
  return { percentage, remaining, monthsLeft, requiredMonthly, onTrack, averageMonthlyContribution: avgMonthly ? r2(avgMonthly) : null, projectedCompletionDate };
}
