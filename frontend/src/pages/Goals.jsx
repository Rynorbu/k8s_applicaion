import { useQuery } from '@tanstack/react-query';
import { Plus, Target, Trash2, Trophy } from 'lucide-react';
import { useState } from 'react';
import { errorMessage } from '../api/client.js';
import { goalsApi } from '../api/endpoints.js';
import { Badge, Card, ConfirmDialog, EmptyState, ErrorState, Input, Modal, PageHeader, PageLoader, ProgressBar, Select, Spinner, StatCard, Textarea } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useAppMutation } from '../hooks/useData.js';
import { formatDate, formatMoney } from '../lib/format.js';

const INVALIDATE = ['goals', 'dashboard'];
const COLORS = ['#22c55e', '#3b82f6', '#a855f7', '#f97316', '#ec4899', '#14b8a6'];

function GoalForm({ onClose }) {
  const [form, setForm] = useState({ name: '', description: '', targetAmount: '', initialAmount: '', targetDate: '', priority: 'medium', color: COLORS[0] });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const save = useAppMutation(goalsApi.create, { success: 'Goal created', invalidate: INVALIDATE, onSuccess: onClose });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({
          ...form,
          targetAmount: Number(form.targetAmount),
          initialAmount: form.initialAmount ? Number(form.initialAmount) : undefined,
          targetDate: form.targetDate || undefined,
          description: form.description || undefined,
        });
      }}
    >
      <Input label="Goal name" required maxLength={80} placeholder="e.g. Emergency fund" value={form.name} onChange={set('name')} />
      <div className="grid grid-cols-2 gap-3">
        <Input label="Target amount" type="number" min="0.01" step="0.01" required value={form.targetAmount} onChange={set('targetAmount')} />
        <Input label="Already saved" type="number" min="0" step="0.01" value={form.initialAmount} onChange={set('initialAmount')} />
      </div>
      <div className="grid grid-cols-2 gap-3">
        <Input label="Target date" type="date" value={form.targetDate} onChange={set('targetDate')} />
        <Select label="Priority" value={form.priority} onChange={set('priority')} options={['high', 'medium', 'low'].map((p) => ({ value: p, label: p[0].toUpperCase() + p.slice(1) }))} />
      </div>
      <div>
        <span className="label">Color</span>
        <div className="flex gap-2">
          {COLORS.map((c) => (
            <button type="button" key={c} onClick={() => setForm((f) => ({ ...f, color: c }))} className={`h-8 w-8 rounded-full ring-offset-2 ${form.color === c ? 'ring-2 ring-slate-900 dark:ring-white' : ''}`} style={{ backgroundColor: c }} aria-label={`Color ${c}`} />
          ))}
        </div>
      </div>
      <Textarea label="Description" maxLength={500} value={form.description} onChange={set('description')} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="h-4 w-4 text-white" />} Create goal
        </button>
      </div>
    </form>
  );
}

function ContributeForm({ goal, onClose }) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('add');
  const [note, setNote] = useState('');
  const save = useAppMutation((body) => goalsApi.contribute(goal.id, body), { success: mode === 'add' ? 'Contribution added' : 'Withdrawal recorded', invalidate: INVALIDATE, onSuccess: onClose });
  return (
    <form
      className="space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate({ amount: (mode === 'add' ? 1 : -1) * Number(amount), note: note || undefined });
      }}
    >
      <Select label="Type" value={mode} onChange={(e) => setMode(e.target.value)} options={[{ value: 'add', label: 'Add money' }, { value: 'withdraw', label: 'Withdraw' }]} />
      <Input label="Amount" type="number" min="0.01" step="0.01" required value={amount} onChange={(e) => setAmount(e.target.value)} />
      <Input label="Note" maxLength={255} value={note} onChange={(e) => setNote(e.target.value)} />
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={onClose}>
          Cancel
        </button>
        <button className="btn-primary" disabled={save.isPending}>
          {save.isPending && <Spinner className="h-4 w-4 text-white" />} Save
        </button>
      </div>
    </form>
  );
}

