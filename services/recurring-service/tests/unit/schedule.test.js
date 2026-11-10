import { describe, expect, it } from 'vitest';
import { createRecurringSchema } from '../../src/app.js';
import { addMonths, describeSchedule, firstOnOrAfter, nextOccurrence, occurrencesBetween } from '../../src/schedule.js';

describe('addMonths', () => {
  it('clamps to month end while keeping the anchor day', () => {
    expect(addMonths('2026-01-31', 1, 31)).toBe('2026-02-28');
    expect(addMonths('2026-02-28', 1, 31)).toBe('2026-03-31');
    expect(addMonths('2024-01-31', 1, 31)).toBe('2024-02-29');
    expect(addMonths('2026-11-15', 3, 15)).toBe('2027-02-15');
  });
});

describe('nextOccurrence', () => {
  it('supports all frequencies and intervals', () => {
    expect(nextOccurrence({ frequency: 'daily', intervalCount: 3 }, '2026-10-30')).toBe('2026-11-02');
    expect(nextOccurrence({ frequency: 'weekly' }, '2026-10-14')).toBe('2026-10-21');
    expect(nextOccurrence({ frequency: 'biweekly' }, '2026-10-14')).toBe('2026-10-28');
    expect(nextOccurrence({ frequency: 'monthly', anchorDay: 31 }, '2026-04-30')).toBe('2026-05-31');
    expect(nextOccurrence({ frequency: 'quarterly', anchorDay: 1 }, '2026-10-01')).toBe('2027-01-01');
    expect(nextOccurrence({ frequency: 'yearly', anchorDay: 29 }, '2024-02-29')).toBe('2025-02-28');
  });
});

describe('occurrencesBetween', () => {
  const rule = { frequency: 'monthly', intervalCount: 1, anchorDay: 5, startDate: '2026-01-05', nextRunDate: '2026-01-05', occurrencesGenerated: 0 };

  it('lists dates in a window', () => {
    expect(occurrencesBetween(rule, '2026-02-01', '2026-05-01')).toEqual(['2026-02-05', '2026-03-05', '2026-04-05']);
  });

  it('respects end dates and max occurrences', () => {
    expect(occurrencesBetween({ ...rule, endDate: '2026-03-10' }, '2026-01-01', '2026-12-31')).toHaveLength(3);
    expect(occurrencesBetween({ ...rule, maxOccurrences: 2 }, '2026-01-01', '2026-12-31')).toEqual(['2026-01-05', '2026-02-05']);
  });

  it('finds the first occurrence on or after a date (resume without back-fill)', () => {
    expect(firstOnOrAfter(rule, '2026-06-06')).toBe('2026-07-05');
  });
});

describe('schedule text and validation', () => {
  it('describes schedules', () => {
    expect(describeSchedule({ frequency: 'monthly', intervalCount: 1 })).toBe('Every month');
    expect(describeSchedule({ frequency: 'weekly', intervalCount: 2 })).toBe('Every 2 × week');
  });

  it('rejects end dates before start dates', () => {
    const base = { type: 'expense', description: 'Rent', amount: 1000, frequency: 'monthly', startDate: '2026-10-01' };
    expect(createRecurringSchema.safeParse({ ...base, endDate: '2026-09-01' }).success).toBe(false);
    expect(createRecurringSchema.parse(base).intervalCount).toBe(1);
  });
});
