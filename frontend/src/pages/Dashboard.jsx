import { useQuery } from '@tanstack/react-query';
import { ArrowDownRight, ArrowUpRight, CalendarClock, Landmark, PiggyBank, Sparkles, Wallet } from 'lucide-react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { dashboardApi } from '../api/endpoints.js';
import { CategoryDonut, IncomeExpenseBars, SpendingSparkline } from '../components/charts/index.jsx';
import { Badge, Card, CategoryBadge, EmptyState, ErrorState, PageHeader, PageLoader, ProgressBar, StatCard, StatusLabel } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { formatDate, formatMoney, formatPercent } from '../lib/format.js';

const SEVERITY_BADGE = { success: 'green', warning: 'amber', danger: 'red', info: 'blue' };

export default function Dashboard() {
  const { user, currency: profileCurrency } = useAuth();
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['dashboard'], queryFn: dashboardApi.get, refetchInterval: 60_000 });

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;

  const a = data.analytics;
  const currency = a?.currency ?? profileCurrency;
  const month = a?.month;
  const hasData = (a?.month?.incomeCount ?? 0) + (a?.month?.expenseCount ?? 0) > 0 || (a?.totalBalance ?? 0) !== 0;
  const firstName = user?.name?.split(' ')[0] ?? 'there';

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Hi ${firstName} 👋`}
        description={`Here's your financial overview for ${new Date().toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}.`}
        actions={
          <>
            <Link to="/income" className="btn-secondary">
              Add income
            </Link>
            <Link to="/expenses" className="btn-primary">
              Add expense
            </Link>
          </>
        }
      />
      {data.partial && <p className="text-xs text-amber-600">Some widgets are temporarily unavailable ({Object.keys(data.errors).join(', ')}).</p>}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard label="Total balance" value={formatMoney(a?.totalBalance, currency)} icon={Landmark} accent="brand" />
        <StatCard label="Income this month" value={formatMoney(month?.totalIncome, currency)} icon={ArrowUpRight} accent="blue" change={a?.changes?.income} />
        <StatCard label="Expenses this month" value={formatMoney(month?.totalExpenses, currency)} icon={ArrowDownRight} accent="orange" change={a?.changes?.expenses} invertChange />
        <StatCard label={`Savings · ${formatPercent(month?.savingsRate)} rate`} value={formatMoney(month?.net, currency, { signed: true })} icon={PiggyBank} accent="green" />
      </div>

      {!hasData && (
        <EmptyState
          icon={Wallet}
          title="Let's get started"
          description="Add your first income and expense, or import a CSV/Excel statement to see your dashboard come alive."
          action={
            <div className="flex gap-2">
              <Link to="/expenses" className="btn-primary">
                Add expense
              </Link>
              <Link to="/import" className="btn-secondary">
                Import transactions
              </Link>
            </div>
          }
        />
      )}

      <div className="grid gap-6 xl:grid-cols-3">
        <Card className="xl:col-span-2" title="Income vs expenses" subtitle="Last 6 months">
          <IncomeExpenseBars data={a?.monthlyTrend ?? []} currency={currency} />
        </Card>
        <Card title="Spending by category" subtitle="This month">
          <CategoryDonut data={a?.spendingByCategory ?? []} currency={currency} compact />
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card title="Monthly spending" subtitle={`${formatMoney(month?.averageDailySpend, currency)} average per day`}>
          <SpendingSparkline data={a?.dailySpending ?? []} currency={currency} />
          <div className="mt-3 flex justify-between text-sm">
            <span className="text-slate-500">Spent so far</span>
            <span className="font-semibold">{formatMoney(month?.totalExpenses, currency)}</span>
          </div>
          {data.insights?.forecast && (
            <div className="mt-1 flex justify-between text-sm">
              <span className="text-slate-500">Projected month-end</span>
              <span className="font-semibold">{formatMoney(data.insights.forecast.projectedTotal, currency)}</span>
            </div>
          )}
        </Card>

        <Card title="Budget status" action={<Link to="/budgets" className="text-sm font-medium text-brand-600">Manage</Link>}>
          {data.budgets?.budgets?.length ? (
            <ul className="space-y-4">
              {data.budgets.budgets.slice(0, 5).map((b) => (
                <li key={b.id}>
                  <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                    <span className="truncate font-medium">{b.name}</span>
                    <StatusLabel status={b.usage.status} />
                  </div>
                  <ProgressBar value={b.usage.percentage} status={b.usage.status} label={`${b.name} budget usage`} />
                  <p className="mt-1 text-xs text-slate-500">
                    {formatMoney(b.usage.spent, b.currency)} of {formatMoney(b.amount, b.currency)} · {b.usage.percentage}%
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              No budgets yet. <Link to="/budgets" className="font-medium text-brand-600">Create one</Link> to get warnings before you overspend.
            </p>
          )}
        </Card>

        <Card title="Financial goals" action={<Link to="/goals" className="text-sm font-medium text-brand-600">View all</Link>}>
          {data.goals?.goals?.length ? (
            <ul className="space-y-4">
              {data.goals.goals.map((g) => (
                <li key={g.id}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="truncate font-medium">{g.name}</span>
                    <span className="tabular-nums text-slate-500">{g.progress.percentage}%</span>
                  </div>
                  <ProgressBar value={g.progress.percentage} color={g.color} label={`${g.name} progress`} />
                  <p className="mt-1 text-xs text-slate-500">
                    {formatMoney(g.currentAmount, g.currency)} of {formatMoney(g.targetAmount, g.currency)}
                  </p>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">
              No goals yet. <Link to="/goals" className="font-medium text-brand-600">Set a savings goal</Link>.
            </p>
          )}
        </Card>
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Recent transactions"
          action={<Link to="/search" className="text-sm font-medium text-brand-600">View all</Link>}
        >
          {data.recentTransactions?.data?.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {data.recentTransactions.data.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{t.description}</p>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-slate-500">
                      <span>{formatDate(t.date)}</span>
                      <CategoryBadge category={t.category} />
                    </div>
                  </div>
                  <span className={`shrink-0 text-sm font-semibold tabular-nums ${t.kind === 'income' ? 'text-green-700 dark:text-green-400' : 'text-slate-900 dark:text-slate-100'}`}>
                    {t.kind === 'income' ? '+' : '−'}
                    {formatMoney(t.amount, t.currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">No transactions yet.</p>
          )}
        </Card>

        <Card title="AI insights" action={<Sparkles className="h-5 w-5 text-brand-600" aria-hidden />}>
          {data.insights ? (
            <div className="space-y-4">
              <div className="flex items-center gap-3">
                <div className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-brand-500 text-lg font-bold">{data.insights.healthScore.score}</div>
                <div>
                  <p className="text-sm font-semibold">Financial health: {data.insights.healthScore.label}</p>
                  <p className="text-xs text-slate-500">{data.insights.narrativeSource === 'claude' ? 'Summary by Claude' : 'Automated summary'}</p>
                </div>
              </div>
              <p className="text-sm leading-relaxed text-slate-600 dark:text-slate-300">{data.insights.narrative}</p>
              <ul className="space-y-2">
                {[...data.insights.anomalies.slice(0, 2), ...data.insights.recommendations.slice(0, 2)].map((r) => (
                  <li key={r.id} className="rounded-lg bg-slate-50 p-3 text-sm dark:bg-slate-800/60">
                    <Badge color={SEVERITY_BADGE[r.severity] ?? 'gray'}>{r.title}</Badge>
                    <p className="mt-1 text-xs text-slate-600 dark:text-slate-300">{r.message}</p>
                  </li>
                ))}
              </ul>
            </div>
          ) : (
            <p className="text-sm text-slate-500">Insights appear once you have some transactions.</p>
          )}
        </Card>
      </div>

      {data.upcomingBills?.data?.length > 0 && (
        <Card title="Upcoming recurring transactions" subtitle="Next 14 days" action={<CalendarClock className="h-5 w-5 text-slate-400" aria-hidden />}>
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.upcomingBills.data.slice(0, 6).map((b) => (
              <li key={`${b.recurringId}-${b.date}`} className="flex items-center justify-between rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-800">
                <div>
                  <p className="font-medium">{b.description}</p>
                  <p className="text-xs text-slate-500">{formatDate(b.date)}</p>
                </div>
                <span className={b.type === 'income' ? 'font-semibold text-green-700 dark:text-green-400' : 'font-semibold'}>
                  {b.type === 'income' ? '+' : '−'}
                  {formatMoney(b.amount, b.currency ?? currency)}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
