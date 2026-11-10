import { useQuery } from '@tanstack/react-query';
import { AlertTriangle, Bell, CheckCheck, CheckCircle2, Info, OctagonAlert, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { errorMessage } from '../api/client.js';
import { notificationsApi } from '../api/endpoints.js';
import { Card, EmptyState, ErrorState, PageHeader, PageLoader, Pagination, Tabs } from '../components/ui/index.jsx';
import { useAppMutation } from '../hooks/useData.js';
import { timeAgo } from '../lib/format.js';

const SEVERITY = {
  info: [Info, 'text-brand-600'],
  success: [CheckCircle2, 'text-green-600'],
  warning: [AlertTriangle, 'text-amber-500'],
  danger: [OctagonAlert, 'text-red-600'],
};

export default function Notifications() {
  const [filter, setFilter] = useState('all');
  const [page, setPage] = useState(1);
  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['notifications', filter, page],
    queryFn: () => notificationsApi.list({ unreadOnly: filter === 'unread', page, pageSize: 20 }),
    refetchInterval: 30_000,
  });
  const markRead = useAppMutation(notificationsApi.markRead, { invalidate: ['notifications'] });
  const markAll = useAppMutation(notificationsApi.markAllRead, { success: 'All caught up!', invalidate: ['notifications'] });
  const remove = useAppMutation(notificationsApi.remove, { invalidate: ['notifications'] });

  return (
    <div>
      <PageHeader
        title="Notifications"
        description="Budget alerts, goal milestones, reports and security notices."
        actions={
          <>
            <Tabs tabs={[{ value: 'all', label: 'All' }, { value: 'unread', label: 'Unread' }]} value={filter} onChange={(v) => { setFilter(v); setPage(1); }} />
            <button className="btn-secondary" onClick={() => markAll.mutate()}>
              <CheckCheck className="h-4 w-4" /> Mark all read
            </button>
          </>
        }
      />
      <Card>
        {isLoading ? (
          <PageLoader />
        ) : error ? (
          <ErrorState message={errorMessage(error)} onRetry={refetch} />
        ) : data.data.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" description="You'll be notified about budget warnings, milestones and more." />
        ) : (
          <ul className="divide-y divide-slate-100 dark:divide-slate-800">
            {data.data.map((n) => {
              const [Icon, color] = SEVERITY[n.severity] ?? SEVERITY.info;
              return (
                <li key={n.id} className={`flex gap-3 py-4 ${n.read ? 'opacity-70' : ''}`}>
                  <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} aria-label={n.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-2 font-medium">
                      {!n.read && <span className="h-2 w-2 rounded-full bg-brand-600" aria-label="Unread" />}
                      {n.title}
                    </p>
                    <p className="mt-0.5 text-sm text-slate-600 dark:text-slate-300">{n.message}</p>
                    <div className="mt-1 flex gap-3 text-xs text-slate-500">
                      <span>{timeAgo(n.createdAt)}</span>
                      {n.link && (
                        <Link to={n.link} className="font-medium text-brand-600" onClick={() => !n.read && markRead.mutate(n.id)}>
                          View
                        </Link>
                      )}
                      {!n.read && (
                        <button className="font-medium text-brand-600" onClick={() => markRead.mutate(n.id)}>
                          Mark as read
                        </button>
                      )}
                    </div>
                  </div>
                  <button className="btn-ghost h-8 px-2 text-slate-400" onClick={() => remove.mutate(n.id)} aria-label="Delete notification">
                    <Trash2 className="h-4 w-4" />
                  </button>
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
