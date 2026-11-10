import { Conflict, Events, Forbidden, NotFound, UnprocessableEntity, enqueueEvent, withTransaction } from '@spendwise/common';
import { FALLBACK_CATEGORY_IDS, confidenceOf, suggestCategory } from './suggest.js';

const MAX_CUSTOM_CATEGORIES = 100;

export const toCategory = (row) => ({
  id: row.id,
  userId: row.user_id,
  type: row.type,
  name: row.name,
  color: row.color,
  icon: row.icon,
  keywords: row.keywords,
  isSystem: row.is_system,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const eventPayload = (c) => ({ categoryId: c.id, userId: c.userId, type: c.type, name: c.name, color: c.color, icon: c.icon });

export function createCategoryService({ pool }) {
  async function visibleCategories(userId, type) {
    const { rows } = await pool.query(
      `SELECT * FROM categories WHERE (user_id IS NULL OR user_id = $1) AND ($2::text IS NULL OR type = $2)
        ORDER BY is_system DESC, type, name`,
      [userId, type ?? null],
    );
    return rows.map(toCategory);
  }

  async function getOwnedOrSystem(userId, id) {
    const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1 AND (user_id IS NULL OR user_id = $2)', [id, userId]);
    if (!rows[0]) throw NotFound('Category not found');
    return toCategory(rows[0]);
  }

  async function getFallback(type) {
    const { rows } = await pool.query('SELECT * FROM categories WHERE id = $1', [FALLBACK_CATEGORY_IDS[type]]);
    return toCategory(rows[0]);
  }

  return {
    list: visibleCategories,
    get: getOwnedOrSystem,

    async create(userId, input) {
      return withTransaction(pool, async (client) => {
        const { rows: countRows } = await client.query('SELECT count(*)::int AS n FROM categories WHERE user_id = $1', [userId]);
        if (countRows[0].n >= MAX_CUSTOM_CATEGORIES) throw UnprocessableEntity(`You can create at most ${MAX_CUSTOM_CATEGORIES} categories`);
        const { rows: clash } = await client.query(
          'SELECT 1 FROM categories WHERE user_id IS NULL AND type = $1 AND lower(name) = lower($2)',
          [input.type, input.name],
        );
        if (clash.length) throw Conflict('A built-in category with this name already exists');
        const { rows } = await client.query(
          `INSERT INTO categories (user_id, type, name, color, icon, keywords) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
          [userId, input.type, input.name, input.color, input.icon, input.keywords],
        );
        const category = toCategory(rows[0]);
        await enqueueEvent(client, Events.CategoryCreated, eventPayload(category));
        return category;
      });
    },

    async update(userId, id, changes) {
      return withTransaction(pool, async (client) => {
        const { rows: existing } = await client.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [id]);
        if (!existing[0] || (existing[0].user_id && existing[0].user_id !== userId)) throw NotFound('Category not found');
        if (!existing[0].user_id) throw Forbidden('Built-in categories cannot be modified');
        const { rows } = await client.query(
          `UPDATE categories SET name = COALESCE($2, name), color = COALESCE($3, color), icon = COALESCE($4, icon),
                  keywords = COALESCE($5, keywords), updated_at = now()
            WHERE id = $1 RETURNING *`,
          [id, changes.name ?? null, changes.color ?? null, changes.icon ?? null, changes.keywords ?? null],
        );
        const category = toCategory(rows[0]);
        await enqueueEvent(client, Events.CategoryUpdated, eventPayload(category));
        return category;
      });
    },

    async remove(userId, id) {
      await withTransaction(pool, async (client) => {
        const { rows } = await client.query('SELECT * FROM categories WHERE id = $1 FOR UPDATE', [id]);
        const row = rows[0];
        if (!row || (row.user_id && row.user_id !== userId)) throw NotFound('Category not found');
        if (!row.user_id) throw Forbidden('Built-in categories cannot be deleted');
        await client.query('DELETE FROM categories WHERE id = $1', [id]);
        const fallback = await getFallback(row.type);
        // Consumers (expense, income, budget, analytics, search...) reassign to the fallback category.
        await enqueueEvent(client, Events.CategoryDeleted, {
          ...eventPayload(toCategory(row)),
          fallbackCategory: { id: fallback.id, name: fallback.name, color: fallback.color, icon: fallback.icon },
        });
      });
    },

    async suggest(userId, input) {
      const categories = await visibleCategories(userId, input.type);
      const { category, score } = suggestCategory(categories, input);
      return { category: category ?? (await getFallback(input.type)), confidence: confidenceOf(score), matched: Boolean(category) };
    },

    /** Resolve by explicit name (imports) or by description keywords; falls back to "Other". */
    async resolve({ userId, type, name, description, merchant }) {
      if (name) {
        const { rows } = await pool.query(
          `SELECT * FROM categories WHERE (user_id IS NULL OR user_id = $1) AND type = $2 AND lower(name) = lower($3)
            ORDER BY is_system ASC LIMIT 1`,
          [userId, type, name],
        );
        if (rows[0]) return toCategory(rows[0]);
      }
      return (await this.suggest(userId, { type, description: description ?? name, merchant })).category;
    },
  };
}
