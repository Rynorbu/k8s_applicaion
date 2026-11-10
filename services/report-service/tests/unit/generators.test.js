import ExcelJS from 'exceljs';
import { describe, expect, it } from 'vitest';
import { createReportSchema } from '../../src/app.js';
import { csvCell, toCsv, toPdf, toXlsx } from '../../src/generators.js';

const data = {
  title: 'Test report',
  type: 'full',
  from: '2026-09-01',
  to: '2026-09-30',
  baseCurrency: 'USD',
  analytics: {
    summary: { totalIncome: 5000, totalExpenses: 1250.5, net: 3749.5, savingsRate: 74.99, averageDailySpend: 41.68 },
    expenseCategories: [{ name: 'Housing', total: 1000, percentage: 80, count: 1, color: '#8b5cf6' }],
    monthly: [{ label: 'Sep 2026', income: 5000, expenses: 1250.5, net: 3749.5 }],
  },
  transactions: [
    { date: '2026-09-02', type: 'expense', description: '=HYPERLINK("http://evil")', counterparty: 'Shop, Inc', category: 'Shopping', amount: 250.5, currency: 'USD', amountBase: 250.5, baseCurrency: 'USD', tags: ['a'] },
    { date: '2026-09-01', type: 'income', description: 'Salary', counterparty: 'ACME', category: 'Salary', amount: 5000, currency: 'USD', amountBase: 5000, baseCurrency: 'USD', tags: [] },
  ],
};

describe('csvCell', () => {
  it('neutralises spreadsheet formulas (CSV injection)', () => {
    expect(csvCell('=1+1')).toBe("'=1+1");
    expect(csvCell('@SUM(A1)')).toBe("'@SUM(A1)");
    expect(csvCell('-12.5')).toBe('-12.5'); // negative numbers stay numeric
  });

  it('quotes delimiters and quotes', () => {
    expect(csvCell('a,b')).toBe('"a,b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
  });
});

describe('report generators', () => {
  it('produces CSV with summary and transactions', () => {
    const csv = toCsv(data).toString('utf8');
    expect(csv).toContain('Total income,5000');
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(csv).toContain('"Shop, Inc"');
  });

  it('produces a valid XLSX workbook', async () => {
    const buffer = await toXlsx(data);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Summary', 'Categories', 'Monthly', 'Transactions']);
    expect(wb.getWorksheet('Transactions').rowCount).toBe(3);
  });

  it('produces a PDF document', async () => {
    const pdf = await toPdf(data);
    expect(pdf.subarray(0, 4).toString()).toBe('%PDF');
    expect(pdf.length).toBeGreaterThan(1000);
  });
});

describe('report request validation', () => {
  it('validates ranges and formats', () => {
    expect(createReportSchema.safeParse({ format: 'docx', from: '2026-01-01', to: '2026-01-31' }).success).toBe(false);
    expect(createReportSchema.safeParse({ format: 'pdf', from: '2026-02-01', to: '2026-01-31' }).success).toBe(false);
    expect(createReportSchema.parse({ format: 'csv', from: '2026-01-01', to: '2026-01-31' }).type).toBe('full');
  });
});
