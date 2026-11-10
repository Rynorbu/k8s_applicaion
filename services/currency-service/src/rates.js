/** Pure exchange-rate math. `rates` maps currency -> units per 1 USD. */
export function crossRate(rates, from, to) {
  if (from === to) return 1;
  const fromRate = rates[from];
  const toRate = rates[to];
  if (!fromRate || !toRate) return null;
  return toRate / fromRate;
}

export function convertAmount(rates, { from, to, amount, decimals = 2 }) {
  const rate = crossRate(rates, from, to);
  if (rate === null) return null;
  const factor = 10 ** Math.max(decimals, 2);
  return { rate: Number(rate.toFixed(10)), converted: Math.round(amount * rate * factor) / factor };
}

/** Re-bases a USD-relative rate table onto another base currency. */
export function rebase(rates, base) {
  const baseRate = rates[base];
  if (!baseRate) return null;
  return Object.fromEntries(Object.entries(rates).map(([code, rate]) => [code, Number((rate / baseRate).toFixed(10))]));
}

/** Parses a Frankfurter/ECB response ({ base, date, rates }) into USD-relative rates. */
export function parseProviderResponse(body) {
  if (!body || typeof body.rates !== 'object' || !/^\d{4}-\d{2}-\d{2}$/.test(body.date ?? '')) {
    throw new Error('Unexpected provider response');
  }
  const base = String(body.base ?? 'USD').toUpperCase();
  const rates = { [base]: 1 };
  for (const [code, value] of Object.entries(body.rates)) {
    const n = Number(value);
    if (/^[A-Z]{3}$/.test(code) && Number.isFinite(n) && n > 0) rates[code] = n;
  }
  const usd = rates.USD;
  if (!usd) throw new Error('Provider response does not include USD');
  return { asOf: body.date, rates: rebase(rates, 'USD') };
}
