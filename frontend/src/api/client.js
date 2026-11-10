import axios from 'axios';

/**
 * HTTP client.
 *  - The access token lives only in memory (never localStorage) to limit XSS impact.
 *  - The refresh token is an httpOnly, SameSite=Strict cookie scoped to /api/v1/auth.
 *  - Every request carries a W3C `traceparent` and a correlation id so a click in the
 *    browser can be followed through the gateway, services and RabbitMQ in Jaeger.
 */
let accessToken = null;
let onSessionExpired = () => {};

export const setAccessToken = (token) => {
  accessToken = token;
};
export const getAccessToken = () => accessToken;
export const setSessionExpiredHandler = (fn) => {
  onSessionExpired = fn;
};

const hex = (bytes) => Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (b) => b.toString(16).padStart(2, '0')).join('');

export function newTraceHeaders() {
  const traceId = hex(16);
  return { traceparent: `00-${traceId}-${hex(8)}-01`, 'x-correlation-id': `web-${traceId.slice(0, 24)}` };
}

export const api = axios.create({
  baseURL: '/api/v1',
  withCredentials: true,
  timeout: 30_000,
  headers: { 'X-Requested-With': 'XMLHttpRequest' },
});

api.interceptors.request.use((config) => {
  Object.assign(config.headers, newTraceHeaders());
  if (accessToken) config.headers.Authorization = `Bearer ${accessToken}`;
  return config;
});

// Single-flight refresh: concurrent 401s share one refresh request (avoids
// tripping refresh-token reuse detection).
let refreshing = null;
export function refreshSession() {
  refreshing ??= axios
    .post('/api/v1/auth/refresh', null, { withCredentials: true, headers: { 'X-Requested-With': 'XMLHttpRequest', ...newTraceHeaders() } })
    .then((res) => {
      setAccessToken(res.data.accessToken);
      return res.data;
    })
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    const original = error.config;
    const isAuthCall = original?.url?.startsWith('/auth/');
    if (error.response?.status === 401 && original && !original._retried && !isAuthCall) {
      original._retried = true;
      try {
        await refreshSession();
        return api(original);
      } catch {
        setAccessToken(null);
        onSessionExpired();
      }
    }
    return Promise.reject(error);
  },
);

/** Extracts a human-readable message from an API error. */
export function errorMessage(error, fallback = 'Something went wrong') {
  const data = error?.response?.data?.error;
  if (data?.details?.length) return `${data.message}: ${data.details.map((d) => `${d.path ? `${d.path} ` : ''}${d.message}`).join('; ')}`;
  return data?.message ?? (error?.code === 'ECONNABORTED' ? 'The request timed out' : fallback);
}

/** Downloads a binary response (reports, receipts) without exposing the token in a URL. */
export async function downloadFile(url, fallbackName) {
  const res = await api.get(url, { responseType: 'blob' });
  const disposition = res.headers['content-disposition'] ?? '';
  const name = /filename="?([^"]+)"?/.exec(disposition)?.[1] ?? fallbackName;
  const href = URL.createObjectURL(res.data);
  const a = document.createElement('a');
  a.href = href;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
