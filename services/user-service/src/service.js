import { Events, NotFound, enqueueEvent, withTransaction } from '@spendwise/common';

export const toProfile = (row) => ({
  userId: row.user_id,
  email: row.email,
  name: row.name,
  baseCurrency: row.base_currency,
  timezone: row.timezone,
  locale: row.locale,
  dateFormat: row.date_format,
  theme: row.theme,
  monthlyIncomeTarget: row.monthly_income_target,
  bio: row.bio,
  occupation: row.occupation,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const COLUMN_MAP = {
  name: 'name',
  baseCurrency: 'base_currency',
  timezone: 'timezone',
  locale: 'locale',
  dateFormat: 'date_format',
  theme: 'theme',
  monthlyIncomeTarget: 'monthly_income_target',
  bio: 'bio',
  occupation: 'occupation',
};

export function createUserService({ pool, currencyClient }) {
  return {
    /** Consumer: create a profile when an account is registered (idempotent upsert). */
    async createFromRegistration(client, { userId, email, name }) {
      await client.query(
        `INSERT INTO profiles (user_id, email, name) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING`,
        [userId, email, name],
      );
    },

    async get(userId) {
      const { rows } = await pool.query('SELECT * FROM profiles WHERE user_id = $1', [userId]);
      if (!rows[0]) throw NotFound('Profile not found');
      return toProfile(rows[0]);
    },

    async update(userId, changes) {
      if (changes.baseCurrency) {
        // Synchronous validation against the currency service (REST).
        await currencyClient.get(`/internal/currencies/${changes.baseCurrency}`);
      }
      const entries = Object.entries(changes).filter(([k, v]) => v !== undefined && COLUMN_MAP[k]);
      if (entries.length === 0) return this.get(userId);
      const sets = entries.map(([k], i) => `${COLUMN_MAP[k]} = $${i + 2}`);
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          `UPDATE profiles SET ${sets.join(', ')}, updated_at = now() WHERE user_id = $1 RETURNING *`,
          [userId, ...entries.map(([, v]) => v)],
        );
        if (!rows[0]) throw NotFound('Profile not found');
        const profile = toProfile(rows[0]);
        await enqueueEvent(client, Events.UserProfileUpdated, {
          userId,
          name: profile.name,
          email: profile.email,
          baseCurrency: profile.baseCurrency,
          timezone: profile.timezone,
          changedFields: entries.map(([k]) => k),
        });
        return profile;
      });
    },
  };
}
