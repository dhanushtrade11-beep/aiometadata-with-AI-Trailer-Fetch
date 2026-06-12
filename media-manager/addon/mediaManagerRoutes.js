/**
 * Media Manager API Routes
 * Handles manual overrides for trailers, artwork, and metadata.
 * Overrides stored in Redis under key: override:v1:<stremioId>
 * 
 * Routes:
 *   GET  /api/media-manager/search?q=&type=   → search TMDB
 *   GET  /api/media-manager/override/:id       → get existing override
 *   POST /api/media-manager/override/:id       → save override
 *   DELETE /api/media-manager/override/:id     → clear override
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

// ─── Redis helper (reuses existing connection from gemini-trailer) ────────────
let _redis = null;

async function getRedis() {
  if (_redis && _redis.status === 'ready') return _redis;
  const url = process.env.REDIS_URL;
  if (!url) return null;
  try {
    const { createClient } = require('redis');
    _redis = createClient({ url });
    _redis.on('error', () => {});
    await _redis.connect();
    return _redis;
  } catch { return null; }
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

// ─── TMDB search ──────────────────────────────────────────────────────────────
async function searchTMDB(query, type) {
  const apiKey = process.env.TMDB_API_KEY;
  if (!apiKey) return [];

  const endpoint = type === 'series' ? 'tv' : 'movie';
  const url = `https://api.themoviedb.org/3/search/${endpoint}?api_key=${apiKey}&query=${encodeURIComponent(query)}&include_adult=false&language=en-US&page=1`;

  try {
    const res = await fetch(url);
    const data = await res.json();
    const results = (data.results || []).slice(0, 12);

    return results.map(item => {
      const isMovie = type === 'movie';
      const title = isMovie ? item.title : item.name;
      const year = isMovie
        ? (item.release_date ? parseInt(item.release_date.substring(0, 4)) : null)
        : (item.first_air_date ? parseInt(item.first_air_date.substring(0, 4)) : null);

      return {
        id: `${isMovie ? 'tmdb' : 'tmdb'}:${item.id}`,
        tmdbId: item.id,
        type,
        title,
        year,
        poster: item.poster_path ? `https://image.tmdb.org/t/p/w342${item.poster_path}` : null,
        background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
        imdb_id: item.imdb_id || null,
        language: item.original_language || null,
        overview: item.overview || null,
      };
    });
  } catch (e) {
    console.error('[MediaManager] TMDB search error:', e.message);
    return [];
  }
}

// ─── Also invalidate trailer cache so new trailer is fetched ─────────────────
async function invalidateTrailerCache(stremioId) {
  try {
    const r = await getRedis();
    if (!r) return;
    // Clear all trailer cache versions for this id
    for (const v of ['v7','v8','v9','v10']) {
      await r.del(`trailer:${v}:${stremioId}`).catch(() => {});
    }
  } catch {}
}

// ─── Register routes ──────────────────────────────────────────────────────────
function registerMediaManagerRoutes(addon) {

  // Search TMDB
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

    // Sanitize — only allow known fields
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

    // Invalidate trailer cache so new trailer is picked up immediately
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

  console.log('[MediaManager] Routes registered: /api/media-manager/*');
}

module.exports = { registerMediaManagerRoutes, redisGet, OVERRIDE_PREFIX };
