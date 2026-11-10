import { useQuery } from '@tanstack/react-query';
import { Sparkles, X } from 'lucide-react';
import { useMemo, useState } from 'react';
import { errorMessage } from '../api/client.js';
import { analyticsApi, insightsApi } from '../api/endpoints.js';
import { CategoryDonut, IncomeExpenseBars, SimpleBars, TrendLines } from '../components/charts/index.jsx';
import { Badge, Card, ErrorState, PageHeader, PageLoader, StatCard, Tabs } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useAppMutation } from '../hooks/useData.js';
import { formatMoney, formatPercent, shiftIso, todayIso } from '../lib/format.js';

const RANGES = {
  day: { label: 'Daily', days: 30, granularity: 'day' },
  week: { label: 'Weekly', days: 7 * 12, granularity: 'week' },
  month: { label: 'Monthly', days: 365, granularity: 'month' },
  year: { label: 'Yearly', days: 365 * 5, granularity: 'year' },
};
const SEVERITY_BADGE = { success: 'green', warning: 'amber', danger: 'red', info: 'blue' };

export default function Analytics() {
  const { currency } = useAuth();
  const [range, setRange] = useState('month');
  const [type, setType] = useState('expense');
  const period = useMemo(() => ({ from: shiftIso(todayIso(), -RANGES[range].days + 1), to: todayIso() }), [range]);

  const summary = useQuery({ queryKey: ['analytics', 'summary', period], queryFn: () => analyticsApi.summary(period) });
  const trends = useQuery({ queryKey: ['analytics', 'trends', range, period], queryFn: () => analyticsApi.trends({ granularity: RANGES[range].granularity, ...period }) });
  const categories = useQuery({ queryKey: ['analytics', 'categories', type, period], queryFn: () => analyticsApi.categories({ type, ...period }) });
  const patterns = useQuery({ queryKey: ['analytics', 'patterns', period], queryFn: () => analyticsApi.patterns(period) });
  const ive = useQuery({ queryKey: ['analytics', 'ive'], queryFn: () => analyticsApi.incomeVsExpenses(12) });
  const insights = useQuery({ queryKey: ['insights', 'overview'], queryFn: insightsApi.overview });
  const dismiss = useAppMutation(insightsApi.dismiss, { invalidate: ['insights', 'dashboard'] });

  if (summary.isLoading) return <PageLoader />;
  if (summary.error) return <ErrorState message={errorMessage(summary.error)} onRetry={summary.refetch} />;
  const s = summary.data;
  const TrendChart = range === 'day' || range === 'week' ? TrendLines : IncomeExpenseBars;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Analytics"
        description="Understand your spending patterns over time."
        actions={<Tabs tabs={Object.entries(RANGES).map(([value, r]) => ({ value, label: r.label }))} value={range} onChange={setRange} />}
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Income" value={formatMoney(s.totalIncome, currency)} accent="blue" />
        <StatCard label="Expenses" value={formatMoney(s.totalExpenses, currency)} accent="orange" />
        <StatCard label={`Net savings · ${formatPercent(s.savingsRate)}`} value={formatMoney(s.net, currency, { signed: true })} accent="green" />
        <StatCard label="Average daily spend" value={formatMoney(s.averageDailySpend, currency)} />
      </div>

      <Card title={`${RANGES[range].label} income & expenses`} subtitle={`${period.from} → ${period.to}`}>
        {trends.data ? <TrendChart data={trends.data.data} currency={currency} height={300} /> : <PageLoader />}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card title="By category" action={<Tabs tabs={[{ value: 'expense', label: 'Spending' }, { value: 'income', label: 'Income' }]} value={type} onChange={setType} />}>
          <CategoryDonut data={categories.data?.data ?? []} currency={currency} />
        </Card>
        <Card title="Spending by day of week" subtitle="Average per week">
          <SimpleBars data={patterns.data?.byWeekday ?? []} dataKey="averagePerWeek" labelKey="day" name="Avg per week" currency={currency} />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Income vs expenses" subtitle={ive.data ? `Last 12 months · net ${formatMoney(ive.data.net, currency, { signed: true })}` : 'Last 12 months'}>
          <IncomeExpenseBars data={ive.data?.data ?? []} currency={currency} />
        </Card>
        <Card title="Top merchants">
          {patterns.data?.topMerchants?.length ? (
            <ol className="space-y-2">
              {patterns.data.topMerchants.map((m, i) => (
                <li key={m.name} className="flex justify-between text-sm">
                  <span className="truncate">
                    <span className="mr-2 text-slate-400">{i + 1}.</span>
                    {m.name}
                    <span className="ml-1 text-xs text-slate-500">({m.count})</span>
                  </span>
                  <span className="font-semibold tabular-nums">{formatMoney(m.total, currency)}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="text-sm text-slate-500">Add merchants to your expenses to see this.</p>
          )}
        </Card>
      </div>

      {insights.data && (
        <Card title="AI insights" subtitle={insights.data.narrativeSource === 'claude' ? 'Narrative written by Claude from your computed statistics' : 'Automated analysis'} action={<Sparkles className="h-5 w-5 text-brand-600" aria-hidden />}>
          <div className="grid gap-6 lg:grid-cols-3">
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <div className="flex h-16 w-16 items-center justify-center rounded-full border-4 border-brand-500 text-xl font-bold">{insights.data.healthScore.score}</div>
                <div>
                  <p className="font-semibold">{insights.data.healthScore.label}</p>
                  <p className="text-xs text-slate-500">Financial health score</p>
                </div>
              </div>
              <dl className="space-y-1 text-xs">
                {Object.entries(insights.data.healthScore.components).map(([k, v]) => (
                  <div key={k} className="flex justify-between">
                    <dt className="capitalize text-slate-500">{k}</dt>
                    <dd className="font-semibold">{v}</dd>
                  </div>
                ))}
              </dl>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{insights.data.narrative}</p>
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Forecast & trends</h3>
              <p className="text-sm">
                Projected month-end spending: <strong>{formatMoney(insights.data.forecast.projectedTotal, currency)}</strong>
                {insights.data.forecast.vsAverage !== null && (
                  <span className="text-slate-500"> ({insights.data.forecast.vsAverage > 0 ? '+' : ''}{insights.data.forecast.vsAverage}% vs average)</span>
                )}
              </p>
              {insights.data.trends.map((t) => (
                <p key={t.categoryId} className="text-sm">
                  {t.direction === 'up' ? '▲' : '▼'} <strong>{t.name}</strong> {formatMoney(Math.abs(t.change), currency)} {t.direction === 'up' ? 'more' : 'less'} than last month
                  {t.changePct !== null && <span className="text-slate-500"> ({t.changePct > 0 ? '+' : ''}{t.changePct}%)</span>}
                </p>
              ))}
              {insights.data.trends.length === 0 && <p className="text-sm text-slate-500">No significant category changes.</p>}
            </div>
            <div className="space-y-2">
              <h3 className="text-sm font-semibold">Recommendations & anomalies</h3>
              {[...insights.data.anomalies, ...insights.data.recommendations].map((r) => (
                <div key={r.id} className="relative rounded-lg bg-slate-50 p-3 dark:bg-slate-800/60">
                  <Badge color={SEVERITY_BADGE[r.severity] ?? 'gray'}>{r.title}</Badge>
                  <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{r.message}</p>
                  {r.type === 'anomaly' && (
                    <button className="absolute right-2 top-2 text-slate-400 hover:text-slate-600" onClick={() => dismiss.mutate(r.id)} aria-label="Dismiss">
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </Card>
      )}
    </div>
  );
}
