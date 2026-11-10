import request from 'supertest';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import { setupTestAuth } from '@spendwise/common/testing';
import { buildApp } from '../../src/app.js';
import { sanitizeFileName, sniff } from '../../src/filetype.js';
import { IMPORT_TEMPLATE, normalizeHeader, normalizeRecords, parseAmount, parseDate, readCsv } from '../../src/importer.js';

describe('file type sniffing', () => {
  it('detects types from magic bytes, not names', () => {
    expect(sniff(Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0])).mime).toBe('image/jpeg');
    expect(sniff(Buffer.from('%PDF-1.7 ...')).mime).toBe('application/pdf');
    expect(sniff(Buffer.from('date,amount\n2026-01-01,5')).mime).toBe('text/csv');
    expect(sniff(Buffer.from([0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00]))).toBeNull(); // Windows executable (MZ header)
  });

  it('sanitizes file names', () => {
    expect(sanitizeFileName('../../etc/passwd', 'csv')).toBe('passwd');
    expect(sanitizeFileName('C:\\Users\\x\\rec<ei>pt.png', 'png')).toBe('receipt.png');
    expect(sanitizeFileName('', 'pdf')).toBe('file.pdf');
  });
});

describe('import parsing', () => {
  it('normalizes header aliases', () => {
    expect(normalizeHeader('Transaction Date')).toBe('date');
    expect(normalizeHeader('Payee')).toBe('merchant');
    expect(normalizeHeader('random')).toBeNull();
  });

  it('parses amounts in common bank formats', () => {
    expect(parseAmount('$1,234.56')).toBe(1234.56);
    expect(parseAmount('(12.50)')).toBe(-12.5);
    expect(parseAmount('1.234,56')).toBe(1234.56);
    expect(parseAmount('abc')).toBeNull();
  });

  it('parses dates with explicit formats', () => {
    expect(parseDate('2026-10-05')).toBe('2026-10-05');
    expect(parseDate('05/10/2026', 'DD/MM/YYYY')).toBe('2026-10-05');
    expect(parseDate('10/05/2026', 'MM/DD/YYYY')).toBe('2026-10-05');
    expect(parseDate('31/02/2026', 'DD/MM/YYYY')).toBeNull();
  });

  it('validates rows and reports per-row errors', () => {
    const { rows, errors } = normalizeRecords([
      { Date: '2026-10-01', Amount: '-45.20', Description: 'Groceries', Category: 'Groceries' },
      { Date: '2026-10-02', Amount: '3000', Type: 'income', Description: 'Salary' },
      { Date: 'not a date', Amount: '10', Description: 'x' },
      { Date: '2026-10-03', Debit: '12.00', Payee: 'Uber' },
      { Date: '2026-10-04', Amount: '5', Type: 'transfer' },
    ]);
    expect(rows).toEqual([
      expect.objectContaining({ rowNumber: 2, type: 'expense', amount: 45.2, category: 'Groceries' }),
      expect.objectContaining({ rowNumber: 3, type: 'income', amount: 3000 }),
      expect.objectContaining({ rowNumber: 5, type: 'expense', amount: 12, description: 'Uber', merchant: 'Uber' }),
    ]);
    expect(errors.map((e) => e.row)).toEqual([4, 6]);
  });

  it('parses the bundled template', () => {
    const { rows, errors } = normalizeRecords(readCsv(Buffer.from(IMPORT_TEMPLATE)));
    expect(errors).toEqual([]);
    expect(rows).toHaveLength(4);
  });
});

describe('file API', () => {
  let app;
  let tokenFor;
  const service = {
    uploadReceipt: vi.fn().mockResolvedValue({ id: 'f1' }),
    importTransactions: vi.fn().mockResolvedValue({ id: 'i1' }),
  };

  beforeAll(async () => {
    ({ tokenFor } = await setupTestAuth());
    app = buildApp({ service, config: { MAX_UPLOAD_BYTES: 1024 } });
  });

  it('accepts multipart uploads', async () => {
    const res = await request(app)
      .post('/api/v1/files/receipts')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .attach('file', Buffer.from([0xff, 0xd8, 0xff, 0xe0]), 'r.jpg');
    expect(res.status).toBe(201);
    expect(service.uploadReceipt).toHaveBeenCalledWith(expect.any(String), expect.objectContaining({ originalname: 'r.jpg' }));
  });

  it('rejects oversized files with 413', async () => {
    const res = await request(app)
      .post('/api/v1/files/receipts')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .attach('file', Buffer.alloc(4096, 1), 'big.jpg');
    expect(res.status).toBe(413);
  });

  it('validates import options', async () => {
    const res = await request(app)
      .post('/api/v1/files/imports')
      .set('Authorization', `Bearer ${await tokenFor()}`)
      .field('defaultType', 'transfer')
      .attach('file', Buffer.from('date,amount\n'), 'x.csv');
    expect(res.status).toBe(400);
  });
});
