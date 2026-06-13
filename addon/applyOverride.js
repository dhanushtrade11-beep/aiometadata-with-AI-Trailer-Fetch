/**
 * applyOverride.js
 * Called in index.js BEFORE the trailer AI fetch.
 * If a manual override exists for this stremioId, it is applied to meta.
 * Manual overrides always win over AI-fetched trailers and TMDB data.
 *
 * Key lookup order (first match wins):
 *   1. stremioId as-is          (e.g. "tt1234567" or "tmdb:1367220")
 *   2. tmdb:<tmdbId> from meta  (e.g. "tmdb:1367220" — for when stremioId is IMDB format)
 *   3. imdb_id from meta        (e.g. "tt1234567" — for when stremioId is TMDB format)
 */

'use strict';

const { OVERRIDE_PREFIX } = require('./mediaManagerRoutes');

async function tryGetOverride(redis, key) {
  try {
    const raw = await redis.get(`${OVERRIDE_PREFIX}${key}`);
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Apply any stored manual overrides to the meta object.
 * @param {object} redis      The ioredis client (passed from index.js)
 * @param {string} stremioId  e.g. "tt1234567" or "tmdb:123456"
 * @param {object} meta       The meta object from getMeta / cacheWrapMetaSmart
 */
async function applyOverride(redis, stremioId, meta) {
  if (!meta) return { meta, trailerOverridden: false };

  let trailerOverridden = false;

  try {
    if (!redis) return { meta, trailerOverridden: false };

    // Build list of candidate keys to try
    const candidates = [stremioId];

    // If stremioId is IMDB format (tt...), also try tmdb: key from meta
    if (stremioId && !stremioId.startsWith('tmdb:')) {
      const metaId = meta.id || '';
      if (metaId.startsWith('tmdb:')) candidates.push(metaId);
      if (meta._tmdbId) candidates.push(`tmdb:${meta._tmdbId}`);
    }

    // If stremioId is TMDB format, also try IMDB key from meta
    if (stremioId && stremioId.startsWith('tmdb:')) {
      if (meta.imdb_id) candidates.push(meta.imdb_id);
      if (meta._imdbId) candidates.push(meta._imdbId);
    }

    // Try each candidate key until we find an override
    let override = null;
    for (const key of candidates) {
      if (!key) continue;
      override = await tryGetOverride(redis, key);
      if (override) {
        console.log(`[Override] Found override for "${meta.name}" via key: ${key}`);
        break;
      }
    }

    if (!override) return { meta, trailerOverridden: false };

    // ── Trailer ────────────────────────────────────────────────────────────
    if (override.trailerYtId) {
      meta.trailer  = { source: 'youtube', id: override.trailerYtId };
      meta.trailers = [{ source: override.trailerYtId, type: 'Trailer' }];
      trailerOverridden = true;
      console.log(`[Override] ✓ Trailer for "${meta.name}": ${override.trailerYtId} (AI fetch skipped)`);
    }

    // ── Artwork ────────────────────────────────────────────────────────────
    if (override.poster)     meta.poster     = override.poster;
    if (override.background) meta.background = override.background;
    if (override.logo)       meta.logo       = override.logo;
    if (override.thumbnail)  meta.thumbnail  = override.thumbnail;

    // ── Metadata ───────────────────────────────────────────────────────────
    if (override.name)     meta.name     = override.name;
    if (override.overview) meta.overview  = override.overview;
    if (override.year)     meta.year      = Number(override.year);

  } catch (e) {
    console.error('[Override] Error applying override:', e.message);
  }

  return { meta, trailerOverridden };
}

module.exports = { applyOverride };
