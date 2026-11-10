import { BadRequest, Events, NotFound, cached, enqueueEvent, getLogger, withTransaction } from '@spendwise/common';
import { convertAmount, parseProviderResponse, rebase } from './rates.js';

const CACHE_KEY = 'currency:latest:v1';
const REFRESH_LOCK = 727_202;

export function createCurrencyService({ pool, redis, config }) {
  const log = getLogger();

  async function loadRates(date) {
    // Latest known rate per currency as of `date` (or today).
    const { rows } = await pool.query(
      `SELECT DISTINCT ON (r.quote) r.quote, r.rate, r.as_of
         FROM exchange_rates r JOIN currencies c ON c.code = r.quote AND c.active
        WHERE ($1::date IS NULL OR r.as_of <= $1::date)
        ORDER BY r.quote, r.as_of DESC`,
      [date ?? null],
    );
    if (rows.length === 0 && date) return loadRates(null);
    const rates = Object.fromEntries(rows.map((r) => [r.quote.trim(), r.rate]));
    const asOf = rows.reduce((max, r) => (r.as_of > max ? r.as_of : max), '0000-00-00');
    return { rates, asOf };
  }

  const latest = () => cached(redis, CACHE_KEY, 3600, () => loadRates(null));
  const ratesFor = (date) => (date ? loadRates(date) : latest());

  async function currencyMeta(code) {
    const { rows } = await pool.query('SELECT * FROM currencies WHERE code = $1 AND active', [code]);
    if (!rows[0]) throw NotFound(`Unsupported currency ${code}`);
    return { code: rows[0].code.trim(), name: rows[0].name, symbol: rows[0].symbol, decimals: rows[0].decimals };
  }

  return {
    async list() {
      const [{ rows }, { rates, asOf }] = await Promise.all([
        pool.query('SELECT * FROM currencies WHERE active ORDER BY code'),
        latest(),
      ]);
      return {
        asOf,
        data: rows.map((r) => ({ code: r.code.trim(), name: r.name, symbol: r.symbol, decimals: r.decimals, usdRate: rates[r.code.trim()] ?? null })),
      };
    },

    get: currencyMeta,

    async rates(base = 'USD', date) {
      await currencyMeta(base);
      const { rates, asOf } = await ratesFor(date);
      return { base, asOf, rates: rebase(rates, base) };
    },

    async convert({ from, to, amount, date }) {
      const [, target] = await Promise.all([currencyMeta(from), currencyMeta(to)]);
      const { rates, asOf } = await ratesFor(date);
      const result = convertAmount(rates, { from, to, amount, decimals: target.decimals });
      if (!result) throw BadRequest(`No exchange rate available for ${from}/${to}`);
      return { from, to, amount, converted: result.converted, rate: result.rate, asOf };
    },

    /** Fetches fresh ECB rates. Guarded by an advisory lock so only one replica refreshes. */
    async refresh() {
      return withTransaction(pool, async (client) => {
        const { rows: lock } = await client.query('SELECT pg_try_advisory_xact_lock($1) AS ok', [REFRESH_LOCK]);
        if (!lock[0].ok) return { skipped: true };
        const res = await fetch(config.RATES_PROVIDER_URL, { signal: AbortSignal.timeout(10_000) });
        if (!res.ok) throw new Error(`Rate provider responded ${res.status}`);
        const { asOf, rates } = parseProviderResponse(await res.json());
        const { rows: known } = await client.query('SELECT code FROM currencies');
        const supported = new Set(known.map((r) => r.code.trim()));
        let count = 0;
        for (const [quote, rate] of Object.entries(rates)) {
          if (!supported.has(quote)) continue;
          await client.query(
            `INSERT INTO exchange_rates (quote, as_of, rate, source) VALUES ($1, $2, $3, 'ecb')
             ON CONFLICT (quote, as_of) DO UPDATE SET rate = EXCLUDED.rate, source = EXCLUDED.source, updated_at = now()`,
            [quote, asOf, rate],
          );
          count += 1;
        }
        await enqueueEvent(client, Events.ExchangeRatesUpdated, { asOf, source: 'ecb', count });
        await redis?.del(CACHE_KEY).catch(() => {});
        log.info({ asOf, count }, 'exchange rates refreshed');
        return { asOf, count };
      });
    },
  };
}
