/**
 * applyOverride.js
 * Called in index.js BEFORE the trailer AI fetch.
 * If a manual override exists for this stremioId, it is applied to meta.
 * Manual overrides always win over AI-fetched trailers and TMDB data.
 */

'use strict';

const { redisGet, OVERRIDE_PREFIX } = require('./mediaManagerRoutes');

/**
 * Apply any stored manual overrides to the meta object.
 * Returns the (possibly modified) meta.
 * 
 * @param {string} stremioId  e.g. "tt1234567" or "tmdb:123456"
 * @param {object} meta       The meta object from getMeta / cacheWrapMetaSmart
 * @returns {Promise<{meta: object, trailerOverridden: boolean}>}
 */
async function applyOverride(stremioId, meta) {
  if (!meta) return { meta, trailerOverridden: false };

  let trailerOverridden = false;

  try {
    const override = await redisGet(`${OVERRIDE_PREFIX}${stremioId}`);
    if (!override) return { meta, trailerOverridden: false };

    // ── Trailer ────────────────────────────────────────────────────────────
    if (override.trailerYtId) {
      meta.trailer  = { source: 'youtube', id: override.trailerYtId };
      meta.trailers = [{ source: override.trailerYtId, type: 'Trailer' }];
      trailerOverridden = true;
      console.log(`[Override] Trailer for "${meta.name}": ${override.trailerYtId}`);
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

    if (Object.keys(override).some(k => !['_updatedAt','_type','trailerYtId'].includes(k))) {
      console.log(`[Override] Metadata/artwork applied for "${meta.name}"`);
    }
  } catch (e) {
    console.error('[Override] Error applying override:', e.message);
  }

  return { meta, trailerOverridden };
}

module.exports = { applyOverride };
