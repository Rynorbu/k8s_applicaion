import { describe, expect, it } from 'vitest';
import { contributionSchema, createGoalSchema } from '../../src/app.js';
import { computeProgress, crossedMilestones } from '../../src/progress.js';

describe('crossedMilestones', () => {
  it('returns every milestone crossed by a contribution', () => {
    expect(crossedMilestones(1000, 0, 260)).toEqual([25]);
    expect(crossedMilestones(1000, 260, 1000)).toEqual([50, 75, 100]);
    expect(crossedMilestones(1000, 500, 600)).toEqual([]);
    expect(crossedMilestones(1000, 900, 400)).toEqual([]); // withdrawals never announce
  });
});

describe('computeProgress', () => {
  const today = new Date('2026-10-14T00:00:00Z');

  it('computes required monthly savings to hit the target date', () => {
    const p = computeProgress({ targetAmount: 1200, currentAmount: 200, targetDate: '2027-10-14', createdAt: '2026-10-14T00:00:00Z' }, today);
    expect(p.percentage).toBeCloseTo(16.67, 2);
    expect(p.remaining).toBe(1000);
    expect(p.requiredMonthly).toBeCloseTo(83.4, 0);
    expect(p.onTrack).toBe(true);
  });

  it('flags goals falling behind and projects completion', () => {
    const p = computeProgress({ targetAmount: 1000, currentAmount: 100, targetDate: '2026-12-31', createdAt: '2026-01-01T00:00:00Z' }, today);
    expect(p.onTrack).toBe(false);
    expect(p.averageMonthlyContribution).toBeGreaterThan(0);
    expect(p.projectedCompletionDate > '2026-12-31').toBe(true);
  });

  it('caps percentage at 100', () => {
    expect(computeProgress({ targetAmount: 100, currentAmount: 150 }, today).percentage).toBe(100);
  });
});

describe('goal validation', () => {
  it('validates goals and contributions', () => {
    expect(createGoalSchema.parse({ name: 'Emergency fund', targetAmount: 5000 })).toMatchObject({ priority: 'medium', icon: 'piggy-bank' });
    expect(contributionSchema.safeParse({ amount: 0 }).success).toBe(false);
    expect(contributionSchema.parse({ amount: -50 }).amount).toBe(-50);
  });
});
