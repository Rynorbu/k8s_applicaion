import { useQuery } from '@tanstack/react-query';
import { Paperclip, Pencil, Plus, Sparkles, Trash2, Wallet } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { downloadFile, errorMessage } from '../api/client.js';
import { categoriesApi, expensesApi, filesApi, incomesApi } from '../api/endpoints.js';
import {
  Badge,
  Card,
  CategoryBadge,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  Input,
  Modal,
  PageHeader,
  PageLoader,
  Pagination,
  Select,
  Spinner,
  Textarea,
} from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAppMutation, useCategories, useCurrencies } from '../hooks/useData.js';
import { formatDate, formatMoney, todayIso } from '../lib/format.js';

const CONFIG = {
  expense: {
    title: 'Expenses',
    description: 'Track where your money goes.',
    api: expensesApi,
    dateKey: 'expenseDate',
    partyKey: 'merchant',
    partyLabel: 'Merchant',
    methodKey: 'paymentMethod',
    methods: [
      ['card', 'Card'],
      ['cash', 'Cash'],
      ['bank_transfer', 'Bank transfer'],
      ['mobile_wallet', 'Mobile wallet'],
      ['other', 'Other'],
    ],
    queryKey: 'expenses',
  },
  income: {
    title: 'Income',
    description: 'Record salaries, freelance work and other earnings.',
    api: incomesApi,
    dateKey: 'incomeDate',
    partyKey: 'payer',
    partyLabel: 'Payer',
    methodKey: 'receivedVia',
    methods: [
      ['bank_transfer', 'Bank transfer'],
      ['cash', 'Cash'],
      ['card', 'Card'],
      ['mobile_wallet', 'Mobile wallet'],
      ['other', 'Other'],
    ],
    queryKey: 'incomes',
  },
};

const INVALIDATE = ['expenses', 'incomes', 'dashboard', 'analytics', 'budgets', 'search', 'notifications', 'insights'];

function TransactionForm({ kind, initial, onClose }) {
  const cfg = CONFIG[kind];
  const toast = useToast();
  const { currency: baseCurrency } = useAuth();
  const { data: categories = [] } = useCategories(kind);
  const { data: currencies = [] } = useCurrencies();
  const [form, setForm] = useState(() => ({
    amount: initial?.amount ?? '',
    currency: initial?.currency ?? baseCurrency,
    categoryId: initial?.category?.id ?? '',
    description: initial?.description ?? '',
    party: initial?.[cfg.partyKey] ?? '',
    method: initial?.[cfg.methodKey] ?? cfg.methods[0][0],
    date: initial?.[cfg.dateKey] ?? todayIso(),
    notes: initial?.notes ?? '',
    tags: (initial?.tags ?? []).join(', '),
    receiptFileId: initial?.receiptFileId ?? null,
  }));
  const [suggested, setSuggested] = useState(null);
  const [uploading, setUploading] = useState(false);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = useAppMutation(
    (body) => (initial ? cfg.api.update(initial.id, body) : cfg.api.create(body)),
    { success: initial ? 'Saved' : `${kind === 'expense' ? 'Expense' : 'Income'} added`, invalidate: INVALIDATE, onSuccess: onClose },
  );

  const suggest = async () => {
    if (form.categoryId || form.description.length < 3) return;
    try {
      const res = await categoriesApi.suggest({ type: kind, description: form.description, merchant: form.party || undefined });
      if (res.matched) setSuggested(res.category);
    } catch {
      // suggestions are best-effort
    }
  };

  const upload = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) return toast.error('Receipts must be 5 MB or smaller');
    setUploading(true);
    try {
      const res = await filesApi.uploadReceipt(file);
      setForm((f) => ({ ...f, receiptFileId: res.id }));
      toast.success('Receipt attached');
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setUploading(false);
    }
  };

  const submit = (e) => {
    e.preventDefault();
    const body = {
      amount: Number(form.amount),
      currency: form.currency,
      categoryId: form.categoryId || suggested?.id || undefined,
      description: form.description,
      [cfg.partyKey]: form.party || (initial ? null : undefined),
      [cfg.methodKey]: form.method,
      [cfg.dateKey]: form.date,
      notes: form.notes || (initial ? null : undefined),
      tags: form.tags.split(',').map((t) => t.trim()).filter(Boolean).slice(0, 10),
      receiptFileId: form.receiptFileId ?? (initial ? null : undefined),
    };
    if (initial) body.version = initial.version;
    save.mutate(body);
  };

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <div className="col-span-2">
          <Input label="Amount" type="number" inputMode="decimal" step="0.01" min="0.01" required value={form.amount} onChange={set('amount')} />
        </div>
        <Select label="Currency" value={form.currency} onChange={set('currency')} options={(currencies.length ? currencies : [{ code: baseCurrency }]).map((c) => ({ value: c.code, label: c.code }))} />
      </div>
      <Input label="Description" required maxLength={255} value={form.description} onChange={set('description')} onBlur={suggest} />
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Select
            label="Category"
            value={form.categoryId}
            onChange={(e) => {
              setSuggested(null);
              set('categoryId')(e);
            }}
            placeholder="Auto-categorize"
            options={categories.map((c) => ({ value: c.id, label: c.name }))}
          />
          {suggested && !form.categoryId && (
            <p className="mt-1 flex items-center gap-1 text-xs text-brand-600">
              <Sparkles className="h-3 w-3" aria-hidden /> Suggested: {suggested.name}
            </p>
          )}
        </div>
        <Input label="Date" type="date" required max="2100-12-31" value={form.date} onChange={set('date')} />
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label={cfg.partyLabel} maxLength={120} value={form.party} onChange={set('party')} />
        <Select label={kind === 'expense' ? 'Payment method' : 'Received via'} value={form.method} onChange={set('method')} options={cfg.methods.map(([value, label]) => ({ value, label }))} />
      </div>
      <Input label="Tags" hint="Comma separated, e.g. work, travel" value={form.tags} onChange={set('tags')} />
      <Textarea label="Notes" maxLength={1000} value={form.notes} onChange={set('notes')} />
      <div className="flex items-center gap-3">
        <label className="btn-secondary cursor-pointer">
          {uploading ? <Spinner className="h-4 w-4" /> : <Paperclip className="h-4 w-4" />}
          {form.receiptFileId ? 'Replace receipt' : 'Attach receipt'}
          <input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="sr-only" onChange={upload} />
        </label>
        {form.receiptFileId && <Badge color="green">Receipt attached</Badge>}
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={save.isPending || uploading}>
          {save.isPending && <Spinner className="h-4 w-4 text-white" />} Save
        </button>
      </div>
    </form>
  );
}

