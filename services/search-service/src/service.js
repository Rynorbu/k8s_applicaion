import { escapeLike, paginated, round2 } from '@spendwise/common';

const toResult = (row) => ({
  id: row.id,
  kind: row.kind,
  amount: row.amount,
  currency: row.currency.trim(),
  amountBase: row.amount_base,
  baseCurrency: row.base_currency.trim(),
  description: row.description,
  counterparty: row.counterparty,
  notes: row.notes,
  tags: row.tags,
  category: row.category_id ? { id: row.category_id, name: row.category_name, color: row.category_color } : null,
  date: row.occurred_on,
  origin: row.origin,
  score: row.rank !== undefined ? round2(row.rank) : undefined,
});

const SORTS = {
  relevance: 'rank DESC, occurred_on DESC',
  date_desc: 'occurred_on DESC, indexed_at DESC',
  date_asc: 'occurred_on ASC',
  amount_desc: 'amount_base DESC',
  amount_asc: 'amount_base ASC',
};

/** Builds a parameterised search query. Exported for unit testing. */
export function buildSearch(userId, f) {
  const params = [userId];
  const where = ['d.user_id = $1', 'NOT d.deleted'];
  const p = (v) => {
    params.push(v);
    return `$${params.length}`;
  };
  let rank = '0';
  if (f.q) {
    const tsq = `websearch_to_tsquery('simple', ${p(f.q)})`;
    const like = p(`%${escapeLike(f.q)}%`);
    where.push(`(d.search_vector @@ ${tsq} OR d.description ILIKE ${like} OR d.counterparty ILIKE ${like})`);
    rank = `ts_rank(d.search_vector, ${tsq}) + CASE WHEN d.description ILIKE ${like} THEN 0.1 ELSE 0 END`;
  }
  if (f.type) where.push(`d.kind = ${p(f.type)}`);
  if (f.categoryId) where.push(`d.category_id = ${p(f.categoryId)}`);
  if (f.from) where.push(`d.occurred_on >= ${p(f.from)}`);
  if (f.to) where.push(`d.occurred_on <= ${p(f.to)}`);
  if (f.minAmount !== undefined) where.push(`d.amount_base >= ${p(f.minAmount)}`);
  if (f.maxAmount !== undefined) where.push(`d.amount_base <= ${p(f.maxAmount)}`);
  if (f.tag) where.push(`${p(f.tag)} = ANY(d.tags)`);
  const sort = f.sort === 'relevance' && !f.q ? 'date_desc' : f.sort;
  return { params, where: where.join(' AND '), rank, orderBy: SORTS[sort] ?? SORTS.date_desc };
}

