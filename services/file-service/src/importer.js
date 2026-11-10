import { parse } from 'csv-parse/sync';
import ExcelJS from 'exceljs';

export const MAX_IMPORT_ROWS = 5000;

const HEADER_ALIASES = {
  date: ['date', 'transaction date', 'posted date', 'posting date', 'value date', 'booking date'],
  type: ['type', 'kind', 'transaction type'],
  amount: ['amount', 'value', 'sum', 'total'],
  debit: ['debit', 'withdrawal', 'money out', 'paid out'],
  credit: ['credit', 'deposit', 'money in', 'paid in'],
  currency: ['currency', 'ccy'],
  description: ['description', 'details', 'memo', 'narration', 'particulars', 'name', 'title'],
  category: ['category'],
  merchant: ['merchant', 'payee', 'payer', 'counterparty', 'vendor'],
  notes: ['notes', 'note', 'comment'],
};

export function normalizeHeader(header) {
  const h = String(header ?? '').toLowerCase().replace(/[_-]/g, ' ').replace(/\s+/g, ' ').trim();
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) if (aliases.includes(h)) return field;
  return null;
}

/** Parses "1,234.56", "$12", "(12.50)", "-5" into a number (parentheses = negative). */
export function parseAmount(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value === null || value === undefined) return null;
  let s = String(value).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || s.startsWith('-') || s.endsWith('-');
  s = s.replace(/[()\s]/g, '').replace(/^-|-$/g, '').replace(/[^\d.,]/g, '');
  // Whichever separator appears last is the decimal point: 1,234.56 / 1.234,56 / 12,5
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  const commaIsDecimal = lastComma > lastDot && (lastDot !== -1 || /,\d{1,2}$/.test(s));
  s = commaIsDecimal ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const pad = (n) => String(n).padStart(2, '0');

export function parseDate(value, format = 'YYYY-MM-DD') {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value.toISOString().slice(0, 10);
  const s = String(value ?? '').trim();
  let y;
  let m;
  let d;
  const iso = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  const slash = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/);
  if (iso) [, y, m, d] = iso;
  else if (slash) {
    if (format === 'MM/DD/YYYY') [, m, d, y] = slash;
    else [, d, m, y] = slash;
  } else return null;
  const date = `${y}-${pad(m)}-${pad(d)}`;
  const parsed = new Date(`${date}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().startsWith(date) ? date : null;
}

const clean = (v, max) => {
  const s = String(v ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .trim();
  return s ? s.slice(0, max) : undefined;
};

/** Converts raw records (header -> value) into validated transaction rows. */
export function normalizeRecords(records, { defaultType = 'expense', dateFormat = 'YYYY-MM-DD', today = new Date() } = {}) {
  const rows = [];
  const errors = [];
  const maxDate = new Date(today.getTime() + 366 * 86_400_000).toISOString().slice(0, 10);
  records.slice(0, MAX_IMPORT_ROWS).forEach((raw, index) => {
    const rowNumber = index + 2; // header is row 1
    const rec = {};
    for (const [header, value] of Object.entries(raw)) {
      const field = normalizeHeader(header);
      if (field && rec[field] === undefined) rec[field] = value;
    }
    const fail = (message) => errors.push({ row: rowNumber, message });
    const date = parseDate(rec.date, dateFormat);
    if (!date) return fail('Invalid or missing date');
    if (date > maxDate) return fail('Date is too far in the future');

    let amount = parseAmount(rec.amount);
    let type = clean(rec.type, 20)?.toLowerCase();
    if (amount === null) {
      const debit = parseAmount(rec.debit);
      const credit = parseAmount(rec.credit);
      if (debit) [amount, type] = [Math.abs(debit), 'expense'];
      else if (credit) [amount, type] = [Math.abs(credit), 'income'];
    }
    if (amount === null || amount === 0) return fail('Invalid or missing amount');
    if (type && ['debit', 'withdrawal', 'expense', 'spend'].includes(type)) type = 'expense';
    else if (type && ['credit', 'deposit', 'income', 'earning'].includes(type)) type = 'income';
    else if (type) return fail(`Unknown type "${type}"`);
    else type = amount < 0 ? 'expense' : defaultType;
    amount = Math.round(Math.abs(amount) * 100) / 100;
    if (amount > 1_000_000_000) return fail('Amount is too large');

    const currency = clean(rec.currency, 3)?.toUpperCase();
    if (currency && !/^[A-Z]{3}$/.test(currency)) return fail('Invalid currency code');
    const merchant = clean(rec.merchant, 120);
    const description = clean(rec.description, 255) ?? merchant ?? 'Imported transaction';
    rows.push({ rowNumber, date, type, amount, currency, description, merchant, category: clean(rec.category, 50), notes: clean(rec.notes, 1000) });
  });
  if (records.length > MAX_IMPORT_ROWS) errors.push({ row: MAX_IMPORT_ROWS + 2, message: `Only the first ${MAX_IMPORT_ROWS} rows are imported` });
  return { rows, errors, totalRows: Math.min(records.length, MAX_IMPORT_ROWS) };
}

export function readCsv(buffer) {
  return parse(buffer, { columns: true, bom: true, skip_empty_lines: true, trim: true, relax_column_count: true, to: MAX_IMPORT_ROWS + 1 });
}

export async function readXlsx(buffer) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buffer);
  const sheet = wb.worksheets[0];
  if (!sheet) return [];
  const headers = [];
  sheet.getRow(1).eachCell((cell, col) => {
    headers[col] = String(cell.text ?? '').trim();
  });
  const records = [];
  sheet.eachRow((row, rowNumber) => {
    if (rowNumber === 1 || records.length > MAX_IMPORT_ROWS) return;
    const rec = {};
    row.eachCell({ includeEmpty: false }, (cell, col) => {
      if (!headers[col]) return;
      const v = cell.value;
      // Use computed results for formulas; never evaluate them.
      rec[headers[col]] = v && typeof v === 'object' && !(v instanceof Date) ? (v.result ?? cell.text) : v;
    });
    if (Object.keys(rec).length) records.push(rec);
  });
  return records;
}

export const IMPORT_TEMPLATE = `date,type,amount,currency,description,category,merchant,notes
2026-10-01,income,4500.00,USD,October salary,Salary,ACME Corp,
2026-10-02,expense,1200.00,USD,Monthly rent,Housing,Landlord,
2026-10-03,expense,54.20,USD,Weekly groceries,Groceries,Whole Foods,
2026-10-04,expense,15.99,USD,Netflix subscription,Subscriptions,Netflix,
`;
