import Redis from 'ioredis';
import { getLogger } from './logger.js';

export function createRedis(url, { keyPrefix } = {}) {
  const redis = new Redis(url, {
    keyPrefix,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
    lazyConnect: false,
    retryStrategy: (times) => Math.min(times * 500, 10_000),
  });
  redis.on('error', (err) => getLogger().warn({ err: err.message }, 'redis error'));
  return redis;
}

/** Cache-aside helper that degrades gracefully: a Redis outage never fails the request. */
export async function cached(redis, key, ttlSeconds, compute) {
  if (redis && redis.status === 'ready') {
    try {
      const hit = await redis.get(key);
      if (hit) return JSON.parse(hit);
    } catch {
      // fall through to compute
    }
  }
  const value = await compute();
  if (redis && redis.status === 'ready') {
    redis.set(key, JSON.stringify(value), 'EX', ttlSeconds).catch(() => {});
  }
  return value;
}
