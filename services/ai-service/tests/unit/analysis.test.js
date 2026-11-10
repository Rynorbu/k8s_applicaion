import { describe, expect, it } from 'vitest';
import { categoryTrends, detectAnomaly, forecastMonthEnd, healthScore, median, recommendations, templateNarrative } from '../../src/analysis.js';
import { createNarrator } from '../../src/narrative.js';

describe('detectAnomaly', () => {
  const groceries = [42, 55, 38, 61, 47, 50, 44, 58];

  it('flags amounts far outside the robust spread', () => {
    const r = detectAnomaly(320, groceries);
    expect(r.isAnomaly).toBe(true);
    expect(r.ratio).toBeGreaterThan(6);
  });

  it('does not flag normal variation', () => {
    expect(detectAnomaly(65, groceries).isAnomaly).toBe(false);
  });

  it('requires enough history', () => {
    expect(detectAnomaly(1000, [10, 12])).toMatchObject({ isAnomaly: false, reason: 'insufficient_history' });
  });

  it('handles zero spread (identical history)', () => {
    expect(detectAnomaly(15, [15, 15, 15, 15, 15]).isAnomaly).toBe(false);
    expect(detectAnomaly(60, [15, 15, 15, 15, 15]).isAnomaly).toBe(true);
  });

  it('computes medians', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });
});

describe('categoryTrends', () => {
  it('surfaces significant month-over-month changes', () => {
    const t = categoryTrends(
      [{ categoryId: 'a', name: 'Dining', total: 400 }, { categoryId: 'b', name: 'Fuel', total: 105 }],
      [{ categoryId: 'a', name: 'Dining', total: 200 }, { categoryId: 'b', name: 'Fuel', total: 100 }],
    );
    expect(t).toEqual([expect.objectContaining({ name: 'Dining', change: 200, changePct: 100, direction: 'up' })]);
  });
});

describe('forecastMonthEnd', () => {
  it('blends run-rate and trailing average', () => {
    const f = forecastMonthEnd({ spentSoFar: 500, dayOfMonth: 10, daysInMonth: 30, trailingAverage: 1200 });
    expect(f.runRate).toBe(1500);
    expect(f.projectedTotal).toBeGreaterThan(1200);
    expect(f.projectedTotal).toBeLessThan(1500);
  });

  it('never projects below what is already spent', () => {
    expect(forecastMonthEnd({ spentSoFar: 900, dayOfMonth: 28, daysInMonth: 30, trailingAverage: 100 }).projectedTotal).toBeGreaterThanOrEqual(900);
  });
});

describe('recommendations & health score', () => {
  it('warns about low savings and concentrated spending', () => {
    const recs = recommendations({ income: 3000, expenses: 2800, categories: [{ name: 'Dining', total: 1500 }] });
    expect(recs.map((r) => r.id)).toEqual(expect.arrayContaining(['low-savings', 'concentrated-spend']));
  });

  it('scores healthy finances higher than overspending', () => {
    const good = healthScore({ income: 6000, expenses: 3600, monthlyExpenses: [1200, 1250, 1180], categories: [{ total: 900 }] });
    const bad = healthScore({ income: 3000, expenses: 3500, monthlyExpenses: [500, 2000, 1000], categories: [{ total: 2500 }] });
    expect(good.score).toBeGreaterThan(bad.score);
    expect(good.score).toBeLessThanOrEqual(100);
  });

  it('produces a template narrative', () => {
    const text = templateNarrative({
      health: { score: 72, label: 'Good' },
      forecast: { projectedTotal: 1500, vsAverage: 10 },
      trends: [{ name: 'Dining', direction: 'up', change: 120 }],
      recs: [{ message: 'Save more.' }],
      currency: 'USD',
    });
    expect(text).toContain('72/100');
    expect(text).toContain('Dining');
  });
});

describe('narrator', () => {
  it('is disabled without an API key', async () => {
    const narrator = createNarrator({ apiKey: undefined, model: 'claude-opus-5-5' });
    expect(narrator.enabled).toBe(false);
    expect(await narrator.narrate('u', { fingerprint: 'x', data: {} })).toBeNull();
  });
});
