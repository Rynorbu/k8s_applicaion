import { describe, expect, it } from 'vitest';
import { searchQuery } from '../../src/app.js';
import { buildSearch } from '../../src/service.js';

describe('buildSearch', () => {
  it('uses full-text + trigram matching with bound parameters', () => {
    const s = buildSearch('u1', { q: "coffee' OR 1=1 --", type: 'expense', minAmount: 5, sort: 'relevance' });
    expect(s.where).toContain("websearch_to_tsquery('simple', $2)");
    expect(s.where).toContain('d.description ILIKE $3');
    expect(s.where).not.toContain('OR 1=1');
    expect(s.params).toEqual(['u1', "coffee' OR 1=1 --", "%coffee' OR 1=1 --%", 'expense', 5]);
    expect(s.orderBy).toBe('rank DESC, occurred_on DESC');
  });

  it('falls back to date sorting without a query', () => {
    expect(buildSearch('u1', { sort: 'relevance' }).orderBy).toBe('occurred_on DESC, indexed_at DESC');
  });

  it('escapes LIKE wildcards', () => {
    expect(buildSearch('u1', { q: '100%' }).params[2]).toBe('%100\\%%');
  });
});

describe('search query validation', () => {
  it('validates ranges', () => {
    expect(searchQuery.safeParse({ minAmount: 50, maxAmount: 10 }).success).toBe(false);
    expect(searchQuery.parse({ q: ' rent ' })).toMatchObject({ q: 'rent', page: 1, pageSize: 20, sort: 'relevance' });
  });
});
