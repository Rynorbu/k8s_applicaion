import { useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatMoney } from '../../lib/format.js';

/*
 * Chart conventions (validated palette, see index.css tokens):
 *  - income = categorical slot 1 (blue), expenses = slot 2 (orange); one y-axis only
 *  - thin marks: 2px lines, 4px rounded bar ends anchored at the baseline, 2px gaps
 *  - recessive grid/axes, legend for >= 2 series, hover tooltip on every chart
 *  - every chart has a "Table" toggle so values are never conveyed by color alone
 */
const AXIS = { stroke: 'var(--chart-axis)', fontSize: 12, tickLine: false, axisLine: false };
const SERIES = { income: 'var(--series-income)', expenses: 'var(--series-expense)', net: 'var(--series-net)' };

function ChartTooltip({ active, payload, label, currency }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs shadow-lg dark:border-slate-700 dark:bg-slate-800">
      {label && <p className="mb-1 font-semibold text-slate-900 dark:text-slate-100">{label}</p>}
      {payload.map((p) => (
        <p key={p.dataKey ?? p.name} className="flex items-center gap-2 text-slate-600 dark:text-slate-300">
          <span className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color ?? p.payload?.color }} aria-hidden />
          <span>{p.name}:</span>
          <span className="font-semibold text-slate-900 dark:text-slate-100">{formatMoney(p.value, currency)}</span>
        </p>
      ))}
    </div>
  );
}

function legendText(value) {
  return <span className="text-xs text-slate-600 dark:text-slate-300">{value}</span>;
}

