import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  AppError,
  Events,
  NotFound,
  UnprocessableEntity,
  enqueueEvent,
  getLogger,
  paginated,
  withTransaction,
} from '@spendwise/common';
import { CONTENT_TYPES, generate } from './generators.js';

const toReport = (row) => ({
  id: row.id,
  title: row.title,
  type: row.type,
  format: row.format,
  from: row.date_from,
  to: row.date_to,
  status: row.status,
  fileName: row.file_name,
  fileSize: row.file_size,
  error: row.error,
  createdAt: row.created_at,
  completedAt: row.completed_at,
  expiresAt: row.expires_at,
});

const MAX_ACTIVE_JOBS_PER_USER = 5;

export function createReportService({ pool, clients, config }) {
  const log = getLogger();
  const storageRoot = path.resolve(config.REPORTS_DIR);

  async function getRow(userId, id) {
    const { rows } = await pool.query('SELECT * FROM reports WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) throw NotFound('Report not found');
    return rows[0];
  }

  async function collectData(report) {
    const query = { userId: report.user_id, from: report.date_from, to: report.date_to };
    const [analytics, expenses, incomes] = await Promise.all([
      clients.analytics.get('/internal/analytics/report', { query }),
      report.type === 'summary' ? { data: [] } : clients.expenses.get('/internal/expenses', { query: { ...query, limit: 10_000 } }),
      report.type === 'summary' ? { data: [] } : clients.incomes.get('/internal/incomes', { query: { ...query, limit: 10_000 } }),
    ]);
    const transactions = [
      ...expenses.data.map((e) => ({ ...e, type: 'expense', date: e.expenseDate, counterparty: e.merchant })),
      ...incomes.data.map((i) => ({ ...i, type: 'income', date: i.incomeDate, counterparty: i.payer })),
    ]
      .map((t) => ({
        date: t.date,
        type: t.type,
        description: t.description,
        counterparty: t.counterparty ?? '',
        category: t.category?.name ?? '',
        amount: t.amount,
        currency: t.currency,
        amountBase: t.amountBase,
        baseCurrency: t.baseCurrency,
        tags: t.tags ?? [],
      }))
      .sort((a, b) => b.date.localeCompare(a.date));
    const baseCurrency = transactions[0]?.baseCurrency ?? 'USD';
    return { title: report.title, type: report.type, from: report.date_from, to: report.date_to, baseCurrency, analytics, transactions };
  }

  return {
    async request(userId, input) {
      return withTransaction(pool, async (client) => {
        const { rows: active } = await client.query(
          `SELECT count(*)::int AS n FROM reports WHERE user_id = $1 AND status IN ('pending', 'processing')`,
          [userId],
        );
        if (active[0].n >= MAX_ACTIVE_JOBS_PER_USER) throw UnprocessableEntity('Too many reports in progress. Please wait for them to finish.');
        const title = input.title ?? `${input.type === 'transactions' ? 'Transactions' : 'Financial'} report ${input.from} – ${input.to}`;
        const { rows } = await client.query(
          `INSERT INTO reports (user_id, title, type, format, date_from, date_to) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
          [userId, title, input.type, input.format, input.from, input.to],
        );
        const report = toReport(rows[0]);
        await enqueueEvent(client, Events.ReportRequested, { reportId: report.id, userId, type: report.type, format: report.format, from: report.from, to: report.to });
        return report;
      });
    },

    /** Event handler for ReportRequested (async worker). */
    async process(client, { reportId }) {
      const { rows } = await client.query(`SELECT * FROM reports WHERE id = $1 FOR UPDATE`, [reportId]);
      const report = rows[0];
      if (!report || report.status === 'completed') return;
      await client.query(`UPDATE reports SET status = 'processing', started_at = now() WHERE id = $1`, [reportId]);
      try {
        const data = await collectData(report);
        const buffer = await generate(report.format, data);
        const fileName = `spendwise-${report.type}-${report.date_from}_${report.date_to}.${report.format}`;
        const storageKey = path.join(report.user_id, `${report.id}.${report.format}`);
        await mkdir(path.join(storageRoot, report.user_id), { recursive: true });
        await writeFile(path.join(storageRoot, storageKey), buffer);
        await client.query(
          `UPDATE reports SET status = 'completed', file_name = $2, storage_key = $3, file_size = $4, completed_at = now(), error = NULL WHERE id = $1`,
          [reportId, fileName, storageKey, buffer.length],
        );
        await enqueueEvent(client, Events.ReportGenerated, { reportId, userId: report.user_id, title: report.title, format: report.format, fileSize: buffer.length }, { userId: report.user_id });
        log.info({ reportId, bytes: buffer.length }, 'report generated');
      } catch (err) {
        // Transient dependency failures are retried by the message bus; anything else fails the job.
        if (err instanceof AppError && err.status === 503) throw err;
        log.error({ err, reportId }, 'report generation failed');
        await client.query(`UPDATE reports SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`, [reportId, 'Report generation failed']);
        await enqueueEvent(client, Events.ReportFailed, { reportId, userId: report.user_id, title: report.title }, { userId: report.user_id });
      }
    },

    async list(userId, { page, pageSize }) {
      const [{ rows }, { rows: count }] = await Promise.all([
        pool.query('SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3', [userId, pageSize, (page - 1) * pageSize]),
        pool.query('SELECT count(*)::int AS n FROM reports WHERE user_id = $1', [userId]),
      ]);
      return paginated(rows.map(toReport), { page, pageSize }, count[0].n);
    },

    async get(userId, id) {
      return toReport(await getRow(userId, id));
    },

    async download(userId, id) {
      const row = await getRow(userId, id);
      if (row.status !== 'completed') throw UnprocessableEntity('Report is not ready yet');
      const filePath = path.resolve(storageRoot, row.storage_key);
      if (!filePath.startsWith(storageRoot + path.sep)) throw NotFound('Report file not found'); // path traversal guard
      return { filePath, fileName: row.file_name, contentType: CONTENT_TYPES[row.format] };
    },

    async remove(userId, id) {
      const row = await getRow(userId, id);
      await pool.query('DELETE FROM reports WHERE id = $1', [id]);
      if (row.storage_key) await rm(path.resolve(storageRoot, row.storage_key), { force: true });
    },

    /** Housekeeping: expire old reports and fail jobs stuck in processing. */
    async housekeeping() {
      const { rows } = await pool.query(`DELETE FROM reports WHERE expires_at < now() RETURNING storage_key`);
      for (const r of rows) if (r.storage_key) await rm(path.resolve(storageRoot, r.storage_key), { force: true });
      await pool.query(
        `UPDATE reports SET status = 'failed', error = 'Timed out' WHERE status IN ('pending', 'processing') AND created_at < now() - interval '30 minutes'`,
      );
    },
  };
}
