import { createHash } from 'node:crypto';
import { Events, NotFound, businessEvents, enqueueEvent, getLogger, round2, todayUtc } from '@spendwise/common';
import { categoryTrends, detectAnomaly, forecastMonthEnd, healthScore, recommendations, templateNarrative } from './analysis.js';

const DAY_MS = 86_400_000;
const shiftDays = (date, days) => new Date(new Date(`${date}T00:00:00Z`).getTime() + days * DAY_MS).toISOString().slice(0, 10);

const toInsight = (row) => ({
  id: row.id,
  type: row.type,
  severity: row.severity,
  title: row.title,
  message: row.message,
  data: row.data,
  createdAt: row.created_at,
});

export function createInsightService({ pool, narrator }) {
  const log = getLogger();

  async function categoryTotals(userId, from, to) {
    const { rows } = await pool.query(
      `SELECT category_id, max(category_name) AS name, sum(amount_base) AS total FROM ai_transactions
        WHERE user_id = $1 AND kind = 'expense' AND NOT deleted AND occurred_on BETWEEN $2 AND $3
        GROUP BY category_id ORDER BY total DESC`,
      [userId, from, to],
    );
    return rows.map((r) => ({ categoryId: r.category_id, name: r.name ?? 'Other', total: r.total }));
  }

  return {
    async list(userId) {
      const { rows } = await pool.query(
        'SELECT * FROM insights WHERE user_id = $1 AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 50',
        [userId],
      );
      return { data: rows.map(toInsight) };
    },

    async dismiss(userId, id) {
      const { rowCount } = await pool.query('UPDATE insights SET dismissed_at = now() WHERE id = $1 AND user_id = $2', [id, userId]);
      if (rowCount === 0) throw NotFound('Insight not found');
    },

    /** Computes the live insight overview: health score, forecast, trends, recommendations, narrative. */
    async overview(userId) {
      const today = todayUtc();
      const monthStart = `${today.slice(0, 7)}-01`;
      const prevMonthEnd = shiftDays(monthStart, -1);
      const prevMonthStart = `${prevMonthEnd.slice(0, 7)}-01`;
      const ninetyDaysAgo = shiftDays(today, -89);

      const [{ rows: totals }, { rows: monthly }, current, previous, recent, { rows: currencyRow }, { rows: recurring }] = await Promise.all([
        pool.query(
          `SELECT COALESCE(sum(amount_base) FILTER (WHERE kind = 'income'), 0) AS income,
                  COALESCE(sum(amount_base) FILTER (WHERE kind = 'expense'), 0) AS expenses
             FROM ai_transactions WHERE user_id = $1 AND NOT deleted AND occurred_on BETWEEN $2 AND $3`,
          [userId, ninetyDaysAgo, today],
        ),
        pool.query(
          `SELECT date_trunc('month', occurred_on)::date AS month, sum(amount_base) AS total FROM ai_transactions
            WHERE user_id = $1 AND kind = 'expense' AND NOT deleted AND occurred_on >= $2 AND occurred_on < $3
            GROUP BY 1 ORDER BY 1`,
          [userId, shiftDays(monthStart, -180), monthStart],
        ),
        categoryTotals(userId, monthStart, today),
        categoryTotals(userId, prevMonthStart, prevMonthEnd),
        categoryTotals(userId, ninetyDaysAgo, today),
        pool.query('SELECT base_currency FROM ai_transactions WHERE user_id = $1 ORDER BY updated_at DESC LIMIT 1', [userId]),
        pool.query(
          `SELECT COALESCE(sum(amount_base) FILTER (WHERE origin = 'recurring'), 0) AS recurring, COALESCE(sum(amount_base), 0) AS total
             FROM ai_transactions WHERE user_id = $1 AND kind = 'expense' AND NOT deleted AND occurred_on BETWEEN $2 AND $3`,
          [userId, ninetyDaysAgo, today],
        ),
      ]);
      const currency = currencyRow[0]?.base_currency?.trim() ?? 'USD';
      const { income, expenses } = totals[0];
      const monthlyExpenses = monthly.map((m) => m.total);
      const trailingAverage = monthlyExpenses.length ? monthlyExpenses.slice(-3).reduce((a, b) => a + b, 0) / Math.min(3, monthlyExpenses.length) : 0;
      const d = new Date(`${today}T00:00:00Z`);
      const daysInMonth = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();

      const health = healthScore({ income, expenses, monthlyExpenses, categories: recent });
      const forecast = forecastMonthEnd({
        spentSoFar: current.reduce((s, c) => s + c.total, 0),
        dayOfMonth: d.getUTCDate(),
        daysInMonth,
        trailingAverage,
      });
      const trends = categoryTrends(current, previous);
      const recs = recommendations({
        income,
        expenses,
        categories: recent,
        recurringShare: recurring[0].total > 0 ? recurring[0].recurring / recurring[0].total : 0,
      });
      const { rows: anomalies } = await pool.query(
        `SELECT * FROM insights WHERE user_id = $1 AND type = 'anomaly' AND dismissed_at IS NULL ORDER BY created_at DESC LIMIT 5`,
        [userId],
      );

      const stats = {
        currency,
        last90Days: { income: round2(income), expenses: round2(expenses) },
        healthScore: health,
        forecast,
        categoryTrends: trends,
        topCategories: recent.slice(0, 5).map((c) => ({ name: c.name, total: round2(c.total) })),
        recommendations: recs.map((r) => r.title),
        recentAnomalies: anomalies.map((a) => a.message),
      };
      const fingerprint = createHash('sha256').update(JSON.stringify(stats)).digest('hex').slice(0, 16);
      const aiNarrative = await narrator.narrate(userId, { fingerprint, data: stats });

      return {
        asOf: today,
        currency,
        healthScore: health,
        forecast,
        trends,
        recommendations: recs,
        anomalies: anomalies.map(toInsight),
        narrative: aiNarrative ?? templateNarrative({ health, forecast, trends, recs, currency }),
        narrativeSource: aiNarrative ? 'claude' : 'template',
      };
    },

    // ---- event consumers -------------------------------------------------
    async upsert(client, kind, data) {
      const isExpense = kind === 'expense';
      const id = isExpense ? data.expenseId : data.incomeId;
      await client.query(
        `INSERT INTO ai_transactions (id, user_id, kind, amount_base, base_currency, category_id, category_name, description,
                                      counterparty, occurred_on, origin, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (id) DO UPDATE SET amount_base = EXCLUDED.amount_base, category_id = EXCLUDED.category_id,
           category_name = EXCLUDED.category_name, description = EXCLUDED.description, counterparty = EXCLUDED.counterparty,
           occurred_on = EXCLUDED.occurred_on, version = EXCLUDED.version, updated_at = now()
         WHERE ai_transactions.version <= EXCLUDED.version AND NOT ai_transactions.deleted`,
        [
          id, data.userId, kind, data.amountBase, data.baseCurrency, data.categoryId, data.categoryName, data.description,
          isExpense ? data.merchant : data.payer, isExpense ? data.expenseDate : data.incomeDate, data.origin, data.version ?? 1,
        ],
      );
    },

    async remove(client, kind, data) {
      const id = kind === 'expense' ? data.expenseId : data.incomeId;
      await client.query(
        `INSERT INTO ai_transactions (id, user_id, kind, amount_base, base_currency, occurred_on, deleted)
         VALUES ($1, $2, $3, 0, $4, $5, true) ON CONFLICT (id) DO UPDATE SET deleted = true, updated_at = now()`,
        [id, data.userId, kind, data.baseCurrency ?? 'USD', kind === 'expense' ? data.expenseDate : data.incomeDate],
      );
    },

    /** ExpenseCreated: project, then check for an anomalous amount within its category. */
    async onExpenseCreated(client, data) {
      await this.upsert(client, 'expense', data);
      if (data.origin === 'recurring' || data.expenseDate < shiftDays(todayUtc(), -30)) return;
      const { rows } = await client.query(
        `SELECT amount_base FROM ai_transactions
          WHERE user_id = $1 AND kind = 'expense' AND NOT deleted AND category_id = $2 AND id <> $3
            AND occurred_on >= $4 ORDER BY occurred_on DESC LIMIT 200`,
        [data.userId, data.categoryId, data.expenseId, shiftDays(data.expenseDate, -180)],
      );
      const result = detectAnomaly(data.amountBase, rows.map((r) => r.amount_base));
      if (!result.isAnomaly) return;
      const message = `${data.description} (${data.amountBase.toFixed(2)} ${data.baseCurrency}) is ${result.ratio}× your typical ${data.categoryName} expense of ${result.median.toFixed(2)} ${data.baseCurrency}.`;
      const inserted = await client.query(
        `INSERT INTO insights (user_id, type, severity, title, message, data, fingerprint)
         VALUES ($1, 'anomaly', 'warning', 'Unusual expense detected', $2, $3, $4) ON CONFLICT DO NOTHING RETURNING id`,
        [data.userId, message, { expenseId: data.expenseId, ...result, categoryName: data.categoryName }, `anomaly:${data.expenseId}`],
      );
      if (inserted.rowCount === 0) return;
      await enqueueEvent(
        client,
        Events.AnomalyDetected,
        { userId: data.userId, expenseId: data.expenseId, insightId: inserted.rows[0].id, amount: data.amountBase, median: result.median, ratio: result.ratio, score: result.score, categoryName: data.categoryName, message },
        { userId: data.userId },
      );
      businessEvents.inc({ name: 'anomaly_detected' });
      log.info({ expenseId: data.expenseId, ratio: result.ratio }, 'spending anomaly detected');
    },

    async onCategoryUpdated(client, { categoryId, name }) {
      await client.query('UPDATE ai_transactions SET category_name = $2 WHERE category_id = $1', [categoryId, name]);
    },

    async onCategoryDeleted(client, { categoryId, fallbackCategory }) {
      await client.query('UPDATE ai_transactions SET category_id = $2, category_name = $3 WHERE category_id = $1', [
        categoryId,
        fallbackCategory.id,
        fallbackCategory.name,
      ]);
    },
  };
}
