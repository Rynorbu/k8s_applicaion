import {
  AppError,
  BadRequest,
  Conflict,
  Events,
  NotFound,
  businessEvents,
  enqueueEvent,
  escapeLike,
  paginated,
  round2,
  withTransaction,
} from '@spendwise/common';

export const toExpense = (row) => ({
  id: row.id,
  userId: row.user_id,
  amount: row.amount,
  currency: row.currency.trim(),
  amountBase: row.amount_base,
  baseCurrency: row.base_currency.trim(),
  exchangeRate: row.exchange_rate,
  category: { id: row.category_id, name: row.category_name, color: row.category_color, icon: row.category_icon },
  description: row.description,
  merchant: row.merchant,
  paymentMethod: row.payment_method,
  expenseDate: row.expense_date,
  notes: row.notes,
  tags: row.tags,
  receiptFileId: row.receipt_file_id,
  origin: row.origin,
  recurringId: row.recurring_id,
  importId: row.import_id,
  version: row.version,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

/** Event payload: a full snapshot so consumers never need to call back (event-carried state transfer). */
export const toEventPayload = (e) => ({
  expenseId: e.id,
  userId: e.userId,
  amount: e.amount,
  currency: e.currency,
  amountBase: e.amountBase,
  baseCurrency: e.baseCurrency,
  exchangeRate: e.exchangeRate,
  categoryId: e.category.id,
  categoryName: e.category.name,
  categoryColor: e.category.color,
  description: e.description,
  merchant: e.merchant,
  paymentMethod: e.paymentMethod,
  expenseDate: e.expenseDate,
  tags: e.tags,
  notes: e.notes,
  origin: e.origin,
  recurringId: e.recurringId,
  importId: e.importId,
  receiptFileId: e.receiptFileId,
  version: e.version,
});

const SORTS = {
  date_desc: 'expense_date DESC, created_at DESC',
  date_asc: 'expense_date ASC, created_at ASC',
  amount_desc: 'amount_base DESC, expense_date DESC',
  amount_asc: 'amount_base ASC, expense_date DESC',
};

export function buildListQuery(userId, f) {
  const where = ['user_id = $1', 'deleted_at IS NULL'];
  const params = [userId];
  const add = (sql, value) => {
    params.push(value);
    where.push(sql.replace('?', `$${params.length}`));
  };
  if (f.from) add('expense_date >= ?', f.from);
  if (f.to) add('expense_date <= ?', f.to);
  if (f.categoryId) add('category_id = ?', f.categoryId);
  if (f.minAmount !== undefined) add('amount_base >= ?', f.minAmount);
  if (f.maxAmount !== undefined) add('amount_base <= ?', f.maxAmount);
  if (f.paymentMethod) add('payment_method = ?', f.paymentMethod);
  if (f.origin) add('origin = ?', f.origin);
  if (f.tag) add('? = ANY(tags)', f.tag);
  if (f.q) {
    params.push(`%${escapeLike(f.q)}%`);
    where.push(`(description ILIKE $${params.length} OR merchant ILIKE $${params.length})`);
  }
  return { where: where.join(' AND '), params, orderBy: SORTS[f.sort] ?? SORTS.date_desc };
}

export function createExpenseService({ pool, clients }) {
  const { categories, currency, files } = clients;

  async function baseCurrencyOf(db, userId) {
    const { rows } = await db.query('SELECT base_currency FROM user_settings WHERE user_id = $1', [userId]);
    return rows[0]?.base_currency?.trim() ?? 'USD';
  }

  async function resolveCategory(userId, { categoryId, categoryName, description, merchant }) {
    if (categoryId) {
      try {
        const category = await categories.get(`/internal/categories/${categoryId}`, { query: { userId } });
        if (category.type !== 'expense') throw BadRequest('Category must be an expense category');
        return category;
      } catch (err) {
        if (err instanceof AppError && err.status === 404) throw BadRequest('Unknown category');
        throw err;
      }
    }
    return categories.post('/internal/categories/resolve', {
      userId,
      type: 'expense',
      name: categoryName ?? undefined,
      description: description ?? undefined,
      merchant: merchant ?? undefined,
    });
  }

  async function convert(amount, from, to, date) {
    if (from === to) return { amountBase: round2(amount), rate: 1 };
    const result = await currency.get('/internal/convert', { query: { from, to, amount, date } });
    return { amountBase: round2(result.converted), rate: result.rate };
  }

  async function verifyReceipt(userId, receiptFileId) {
    if (!receiptFileId) return;
    try {
      const file = await files.get(`/internal/files/${receiptFileId}`, { query: { userId } });
      if (file.kind !== 'receipt') throw BadRequest('File is not a receipt');
    } catch (err) {
      if (err instanceof AppError && err.status === 404) throw BadRequest('Unknown receipt');
      throw err;
    }
  }

  /** Performs synchronous lookups (category, FX, receipt) before opening the DB transaction. */
  async function prepare(userId, input, db = pool) {
    const baseCurrency = await baseCurrencyOf(db, userId);
    const currencyCode = input.currency ?? baseCurrency;
    const [category, conversion] = await Promise.all([
      resolveCategory(userId, input),
      convert(input.amount, currencyCode, baseCurrency, input.expenseDate),
      verifyReceipt(userId, input.receiptFileId),
    ]);
    return { category, conversion, baseCurrency, currencyCode };
  }

  async function insert(client, userId, input, prepared, extra = {}) {
    const { category, conversion, baseCurrency, currencyCode } = prepared;
    const { rows } = await client.query(
      `INSERT INTO expenses (user_id, amount, currency, amount_base, base_currency, exchange_rate, category_id, category_name,
                             category_color, category_icon, description, merchant, payment_method, expense_date, notes, tags,
                             receipt_file_id, origin, recurring_id, occurrence_date, import_id, import_row)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22)
       ON CONFLICT DO NOTHING
       RETURNING *`,
      [
        userId, input.amount, currencyCode, conversion.amountBase, baseCurrency, conversion.rate, category.id, category.name,
        category.color, category.icon, input.description, input.merchant ?? null, input.paymentMethod ?? 'card', input.expenseDate,
        input.notes ?? null, input.tags ?? [], input.receiptFileId ?? null, extra.origin ?? 'manual', extra.recurringId ?? null,
        extra.occurrenceDate ?? null, extra.importId ?? null, extra.importRow ?? null,
      ],
    );
    if (!rows[0]) return null; // duplicate recurring occurrence / import row
    const expense = toExpense(rows[0]);
    await enqueueEvent(client, Events.ExpenseCreated, toEventPayload(expense), { userId });
    businessEvents.inc({ name: 'expense_created' });
    return expense;
  }

  async function getRow(db, userId, id, lock = false) {
    const { rows } = await db.query(
      `SELECT * FROM expenses WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL ${lock ? 'FOR UPDATE' : ''}`,
      [id, userId],
    );
    if (!rows[0]) throw NotFound('Expense not found');
    return rows[0];
  }

  return {
    async list(userId, filters) {
      const { where, params, orderBy } = buildListQuery(userId, filters);
      const offset = (filters.page - 1) * filters.pageSize;
      const [{ rows }, { rows: agg }] = await Promise.all([
        pool.query(`SELECT * FROM expenses WHERE ${where} ORDER BY ${orderBy} LIMIT ${filters.pageSize} OFFSET ${offset}`, params),
        pool.query(`SELECT count(*)::int AS total, COALESCE(sum(amount_base), 0) AS sum FROM expenses WHERE ${where}`, params),
      ]);
      return { ...paginated(rows.map(toExpense), filters, agg[0].total), summary: { totalAmountBase: round2(agg[0].sum) } };
    },

    async get(userId, id) {
      return toExpense(await getRow(pool, userId, id));
    },

    async create(userId, input) {
      const prepared = await prepare(userId, input);
      return withTransaction(pool, (client) => insert(client, userId, input, prepared));
    },

    async update(userId, id, changes) {
      const current = toExpense(await getRow(pool, userId, id));
      if (changes.version !== undefined && changes.version !== current.version) {
        throw Conflict('This expense was modified by another request. Reload and try again.');
      }
      const merged = {
        amount: changes.amount ?? current.amount,
        currency: changes.currency ?? current.currency,
        expenseDate: changes.expenseDate ?? current.expenseDate,
        categoryId: changes.categoryId ?? current.category.id,
        description: changes.description ?? current.description,
      };
      const needsFx = changes.amount !== undefined || changes.currency !== undefined || changes.expenseDate !== undefined;
      const [category, conversion] = await Promise.all([
        changes.categoryId ? resolveCategory(userId, { categoryId: changes.categoryId }) : current.category,
        needsFx
          ? convert(merged.amount, merged.currency, current.baseCurrency, merged.expenseDate)
          : { amountBase: current.amountBase, rate: current.exchangeRate },
        changes.receiptFileId ? verifyReceipt(userId, changes.receiptFileId) : undefined,
      ]);
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `UPDATE expenses SET amount = $3, currency = $4, amount_base = $5, exchange_rate = $6, category_id = $7,
                  category_name = $8, category_color = $9, category_icon = $10, description = $11,
                  merchant = $12, payment_method = $13, expense_date = $14, notes = $15, tags = $16, receipt_file_id = $17,
                  version = version + 1, updated_at = now()
            WHERE id = $1 AND user_id = $2 AND deleted_at IS NULL AND version = $18
            RETURNING *`,
          [
            id, userId, merged.amount, merged.currency, conversion.amountBase, conversion.rate, category.id, category.name,
            category.color, category.icon, merged.description,
            changes.merchant !== undefined ? changes.merchant : current.merchant,
            changes.paymentMethod ?? current.paymentMethod, merged.expenseDate,
            changes.notes !== undefined ? changes.notes : current.notes,
            changes.tags ?? current.tags,
            changes.receiptFileId !== undefined ? changes.receiptFileId : current.receiptFileId,
            current.version,
          ],
        );
        if (!rows[0]) throw Conflict('This expense was modified concurrently. Reload and try again.');
        const updated = toExpense(rows[0]);
        await enqueueEvent(client, Events.ExpenseUpdated, { ...toEventPayload(updated), previous: toEventPayload(current) }, { userId });
        return updated;
      });
    },

    async remove(userId, id) {
      await withTransaction(pool, async (client) => {
        const row = await getRow(client, userId, id, true);
        await client.query('UPDATE expenses SET deleted_at = now(), version = version + 1 WHERE id = $1', [id]);
        await enqueueEvent(client, Events.ExpenseDeleted, toEventPayload(toExpense(row)), { userId });
      });
    },

    async listForUser(userId, { from, to, limit }) {
      const { rows } = await pool.query(
        `SELECT * FROM expenses WHERE user_id = $1 AND deleted_at IS NULL
            AND ($2::date IS NULL OR expense_date >= $2) AND ($3::date IS NULL OR expense_date <= $3)
          ORDER BY expense_date DESC, created_at DESC LIMIT $4`,
        [userId, from ?? null, to ?? null, limit],
      );
      return { data: rows.map(toExpense) };
    },

    // ---- event consumers -------------------------------------------------
    async upsertSettings(client, { userId, baseCurrency }) {
      await client.query(
        `INSERT INTO user_settings (user_id, base_currency) VALUES ($1, $2)
         ON CONFLICT (user_id) DO UPDATE SET base_currency = EXCLUDED.base_currency, updated_at = now()`,
        [userId, baseCurrency ?? 'USD'],
      );
    },

    async onCategoryUpdated(client, { categoryId, name, color, icon }) {
      await client.query(
        'UPDATE expenses SET category_name = $2, category_color = $3, category_icon = $4 WHERE category_id = $1',
        [categoryId, name, color, icon],
      );
    },

    async onCategoryDeleted(client, { categoryId, type, fallbackCategory }) {
      if (type !== 'expense') return;
      await client.query(
        `UPDATE expenses SET category_id = $2, category_name = $3, category_color = $4, category_icon = $5, updated_at = now()
          WHERE category_id = $1`,
        [categoryId, fallbackCategory.id, fallbackCategory.name, fallbackCategory.color, fallbackCategory.icon],
      );
    },

    async onRecurringDue(client, data) {
      if (data.type !== 'expense') return;
      const input = {
        amount: data.amount,
        currency: data.currency,
        categoryId: data.categoryId,
        description: data.description,
        merchant: data.merchant,
        paymentMethod: data.paymentMethod ?? 'other',
        expenseDate: data.occurrenceDate,
        notes: data.notes,
        tags: ['recurring'],
      };
      let prepared;
      try {
        prepared = await prepare(data.userId, input, client);
      } catch (err) {
        // Category deleted since the rule was created: fall back to auto-categorization.
        if (!(err instanceof AppError && err.status === 400)) throw err;
        prepared = await prepare(data.userId, { ...input, categoryId: undefined }, client);
      }
      await insert(client, data.userId, input, prepared, {
        origin: 'recurring',
        recurringId: data.recurringId,
        occurrenceDate: data.occurrenceDate,
      });
    },

    async onImportBatch(client, { userId, importId, rows }) {
      const categoryCache = new Map();
      const rateCache = new Map();
      const baseCurrency = await baseCurrencyOf(client, userId);
      for (const row of rows.filter((r) => r.type === 'expense')) {
        const key = (row.category ?? '').toLowerCase();
        let category = categoryCache.get(key);
        if (!category) {
          category = await resolveCategory(userId, { categoryName: row.category, description: row.description, merchant: row.merchant });
          if (row.category) categoryCache.set(key, category);
        }
        const currencyCode = row.currency ?? baseCurrency;
        const rateKey = `${currencyCode}:${row.date}`;
        if (!rateCache.has(rateKey)) rateCache.set(rateKey, (await convert(1, currencyCode, baseCurrency, row.date)).rate);
        const rate = rateCache.get(rateKey);
        const conversion = { amountBase: round2(row.amount * rate), rate };
        await insert(
          client,
          userId,
          { amount: row.amount, currency: currencyCode, description: row.description, merchant: row.merchant, expenseDate: row.date, notes: row.notes, tags: ['imported'], paymentMethod: 'other' },
          { category, conversion, baseCurrency, currencyCode },
          { origin: 'import', importId, importRow: row.rowNumber },
        );
      }
    },
  };
}
