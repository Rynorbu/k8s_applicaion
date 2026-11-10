import { describe, expect, it } from 'vitest';
import { trendsQuery } from '../../src/app.js';
import { daysInclusive, fillSeries, labelFor, monthRange, percentChange, startOf } from '../../src/periods.js';

describe('period helpers', () => {
  it('truncates dates to period starts', () => {
    expect(startOf('week', '2026-10-14')).toBe('2026-10-12');
    expect(startOf('month', '2026-10-14')).toBe('2026-10-01');
    expect(startOf('year', '2026-10-14')).toBe('2026-01-01');
  });

  it('builds month ranges with offsets', () => {
    expect(monthRange('2026-01-15', -1)).toEqual({ from: '2025-12-01', to: '2025-12-31' });
    expect(monthRange('2026-02-10')).toEqual({ from: '2026-02-01', to: '2026-02-28' });
  });

  it('labels periods', () => {
    expect(labelFor('month', '2026-10-01')).toBe('Oct 2026');
    expect(labelFor('year', '2026-01-01')).toBe('2026');
  });

  it('computes percent change safely', () => {
    expect(percentChange(150, 100)).toBe(50);
    expect(percentChange(0, 0)).toBe(0);
    expect(percentChange(10, 0)).toBeNull();
  });

  it('counts days inclusively', () => {
    expect(daysInclusive('2026-10-01', '2026-10-31')).toBe(31);
  });
});

describe('fillSeries', () => {
  it('fills gaps with zeros and computes net', () => {
    const series = fillSeries([{ period: '2026-08-01', income: 1000, expenses: 400 }], 'month', '2026-07-01', '2026-09-30');
    expect(series.map((s) => s.period)).toEqual(['2026-07-01', '2026-08-01', '2026-09-01']);
    expect(series[1]).toMatchObject({ income: 1000, expenses: 400, net: 600 });
    expect(series[0]).toMatchObject({ income: 0, expenses: 0, net: 0 });
  });
});

describe('trends query', () => {
  it('rejects daily series longer than a year', () => {
    expect(trendsQuery.safeParse({ granularity: 'day', from: '2024-01-01', to: '2026-01-01' }).success).toBe(false);
    expect(trendsQuery.parse({ granularity: 'week', from: '2026-01-01', to: '2026-03-01' }).granularity).toBe('week');
  });
});
