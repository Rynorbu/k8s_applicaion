import { createHash } from 'node:crypto';

export const GENESIS_HASH = '0'.repeat(64);
const SENSITIVE_KEYS = /^(password|newPassword|currentPassword|token|accessToken|refreshToken|resetUrl|secret|authorization)$/i;

/** Deterministic JSON (sorted keys) so hashes are stable regardless of JSONB key ordering. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value)
    .filter((k) => value[k] !== undefined)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(value[k])}`)
    .join(',')}}`;
}

/** Removes secrets (reset links, tokens, passwords) before anything is persisted. */
export function redact(value) {
  if (Array.isArray(value)) return value.map(redact);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, SENSITIVE_KEYS.test(k) ? '[REDACTED]' : redact(v)]));
  }
  return value;
}

export function computeHash(prevHash, entry) {
  return createHash('sha256')
    .update(prevHash)
    .update(
      stableStringify({
        eventId: entry.eventId,
        eventType: entry.eventType,
        source: entry.source,
        actorId: entry.actorId ?? null,
        occurredAt: entry.occurredAt,
        payload: entry.payload,
      }),
    )
    .digest('hex');
}

/** Verifies a sequence of entries (ordered by seq). Returns the first broken link, if any. */
export function verifyChain(entries, startPrevHash = GENESIS_HASH) {
  let prev = startPrevHash;
  for (const entry of entries) {
    if (entry.prevHash !== prev) return { valid: false, brokenAt: entry.seq, reason: 'prev_hash mismatch' };
    const expected = computeHash(prev, entry);
    if (expected !== entry.hash) return { valid: false, brokenAt: entry.seq, reason: 'hash mismatch (entry modified)' };
    prev = entry.hash;
  }
  return { valid: true, lastHash: prev };
}
