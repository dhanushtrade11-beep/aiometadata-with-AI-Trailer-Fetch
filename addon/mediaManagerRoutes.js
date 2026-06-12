/**
 * Media Manager API Routes
 * Handles manual overrides for trailers, artwork, and metadata.
 * Overrides stored in Redis under key: override:v1:<stremioId>
 *
 * Routes:
 *   GET  /api/media-manager/search?q=&type=        → search TMDB by title
 *   GET  /api/media-manager/lookup?id=&type=        → lookup TMDB/IMDB by ID
 *   GET  /api/media-manager/override/:id            → get existing override
 *   POST /api/media-manager/override/:id            → save override
 *   DELETE /api/media-manager/override/:id          → clear override
 */

'use strict';

const OVERRIDE_PREFIX = 'override:v1:';
const OVERRIDE_TTL    = 365 * 24 * 60 * 60; // 1 year

// ─── Admin check ──────────────────────────────────────────────────────────────
function requireAdmin(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ─── Redis helper ─────────────────────────────────────────────────────────────
let _redis = null;

let _redisError = null;

async function getRedis() {
  if (_redis && _redis.status === 'ready') return _redis;
  const url = process.env.REDIS_URL;
  if (!url) {
    _redisError = 'REDIS_URL environment variable is not set';
    return null;
  }
  try {
    const { createClient } = require('redis');
    _redis = createClient({ url });
    _redis.on('error', (e) => { _redisError = e.message; _redis = null; });
    await _redis.connect();
    _redisError = null;
    return _redis;
  } catch (e) {
    _redisError = e.message;
    _redis = null;
    return null;
  }
}

async function redisGet(key) {
  try {
    const r = await getRedis();
    if (!r) return null;
    const v = await r.get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

async function redisSet(key, value) {
  try {
    const r = await getRedis();
    if (!r) return false;
    await r.set(key, JSON.stringify(value), { EX: OVERRIDE_TTL });
    return true;
  } catch { return false; }
}

async function redisDel(key) {
  try {
    const r = await getRedis();
    if (!r) return false;
    await r.del(key);
    return true;
  } catch { return false; }
}

// ─── TMDB search by title ─────────────────────────────────────────────────────
async function searchTMDB(query, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return [];

  const endpoint = type === 'series' ? 'tv' : 'movie';
  const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const results = (data.results || []).slice(0, 12);

    return results.map(item => normalizeTMDBItem(item, type));
  } catch (e) {
    console.error('[MediaManager] TMDB search error:', e.message);
    return [];
  }
}

// ─── TMDB lookup by TMDB ID or IMDB ID ───────────────────────────────────────
async function lookupByID(rawId, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return null;

  const isImdb = /^tt\d+/.test(rawId.trim());

  try {
    if (isImdb) {
      // Use TMDB find endpoint to resolve IMDB id
      const findUrl = `https://api.themoviedb.org/3/find/${rawId.trim()}?api_key=${apiKey}&external_source=imdb_id`;
      const findRes = await fetch(findUrl);
      const findData = await findRes.json();

      // Pick from movie or tv results depending on type
      const movieResults = findData.movie_results || [];
      const tvResults = findData.tv_results || [];

      let item = null;
      if (type === 'series' && tvResults.length > 0) {
        item = { ...tvResults[0], _resolvedType: 'series' };
      } else if (type === 'movie' && movieResults.length > 0) {
        item = { ...movieResults[0], _resolvedType: 'movie' };
      } else if (movieResults.length > 0) {
        item = { ...movieResults[0], _resolvedType: 'movie' };
      } else if (tvResults.length > 0) {
        item = { ...tvResults[0], _resolvedType: 'series' };
      }

      if (!item) return null;
      const resolvedType = item._resolvedType;
      return normalizeTMDBItem(item, resolvedType, rawId.trim());
    } else {
      // Direct TMDB numeric ID
      const numericId = rawId.trim().replace(/^tmdb:/i, '');
      const endpoint = type === 'series' ? 'tv' : 'movie';
      const detailUrl = `https://api.themoviedb.org/3/${endpoint}/${numericId}?api_key=${apiKey}&language=en-US`;
      const detailRes = await fetch(detailUrl);
      if (!detailRes.ok) return null;
      const item = await detailRes.json();
      return normalizeTMDBItem(item, type);
    }
  } catch (e) {
    console.error('[MediaManager] TMDB lookup error:', e.message);
    return null;
  }
}

// ─── Normalize a TMDB item into SearchResult shape ────────────────────────────
function normalizeTMDBItem(item, type, imdbIdOverride) {
  const isMovie = type === 'movie';
  const title = isMovie ? item.title : (item.name || item.title);
  const year = isMovie
    ? (item.release_date ? parseInt(item.release_date.substring(0, 4)) : null)
    : (item.first_air_date ? parseInt(item.first_air_date.substring(0, 4)) : null);

  return {
    id: `tmdb:${item.id}`,
    tmdbId: item.id,
    type,
    title,
    year,
    poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
    imdb_id: imdbIdOverride || item.imdb_id || null,
    language: item.original_language || null,
    overview: item.overview || null,
  };
}

// ─── Invalidate trailer cache ─────────────────────────────────────────────────
async function invalidateTrailerCache(stremioId) {
  try {
    const r = await getRedis();
    if (!r) return;
    for (const v of ['v7','v8','v9','v10']) {
      await r.del(`trailer:${v}:${stremioId}`).catch(() => {});
    }
  } catch {}
}

// ─── Register routes ──────────────────────────────────────────────────────────
function registerMediaManagerRoutes(addon) {

  // Search TMDB by title
  addon.get('/api/media-manager/search', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { q, type = 'movie' } = req.query;
    if (!q || !q.trim()) return res.json({ results: [] });
    try {
      const results = await searchTMDB(q.trim(), type);
      res.json({ results });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lookup by TMDB ID or IMDB ID (NEW)
  addon.get('/api/media-manager/lookup', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id, type = 'movie' } = req.query;
    if (!id || !id.trim()) return res.status(400).json({ error: 'id is required' });
    try {
      const result = await lookupByID(id.trim(), type);
      if (!result) return res.status(404).json({ error: 'Not found on TMDB' });
      res.json({ result });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Get existing override
  addon.get('/api/media-manager/override/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    try {
      const override = await redisGet(`${OVERRIDE_PREFIX}${id}`);
      res.json({ override: override || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Save override
  addon.post('/api/media-manager/override/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    const { override, type } = req.body;

    if (!override || typeof override !== 'object') {
      return res.status(400).json({ error: 'Invalid override data' });
    }

    const allowed = ['trailerYtId', 'poster', 'background', 'logo', 'thumbnail', 'name', 'overview', 'year'];
    const clean = {};
    for (const key of allowed) {
      if (override[key] !== undefined && override[key] !== '') {
        clean[key] = override[key];
      }
    }
    clean._updatedAt = new Date().toISOString();
    clean._type = type || 'movie';

    const saved = await redisSet(`${OVERRIDE_PREFIX}${id}`, clean);
    if (!saved) return res.status(500).json({ error: 'Failed to save (Redis unavailable)' });

    if (clean.trailerYtId) await invalidateTrailerCache(id);

    console.log(`[MediaManager] Override saved for ${id}:`, JSON.stringify(clean));
    res.json({ success: true, override: clean });
  });

  // Clear override
  addon.delete('/api/media-manager/override/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    await redisDel(`${OVERRIDE_PREFIX}${id}`);
    await invalidateTrailerCache(id);
    console.log(`[MediaManager] Override cleared for ${id}`);
    res.json({ success: true });
  });

  // Redis debug route (no admin key required so you can test in browser)
  addon.get('/api/media-manager/debug', async (req, res) => {
    const redisUrl = process.env.REDIS_URL;
    const result = {
      redis_url_set: !!redisUrl,
      redis_url_prefix: redisUrl ? redisUrl.substring(0, 15) + '...' : null,
      redis_url_protocol: redisUrl ? redisUrl.split('://')[0] : null,
      tmdb_key_set: !!process.env.TMDB_API_KEY,
      admin_key_set: !!process.env.ADMIN_KEY,
    };

    // Try connecting
    try {
      const r = await getRedis();
      if (r) {
        await r.set('debug:ping', 'pong', { EX: 60 });
        const val = await r.get('debug:ping');
        result.redis_status = val === 'pong' ? 'connected_and_working' : 'connected_but_read_failed';
      } else {
        result.redis_status = 'failed_to_connect';
        result.redis_error = _redisError || 'Unknown error';
      }
    } catch (e) {
      result.redis_status = 'exception';
      result.redis_error = e.message;
    }

    res.json(result);
  });

  console.log('[MediaManager] Routes registered: /api/media-manager/*');
}

module.exports = { registerMediaManagerRoutes, redisGet, OVERRIDE_PREFIX };
