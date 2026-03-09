/**
 * Redis client for cache, queues, etc.
 * Uses REDIS_URL from env (e.g. redis://localhost:6379 or Redis Cloud URL).
 * Returns null if REDIS_URL is not set.
 */

const Redis = require('ioredis');

let client = null;

function getRedis() {
  const url = process.env.REDIS_URL;
  if (!url) return null;
  if (client) return client;
  client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  client.on('error', (err) => console.error('[Redis]', err.message));
  return client;
}

/** Call this on app shutdown to disconnect cleanly. */
async function closeRedis() {
  if (client) {
    await client.quit();
    client = null;
  }
}

module.exports = { getRedis, closeRedis };
