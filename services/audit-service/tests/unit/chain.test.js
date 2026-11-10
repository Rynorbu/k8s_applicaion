import { describe, expect, it } from 'vitest';
import { GENESIS_HASH, computeHash, redact, stableStringify, verifyChain } from '../../src/chain.js';

const build = (payloads) => {
  let prev = GENESIS_HASH;
  return payloads.map((payload, i) => {
    const entry = { seq: i + 1, eventId: `e${i}`, eventType: 'ExpenseCreated', source: 'expense-service', actorId: 'u1', occurredAt: '2026-10-14T00:00:00.000Z', payload };
    const hash = computeHash(prev, entry);
    const full = { ...entry, prevHash: prev, hash };
    prev = hash;
    return full;
  });
};

describe('stableStringify', () => {
  it('is independent of key order', () => {
    expect(stableStringify({ b: 1, a: { d: 2, c: [3, { y: 1, x: 2 }] } })).toBe(stableStringify({ a: { c: [3, { x: 2, y: 1 }], d: 2 }, b: 1 }));
  });
});

describe('redact', () => {
  it('removes secrets recursively', () => {
    expect(redact({ email: 'a@b.c', resetUrl: 'http://x?token=1', nested: { password: 'p', ok: 1 } })).toEqual({
      email: 'a@b.c',
      resetUrl: '[REDACTED]',
      nested: { password: '[REDACTED]', ok: 1 },
    });
  });
});

describe('hash chain', () => {
  it('verifies an intact chain', () => {
    expect(verifyChain(build([{ a: 1 }, { b: 2 }, { c: 3 }])).valid).toBe(true);
  });

  it('detects a modified payload', () => {
    const chain = build([{ amount: 10 }, { amount: 20 }, { amount: 30 }]);
    chain[1].payload = { amount: 2000 };
    expect(verifyChain(chain)).toMatchObject({ valid: false, brokenAt: 2 });
  });

  it('detects a deleted entry', () => {
    const chain = build([{ a: 1 }, { b: 2 }, { c: 3 }]);
    chain.splice(1, 1);
    expect(verifyChain(chain)).toMatchObject({ valid: false, brokenAt: 3, reason: 'prev_hash mismatch' });
  });
});