/** Wraps a chart with a Chart/Table toggle (accessibility relief + exact values). */
export function ChartFrame({ height = 280, columns, rows, children, empty }) {
  const [view, setView] = useState('chart');
  if (!rows?.length || empty) {
    return (
      <div className="flex items-center justify-center text-sm text-slate-500" style={{ height }}>
        No data for this period yet
      </div>
    );
  }
  return (
    <div>
      <div className="mb-2 flex justify-end">
        <button className="text-xs font-medium text-brand-600 hover:underline dark:text-brand-100" onClick={() => setView(view === 'chart' ? 'table' : 'chart')}>
          {view === 'chart' ? 'View as table' : 'View as chart'}
        </button>
      </div>
      {view === 'chart' ? (
        <div style={{ height }}>
          <ResponsiveContainer width="100%" height="100%">
            {children}
          </ResponsiveContainer>
        </div>
      ) : (
        <div className="max-h-[320px] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-white text-xs uppercase text-slate-500 dark:bg-slate-900">
              <tr>
                {columns.map((c) => (
                  <th key={c.key} className={`py-2 ${c.numeric ? 'text-right' : ''}`}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {rows.map((r, i) => (
                <tr key={i}>
                  {columns.map((c) => (
                    <td key={c.key} className={`py-1.5 ${c.numeric ? 'text-right tabular-nums' : ''}`}>
                      {c.format ? c.format(r[c.key]) : r[c.key]}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

const moneyCols = (currency) => [
  { key: 'label', label: 'Period' },
  { key: 'income', label: 'Income', numeric: true, format: (v) => formatMoney(v, currency) },
  { key: 'expenses', label: 'Expenses', numeric: true, format: (v) => formatMoney(v, currency) },
  { key: 'net', label: 'Net', numeric: true, format: (v) => formatMoney(v, currency, { signed: true }) },
];

/** Income vs expenses per period: grouped bars, one money axis. */
export function IncomeExpenseBars({ data, currency, height = 280 }) {
  const empty = data?.every((d) => d.income === 0 && d.expenses === 0);
  return (
    <ChartFrame height={height} rows={data} columns={moneyCols(currency)} empty={empty}>
      <BarChart data={data} barGap={2} barCategoryGap="24%" margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...AXIS} />
        <YAxis {...AXIS} width={64} tickFormatter={(v) => formatMoney(v, currency, { compact: true })} />
        <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
        <Legend formatter={legendText} iconType="circle" iconSize={8} />
        <Bar dataKey="income" name="Income" fill={SERIES.income} radius={[4, 4, 0, 0]} maxBarSize={28} />
        <Bar dataKey="expenses" name="Expenses" fill={SERIES.expenses} radius={[4, 4, 0, 0]} maxBarSize={28} />
      </BarChart>
    </ChartFrame>
  );
}

/** Income & expense lines over time (daily/weekly granularity). */
export function TrendLines({ data, currency, height = 280 }) {
  const empty = data?.every((d) => d.income === 0 && d.expenses === 0);
  return (
    <ChartFrame height={height} rows={data} columns={moneyCols(currency)} empty={empty}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey="label" {...AXIS} minTickGap={24} />
        <YAxis {...AXIS} width={64} tickFormatter={(v) => formatMoney(v, currency, { compact: true })} />
        <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ stroke: 'var(--chart-axis)', strokeDasharray: '3 3' }} />
        <Legend formatter={legendText} iconType="circle" iconSize={8} />
        <Line type="monotone" dataKey="income" name="Income" stroke={SERIES.income} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--chart-surface)' }} />
        <Line type="monotone" dataKey="expenses" name="Expenses" stroke={SERIES.expenses} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: 'var(--chart-surface)' }} />
      </LineChart>
    </ChartFrame>
  );
}

/** Daily spending sparkline (single series - no legend; the card title names it). */
export function SpendingSparkline({ data, currency, height = 120 }) {
  if (!data?.length) return null;
  return (
    <div style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="spark" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={SERIES.expenses} stopOpacity={0.25} />
              <stop offset="100%" stopColor={SERIES.expenses} stopOpacity={0} />
            </linearGradient>
          </defs>
          <XAxis dataKey="date" hide />
          <Tooltip content={<ChartTooltip currency={currency} />} labelFormatter={(d) => d} />
          <Area type="monotone" dataKey="amount" name="Spent" stroke={SERIES.expenses} strokeWidth={2} fill="url(#spark)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

/**
 * Spending by category. Slices use each category's own stored color (color follows the
 * entity, not its rank). More than 6 categories fold into "Other"; the ranked legend
 * beside the donut doubles as direct labels with exact values.
 */
export function CategoryDonut({ data, currency, height = 220, compact = false }) {
  if (!data?.length) {
    return <div className="flex h-40 items-center justify-center text-sm text-slate-500">No spending recorded for this period</div>;
  }
  const top = data.slice(0, 6);
  const rest = data.slice(6);
  const slices = rest.length
    ? [...top, { categoryId: 'other', name: 'Other', color: '#94a3b8', total: rest.reduce((s, c) => s + c.total, 0), percentage: rest.reduce((s, c) => s + c.percentage, 0) }]
    : top;
  const total = slices.reduce((s, c) => s + c.total, 0);
  return (
    <div className={`grid items-center gap-4 ${compact ? 'grid-cols-1' : 'sm:grid-cols-2'}`}>
      <div className="relative min-w-0" style={{ height: compact ? 180 : height }}>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={slices} dataKey="total" nameKey="name" innerRadius="62%" outerRadius="92%" paddingAngle={1} stroke="var(--chart-surface)" strokeWidth={2}>
              {slices.map((s) => (
                <Cell key={s.categoryId} fill={s.color} />
              ))}
            </Pie>
            <Tooltip content={<ChartTooltip currency={currency} />} />
          </PieChart>
        </ResponsiveContainer>
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xs text-slate-500">Total</span>
          <span className="text-lg font-bold">{formatMoney(total, currency, { compact: true })}</span>
        </div>
      </div>
      <ul className="space-y-2">
        {slices.map((s) => (
          <li key={s.categoryId} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: s.color }} aria-hidden />
              <span className="truncate text-slate-700 dark:text-slate-300">{s.name}</span>
            </span>
            <span className="shrink-0 tabular-nums text-slate-900 dark:text-slate-100">
              {formatMoney(s.total, currency)} <span className="text-xs text-slate-500">({s.percentage.toFixed(0)}%)</span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Single-series bar chart (e.g. spending by weekday). */
export function SimpleBars({ data, dataKey, labelKey, name, currency, height = 240 }) {
  const columns = [
    { key: labelKey, label: 'Label' },
    { key: dataKey, label: name, numeric: true, format: (v) => formatMoney(v, currency) },
  ];
  return (
    <ChartFrame height={height} rows={data} columns={columns} empty={data?.every((d) => !d[dataKey])}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid vertical={false} stroke="var(--chart-grid)" />
        <XAxis dataKey={labelKey} {...AXIS} tickFormatter={(v) => String(v).slice(0, 3)} />
        <YAxis {...AXIS} width={64} tickFormatter={(v) => formatMoney(v, currency, { compact: true })} />
        <Tooltip content={<ChartTooltip currency={currency} />} cursor={{ fill: 'var(--chart-grid)', opacity: 0.4 }} />
        <Bar dataKey={dataKey} name={name} fill={SERIES.expenses} radius={[4, 4, 0, 0]} maxBarSize={36} />
      </BarChart>
    </ChartFrame>
  );
}