export function createSearchService({ pool }) {
  return {
    async search(userId, filters) {
      const { params, where, rank, orderBy } = buildSearch(userId, filters);
      const offset = (filters.page - 1) * filters.pageSize;
      const [{ rows }, { rows: totals }, { rows: byCategory }] = await Promise.all([
        pool.query(
          `SELECT d.*, ${rank} AS rank FROM search_documents d WHERE ${where} ORDER BY ${orderBy} LIMIT ${filters.pageSize} OFFSET ${offset}`,
          params,
        ),
        pool.query(
          `SELECT count(*)::int AS total,
                  count(*) FILTER (WHERE kind = 'expense')::int AS expenses,
                  count(*) FILTER (WHERE kind = 'income')::int AS incomes,
                  COALESCE(sum(amount_base) FILTER (WHERE kind = 'expense'), 0) AS expense_total,
                  COALESCE(sum(amount_base) FILTER (WHERE kind = 'income'), 0) AS income_total
             FROM search_documents d WHERE ${where}`,
          params,
        ),
        pool.query(
          `SELECT category_id, max(category_name) AS name, max(category_color) AS color, count(*)::int AS count
             FROM search_documents d WHERE ${where} AND category_id IS NOT NULL
            GROUP BY category_id ORDER BY count DESC LIMIT 10`,
          params,
        ),
      ]);
      const t = totals[0];
      return {
        ...paginated(rows.map(toResult), filters, t.total),
        facets: {
          type: { expense: t.expenses, income: t.incomes },
          categories: byCategory.map((c) => ({ id: c.category_id, name: c.name, color: c.color, count: c.count })),
        },
        totals: { expenses: round2(t.expense_total), income: round2(t.income_total) },
      };
    },

    async suggest(userId, q) {
      const { rows } = await pool.query(
        `SELECT term, max(sim) AS sim FROM (
            SELECT description AS term, similarity(description, $2) AS sim FROM search_documents
             WHERE user_id = $1 AND NOT deleted AND (description % $2 OR description ILIKE $3)
            UNION ALL
            SELECT counterparty, similarity(counterparty, $2) FROM search_documents
             WHERE user_id = $1 AND NOT deleted AND counterparty IS NOT NULL AND (counterparty % $2 OR counterparty ILIKE $3)
          ) s GROUP BY term ORDER BY sim DESC, term LIMIT 8`,
        [userId, q, `${escapeLike(q)}%`],
      );
      return { query: q, suggestions: rows.map((r) => r.term) };
    },

    async recent(userId, limit) {
      const { rows } = await pool.query(
        `SELECT * FROM search_documents WHERE user_id = $1 AND NOT deleted ORDER BY occurred_on DESC, indexed_at DESC LIMIT $2`,
        [userId, limit],
      );
      return { data: rows.map(toResult) };
    },

    // ---- projection -------------------------------------------------------
    async index(client, kind, d) {
      const isExpense = kind === 'expense';
      await client.query(
        `INSERT INTO search_documents (id, user_id, kind, amount, currency, amount_base, base_currency, description, counterparty,
                                       notes, tags, category_id, category_name, category_color, occurred_on, origin, version)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         ON CONFLICT (id) DO UPDATE SET amount = EXCLUDED.amount, currency = EXCLUDED.currency, amount_base = EXCLUDED.amount_base,
           description = EXCLUDED.description, counterparty = EXCLUDED.counterparty, notes = EXCLUDED.notes, tags = EXCLUDED.tags,
           category_id = EXCLUDED.category_id, category_name = EXCLUDED.category_name, category_color = EXCLUDED.category_color,
           occurred_on = EXCLUDED.occurred_on, version = EXCLUDED.version, indexed_at = now()
         WHERE search_documents.version <= EXCLUDED.version AND NOT search_documents.deleted`,
        [
          isExpense ? d.expenseId : d.incomeId, d.userId, kind, d.amount, d.currency, d.amountBase, d.baseCurrency, d.description,
          isExpense ? d.merchant : d.payer, d.notes, d.tags ?? [], d.categoryId, d.categoryName, d.categoryColor,
          isExpense ? d.expenseDate : d.incomeDate, d.origin, d.version ?? 1,
        ],
      );
    },

    async remove(client, kind, d) {
      const isExpense = kind === 'expense';
      await client.query(
        `INSERT INTO search_documents (id, user_id, kind, amount, currency, amount_base, base_currency, description, occurred_on, deleted)
         VALUES ($1, $2, $3, 0, $4, 0, $4, '', $5, true)
         ON CONFLICT (id) DO UPDATE SET deleted = true, indexed_at = now()`,
        [isExpense ? d.expenseId : d.incomeId, d.userId, kind, d.baseCurrency ?? 'USD', isExpense ? d.expenseDate : d.incomeDate],
      );
    },

    async onCategoryUpdated(client, { categoryId, name, color }) {
      await client.query('UPDATE search_documents SET category_name = $2, category_color = $3 WHERE category_id = $1', [categoryId, name, color]);
    },

    async onCategoryDeleted(client, { categoryId, fallbackCategory }) {
      await client.query('UPDATE search_documents SET category_id = $2, category_name = $3, category_color = $4 WHERE category_id = $1', [
        categoryId,
        fallbackCategory.id,
        fallbackCategory.name,
        fallbackCategory.color,
      ]);
    },
  };
}
