import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { errorMessage } from '../api/client.js';
import { categoriesApi, currencyApi } from '../api/endpoints.js';
import { useToast } from '../context/ToastContext.jsx';

export function useCategories(type) {
  return useQuery({
    queryKey: ['categories', type ?? 'all'],
    queryFn: () => categoriesApi.list(type ? { type } : {}).then((r) => r.data),
    staleTime: 5 * 60_000,
  });
}

export function useCurrencies() {
  return useQuery({ queryKey: ['currencies'], queryFn: () => currencyApi.list().then((r) => r.data), staleTime: 60 * 60_000 });
}

/**
 * Mutation with toast feedback and cache invalidation. Because projections (analytics,
 * search, budgets) update asynchronously from events, dependent queries are refetched
 * again shortly after to pick up eventually-consistent read models.
 */
export function useAppMutation(fn, { success, invalidate = [], onSuccess } = {}) {
  const queryClient = useQueryClient();
  const toast = useToast();
  return useMutation({
    mutationFn: fn,
    onSuccess: (data, vars) => {
      if (success) toast.success(typeof success === 'function' ? success(data, vars) : success);
      const refresh = () => invalidate.forEach((key) => queryClient.invalidateQueries({ queryKey: [key] }));
      refresh();
      setTimeout(refresh, 1500);
      onSuccess?.(data, vars);
    },
    onError: (err) => toast.error(errorMessage(err)),
  });
}