export default function Goals() {
  const { currency } = useAuth();
  const [creating, setCreating] = useState(false);
  const [contributing, setContributing] = useState(null);
  const [deleting, setDeleting] = useState(null);
  const { data, isLoading, error, refetch } = useQuery({ queryKey: ['goals', 'list'], queryFn: () => goalsApi.list() });
  const remove = useAppMutation(goalsApi.remove, { success: 'Goal deleted', invalidate: INVALIDATE, onSuccess: () => setDeleting(null) });

  if (isLoading) return <PageLoader />;
  if (error) return <ErrorState message={errorMessage(error)} onRetry={refetch} />;
  const active = data.data.filter((g) => g.status === 'active');
  const saved = active.reduce((s, g) => s + g.currentAmount, 0);
  const target = active.reduce((s, g) => s + g.targetAmount, 0);

  return (
    <div>
      <PageHeader
        title="Financial goals"
        description="Save with purpose and track every milestone."
        actions={
          <button className="btn-primary" onClick={() => setCreating(true)}>
            <Plus className="h-4 w-4" /> New goal
          </button>
        }
      />
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <StatCard label="Active goals" value={active.length} icon={Target} />
        <StatCard label="Total saved" value={formatMoney(saved, currency)} accent="green" />
        <StatCard label="Overall progress" value={`${target ? ((saved / target) * 100).toFixed(1) : 0}%`} accent="blue" />
      </div>
      {data.data.length === 0 ? (
        <EmptyState icon={Target} title="No goals yet" description="Create a savings goal like an emergency fund, a trip or a new laptop." action={<button className="btn-primary" onClick={() => setCreating(true)}>Create goal</button>} />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {data.data.map((g) => (
            <Card key={g.id}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h3 className="flex items-center gap-2 font-semibold">
                    {g.status === 'completed' && <Trophy className="h-4 w-4 text-amber-500" aria-label="Completed" />}
                    {g.name}
                  </h3>
                  <div className="mt-1 flex gap-1">
                    <Badge color={g.priority === 'high' ? 'red' : g.priority === 'medium' ? 'amber' : 'gray'}>{g.priority}</Badge>
                    <Badge color={g.status === 'completed' ? 'green' : g.status === 'active' ? 'blue' : 'gray'}>{g.status}</Badge>
                  </div>
                </div>
                <button className="btn-ghost px-2 text-red-600" onClick={() => setDeleting(g)} aria-label={`Delete ${g.name}`}>
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
              <div className="mt-4 flex items-end justify-between">
                <span className="text-2xl font-bold tabular-nums">{formatMoney(g.currentAmount, g.currency)}</span>
                <span className="text-sm text-slate-500">of {formatMoney(g.targetAmount, g.currency)}</span>
              </div>
              <div className="mt-2">
                <ProgressBar value={g.progress.percentage} color={g.color} label={`${g.name} progress`} />
              </div>
              <div className="mt-1 flex justify-between text-xs text-slate-500">
                <span>{g.progress.percentage}%</span>
                {[25, 50, 75, 100].map((m) => (
                  <span key={m} className={g.progress.percentage >= m ? 'font-semibold text-green-700 dark:text-green-400' : ''}>
                    {g.progress.percentage >= m ? '✓' : '○'} {m}%
                  </span>
                ))}
              </div>
              <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs dark:border-slate-800">
                {g.targetDate && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Target date</dt>
                    <dd>{formatDate(g.targetDate)}</dd>
                  </div>
                )}
                {g.progress.requiredMonthly !== null && g.status === 'active' && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Needed per month</dt>
                    <dd className="font-semibold">{formatMoney(g.progress.requiredMonthly, g.currency)}</dd>
                  </div>
                )}
                {g.progress.onTrack !== null && g.status === 'active' && (
                  <div className="flex justify-between">
                    <dt className="text-slate-500">Status</dt>
                    <dd className={g.progress.onTrack ? 'font-semibold text-green-700 dark:text-green-400' : 'font-semibold text-amber-700 dark:text-amber-400'}>
                      {g.progress.onTrack ? 'On track' : 'Behind schedule'}
                    </dd>
                  </div>
                )}
              </dl>
              {g.status !== 'cancelled' && (
                <button className="btn-secondary mt-4 w-full" onClick={() => setContributing(g)}>
                  Add contribution
                </button>
              )}
            </Card>
          ))}
        </div>
      )}
      <Modal open={creating} onClose={() => setCreating(false)} title="New savings goal">
        {creating && <GoalForm onClose={() => setCreating(false)} />}
      </Modal>
      <Modal open={Boolean(contributing)} onClose={() => setContributing(null)} title={`Contribute to ${contributing?.name ?? ''}`} size="sm">
        {contributing && <ContributeForm goal={contributing} onClose={() => setContributing(null)} />}
      </Modal>
      <ConfirmDialog open={Boolean(deleting)} title="Delete goal?" message={`"${deleting?.name}" and its contribution history will be removed.`} loading={remove.isPending} onConfirm={() => remove.mutate(deleting.id)} onClose={() => setDeleting(null)} />
    </div>
  );
}
