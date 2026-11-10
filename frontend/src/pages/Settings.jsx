import { useQuery } from '@tanstack/react-query';
import { LogOut, Monitor, Moon, ShieldCheck, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { auditApi, authApi, notificationsApi } from '../api/endpoints.js';
import { Badge, Card, Input, PageHeader, Spinner } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useTheme } from '../context/ThemeContext.jsx';
import { useAppMutation } from '../hooks/useData.js';
import { timeAgo } from '../lib/format.js';
import { PASSWORD_RULES, PasswordChecklist } from './Auth.jsx';

const TYPES = [
  ['budget_warning', 'Budget warnings'],
  ['budget_exceeded', 'Budget exceeded'],
  ['goal_milestone', 'Goal milestones'],
  ['anomaly', 'Unusual spending'],
  ['recurring_posted', 'Recurring transactions posted'],
  ['recurring_created', 'Recurring rules created'],
  ['report_ready', 'Reports ready'],
  ['import_completed', 'Imports completed'],
];

function Toggle({ checked, onChange, label }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 py-2">
      <span className="text-sm">{label}</span>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={`relative h-6 w-11 rounded-full transition ${checked ? 'bg-brand-600' : 'bg-slate-300 dark:bg-slate-700'}`}
      >
        <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition ${checked ? 'left-[22px]' : 'left-0.5'}`} />
      </button>
    </label>
  );
}

function NotificationPreferences() {
  const { data } = useQuery({ queryKey: ['notifications', 'preferences'], queryFn: notificationsApi.preferences });
  const [prefs, setPrefs] = useState(null);
  useEffect(() => data && setPrefs(data), [data]);
  const save = useAppMutation(notificationsApi.updatePreferences, { success: 'Preferences saved', invalidate: ['notifications'] });
  if (!prefs) return <Spinner />;
  const update = (next) => {
    setPrefs(next);
    save.mutate(next);
  };
  return (
    <div className="divide-y divide-slate-100 dark:divide-slate-800">
      <Toggle label="In-app notifications" checked={prefs.inAppEnabled} onChange={(v) => update({ ...prefs, inAppEnabled: v })} />
      <Toggle label="Email notifications" checked={prefs.emailEnabled} onChange={(v) => update({ ...prefs, emailEnabled: v })} />
      <div className="pt-3">
        <p className="mb-1 text-xs font-semibold uppercase text-slate-500">Notify me about</p>
        {TYPES.map(([type, label]) => (
          <Toggle
            key={type}
            label={label}
            checked={!prefs.mutedTypes.includes(type)}
            onChange={(on) => update({ ...prefs, mutedTypes: on ? prefs.mutedTypes.filter((t) => t !== type) : [...prefs.mutedTypes, type] })}
          />
        ))}
        <p className="mt-2 text-xs text-slate-500">Security notifications (password changes, suspicious sessions) are always sent.</p>
      </div>
    </div>
  );
}

function ChangePassword() {
  const [form, setForm] = useState({ currentPassword: '', newPassword: '' });
  const save = useAppMutation(authApi.changePassword, { success: 'Password changed', onSuccess: () => setForm({ currentPassword: '', newPassword: '' }) });
  const valid = PASSWORD_RULES.every(([t]) => t(form.newPassword));
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        save.mutate(form);
      }}
    >
      <Input label="Current password" type="password" autoComplete="current-password" value={form.currentPassword} onChange={(e) => setForm({ ...form, currentPassword: e.target.value })} />
      <div>
        <Input label="New password" type="password" autoComplete="new-password" value={form.newPassword} onChange={(e) => setForm({ ...form, newPassword: e.target.value })} />
        <PasswordChecklist password={form.newPassword} />
      </div>
      <button className="btn-primary" disabled={!valid || !form.currentPassword || save.isPending}>
        {save.isPending && <Spinner className="h-4 w-4 text-white" />} Update password
      </button>
    </form>
  );
}

function Sessions() {
  const { logoutAll } = useAuth();
  const navigate = useNavigate();
  const { data = [], refetch } = useQuery({ queryKey: ['sessions'], queryFn: authApi.sessions });
  const revoke = useAppMutation(authApi.revokeSession, { success: 'Session revoked', onSuccess: () => refetch() });
  return (
    <div>
      <ul className="divide-y divide-slate-100 dark:divide-slate-800">
        {data.map((s) => (
          <li key={s.id} className="flex items-center justify-between gap-3 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-medium">{s.userAgent ?? 'Unknown device'}</p>
              <p className="text-xs text-slate-500">
                {s.ipAddress} · active {timeAgo(s.lastActiveAt)}
              </p>
            </div>
            <button className="btn-secondary px-3 py-1" onClick={() => revoke.mutate(s.id)}>
              Revoke
            </button>
          </li>
        ))}
      </ul>
      <button
        className="btn-danger mt-4"
        onClick={async () => {
          await logoutAll();
          navigate('/login');
        }}
      >
        <LogOut className="h-4 w-4" /> Sign out of all devices
      </button>
    </div>
  );
}

function SecurityActivity() {
  const { data } = useQuery({ queryKey: ['audit'], queryFn: () => auditApi.list({ pageSize: 15 }) });
  return (
    <ul className="divide-y divide-slate-100 text-sm dark:divide-slate-800">
      {data?.data?.map((e) => (
        <li key={e.seq} className="flex items-center justify-between gap-2 py-2">
          <span className="flex items-center gap-2">
            <Badge color={/Failed|Logged|Password/.test(e.eventType) ? 'amber' : 'gray'}>{e.eventType}</Badge>
            <span className="text-xs text-slate-500">{e.source}</span>
          </span>
          <span className="text-xs text-slate-500">{timeAgo(e.occurredAt)}</span>
        </li>
      )) ?? <Spinner />}
    </ul>
  );
}

export default function Settings() {
  const { theme, setTheme } = useTheme();
  return (
    <div>
      <PageHeader title="Settings" description="Appearance, notifications and account security." />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card title="Appearance">
          <div className="grid grid-cols-3 gap-3">
            {[
              ['light', 'Light', Sun],
              ['dark', 'Dark', Moon],
              ['system', 'System', Monitor],
            ].map(([value, label, Icon]) => (
              <button
                key={value}
                onClick={() => setTheme(value)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition ${theme === value ? 'border-brand-600 bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100' : 'border-slate-200 dark:border-slate-700'}`}
                aria-pressed={theme === value}
              >
                <Icon className="h-5 w-5" /> {label}
              </button>
            ))}
          </div>
        </Card>
        <Card title="Notifications">
          <NotificationPreferences />
        </Card>
        <Card title="Change password">
          <ChangePassword />
        </Card>
        <Card title="Active sessions" action={<ShieldCheck className="h-5 w-5 text-green-600" aria-hidden />}>
          <Sessions />
        </Card>
        <Card className="lg:col-span-2" title="Security & activity log" subtitle="Tamper-evident audit trail of your account activity">
          <SecurityActivity />
        </Card>
      </div>
    </div>
  );
}
