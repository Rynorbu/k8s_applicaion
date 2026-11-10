import { getLogger, round2, todayUtc } from '@spendwise/common';
import { daysInclusive, fillSeries, monthRange, percentChange } from './periods.js';

const CACHE_TTL_SECONDS = 300;
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function createAnalyticsService({ pool, redis }) {
  const log = getLogger();

  /** Per-user cache versioning: any event for a user bumps the version and invalidates all of their cached views. */
  async function cachedFor(userId, key, compute) {
    if (!redis || redis.status !== 'ready') return compute();
    try {
      const version = (await redis.get(`analytics:ver:${userId}`)) ?? '0';
      const cacheKey = `analytics:${userId}:${version}:${key}`;
      const hit = await redis.get(cacheKey);
      if (hit) return JSON.parse(hit);
      const value = await compute();
      await redis.set(cacheKey, JSON.stringify(value), 'EX', CACHE_TTL_SECONDS);
      return value;
    } catch (err) {
      log.warn({ err: err.message }, 'analytics cache unavailable');
      return compute();
    }
  }

  async function invalidate(userId) {
    if (redis?.status === 'ready') await redis.incr(`analytics:ver:${userId}`).catch(() => {});
  }

  async function summary(userId, { from, to }) {
    const { rows } = await pool.query(
      `SELECT
         COALESCE(sum(amount_base) FILTER (WHERE kind = 'income'), 0)  AS income,
         COALESCE(sum(amount_base) FILTER (WHERE kind = 'expense'), 0) AS expenses,
         count(*) FILTER (WHERE kind = 'income')::int  AS income_count,
         count(*) FILTER (WHERE kind = 'expense')::int AS expense_count,
         COALESCE(max(amount_base) FILTER (WHERE kind = 'expense'), 0) AS largest_expense
       FROM transactions WHERE user_id = $1 AND NOT deleted AND occurred_on BETWEEN $2 AND $3`,
      [userId, from, to],
    );
    const r = rows[0];
    const net = round2(r.income - r.expenses);
    return {
      from,
      to,
      totalIncome: round2(r.income),
      totalExpenses: round2(r.expenses),
      net,
      savingsRate: r.income > 0 ? round2((net / r.income) * 100) : 0,
      incomeCount: r.income_count,
      expenseCount: r.expense_count,
      averageDailySpend: round2(r.expenses / daysInclusive(from, to)),
      largestExpense: round2(r.largest_expense),
    };
  }

  async function balance(userId) {
    const { rows } = await pool.query(
      `SELECT COALESCE(sum(CASE WHEN kind = 'income' THEN amount_base ELSE -amount_base END), 0) AS balance,
              max(base_currency) AS currency
         FROM transactions WHERE user_id = $1 AND NOT deleted`,
      [userId],
    );
    return { balance: round2(rows[0].balance), currency: rows[0].currency?.trim() ?? null };
  }

  async function trends(userId, { granularity, from, to }) {
    const { rows } = await pool.query(
      `SELECT to_char(date_trunc($2, occurred_on::timestamp), 'YYYY-MM-DD') AS period,
              COALESCE(sum(amount_base) FILTER (WHERE kind = 'income'), 0)  AS income,
              COALESCE(sum(amount_base) FILTER (WHERE kind = 'expense'), 0) AS expenses
         FROM transactions WHERE user_id = $1 AND NOT deleted AND occurred_on BETWEEN $3 AND $4
        GROUP BY 1 ORDER BY 1`,
      [userId, granularity, from, to],
    );
    return { granularity, from, to, data: fillSeries(rows, granularity, from, to) };
  }

  async function categories(userId, { type, from, to }) {
    const { rows } = await pool.query(
      `SELECT category_id, max(category_name) AS name, max(category_color) AS color, sum(amount_base) AS total, count(*)::int AS count
         FROM transactions WHERE user_id = $1 AND kind = $2 AND NOT deleted AND occurred_on BETWEEN $3 AND $4
        GROUP BY category_id ORDER BY total DESC`,
      [userId, type, from, to],
    );
    const grand = rows.reduce((s, r) => s + r.total, 0);
    return {
      type,
      from,
      to,
      total: round2(grand),
      data: rows.map((r) => ({
        categoryId: r.category_id,
        name: r.name ?? 'Uncategorized',
        color: r.color ?? '#94a3b8',
        total: round2(r.total),
        count: r.count,
        percentage: grand > 0 ? round2((r.total / grand) * 100) : 0,
      })),
    };
  }

  async function patterns(userId, { from, to }) {
    const [{ rows: weekdays }, { rows: merchants }] = await Promise.all([
      pool.query(
        `SELECT extract(dow FROM occurred_on)::int AS dow, sum(amount_base) AS total, count(*)::int AS count
           FROM transactions WHERE user_id = $1 AND kind = 'expense' AND NOT deleted AND occurred_on BETWEEN $2 AND $3
          GROUP BY 1`,
        [userId, from, to],
      ),
      pool.query(
        `SELECT counterparty AS name, sum(amount_base) AS total, count(*)::int AS count
           FROM transactions WHERE user_id = $1 AND kind = 'expense' AND NOT deleted AND counterparty IS NOT NULL
            AND occurred_on BETWEEN $2 AND $3
          GROUP BY counterparty ORDER BY total DESC LIMIT 10`,
        [userId, from, to],
      ),
    ]);
    const weeks = Math.max(1, daysInclusive(from, to) / 7);
    return {
      from,
      to,
      byWeekday: WEEKDAYS.map((day, dow) => {
        const r = weekdays.find((w) => w.dow === dow);
        return { day, total: round2(r?.total ?? 0), count: r?.count ?? 0, averagePerWeek: round2((r?.total ?? 0) / weeks) };
      }),
      topMerchants: merchants.map((m) => ({ name: m.name, total: round2(m.total), count: m.count })),
    };
  }

  return {
    summary: (userId, range) => cachedFor(userId, `summary:${range.from}:${range.to}`, () => summary(userId, range)),
    trends: (userId, q) => cachedFor(userId, `trends:${q.granularity}:${q.from}:${q.to}`, () => trends(userId, q)),
    categories: (userId, q) => cachedFor(userId, `categories:${q.type}:${q.from}:${q.to}`, () => categories(userId, q)),
    patterns: (userId, q) => cachedFor(userId, `patterns:${q.from}:${q.to}`, () => patterns(userId, q)),

    incomeVsExpenses(userId, months) {
      const today = todayUtc();
      const { from } = monthRange(today, -(months - 1));
      const { to } = monthRange(today);
      return cachedFor(userId, `ive:${months}:${today}`, async () => {
        const series = await trends(userId, { granularity: 'month', from, to });
        const totals = series.data.reduce((acc, p) => ({ income: acc.income + p.income, expenses: acc.expenses + p.expenses }), { income: 0, expenses: 0 });
        return { months, from, to, totalIncome: round2(totals.income), totalExpenses: round2(totals.expenses), net: round2(totals.income - totals.expenses), data: series.data };
      });
    },

    dashboard(userId) {
      const today = todayUtc();
      return cachedFor(userId, `dashboard:${today}`, async () => {
        const current = monthRange(today);
        const previous = monthRange(today, -1);
        const sixMonths = { from: monthRange(today, -5).from, to: current.to };
        const [thisMonth, lastMonth, bal, trend, cats, daily] = await Promise.all([
          summary(userId, { from: current.from, to: today }),
          summary(userId, previous),
          balance(userId),
          trends(userId, { granularity: 'month', ...sixMonths }),
          categories(userId, { type: 'expense', ...current }),
          trends(userId, { granularity: 'day', from: current.from, to: today }),
        ]);
        return {
          asOf: today,
          currency: bal.currency,
          totalBalance: bal.balance,
          month: thisMonth,
          previousMonth: lastMonth,
          changes: {
            income: percentChange(thisMonth.totalIncome, lastMonth.totalIncome),
            expenses: percentChange(thisMonth.totalExpenses, lastMonth.totalExpenses),
          },
          monthlyTrend: trend.data,
          dailySpending: daily.data.map((d) => ({ date: d.period, amount: d.expenses })),
          spendingByCategory: cats.data,
        };
      });
    },

    async report(userId, { from, to }) {
      const [s, expenseCats, incomeCats, monthly] = await Promise.all([
        summary(userId, { from, to }),
        categories(userId, { type: 'expense', from, to }),
        categories(userId, { type: 'income', from, to }),
        trends(userId, { granularity: 'month', from, to }),
      ]);
      return { summary: s, expenseCategories: expenseCats.data, incomeCategories: incomeCats.data, monthly: monthly.data };
    },

    // ---- event consumers (projection) -------------------------------------
    async upsertTransaction(client, kind, d) {
      const id = kind === 'expense' ? d.expenseId : d.incomeId;
      await client.query(
        `INSERT INTO transactions (id, user_id, kind, amount_base, base_currency, category_id, category_name, category_color,
                                   description, counterparty, occurred_on, origin, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
         ON CONFLICT (id) DO UPDATE SET amount_base = EXCLUDED.amount_base, base_currency = EXCLUDED.base_currency,
           category_id = EXCLUDED.category_id, category_name = EXCLUDED.category_name, category_color = EXCLUDED.category_color,
           description = EXCLUDED.description, counterparty = EXCLUDED.counterparty, occurred_on = EXCLUDED.occurred_on,
           version = EXCLUDED.version, updated_at = now()
         WHERE transactions.version <= EXCLUDED.version AND NOT transactions.deleted`,
        [
          id, d.userId, kind, d.amountBase, d.baseCurrency, d.categoryId, d.categoryName, d.categoryColor, d.description,
          kind === 'expense' ? d.merchant : d.payer, kind === 'expense' ? d.expenseDate : d.incomeDate, d.origin, d.version ?? 1,
        ],
      );
      await invalidate(d.userId);
    },

    async deleteTransaction(client, kind, d) {
      const id = kind === 'expense' ? d.expenseId : d.incomeId;
      // Tombstone insert handles "delete arrives before create" reordering.
      await client.query(
        `INSERT INTO transactions (id, user_id, kind, amount_base, base_currency, occurred_on, version, deleted)
         VALUES ($1, $2, $3, 0, $4, $5, $6, true)
         ON CONFLICT (id) DO UPDATE SET deleted = true, updated_at = now()`,
        [id, d.userId, kind, d.baseCurrency ?? 'USD', kind === 'expense' ? d.expenseDate : d.incomeDate, d.version ?? 1],
      );
      await invalidate(d.userId);
    },

    async onCategoryUpdated(client, { categoryId, name, color }) {
      await client.query('UPDATE transactions SET category_name = $2, category_color = $3 WHERE category_id = $1', [categoryId, name, color]);
    },

    async onCategoryDeleted(client, { categoryId, userId, fallbackCategory }) {
      await client.query('UPDATE transactions SET category_id = $2, category_name = $3, category_color = $4 WHERE category_id = $1', [
        categoryId,
        fallbackCategory.id,
        fallbackCategory.name,
        fallbackCategory.color,
      ]);
      if (userId) await invalidate(userId);
    },
  };
}