export default function Transactions({ kind }) {
  const cfg = CONFIG[kind];
  const { currency } = useAuth();
  const { data: categories = [] } = useCategories(kind);
  const [filters, setFilters] = useState({ page: 1, pageSize: 20, q: '', categoryId: '', from: '', to: '', sort: 'date_desc' });
  const [debouncedQ, setDebouncedQ] = useState('');
  const [editing, setEditing] = useState(null);
  const [deleting, setDeleting] = useState(null);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(filters.q), 300);
    return () => clearTimeout(t);
  }, [filters.q]);
  useEffect(() => setFilters((f) => ({ ...f, page: 1 })), [kind]);

  const params = useMemo(() => ({ ...filters, q: debouncedQ }), [filters, debouncedQ]);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: [cfg.queryKey, params], queryFn: () => cfg.api.list(params), placeholderData: (prev) => prev });
  const remove = useAppMutation((id) => cfg.api.remove(id), { success: 'Deleted', invalidate: INVALIDATE, onSuccess: () => setDeleting(null) });
  const setFilter = (k) => (e) => setFilters((f) => ({ ...f, [k]: e.target.value, page: 1 }));

  return (
    <div>
      <PageHeader
        title={cfg.title}
        description={cfg.description}
        actions={
          <button className="btn-primary" onClick={() => setEditing({})}>
            <Plus className="h-4 w-4" /> Add {kind}
          </button>
        }
      />
      <Card>
        <div className="mb-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Input placeholder="Search description…" value={filters.q} onChange={setFilter('q')} aria-label="Search" className="lg:col-span-2" />
          <Select value={filters.categoryId} onChange={setFilter('categoryId')} placeholder="All categories" options={categories.map((c) => ({ value: c.id, label: c.name }))} aria-label="Category" />
          <Input type="date" value={filters.from} onChange={setFilter('from')} aria-label="From date" />
          <Input type="date" value={filters.to} onChange={setFilter('to')} aria-label="To date" />
        </div>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-500">
            {data?.pagination?.total ?? 0} {kind === 'expense' ? 'expenses' : 'income records'} · Total{' '}
            <span className="font-semibold text-slate-900 dark:text-slate-100">{formatMoney(data?.summary?.totalAmountBase, currency)}</span>
          </p>
          <Select
            value={filters.sort}
            onChange={setFilter('sort')}
            aria-label="Sort"
            className="w-auto"
            options={[
              { value: 'date_desc', label: 'Newest first' },
              { value: 'date_asc', label: 'Oldest first' },
              { value: 'amount_desc', label: 'Highest amount' },
              { value: 'amount_asc', label: 'Lowest amount' },
            ]}
          />
        </div>

        {isLoading ? (
          <PageLoader />
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        ) : data.data.length === 0 ? (
          <EmptyState
            icon={Wallet}
            title={`No ${kind === 'expense' ? 'expenses' : 'income'} found`}
            description="Add one manually, set up a recurring rule, or import a statement."
            action={
              <button className="btn-primary" onClick={() => setEditing({})}>
                <Plus className="h-4 w-4" /> Add {kind}
              </button>
            }
          />
        ) : (
          <div className="-mx-5 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm">
              <thead className="border-b border-slate-200 text-xs uppercase text-slate-500 dark:border-slate-800">
                <tr>
                  <th className="px-5 py-2">Date</th>
                  <th className="py-2">Description</th>
                  <th className="py-2">Category</th>
                  <th className="py-2 text-right">Amount</th>
                  <th className="px-5 py-2 text-right">
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {data.data.map((t) => (
                  <tr key={t.id} className="hover:bg-slate-50 dark:hover:bg-slate-800/40">
                    <td className="whitespace-nowrap px-5 py-3 text-slate-500">{formatDate(t[cfg.dateKey])}</td>
                    <td className="py-3">
                      <p className="font-medium">{t.description}</p>
                      <div className="mt-0.5 flex flex-wrap items-center gap-1 text-xs text-slate-500">
                        {t[cfg.partyKey] && <span>{t[cfg.partyKey]}</span>}
                        {t.origin !== 'manual' && <Badge color="blue">{t.origin}</Badge>}
                        {t.tags.map((tag) => (
                          <Badge key={tag}>#{tag}</Badge>
                        ))}
                        {t.receiptFileId && (
                          <button className="inline-flex items-center gap-0.5 text-brand-600" onClick={() => downloadFile(`/files/${t.receiptFileId}/download`, 'receipt')}>
                            <Paperclip className="h-3 w-3" /> receipt
                          </button>
                        )}
                      </div>
                    </td>
                    <td className="py-3">
                      <CategoryBadge category={t.category} />
                    </td>
                    <td className="whitespace-nowrap py-3 text-right tabular-nums">
                      <p className={`font-semibold ${kind === 'income' ? 'text-green-700 dark:text-green-400' : ''}`}>{formatMoney(t.amount, t.currency)}</p>
                      {t.currency !== t.baseCurrency && <p className="text-xs text-slate-500">≈ {formatMoney(t.amountBase, t.baseCurrency)}</p>}
                    </td>
                    <td className="whitespace-nowrap px-5 py-3 text-right">
                      <button className="btn-ghost px-2" onClick={() => setEditing(t)} aria-label={`Edit ${t.description}`}>
                        <Pencil className="h-4 w-4" />
                      </button>
                      <button className="btn-ghost px-2 text-red-600" onClick={() => setDeleting(t)} aria-label={`Delete ${t.description}`}>
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <Pagination pagination={data?.pagination} onPage={(page) => setFilters((f) => ({ ...f, page }))} />
      </Card>

      <Modal open={Boolean(editing)} onClose={() => setEditing(null)} title={editing?.id ? `Edit ${kind}` : `Add ${kind}`}>
        {editing && <TransactionForm kind={kind} initial={editing.id ? editing : null} onClose={() => setEditing(null)} />}
      </Modal>
      <ConfirmDialog
        open={Boolean(deleting)}
        title={`Delete ${kind}?`}
        message={`"${deleting?.description}" will be removed and your budgets and analytics will update.`}
        loading={remove.isPending}
        onConfirm={() => remove.mutate(deleting.id)}
        onClose={() => setDeleting(null)}
      />
    </div>
  );
}
