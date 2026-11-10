import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, FileText, Sheet, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { downloadFile, errorMessage } from '../api/client.js';
import { reportsApi } from '../api/endpoints.js';
import { Badge, Card, EmptyState, ErrorState, Input, PageHeader, PageLoader, Pagination, Select, Spinner } from '../components/ui/index.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useAppMutation } from '../hooks/useData.js';
import { formatBytes, monthStartIso, timeAgo, todayIso } from '../lib/format.js';

const FORMAT_ICON = { pdf: FileText, csv: Sheet, xlsx: FileSpreadsheet };
const STATUS_COLOR = { pending: 'gray', processing: 'blue', completed: 'green', failed: 'red' };

export default function Reports() {
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [form, setForm] = useState({ type: 'full', format: 'pdf', from: monthStartIso(), to: todayIso(), title: '' });
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['reports', page],
    queryFn: () => reportsApi.list({ page, pageSize: 10 }),
    // Poll while any job is still running (reports are generated asynchronously).
    refetchInterval: (q) => (q.state.data?.data?.some((r) => r.status === 'pending' || r.status === 'processing') ? 2000 : false),
  });
  const create = useAppMutation((body) => reportsApi.create(body), { success: 'Report requested — it will be ready in a few seconds', invalidate: ['reports'] });
  const remove = useAppMutation(reportsApi.remove, { success: 'Report deleted', invalidate: ['reports'] });

  return (
    <div className="space-y-6">
      <PageHeader title="Reports" description="Export your finances as PDF, CSV or Excel." />
      <Card title="Generate a report">
        <form
          className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6"
          onSubmit={(e) => {
            e.preventDefault();
            create.mutate({ ...form, title: form.title || undefined });
          }}
        >
          <div className="lg:col-span-2">
            <Input label="Title (optional)" maxLength={120} value={form.title} onChange={set('title')} />
          </div>
          <Select label="Contents" value={form.type} onChange={set('type')} options={[{ value: 'full', label: 'Summary + transactions' }, { value: 'summary', label: 'Summary only' }, { value: 'transactions', label: 'Transactions only' }]} />
          <Select label="Format" value={form.format} onChange={set('format')} options={[{ value: 'pdf', label: 'PDF' }, { value: 'xlsx', label: 'Excel (.xlsx)' }, { value: 'csv', label: 'CSV' }]} />
          <Input label="From" type="date" required value={form.from} onChange={set('from')} />
          <Input label="To" type="date" required min={form.from} value={form.to} onChange={set('to')} />
          <div className="sm:col-span-2 lg:col-span-6">
            <button className="btn-primary" disabled={create.isPending}>
              {create.isPending && <Spinner className="h-4 w-4 text-white" />} Generate report
            </button>
          </div>
        </form>
      </Card>

      <Card title="Your reports" subtitle="Reports are kept for 7 days">
        {isLoading ? (
          <PageLoader />
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        ) : data.data.length === 0 ? (
          <EmptyState icon={FileText} title="No reports yet" description="Generate your first report above." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.data.map((r) => {
              const Icon = FORMAT_ICON[r.format];
              return (
                <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Icon className="h-8 w-8 shrink-0 text-brand-600" aria-hidden />
                    <div className="min-w-0">
                      <p className="truncate font-medium">{r.title}</p>
                      <p className="text-xs text-slate-500">
                        {r.from} → {r.to} · {r.format.toUpperCase()} · {timeAgo(r.createdAt)}
                        {r.fileSize ? ` · ${formatBytes(r.fileSize)}` : ''}
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge color={STATUS_COLOR[r.status]}>
                      {(r.status === 'pending' || r.status === 'processing') && <Spinner className="h-3 w-3" />}
                      {r.status}
                    </Badge>
                    {r.status === 'completed' && (
                      <button
                        className="btn-secondary px-3 py-1.5"
                        onClick={() => downloadFile(`/reports/${r.id}/download`, `report.${r.format}`).catch((err) => toast.error(errorMessage(err)))}
                      >
                        <Download className="h-4 w-4" /> Download
                      </button>
                    )}
                    <button className="btn-ghost px-2 text-red-600" onClick={() => remove.mutate(r.id)} aria-label="Delete report">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        <Pagination pagination={data?.pagination} onPage={setPage} />
      </Card>
    </div>
  );
}
