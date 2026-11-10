import { describe, expect, it } from 'vitest';
import { createBudgetSchema } from '../../src/app.js';
import { alertLevel, computeStatus, periodFor, shiftPeriod } from '../../src/period.js';

describe('periodFor', () => {
  it('computes calendar months including leap years', () => {
    expect(periodFor('monthly', '2024-02-10')).toEqual({ start: '2024-02-01', end: '2024-02-29' });
    expect(periodFor('monthly', '2026-12-31')).toEqual({ start: '2026-12-01', end: '2026-12-31' });
  });

  it('computes ISO weeks (Monday-Sunday)', () => {
    expect(periodFor('weekly', '2026-10-14')).toEqual({ start: '2026-10-12', end: '2026-10-18' }); // Wednesday
    expect(periodFor('weekly', '2026-10-18')).toEqual({ start: '2026-10-12', end: '2026-10-18' }); // Sunday
    expect(periodFor('weekly', '2026-10-12')).toEqual({ start: '2026-10-12', end: '2026-10-18' }); // Monday
  });

  it('computes years', () => {
    expect(periodFor('yearly', '2026-07-01')).toEqual({ start: '2026-01-01', end: '2026-12-31' });
  });

  it('shifts periods back for history', () => {
    expect(shiftPeriod('monthly', '2026-01-31', 1)).toEqual({ start: '2025-12-01', end: '2025-12-31' });
    expect(shiftPeriod('weekly', '2026-10-14', 1).start).toBe('2026-10-05');
  });
});

describe('computeStatus', () => {
  const budget = { amount: 1000, alertThreshold: 80 };
  const october = { start: '2026-10-01', end: '2026-10-31' };

  it('reports on-track usage with projections', () => {
    const s = computeStatus(budget, 300, october, '2026-10-10');
    expect(s).toMatchObject({ spent: 300, remaining: 700, percentage: 30, status: 'on_track', daysLeft: 21 });
    expect(s.projectedSpend).toBe(930);
    expect(s.dailyAllowance).toBeCloseTo(33.33, 2);
  });

  it('flags warnings and overspending', () => {
    expect(computeStatus(budget, 850, october, '2026-10-20').status).toBe('warning');
    const over = computeStatus(budget, 1200, october, '2026-10-20');
    expect(over).toMatchObject({ status: 'exceeded', remaining: -200, dailyAllowance: 0 });
  });
});

describe('alertLevel', () => {
  it('maps percentages to alert levels', () => {
    expect(alertLevel(50, 80)).toBeNull();
    expect(alertLevel(80, 80)).toBe('warning');
    expect(alertLevel(100, 80)).toBe('exceeded');
  });
});

describe('budget validation', () => {
  it('applies sensible defaults', () => {
    expect(createBudgetSchema.parse({ name: 'Food', amount: 500 })).toMatchObject({ period: 'monthly', alertThreshold: 80 });
    expect(createBudgetSchema.safeParse({ name: 'Food', amount: 500, alertThreshold: 150 }).success).toBe(false);
  });
});
