import { CheckCircle2 } from 'lucide-react';
import { useState } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { authApi } from '../api/endpoints.js';
import { Input, Spinner } from '../components/ui/index.jsx';
import { useAuth } from '../context/AuthContext.jsx';

export const PASSWORD_RULES = [
  [(p) => p.length >= 10, 'At least 10 characters'],
  [(p) => /[a-z]/.test(p), 'A lowercase letter'],
  [(p) => /[A-Z]/.test(p), 'An uppercase letter'],
  [(p) => /\d/.test(p), 'A digit'],
];

function AuthShell({ title, subtitle, children, footer }) {
  return (
    <div className="flex min-h-screen">
      <div className="hidden flex-1 flex-col justify-between bg-gradient-to-br from-brand-700 via-brand-600 to-indigo-500 p-12 text-white lg:flex">
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="" className="h-9 w-9 rounded-lg ring-2 ring-white/30" />
          <span className="text-xl font-bold">SpendWise</span>
        </div>
        <div>
          <h2 className="text-4xl font-bold leading-tight">Take control of every dollar.</h2>
          <p className="mt-4 max-w-md text-lg text-indigo-100">
            Track spending, plan budgets, reach savings goals and get AI-powered insights — all in one place.
          </p>
          <ul className="mt-8 space-y-3 text-indigo-100">
            {['Budgets with real-time warnings', 'Recurring transactions on autopilot', 'Anomaly detection & forecasts', 'PDF, CSV & Excel reports'].map((f) => (
              <li key={f} className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5" aria-hidden /> {f}
              </li>
            ))}
          </ul>
        </div>
        <p className="text-sm text-indigo-200">© {new Date().getFullYear()} SpendWise</p>
      </div>
      <div className="flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-md">
          <h1 className="text-2xl font-bold">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-slate-500">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <p className="mt-6 text-center text-sm text-slate-500">{footer}</p>}
        </div>
      </div>
    </div>
  );
}

function FormError({ message }) {
  if (!message) return null;
  return (
    <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
      {message}
    </div>
  );
}

export function PasswordChecklist({ password }) {
  return (
    <ul className="mt-2 grid grid-cols-2 gap-1 text-xs">
      {PASSWORD_RULES.map(([test, label]) => (
        <li key={label} className={test(password) ? 'text-green-700 dark:text-green-400' : 'text-slate-500'}>
          {test(password) ? '✓' : '○'} {label}
        </li>
      ))}
    </ul>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(form);
      navigate(location.state?.from ?? '/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to sign in'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Welcome back" subtitle="Sign in to your SpendWise account" footer={<>New here? <Link to="/register" className="font-semibold text-brand-600">Create an account</Link></>}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <FormError message={error} />
        <Input label="Email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <Input label="Password" type="password" autoComplete="current-password" required value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm font-medium text-brand-600">
            Forgot password?
          </Link>
        </div>
        <button className="btn-primary w-full" disabled={loading || !form.email || !form.password}>
          {loading && <Spinner className="h-4 w-4 text-white" />} Sign in
        </button>
      </form>
    </AuthShell>
  );
}

export function RegisterPage() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ name: '', email: '', password: '' });
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const valid = PASSWORD_RULES.every(([t]) => t(form.password));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await register(form);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(errorMessage(err, 'Unable to create account'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <AuthShell title="Create your account" subtitle="Start tracking your finances in minutes" footer={<>Already have an account? <Link to="/login" className="font-semibold text-brand-600">Sign in</Link></>}>
      <form className="space-y-4" onSubmit={submit} noValidate>
        <FormError message={error} />
        <Input label="Full name" autoComplete="name" required maxLength={100} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        <Input label="Email" type="email" autoComplete="email" required value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        <div>
          <Input label="Password" type="password" autoComplete="new-password" required maxLength={128} value={form.password} onChange={(e) => setForm({ ...form, password: e.target.value })} />
          <PasswordChecklist password={form.password} />
        </div>
        <button className="btn-primary w-full" disabled={loading || !valid || !form.name || !form.email}>
          {loading && <Spinner className="h-4 w-4 text-white" />} Create account
        </button>
      </form>
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.forgotPassword(email);
      setSent(true);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title="Reset your password" subtitle="We'll email you a secure reset link" footer={<Link to="/login" className="font-semibold text-brand-600">Back to sign in</Link>}>
      {sent ? (
        <div className="rounded-lg border border-green-200 bg-green-50 p-4 text-sm text-green-800 dark:border-green-900 dark:bg-green-950/40 dark:text-green-300">
          If an account exists for <strong>{email}</strong>, a reset link is on its way. The link expires in 30 minutes.
        </div>
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <FormError message={error} />
          <Input label="Email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          <button className="btn-primary w-full" disabled={loading || !email}>
            {loading && <Spinner className="h-4 w-4 text-white" />} Send reset link
          </button>
        </form>
      )}
    </AuthShell>
  );
}

export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') ?? '';
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const valid = PASSWORD_RULES.every(([t]) => t(password));
  const submit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      await authApi.resetPassword({ token, password });
      navigate('/login', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setLoading(false);
    }
  };
  return (
    <AuthShell title="Choose a new password" footer={<Link to="/login" className="font-semibold text-brand-600">Back to sign in</Link>}>
      {!token ? (
        <FormError message="This reset link is missing its token. Request a new one." />
      ) : (
        <form className="space-y-4" onSubmit={submit}>
          <FormError message={error} />
          <div>
            <Input label="New password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
            <PasswordChecklist password={password} />
          </div>
          <button className="btn-primary w-full" disabled={loading || !valid}>
            {loading && <Spinner className="h-4 w-4 text-white" />} Update password
          </button>
        </form>
      )}
    </AuthShell>
  );
}
