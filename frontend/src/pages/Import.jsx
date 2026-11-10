import { useQuery } from '@tanstack/react-query';
import { Download, FileSpreadsheet, Upload } from 'lucide-react';
import { useRef, useState } from 'react';
import { downloadFile, errorMessage } from '../api/client.js';
import { filesApi } from '../api/endpoints.js';
import { Badge, Card, EmptyState, PageHeader, Select, Spinner } from '../components/ui/index.jsx';
import { useAppMutation } from '../hooks/useData.js';
import { formatBytes, timeAgo } from '../lib/format.js';

export default function Import() {
  const inputRef = useRef(null);
  const [file, setFile] = useState(null);
  const [options, setOptions] = useState({ defaultType: 'expense', dateFormat: 'YYYY-MM-DD' });
  const [result, setResult] = useState(null);
  const [dragging, setDragging] = useState(false);
  const history = useQuery({ queryKey: ['imports'], queryFn: () => filesApi.imports({ pageSize: 10 }) });
  const upload = useAppMutation(() => filesApi.importTransactions(file, options), {
    success: (r) => `Imported ${r.validRows} rows`,
    invalidate: ['imports', 'expenses', 'incomes', 'dashboard', 'analytics', 'search', 'budgets'],
    onSuccess: (r) => {
      setResult(r);
      setFile(null);
    },
  });

  const pick = (f) => {
    setResult(null);
    if (f && f.size > 5 * 1024 * 1024) return;
    setFile(f ?? null);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Import transactions"
        description="Bring in bank statements or spreadsheets (CSV or Excel)."
        actions={
          <button className="btn-secondary" onClick={() => downloadFile('/files/imports/template', 'spendwise-import-template.csv')}>
            <Download className="h-4 w-4" /> Download template
          </button>
        }
      />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2" title="Upload file">
          <div
            className={`flex flex-col items-center justify-center rounded-xl border-2 border-dashed p-10 text-center transition ${dragging ? 'border-brand-500 bg-brand-50 dark:bg-brand-500/10' : 'border-slate-300 dark:border-slate-700'}`}
            onDragOver={(e) => {
              e.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => {
              e.preventDefault();
              setDragging(false);
              pick(e.dataTransfer.files?.[0]);
            }}
          >
            <FileSpreadsheet className="h-10 w-10 text-slate-400" aria-hidden />
            {file ? (
              <p className="mt-3 font-medium">
                {file.name} <span className="text-sm text-slate-500">({formatBytes(file.size)})</span>
              </p>
            ) : (
              <p className="mt-3 text-sm text-slate-500">Drag & drop a .csv or .xlsx file here (max 5 MB, 5,000 rows)</p>
            )}
            <button className="btn-secondary mt-4" onClick={() => inputRef.current?.click()}>
              Choose file
            </button>
            <input ref={inputRef} type="file" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only" onChange={(e) => pick(e.target.files?.[0])} />
          </div>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            <Select label="Rows without a type are" value={options.defaultType} onChange={(e) => setOptions({ ...options, defaultType: e.target.value })} options={[{ value: 'expense', label: 'Expenses' }, { value: 'income', label: 'Income' }]} />
            <Select
              label="Date format"
              value={options.dateFormat}
              onChange={(e) => setOptions({ ...options, dateFormat: e.target.value })}
              options={['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'].map((v) => ({ value: v, label: v }))}
            />
          </div>
          <button className="btn-primary mt-4" disabled={!file || upload.isPending} onClick={() => upload.mutate()}>
            {upload.isPending ? <Spinner className="h-4 w-4 text-white" /> : <Upload className="h-4 w-4" />} Import
          </button>
          {upload.error && <p className="mt-3 text-sm text-red-600">{errorMessage(upload.error)}</p>}

          {result && (
            <div className="mt-6 rounded-xl border border-slate-200 p-4 dark:border-slate-800">
              <p className="font-semibold">Import summary</p>
              <div className="mt-2 flex flex-wrap gap-2 text-sm">
                <Badge color="green">{result.validRows} imported</Badge>
                <Badge color="blue">{result.expenseRows} expenses</Badge>
                <Badge color="blue">{result.incomeRows} income</Badge>
                {result.failedRows > 0 && <Badge color="red">{result.failedRows} skipped</Badge>}
              </div>
              {result.errors.length > 0 && (
                <ul className="mt-3 max-h-48 overflow-auto text-xs text-red-700 dark:text-red-400">
                  {result.errors.map((e) => (
                    <li key={`${e.row}-${e.message}`}>
                      Row {e.row}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-2 text-xs text-slate-500">Transactions appear in your lists within a few seconds as they are processed.</p>
            </div>
          )}
        </Card>
        <Card title="Expected columns">
          <ul className="space-y-2 text-sm">
            {[
              ['date', 'Required. Format as selected'],
              ['amount', 'Required. Negative = expense'],
              ['description', 'Recommended'],
              ['type', 'expense / income (optional)'],
              ['category', 'Matched by name, else auto'],
              ['currency', 'ISO code, e.g. USD'],
              ['merchant', 'Merchant or payer'],
              ['debit / credit', 'Bank statement style'],
            ].map(([c, d]) => (
              <li key={c}>
                <code className="rounded bg-slate-100 px-1 dark:bg-slate-800">{c}</code> <span className="text-slate-500">{d}</span>
              </li>
            ))}
          </ul>
        </Card>
      </div>
      <Card title="Import history">
        {history.data?.data?.length ? (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {history.data.data.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 py-3 text-sm">
                <span className="font-medium">{i.fileName}</span>
                <span className="text-slate-500">
                  {i.validRows}/{i.totalRows} rows · {timeAgo(i.createdAt)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState icon={FileSpreadsheet} title="No imports yet" />
        )}
      </Card>
    </div>
  );
}
