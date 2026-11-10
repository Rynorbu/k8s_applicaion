import { AsyncLocalStorage } from 'node:async_hooks';

/**
 * Request-scoped context (request id, correlation id, user id) propagated through
 * async call chains so logs, outgoing HTTP calls and published events carry it
 * without threading it through every function signature.
 */
const storage = new AsyncLocalStorage();

export function runWithContext(ctx, fn) {
  return storage.run({ ...ctx }, fn);
}

export function getContext() {
  return storage.getStore() ?? {};
}

export function setContextValue(key, value) {
  const store = storage.getStore();
  if (store) store[key] = value;
}
