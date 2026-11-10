import { describe, expect, it } from 'vitest';
import { formatMoney, formatPercent, shiftIso } from '../src/lib/format.js';
import { newTraceHeaders } from '../src/api/client.js';

describe('format helpers', () => {
  it('formats money with sign', () => {
    expect(formatMoney(1234.5, 'USD')).toContain('1,234.50');
    expect(formatMoney(5, 'USD', { signed: true })).toContain('+');
  });
  it('formats percentages and shifts dates', () => {
    expect(formatPercent(12.345)).toBe('12.3%');
    expect(formatPercent(null)).toBe('—');
    expect(shiftIso('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('trace headers', () => {
  it('produces valid W3C traceparent headers', () => {
    const h = newTraceHeaders();
    expect(h.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(h['x-correlation-id']).toMatch(/^web-[0-9a-f]{24}$/);
  });
});
