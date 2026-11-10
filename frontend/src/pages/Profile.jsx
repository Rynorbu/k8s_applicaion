import { useEffect, useState } from 'react';
import { profileApi } from '../api/endpoints.js';
import { Card, Input, PageHeader, PageLoader, Select, Spinner, Textarea } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { useAppMutation, useCurrencies } from '../hooks/useData.js';
import { formatDate } from '../lib/format.js';

const TIMEZONES = (() => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['UTC'];
  }
})();

export default function Profile() {
  const { profile, user, setProfile } = useAuth();
  const { data: currencies = [] } = useCurrencies();
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (profile) {
      setForm({
        name: profile.name ?? '',
        baseCurrency: profile.baseCurrency,
        timezone: profile.timezone,
        locale: profile.locale,
        dateFormat: profile.dateFormat,
        monthlyIncomeTarget: profile.monthlyIncomeTarget ?? '',
        occupation: profile.occupation ?? '',
        bio: profile.bio ?? '',
      });
    }
  }, [profile]);

  const save = useAppMutation((body) => profileApi.update(body), {
    success: 'Profile saved',
    invalidate: ['dashboard', 'analytics'],
    onSuccess: (p) => setProfile(p),
  });

  if (!form) return <PageLoader />;
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const currencyChanged = form.baseCurrency !== profile.baseCurrency;

  return (
    <div>
      <PageHeader title="Profile" description="Your personal details and finance preferences." />
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <div className="flex flex-col items-center text-center">
            <div className="flex h-20 w-20 items-center justify-center rounded-full bg-brand-600 text-2xl font-bold text-white">
              {(profile.name ?? '?').split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
            </div>
            <h2 className="mt-3 text-lg font-semibold">{profile.name}</h2>
            <p className="text-sm text-slate-500">{profile.email}</p>
            <p className="mt-2 text-xs text-slate-500">Member since {formatDate(profile.createdAt)}</p>
            {user?.roles?.includes('admin') && <p className="mt-2 rounded-full bg-brand-100 px-2 py-0.5 text-xs font-semibold text-brand-700">Administrator</p>}
          </div>
        </Card>
        <Card className="lg:col-span-2" title="Details">
          <form
            className="grid gap-4 sm:grid-cols-2"
            onSubmit={(e) => {
              e.preventDefault();
              save.mutate({
                ...form,
                monthlyIncomeTarget: form.monthlyIncomeTarget === '' ? null : Number(form.monthlyIncomeTarget),
                occupation: form.occupation || null,
                bio: form.bio || null,
              });
            }}
          >
            <Input label="Full name" required maxLength={100} value={form.name} onChange={set('name')} />
            <Input label="Occupation" maxLength={100} value={form.occupation} onChange={set('occupation')} />
            <div>
              <Select label="Base currency" value={form.baseCurrency} onChange={set('baseCurrency')} options={currencies.map((c) => ({ value: c.code, label: `${c.code} — ${c.name}` }))} />
              {currencyChanged && <p className="mt-1 text-xs text-amber-600">New transactions will be converted to {form.baseCurrency}. Existing ones keep their historical conversion.</p>}
            </div>
            <Select label="Timezone" value={form.timezone} onChange={set('timezone')} options={['UTC', ...TIMEZONES.filter((t) => t !== 'UTC')].map((t) => ({ value: t, label: t }))} />
            <Select label="Locale" value={form.locale} onChange={set('locale')} options={['en-US', 'en-GB', 'en-IN', 'ne-NP', 'de-DE', 'fr-FR', 'es-ES', 'ja-JP'].map((l) => ({ value: l, label: l }))} />
            <Select label="Date format" value={form.dateFormat} onChange={set('dateFormat')} options={['YYYY-MM-DD', 'DD/MM/YYYY', 'MM/DD/YYYY'].map((d) => ({ value: d, label: d }))} />
            <Input label="Monthly income target" type="number" min="0" step="0.01" value={form.monthlyIncomeTarget} onChange={set('monthlyIncomeTarget')} />
            <div className="sm:col-span-2">
              <Textarea label="Bio" maxLength={500} value={form.bio} onChange={set('bio')} />
            </div>
            <div className="sm:col-span-2">
              <button className="btn-primary" disabled={save.isPending}>
                {save.isPending && <Spinner className="h-4 w-4 text-white" />} Save changes
              </button>
            </div>
          </form>
        </Card>
      </div>
    </div>
  );
}
