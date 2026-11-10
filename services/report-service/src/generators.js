import ExcelJS from 'exceljs';
import PDFDocument from 'pdfkit';

const UTF8_BOM = String.fromCharCode(0xfeff); // lets Excel detect UTF-8

const fmtMoney = (n, currency) => {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency: currency || 'USD' }).format(n ?? 0);
  } catch {
    return `${Number(n ?? 0).toFixed(2)} ${currency ?? ''}`.trim();
  }
};

/**
 * CSV cell escaping including formula-injection protection (OWASP "CSV Injection"):
 * values starting with = + - @ TAB CR are prefixed with a single quote.
 */
export function csvCell(value) {
  if (value === null || value === undefined) return '';
  let s = String(value);
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
  if (/[",\n\r]/.test(s)) s = `"${s.replace(/"/g, '""')}"`;
  return s;
}

export const TRANSACTION_COLUMNS = [
  ['date', 'Date'],
  ['type', 'Type'],
  ['description', 'Description'],
  ['counterparty', 'Merchant / Payer'],
  ['category', 'Category'],
  ['amount', 'Amount'],
  ['currency', 'Currency'],
  ['amountBase', 'Amount (base)'],
  ['baseCurrency', 'Base currency'],
  ['tags', 'Tags'],
];

export function toCsv(data) {
  const lines = [];
  if (data.type !== 'transactions') {
    const s = data.analytics.summary;
    lines.push('Summary');
    lines.push(['Metric', 'Value'].join(','));
    lines.push(['Period', `${data.from} to ${data.to}`].map(csvCell).join(','));
    lines.push(['Total income', s.totalIncome].map(csvCell).join(','));
    lines.push(['Total expenses', s.totalExpenses].map(csvCell).join(','));
    lines.push(['Net savings', s.net].map(csvCell).join(','));
    lines.push(['Savings rate %', s.savingsRate].map(csvCell).join(','));
    lines.push('');
    lines.push('Spending by category');
    lines.push(['Category', 'Total', 'Share %', 'Transactions'].join(','));
    for (const c of data.analytics.expenseCategories) lines.push([c.name, c.total, c.percentage, c.count].map(csvCell).join(','));
    lines.push('');
  }
  if (data.type !== 'summary') {
    lines.push(TRANSACTION_COLUMNS.map(([, h]) => h).join(','));
    for (const t of data.transactions) lines.push(TRANSACTION_COLUMNS.map(([k]) => csvCell(k === 'tags' ? t.tags.join(' ') : t[k])).join(','));
  }
  return Buffer.from(`${UTF8_BOM}${lines.join('\r\n')}\r\n`, 'utf8');
}

export async function toXlsx(data) {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'SpendWise';
  wb.created = new Date();
  const currency = data.baseCurrency;
  const moneyFmt = '#,##0.00';
  const headerStyle = (row) => {
    row.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    row.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4F46E5' } };
  };

  if (data.type !== 'transactions') {
    const s = data.analytics.summary;
    const summary = wb.addWorksheet('Summary');
    summary.columns = [{ header: 'Metric', key: 'metric', width: 28 }, { header: 'Value', key: 'value', width: 22 }];
    headerStyle(summary.getRow(1));
    summary.addRows([
      { metric: 'Period', value: `${data.from} to ${data.to}` },
      { metric: `Total income (${currency})`, value: s.totalIncome },
      { metric: `Total expenses (${currency})`, value: s.totalExpenses },
      { metric: `Net savings (${currency})`, value: s.net },
      { metric: 'Savings rate %', value: s.savingsRate },
      { metric: 'Average daily spend', value: s.averageDailySpend },
    ]);
    const cats = wb.addWorksheet('Categories');
    cats.columns = [
      { header: 'Category', key: 'name', width: 26 },
      { header: `Total (${currency})`, key: 'total', width: 16, style: { numFmt: moneyFmt } },
      { header: 'Share %', key: 'percentage', width: 10 },
      { header: 'Transactions', key: 'count', width: 14 },
    ];
    headerStyle(cats.getRow(1));
    cats.addRows(data.analytics.expenseCategories);
    const monthly = wb.addWorksheet('Monthly');
    monthly.columns = [
      { header: 'Month', key: 'label', width: 14 },
      { header: 'Income', key: 'income', width: 14, style: { numFmt: moneyFmt } },
      { header: 'Expenses', key: 'expenses', width: 14, style: { numFmt: moneyFmt } },
      { header: 'Net', key: 'net', width: 14, style: { numFmt: moneyFmt } },
    ];
    headerStyle(monthly.getRow(1));
    monthly.addRows(data.analytics.monthly);
  }
  if (data.type !== 'summary') {
    const tx = wb.addWorksheet('Transactions');
    tx.columns = TRANSACTION_COLUMNS.map(([key, header]) => ({
      header,
      key,
      width: key === 'description' ? 36 : 16,
      style: key.startsWith('amount') ? { numFmt: moneyFmt } : undefined,
    }));
    headerStyle(tx.getRow(1));
    tx.addRows(data.transactions.map((t) => ({ ...t, tags: t.tags.join(', ') })));
    tx.autoFilter = { from: 'A1', to: 'J1' };
    tx.views = [{ state: 'frozen', ySplit: 1 }];
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export function toPdf(data) {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 48, info: { Title: data.title, Author: 'SpendWise' } });
    const chunks = [];
    doc.on('data', (c) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);
    const currency = data.baseCurrency;
    const indigo = '#4f46e5';

    doc.fillColor(indigo).fontSize(22).text('SpendWise', { continued: true }).fillColor('#0f172a').fontSize(22).text(`  ${data.title}`);
    doc.moveDown(0.3).fontSize(10).fillColor('#64748b').text(`Period: ${data.from} to ${data.to}   •   Generated ${new Date().toISOString().slice(0, 16).replace('T', ' ')} UTC`);
    doc.moveDown(1);

    if (data.type !== 'transactions') {
      const s = data.analytics.summary;
      const kpis = [
        ['Income', fmtMoney(s.totalIncome, currency)],
        ['Expenses', fmtMoney(s.totalExpenses, currency)],
        ['Net savings', fmtMoney(s.net, currency)],
        ['Savings rate', `${s.savingsRate}%`],
      ];
      const boxW = (doc.page.width - 96 - 30) / 4;
      const y = doc.y;
      kpis.forEach(([label, value], i) => {
        const x = 48 + i * (boxW + 10);
        doc.roundedRect(x, y, boxW, 52, 6).fillAndStroke('#eef2ff', '#c7d2fe');
        doc.fillColor('#64748b').fontSize(9).text(label, x + 8, y + 8, { width: boxW - 16 });
        doc.fillColor('#0f172a').fontSize(13).text(value, x + 8, y + 24, { width: boxW - 16 });
      });
      doc.y = y + 70;
      doc.x = 48;
      doc.fillColor('#0f172a').fontSize(14).text('Spending by category');
      doc.moveDown(0.5);
      const max = Math.max(...data.analytics.expenseCategories.map((c) => c.total), 1);
      for (const c of data.analytics.expenseCategories.slice(0, 12)) {
        const rowY = doc.y;
        doc.fontSize(9).fillColor('#334155').text(c.name, 48, rowY, { width: 120 });
        doc.rect(172, rowY + 1, (c.total / max) * 250, 9).fill(c.color || indigo);
        doc.fillColor('#334155').text(`${fmtMoney(c.total, currency)} (${c.percentage}%)`, 430, rowY, { width: 120 });
        doc.y = rowY + 16;
      }
      doc.moveDown(1);
    }

    if (data.type !== 'summary') {
      doc.x = 48;
      doc.fillColor('#0f172a').fontSize(14).text(`Transactions (${data.transactions.length})`);
      doc.moveDown(0.5);
      const cols = [
        ['Date', 62],
        ['Type', 46],
        ['Description', 170],
        ['Category', 100],
        ['Amount', 110],
      ];
      const drawHeader = () => {
        let x = 48;
        const y = doc.y;
        doc.rect(48, y - 2, doc.page.width - 96, 16).fill('#e0e7ff');
        doc.fillColor('#1e1b4b').fontSize(9);
        for (const [h, w] of cols) {
          doc.text(h, x + 2, y + 2, { width: w - 4 });
          x += w;
        }
        doc.y = y + 18;
      };
      drawHeader();
      for (const t of data.transactions) {
        if (doc.y > doc.page.height - 72) {
          doc.addPage();
          drawHeader();
        }
        const y = doc.y;
        const values = [t.date, t.type, t.description, t.category, `${t.type === 'expense' ? '-' : '+'}${fmtMoney(t.amountBase, t.baseCurrency)}`];
        let x = 48;
        doc.fontSize(8.5).fillColor('#334155');
        values.forEach((v, i) => {
          doc.fillColor(i === 4 ? (t.type === 'expense' ? '#dc2626' : '#16a34a') : '#334155');
          doc.text(String(v ?? ''), x + 2, y, { width: cols[i][1] - 4, ellipsis: true, lineBreak: false });
          x += cols[i][1];
        });
        doc.y = y + 14;
      }
    }
    doc.end();
  });
}

export const CONTENT_TYPES = {
  pdf: 'application/pdf',
  csv: 'text/csv; charset=utf-8',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

export function generate(format, data) {
  if (format === 'csv') return toCsv(data);
  if (format === 'xlsx') return toXlsx(data);
  return toPdf(data);
}
