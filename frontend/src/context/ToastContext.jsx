import { CheckCircle2, Info, TriangleAlert, X, XCircle } from 'lucide-react';
import { createContext, useCallback, useContext, useMemo, useState } from 'react';

const ToastContext = createContext(null);

const ICONS = {
  success: [CheckCircle2, 'text-green-600'],
  error: [XCircle, 'text-red-600'],
  warning: [TriangleAlert, 'text-amber-500'],
  info: [Info, 'text-brand-600'],
};

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const dismiss = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);
  const push = useCallback(
    (type, message) => {
      const id = crypto.randomUUID();
      setToasts((t) => [...t.slice(-3), { id, type, message }]);
      setTimeout(() => dismiss(id), 5000);
    },
    [dismiss],
  );

  const api = useMemo(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      warning: (m) => push('warning', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2" aria-live="polite">
        {toasts.map(({ id, type, message }) => {
          const [Icon, color] = ICONS[type];
          return (
            <div key={id} role="status" className="pointer-events-auto flex items-start gap-3 rounded-xl border border-slate-200 bg-white p-4 shadow-lg dark:border-slate-700 dark:bg-slate-800">
              <Icon className={`mt-0.5 h-5 w-5 shrink-0 ${color}`} aria-hidden />
              <p className="flex-1 text-sm text-slate-700 dark:text-slate-200">{message}</p>
              <button onClick={() => dismiss(id)} className="text-slate-400 hover:text-slate-600" aria-label="Dismiss">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
