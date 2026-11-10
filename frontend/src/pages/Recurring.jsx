import { useQuery } from '@tanstack/react-query';
import { Pause, Play, Plus, Repeat, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../api/client.js';
import { recurringApi } from '../api/endpoints.js';
import { Badge, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, Select, Spinner, Tabs } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useAppMutation, useCategories, useCurrencies } from '../hooks/useData.js';
import { formatDate, formatMoney, todayIso } from '../lib/format.js';

const INVALIDATE = ['recurring', 'dashboard', 'expenses', 'incomes'];
const FREQUENCIES = [
  ['daily', 'Daily'],
  ['weekly', 'Weekly'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Monthly'],
  ['quarterly', 'Quarterly'],
  ['yearly', 'Yearly'],
];

function RecurringForm({ onClose }) {
  const { currency } = useAuth();
  const [form, setForm] = useState({ type: 'expense', description: '', amount: '', currency, categoryId: '', merchant: '', frequency: 'monthly', intervalCount: 1, startDate: todayIso(), endDate: '' });
  const { data: categories = [] } = useCategories(form.type);
  const { data: currencies = [] } = useCurrencies();
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useAppMutation(recurringApi.create, { success: 'Recurring transaction scheduled', invalidate: INVALIDATE, onSuccess: onClose });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          ...form,
          amount: Number(form.amount),
          intervalCount: Number(form.intervalCount),
          categoryId: form.categoryId || undefined,
          merchant: form.merchant || undefined,
          endDate: form.endDate || undefined,
        });
      }}
    >
      <Tabs tabs={[{ value: 'expense', label: 'Expense' }, { value: 'income', label: 'Income' }]} value={form.type} onChange={(type) => setForm((f) => ({ ...f, type, categoryId: '' }))} />
      <Input label="Description" required maxLength={255} placeholder="e.g. Rent, Netflix, Salary" value={form.description} onChange={set('description')} />
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Input label="Amount" type="number" min="0.01" step="0.01" required value={form.amount} onChange={set('amount')} />
        </div>
        <Select label="Currency" value={form.currency} onChange={set('currency')} options={(currencies.length ? currencies : [{ code: currency }]).map((c) => ({ value: c.code, label: c.code }))} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Category" value={form.categoryId} onChange={set('categoryId')} placeholder="Auto-categorize" options={categories.map((c) => ({ value: c.id, label: c.name }))} />
        <Input label={form.type === 'expense' ? 'Merchant' : 'Payer'} maxLength={120} value={form.merchant} onChange={set('merchant')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Select label="Frequency" value={form.frequency} onChange={set('frequency')} options={FREQUENCIES.map(([value, label]) => ({ value, label }))} />
        <Input label="Repeat every (intervals)" type="number" min="1" max="12" value={form.intervalCount} onChange={set('intervalCount')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Start date" type="date" required value={form.startDate} onChange={set('startDate')} />
        <Input label="End date (optional)" type="date" min={form.startDate} value={form.endDate} onChange={set('endDate')} />
      </div>
      <p className="text-xs text-slate-500">Transactions are generated automatically on each due date. Past start dates are back-filled.</p>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="h-4 w-4 text-white" />} Schedule
        </button>
      </div>
    </form>
  );
}

export default function Recurring() {
  const { currency } = useAuth();
  const [creating, setCreating] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const rules = useQuery({ queryKey: ['recurring', 'list'], queryFn: () => recurringApi.list() });
  const upcoming = useQuery({ queryKey: ['recurring', 'upcoming'], queryFn: () => recurringApi.upcoming(30) });
  const pause = useAppMutation(recurringApi.pause, { success: 'Paused', invalidate: INVALIDATE });
  const resume = useAppMutation(recurringApi.resume, { success: 'Resumed', invalidate: INVALIDATE });
  const remove = useAppMutation(recurringApi.remove, { success: 'Deleted', invalidate: INVALIDATE, onSuccess: () => setDeleting(null) });

  if (rules.isLoading) return <PageLoader />;
  if (rules.error) return <ErrorState message={errorMessage(rules.error)} onRetry={rules.refetch} />;

  return (
    <div>
      <PageHeader
        title="Recurring transactions"
        description="Subscriptions, rent, salary — generated automatically."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New recurring
          </button>
        }
      />
      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-3 xl:col-span-2">
          {rules.data.data.length === 0 ? (
            <EmptyState icon={Repeat} title="Nothing scheduled" description="Automate fixed bills and income so you never have to enter them again." action={<button className="btn-primary" onClick={() => setCreating(true)}>Schedule one</button>} />
          ) : (
            rules.data.data.map((r) => (
              <Card key={r.id}>
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="font-semibold">{r.description}</h3>
                      <Badge color={r.type === 'income' ? 'green' : 'gray'}>{r.type}</Badge>
                      <Badge color={r.status === 'active' ? 'blue' : r.status === 'paused' ? 'amber' : 'gray'}>{r.status}</Badge>
                    </div>
                    <p className="mt-1 text-sm text-slate-500">
                      {r.schedule} · {r.category?.name ?? 'Auto-categorized'} · {r.occurrencesGenerated} generated
                      {r.nextRunDate && ` · next ${formatDate(r.nextRunDate)}`}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-lg font-bold tabular-nums">{formatMoney(r.amount, r.currency ?? currency)}</span>
                    {r.status === 'active' && (
                      <button className="btn-ghost px-2" onClick={() => pause.mutate(r.id)} aria-label="Pause">
                        <Pause className="h-4 w-4" />
                      </button>
                    )}
                    {r.status === 'paused' && (
                      <button className="btn-ghost px-2" onClick={() => resume.mutate(r.id)} aria-label="Resume">
                        <Play className="h-4 w-4" />
                      </button>
                    )}
                    <button className="btn-ghost px-2 text-red-600" onClick={() => setDeleting(r)} aria-label="Delete">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              </Card>
            ))
          )}
        </div>
        <Card title="Next 30 days" subtitle={upcoming.data ? `${formatMoney(upcoming.data.totals.expense, currency)} out · ${formatMoney(upcoming.data.totals.income, currency)} in` : undefined}>
          {upcoming.data?.data?.length ? (
            <ul className="divide-y divide-slate-100 dark:divide-slate-800">
              {upcoming.data.data.slice(0, 15).map((u) => (
                <li key={`${u.recurringId}-${u.date}`} className="flex justify-between py-2 text-sm">
                  <span>
                    <span className="block font-medium">{u.description}</span>
                    <span className="text-xs text-slate-500">{formatDate(u.date)}</span>
                  </span>
                  <span className={u.type === 'income' ? 'font-semibold text-green-700 dark:text-green-400' : 'font-semibold'}>
                    {u.type === 'income' ? '+' : '−'}
                    {formatMoney(u.amount, u.currency ?? currency)}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-slate-500">Nothing due in the next 30 days.</p>
          )}
        </Card>
      </div>
      <Modal open={creating} onClose={() => setCreating(false)} title="New recurring transaction">
        {creating && <RecurringForm onClose={() => setCreating(false)} />}
      </Modal>
      <ConfirmDialog open={Boolean(deleting)} title="Delete recurring transaction?" message="Already generated transactions are kept." loading={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </div>
  );
}
