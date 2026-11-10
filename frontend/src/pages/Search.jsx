import { useQuery } from '@tanstack/react-query';
import { Search as SearchIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { searchApi } from '../api/endpoints.js';
import { Card, CategoryBadge, EmptyState, ErrorState, Input, PageHeader, PageLoader, Pagination, Select } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, formatMoney } from '../lib/format.js';

/** Highlights query terms safely (React escapes text; no innerHTML). */
function Highlight({ text, query }) {
  if (!query || !text) return text ?? null;
  const terms = query.split(/\s+/).filter((t) => t.length > 1).map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  if (!terms.length) return text;
  const parts = text.split(new RegExp(`(${terms.join('|')})`, 'gi'));
  return parts.map((p, i) => (i % 2 ? <mark key={i} className="rounded bg-yellow-200 px-0.5 dark:bg-yellow-500/40 dark:text-white">{p}</mark> : p));
}

export default function Search() {
  const { currency } = useAuth();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const [filters, setFilters] = useState({ type: '', categoryId: '', from: '', to: '', minAmount: '', maxAmount: '', sort: 'relevance', page: 1 });
  const query = params.get('q') ?? '';

  useEffect(() => setQ(query), [query]);
  const { data, isLoading, error, refetch, isFetching } = useQuery({
    queryKey: ['search', query, filters],
    queryFn: () => searchApi.search({ q: query, ...filters, pageSize: 20 }),
    placeholderData: (prev) => prev,
  });
  const set = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, page: 1 }));

  return (
    <div>
      <PageHeader title="Search" description="Full-text search across all expenses and income." />
      <Card>
        <form
          role="search"
          className="flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(q.trim() ? { q: q.trim() } : {});
          }}
        >
          <div className="relative flex-1">
            <SearchIcon className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
            <input className="input pl-9" placeholder='Try "coffee", "rent october" or "-uber"' value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search query" maxLength={200} />
          </div>
          <button className="btn-primary">Search</button>
        </form>
        <div className="mt-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <Select value={filters.type} onChange={set('type')} placeholder="All types" options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} aria-label="Type" />
          <Input type="date" value={filters.from} onChange={set('from')} aria-label="From" />
          <Input type="date" value={filters.to} onChange={set('to')} aria-label="To" />
          <Input type="number" min="0" placeholder="Min amount" value={filters.minAmount} onChange={set('minAmount')} aria-label="Minimum amount" />
          <Input type="number" min="0" placeholder="Max amount" value={filters.maxAmount} onChange={set('maxAmount')} aria-label="Maximum amount" />
          <Select
            value={filters.sort}
            onChange={set('sort')}
            aria-label="Sort"
            options={[
              { value: 'relevance', label: 'Most relevant' },
              { value: 'date_desc', label: 'Newest' },
              { value: 'date_asc', label: 'Oldest' },
              { value: 'amount_desc', label: 'Highest amount' },
              { value: 'amount_asc', label: 'Lowest amount' },
            ]}
          />
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-4">
        <aside className="space-y-4">
          <Card title="Categories">
            {data?.facets?.categories?.length ? (
              <ul className="space-y-1">
                {data.facets.categories.map((c) => (
                  <li key={c.id}>
                    <button
                      className={`flex w-full items-center justify-between rounded-lg px-2 py-1 text-sm hover:bg-slate-100 dark:hover:bg-slate-800 ${filters.categoryId === c.id ? 'bg-brand-50 dark:bg-brand-500/15' : ''}`}
                      onClick={() => setFilters((f) => ({ ...f, categoryId: f.categoryId === c.id ? '' : c.id, page: 1 }))}
                    >
                      <CategoryBadge category={c} />
                      <span className="text-xs text-slate-500">{c.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-slate-500">—</p>
            )}
          </Card>
          {data?.totals && (
            <Card title="Totals">
              <p className="flex justify-between text-sm">
                <span className="text-slate-500">Expenses ({data.facets.type.expense})</span>
                <span className="font-semibold">{formatMoney(data.totals.expenses, currency)}</span>
              </p>
              <p className="mt-1 flex justify-between text-sm">
                <span className="text-slate-500">Income ({data.facets.type.income})</span>
                <span className="font-semibold">{formatMoney(data.totals.income, currency)}</span>
              </p>
            </Card>
          )}
        </aside>
        <Card className="lg:col-span-3" title={query ? `Results for "${query}"` : 'All transactions'} subtitle={data ? `${data.pagination.total} results${isFetching ? ' · updating…' : ''}` : undefined}>
          {isLoading ? (
            <PageLoader />
          ) : error ? (
            <ErrorState message={errorMessage(error)} onRetry={refetch} />
          ) : data.data.length === 0 ? (
            <EmptyState icon={SearchIcon} title="No matches" description="Try different keywords or remove some filters." />
          ) : (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.data.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate font-medium">
                      <Highlight text={t.description} query={query} />
                    </p>
                    <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                      <span>{formatDate(t.date)}</span>
                      {t.counterparty && (
                        <span>
                          <Highlight text={t.counterparty} query={query} />
                        </span>
                      )}
                      <CategoryBadge category={t.category} />
                    </div>
                  </div>
                  <span className={`shrink-0 font-semibold tabular-nums ${t.kind === 'income' ? 'text-green-700 dark:text-green-400' : ''}`}>
                    {t.kind === 'income' ? '+' : '−'}
                    {formatMoney(t.amount, t.currency)}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <Pagination pagination={data?.pagination} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
        </Card>
      </div>
    </div>
  );
}
