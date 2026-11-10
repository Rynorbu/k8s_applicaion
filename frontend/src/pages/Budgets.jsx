import { useQuery } from '@tanstack/react-query';
import { PiggyBank, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../api/client.js';
import { budgetsApi } from '../api/endpoints.js';
import { Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, ProgressBar, Select, Spinner, StatCard, StatusLabel } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useAppMutation, useCategories } from '../hooks/useData.js';
import { formatMoney } from '../lib/format.js';

const INVALIDATE = ['budgets', 'dashboard'];

function BudgetForm({ onClose }) {
  const { data: categories = [] } = useCategories('expense');
  const [form, setForm] = useState({ name: '', categoryId: '', amount: '', period: 'monthly', alertThreshold: 80 });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useAppMutation(budgetsApi.create, { success: 'Budget created', invalidate: INVALIDATE, onSuccess: onClose });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ ...form, amount: Number(form.amount), alertThreshold: Number(form.alertThreshold), categoryId: form.categoryId || undefined });
      }}
    >
      <Input label="Name" required maxLength={80} placeholder="e.g. Dining out" value={form.name} onChange={set('name')} />
      <Select
        label="Category"
        value={form.categoryId}
        onChange={(e) => {
          const cat = categories.find((c) => c.id === e.target.value);
          setForm((f) => ({ ...f, categoryId: e.target.value, name: f.name || cat?.name || '' }));
        }}
        placeholder="All spending (overall budget)"
        options={categories.map((c) => ({ value: c.id, label: c.name }))}
      />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Limit" type="number" min="0.01" step="0.01" required value={form.amount} onChange={set('amount')} />
        <Select label="Period" value={form.period} onChange={set('period')} options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'yearly', label: 'Yearly' }]} />
      </div>
      <div>
        <label className="label" htmlFor="threshold">
          Warn me at {form.alertThreshold}% of the limit
        </label>
        <input id="threshold" type="range" min="50" max="100" step="5" value={form.alertThreshold} onChange={set('alertThreshold')} className="w-full accent-brand-600" />
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="h-4 w-4 text-white" />} Create budget
        </button>
      </div>
    </form>
  );
}

export default function Budgets() {
  const { currency } = useAuth();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['budgets', 'summary'], queryFn: budgetsApi.summary });
  const remove = useAppMutation(budgetsApi.remove, { success: 'Budget deleted', invalidate: INVALIDATE, onSuccess: () => setDeleting(null) });

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  const totalBudgeted = data.budgets.reduce((s, b) => s + b.amount, 0);
  const totalSpent = data.budgets.reduce((s, b) => s + b.usage.spent, 0);

  return (
    <div>
      <PageHeader
        title="Budgets"
        description="Set limits and get warned before you overspend."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New budget
          </button>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Active budgets" value={data.totalBudgets} />
        <StatCard label="On track" value={data.onTrack} accent="green" />
        <StatCard label="Warnings" value={data.warning} accent="orange" />
        <StatCard label="Exceeded" value={data.exceeded} accent="orange" />
      </div>
      {data.budgets.length === 0 ? (
        <EmptyState icon={PiggyBank} title="No budgets yet" description="Create an overall monthly budget or one per category." action={<button className="btn-primary" onClick={() => setCreating(true)}>Create budget</button>} />
      ) : (
        <>
          <p className="mb-3 text-sm text-slate-500">
            {formatMoney(totalSpent, currency)} spent of {formatMoney(totalBudgeted, currency)} budgeted across all budgets this period.
          </p>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {data.budgets.map((b) => (
              <Card key={b.id}>
                <div className="mb-3 flex items-start justify-between gap-2">
                  <div>
                    <h3 className="font-semibold">{b.name}</h3>
                    <p className="text-xs capitalize text-slate-500">
                      {b.period} · {b.category?.name ?? 'All spending'}
                    </p>
                  </div>
                  <button className="btn-ghost px-2 text-red-600" onClick={() => setDeleting(b)} aria-label={`Delete ${b.name}`}>
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
                <div className="mb-1 flex items-end justify-between">
                  <span className="text-2xl font-bold tabular-nums">{formatMoney(b.usage.spent, b.currency)}</span>
                  <span className="text-sm text-slate-500">of {formatMoney(b.amount, b.currency)}</span>
                </div>
                <ProgressBar value={b.usage.percentage} status={b.usage.status} label={`${b.name} usage`} />
                <div className="mt-2 flex items-center justify-between text-xs">
                  <StatusLabel status={b.usage.status} />
                  <span className="tabular-nums text-slate-500">{b.usage.percentage}% used</span>
                </div>
                <dl className="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                  <div>
                    <dt className="text-slate-500">Remaining</dt>
                    <dd className={`font-semibold ${b.usage.remaining < 0 ? 'text-red-600' : ''}`}>{formatMoney(b.usage.remaining, b.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Safe daily spend</dt>
                    <dd className="font-semibold">{formatMoney(b.usage.dailyAllowance, b.currency)}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Days left</dt>
                    <dd className="font-semibold">{b.usage.daysLeft}</dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Projected</dt>
                    <dd className={`font-semibold ${b.usage.projectedToExceed ? 'text-red-600' : ''}`}>{formatMoney(b.usage.projectedSpend, b.currency)}</dd>
                  </div>
                </dl>
              </Card>
            ))}
          </div>
        </>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New budget">
        {creating && <BudgetForm onClose={() => setCreating(false)} />}
      </Modal>
      <ConfirmDialog open={Boolean(deleting)} title="Delete budget?" message={`"${deleting?.name}" will be removed.`} loading={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </div>
  );
}
