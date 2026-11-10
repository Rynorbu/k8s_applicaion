/**
 * Content sniffing by magic bytes. The client-declared MIME type and extension are never
 * trusted (OWASP file upload guidance): a file is accepted only if its bytes match an
 * allowed type.
 */
const SIGNATURES = [
  { mime: 'image/jpeg', ext: 'jpg', test: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: 'image/png', ext: 'png', test: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { mime: 'image/webp', ext: 'webp', test: (b) => b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP' },
  { mime: 'application/pdf', ext: 'pdf', test: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  {
    mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ext: 'xlsx',
    test: (b) => b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04,
  },
];

export function sniff(buffer) {
  if (!buffer || buffer.length < 4) return null;
  return SIGNATURES.find((s) => s.test(buffer)) ?? (looksLikeText(buffer) ? { mime: 'text/csv', ext: 'csv' } : null);
}

/** Plain UTF-8 text without NUL bytes (CSV candidates). */
export function looksLikeText(buffer) {
  const sample = buffer.subarray(0, 8192);
  if (sample.includes(0)) return false;
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(sample.subarray(0, sample.length - 4));
    return true;
  } catch {
    return false;
  }
}

export const RECEIPT_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);
export const IMPORT_TYPES = new Set(['text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet']);

/** Strips paths, control chars and unsafe characters from a client file name. */
export function sanitizeFileName(name, fallbackExt) {
  const base = String(name ?? '')
    .split(/[\\/]/)
    .pop()
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f<>:"|?*]/g, '')
    .replace(/^\.+/, '')
    .trim()
    .slice(0, 120);
  return base || `file.${fallbackExt}`;
}
