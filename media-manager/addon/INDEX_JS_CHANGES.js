/**
 * index.js — TWO CHANGES NEEDED
 * 
 * ════════════════════════════════════════════════════════════════
 * CHANGE 1: Near the top of index.js, after other requires
 * Add these two lines:
 * ════════════════════════════════════════════════════════════════
 */

// ADD after the existing require statements at top of index.js:
const { registerMediaManagerRoutes } = require('./mediaManagerRoutes');
const { applyOverride } = require('./applyOverride');

// ADD after addon is defined (after `const addon = express()` or similar), call:
registerMediaManagerRoutes(addon);

/**
 * ════════════════════════════════════════════════════════════════
 * CHANGE 2: In the meta route, replace the TRAILER OVERRIDE block
 * Find this comment in index.js:
 *   // --- TRAILER OVERRIDE (runs after cache, always fresh) ---
 * Replace the ENTIRE block (from that comment to the closing }) with:
 * ════════════════════════════════════════════════════════════════
 */

// --- TRAILER OVERRIDE (runs after cache, always fresh) ---
if (result?.meta && (result.meta.type === 'movie' || result.meta.type === 'series')) {
  try {
    // Step 1: Apply manual override from Media Manager (highest priority)
    const { applyOverride } = require('./applyOverride');
    const { meta: patchedMeta, trailerOverridden } = await applyOverride(stremioId, result.meta);
    result.meta = patchedMeta;

    // Step 2: Only run AI trailer fetch if no manual trailer override exists
    if (!trailerOverridden) {
      const { fetchAccurateTrailer } = require('./utils/gemini-trailer');
      const rawCountry = result.meta.country;
      const countryList = Array.isArray(rawCountry)
        ? rawCountry
        : typeof rawCountry === 'string' ? [rawCountry] : [];

      const accurateYtId = await fetchAccurateTrailer({
        title: result.meta.name,
        year: result.meta.year || new Date().getFullYear(),
        originalLang: result.meta.language || 'en',
        productionCountries: countryList,
        stremioId: stremioId,
      });

      if (accurateYtId) {
        result.meta.trailer  = { source: 'youtube', id: accurateYtId };
        result.meta.trailers = [{ source: accurateYtId, type: 'Trailer' }];
        console.log(`[Meta Route] AI trailer for "${result.meta.name}": ${accurateYtId}`);
      } else {
        // No trailer found — clear TMDB trailers
        result.meta.trailer  = null;
        result.meta.trailers = [];
        console.log(`[Meta Route] No trailer for "${result.meta.name}" — cleared TMDB trailers`);
      }
    }
  } catch (e) {
    console.error('[Meta Route] Trailer/override error:', e);
  }
}
// --- END TRAILER OVERRIDE ---
