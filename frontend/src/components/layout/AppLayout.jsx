import { useQuery } from '@tanstack/react-query';
import clsx from 'clsx';
import {
  BarChart3,
  Bell,
  FileSpreadsheet,
  FileText,
  LayoutDashboard,
  LogOut,
  Menu,
  Monitor,
  Moon,
  PiggyBank,
  Repeat,
  Search,
  Settings,
  Sun,
  Target,
  TrendingUp,
  User,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { notificationsApi } from '../../api/endpoints.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useTheme } from '../../context/ThemeContext.jsx';

const NAV = [
  { to: '/dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { to: '/expenses', label: 'Expenses', icon: Wallet },
  { to: '/income', label: 'Income', icon: TrendingUp },
  { to: '/budgets', label: 'Budgets', icon: PiggyBank },
  { to: '/recurring', label: 'Recurring', icon: Repeat },
  { to: '/goals', label: 'Goals', icon: Target },
  { to: '/analytics', label: 'Analytics', icon: BarChart3 },
  { to: '/reports', label: 'Reports', icon: FileText },
  { to: '/import', label: 'Import', icon: FileSpreadsheet },
  { to: '/search', label: 'Search', icon: Search },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/profile', label: 'Profile', icon: User },
  { to: '/settings', label: 'Settings', icon: Settings },
];

function Sidebar({ onNavigate }) {
  return (
    <nav className="flex h-full flex-col gap-1 p-4" aria-label="Main">
      <Link to="/dashboard" className="mb-6 flex items-center gap-2 px-2" onClick={onNavigate}>
        <img src="/favicon.svg" alt="" className="h-8 w-8" />
        <span className="text-lg font-bold tracking-tight">SpendWise</span>
      </Link>
      {NAV.map(({ to, label, icon: Icon }) => (
        <NavLink
          key={to}
          to={to}
          onClick={onNavigate}
          className={({ isActive }) =>
            clsx(
              'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition',
              isActive
                ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-100'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-slate-100',
            )
          }
        >
          <Icon className="h-4 w-4" aria-hidden />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}

function ThemeToggle() {
  const { theme, setTheme } = useTheme();
  const next = { light: 'dark', dark: 'system', system: 'light' };
  const Icon = { light: Sun, dark: Moon, system: Monitor }[theme];
  return (
    <button className="btn-ghost px-2" onClick={() => setTheme(next[theme])} aria-label={`Theme: ${theme}`} title={`Theme: ${theme}`}>
      <Icon className="h-5 w-5" />
    </button>
  );
}

export default function AppLayout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const { data: unread } = useQuery({ queryKey: ['notifications', 'unread'], queryFn: notificationsApi.unreadCount, refetchInterval: 30_000 });

  return (
    <div className="min-h-screen lg:pl-64">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 overflow-y-auto border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900 lg:block">
        <Sidebar />
      </aside>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/50" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-0 left-0 w-72 overflow-y-auto bg-white dark:bg-slate-900">
            <button className="absolute right-3 top-3 p-2" onClick={() => setOpen(false)} aria-label="Close menu">
              <X className="h-5 w-5" />
            </button>
            <Sidebar onNavigate={() => setOpen(false)} />
          </aside>
        </div>
      )}

      <header className="sticky top-0 z-20 flex h-16 items-center gap-3 border-b border-slate-200 bg-white/80 px-4 backdrop-blur dark:border-slate-800 dark:bg-slate-900/80 sm:px-6">
        <button className="btn-ghost px-2 lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu">
          <Menu className="h-5 w-5" />
        </button>
        <form
          className="relative max-w-md flex-1"
          onSubmit={(e) => {
            e.preventDefault();
            if (q.trim()) navigate(`/search?q=${encodeURIComponent(q.trim())}`);
          }}
          role="search"
        >
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
          <input className="input pl-9" placeholder="Search transactions…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search transactions" />
        </form>
        <div className="ml-auto flex items-center gap-1">
          <ThemeToggle />
          <Link to="/notifications" className="btn-ghost relative px-2" aria-label={`Notifications (${unread?.unread ?? 0} unread)`}>
            <Bell className="h-5 w-5" />
            {unread?.unread > 0 && (
              <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-600 px-1 text-[10px] font-bold text-white">
                {unread.unread > 99 ? '99+' : unread.unread}
              </span>
            )}
          </Link>
          <div className="mx-2 hidden text-right sm:block">
            <p className="text-sm font-medium leading-tight">{user?.name}</p>
            <p className="text-xs text-slate-500">{user?.email}</p>
          </div>
          <button
            className="btn-ghost px-2"
            onClick={async () => {
              await logout();
              navigate('/login');
            }}
            aria-label="Log out"
            title="Log out"
          >
            <LogOut className="h-5 w-5" />
          </button>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <Outlet />
      </main>
    </div>
  );
}
