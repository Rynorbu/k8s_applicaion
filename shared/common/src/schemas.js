import { z } from 'zod';

// Strip ASCII control characters (except tab/newline) from free text.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export const uuid = z.string().uuid();
export const idParams = z.object({ id: uuid });

export const safeText = (max = 255) =>
  z
    .string()
    .trim()
    .max(max)
    .transform((v) => v.replace(CONTROL_CHARS, ''));

export const requiredText = (max = 255) => safeText(max).pipe(z.string().min(1, 'Required'));

export const currencyCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, 'Must be an ISO-4217 currency code');

/** Positive monetary amount with at most 2 decimals. */
export const money = z.coerce
  .number({ invalid_type_error: 'Must be a number' })
  .positive('Must be greater than 0')
  .max(1_000_000_000, 'Amount is too large')
  .refine((v) => Math.abs(Math.round(v * 100) - v * 100) < 1e-6, 'At most 2 decimal places');

export const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be a date in YYYY-MM-DD format')
  .refine((v) => !Number.isNaN(Date.parse(`${v}T00:00:00Z`)) && new Date(`${v}T00:00:00Z`).toISOString().startsWith(v), {
    message: 'Invalid calendar date',
  });

export const pagination = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const dateRange = z.object({ from: isoDate.optional(), to: isoDate.optional() });

export const tags = z.array(safeText(30).pipe(z.string().min(1))).max(10).default([]);

export function paginated(data, { page, pageSize }, total) {
  return { data, pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) } };
}

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export const todayUtc = () => new Date().toISOString().slice(0, 10);

/** Escapes LIKE/ILIKE wildcards so user input is matched literally. */
export const escapeLike = (s) => s.replace(/[\\%_]/g, (c) => `\\${c}`);
