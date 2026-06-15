/**
 * applyOverride.js
 * Reads overrides from PostgreSQL (permanent) with Redis as fast cache.
 * Called in index.js BEFORE the trailer AI fetch.
 *
 * Key lookup order (first match wins):
 *   1. stremioId as-is          (e.g. "tt1234567" or "tmdb:1367220")
 *   2. tmdb:<tmdbId> from meta
 *   3. imdb_id from meta
 */

'use strict';

const OVERRIDE_PREFIX = 'override:v1:';
const REDIS_CACHE_TTL = 86400; // 24 hours

// ─── Redis cache helpers ──────────────────────────────────────────────────────
async function redisCacheGet(redis, key) {
  try {
    if (!redis) return null;
    const raw = await redis.get(key);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function redisCacheSet(redis, key, value) {
  try {
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), 'EX', REDIS_CACHE_TTL);
  } catch { }
}

// ─── Database helper ──────────────────────────────────────────────────────────
async function dbGetOverride(stremioId) {
  try {
    const database = require('./database');
    await database.initialize();
    const isPostgres = database.type === 'postgres';
    const query = isPostgres
      ? 'SELECT override_data FROM media_overrides WHERE stremio_id = $1'
      : 'SELECT override_data FROM media_overrides WHERE stremio_id = ?';
    const row = await database.getQuery(query, [stremioId]);
    if (!row) return null;
    return typeof row.override_data === 'string'
      ? JSON.parse(row.override_data)
      : row.override_data;
  } catch (e) {
    // Table may not exist yet on first run
    return null;
  }
}

// ─── Get override: Redis cache first, then PostgreSQL ────────────────────────
async function tryGetOverride(redis, key) {
  const redisKey = `${OVERRIDE_PREFIX}${key}`;

  // 1. Try Redis cache (fast)
  const cached = await redisCacheGet(redis, redisKey);
  if (cached) return cached;

  // 2. Fall back to PostgreSQL (permanent source of truth)
  const fromDb = await dbGetOverride(key);
  if (fromDb) {
    // Warm Redis cache for next time
    await redisCacheSet(redis, redisKey, fromDb);
    return fromDb;
  }

  return null;
}

/**
 * Apply any stored manual overrides to the meta object.
 * @param {object} redis      The ioredis client
 * @param {string} stremioId  e.g. "tt1234567" or "tmdb:123456"
 * @param {object} meta       The meta object
 */
async function applyOverride(redis, stremioId, meta) {
  if (!meta) return { meta, trailerOverridden: false };

  let trailerOverridden = false;

  try {
    // Build list of candidate keys to try
    const candidates = [stremioId];

    if (stremioId && !stremioId.startsWith('tmdb:')) {
      const metaId = meta.id || '';
      if (metaId.startsWith('tmdb:')) candidates.push(metaId);
      if (meta._tmdbId) candidates.push(`tmdb:${meta._tmdbId}`);
    }

    if (stremioId && stremioId.startsWith('tmdb:')) {
      if (meta.imdb_id) candidates.push(meta.imdb_id);
      if (meta._imdbId) candidates.push(meta._imdbId);
    }

    // Try each candidate key until we find an override
    let override = null;
    let foundKey = null;
    for (const key of candidates) {
      if (!key) continue;
      override = await tryGetOverride(redis, key);
      if (override) {
        foundKey = key;
        console.log(`[Override] Found override for "${meta.name}" via key: ${key}`);
        break;
      }
    }

    if (!override) {
      console.log(`[Override] No override found for "${meta.name}"`);
      return { meta, trailerOverridden: false };
    }

    // ── Trailer ──────────────────────────────────────────────────────────
    if (override.trailerYtId) {
      meta.trailer  = { source: 'youtube', id: override.trailerYtId };
      meta.trailers = [{ source: override.trailerYtId, type: 'Trailer' }];
      trailerOverridden = true;
      console.log(`[Override] ✓ Trailer applied for "${meta.name}": ${override.trailerYtId} — AI fetch SKIPPED`);
    }

    // ── Artwork ──────────────────────────────────────────────────────────
    if (override.poster)     meta.poster     = override.poster;
    if (override.background) meta.background = override.background;
    if (override.logo)       meta.logo       = override.logo;
    if (override.thumbnail)  meta.thumbnail  = override.thumbnail;

    // ── Metadata ─────────────────────────────────────────────────────────
    if (override.name)     meta.name     = override.name;
    if (override.overview) meta.overview  = override.overview;
    if (override.year)     meta.year      = Number(override.year);

  } catch (e) {
    console.error('[Override] Error applying override:', e.message);
  }

  return { meta, trailerOverridden };
}

module.exports = { applyOverride, OVERRIDE_PREFIX };
