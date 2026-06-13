/**
 * Media Manager API Routes
 * redis client is passed in from index.js (avoids module resolution issues in dist/)
 *
 * Routes:
 *   GET    /api/media-manager/search?q=&type=   → search TMDB by title
 *   GET    /api/media-manager/lookup?id=&type=  → lookup by TMDB or IMDB id
 *   GET    /api/media-manager/override/:id      → get existing override
 *   POST   /api/media-manager/override/:id      → save override
 *   DELETE /api/media-manager/override/:id      → clear override
 *   GET    /api/media-manager/debug             → diagnostics (no auth)
 */

'use strict';

const OVERRIDE_PREFIX = 'override:v1:';
// No TTL for overrides — they are permanent until manually cleared

// ─── Admin check ──────────────────────────────────────────────────────────────
function requireAdmin(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ─── Redis helpers (ioredis — positional EX args) ────────────────────────────
async function redisGet(redis, key) {
  try {
    if (!redis) return null;
    const v = await redis.get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

async function redisSet(redis, key, value) {
  try {
    if (!redis) return false;
    await redis.set(key, JSON.stringify(value)); // No expiry — permanent
    return true;
  } catch { return false; }
}

async function redisDel(redis, key) {
  try {
    if (!redis) return false;
    await redis.del(key);
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
    return (data.results || []).slice(0, 12).map(item => normalizeTMDBItem(item, type));
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
      const findUrl = `https://api.themoviedb.org/3/find/${rawId.trim()}?api_key=${apiKey}&external_source=imdb_id`;
      const findRes = await fetch(findUrl);
      const findData = await findRes.json();
      const movieResults = findData.movie_results || [];
      const tvResults    = findData.tv_results    || [];
      let item = null;
      if (type === 'series' && tvResults.length > 0)       item = { ...tvResults[0],    _resolvedType: 'series' };
      else if (type === 'movie' && movieResults.length > 0) item = { ...movieResults[0], _resolvedType: 'movie'  };
      else if (movieResults.length > 0)                     item = { ...movieResults[0], _resolvedType: 'movie'  };
      else if (tvResults.length > 0)                        item = { ...tvResults[0],    _resolvedType: 'series' };
      if (!item) return null;
      return normalizeTMDBItem(item, item._resolvedType, rawId.trim());
    } else {
      const numericId  = rawId.trim().replace(/^tmdb:/i, '');
      const endpoint   = type === 'series' ? 'tv' : 'movie';
      const detailRes  = await fetch(`https://api.themoviedb.org/3/${endpoint}/${numericId}?api_key=${apiKey}&language=en-US`);
      if (!detailRes.ok) return null;
      return normalizeTMDBItem(await detailRes.json(), type);
    }
  } catch (e) {
    console.error('[MediaManager] TMDB lookup error:', e.message);
    return null;
  }
}

// ─── Normalize TMDB item ──────────────────────────────────────────────────────
function normalizeTMDBItem(item, type, imdbIdOverride) {
  const isMovie = type === 'movie';
  const title   = isMovie ? item.title : (item.name || item.title);
  const year    = isMovie
    ? (item.release_date    ? parseInt(item.release_date.substring(0, 4))    : null)
    : (item.first_air_date  ? parseInt(item.first_air_date.substring(0, 4))  : null);
  return {
    id:         `tmdb:${item.id}`,
    tmdbId:     item.id,
    type,
    title,
    year,
    poster:     item.poster_path   ? `https://image.tmdb.org/t/p/w342${item.poster_path}`   : null,
    background: item.backdrop_path ? `https://image.tmdb.org/t/p/w1280${item.backdrop_path}` : null,
    imdb_id:    imdbIdOverride || item.imdb_id || null,
    language:   item.original_language || null,
    overview:   item.overview || null,
  };
}

// ─── Invalidate trailer cache keys ───────────────────────────────────────────
async function invalidateTrailerCache(redis, stremioId, meta) {
  try {
    if (!redis) return;
    // Build all possible stremioId variants that gemini-trailer might cache under
    const ids = new Set([stremioId]);
    if (meta) {
      if (meta.id) ids.add(meta.id);
      if (meta.imdb_id) ids.add(meta.imdb_id);
      if (meta._tmdbId) ids.add(`tmdb:${meta._tmdbId}`);
      if (meta._imdbId) ids.add(meta._imdbId);
    }
    // Delete trailer cache for all versions and all id variants
    const versions = ['v7','v8','v9','v10'];
    const keys = [];
    for (const id of ids) {
      for (const v of versions) {
        keys.push(`trailer:${v}:${id}`);
      }
    }
    if (keys.length > 0) {
      await redis.del(...keys).catch(() => {});
      console.log(`[MediaManager] Invalidated trailer cache keys:`, keys.join(', '));
    }
  } catch {}
}

// ─── Register routes ──────────────────────────────────────────────────────────
function registerMediaManagerRoutes(addon, redis) {

  // Search by title
  addon.get('/api/media-manager/search', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { q, type = 'movie' } = req.query;
    if (!q || !q.trim()) return res.json({ results: [] });
    try {
      res.json({ results: await searchTMDB(q.trim(), type) });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // Lookup by TMDB/IMDB ID
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
    try {
      const override = await redisGet(redis, `${OVERRIDE_PREFIX}${req.params.id}`);
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
    const allowed = ['trailerYtId','poster','background','logo','thumbnail','name','overview','year'];
    const clean   = {};
    for (const key of allowed) {
      if (override[key] !== undefined && override[key] !== '') clean[key] = override[key];
    }
    clean._updatedAt = new Date().toISOString();
    clean._type      = type || 'movie';

    const saved = await redisSet(redis, `${OVERRIDE_PREFIX}${id}`, clean);
    if (!saved) return res.status(500).json({ error: 'Failed to save (Redis unavailable)' });

    // Invalidate trailer cache
    await invalidateTrailerCache(redis, id);

    // Invalidate cache for this movie — fire and forget (don't block the save response)
    setImmediate(async () => {
      try {
        const idsToInvalidate = [id];
        if (id.startsWith('tmdb:')) idsToInvalidate.push(id.replace('tmdb:', ''));

        let totalDeleted = 0;
        for (const searchId of idsToInvalidate) {
          // Single scan pass matching ALL meta component keys for this id
          let cursor = '0';
          do {
            const [nextCursor, keys] = await redis.scan(cursor, 'MATCH', 'meta*:' + searchId, 'COUNT', 500);
            cursor = nextCursor;
            if (keys && keys.length > 0) {
              await redis.del(...keys);
              totalDeleted += keys.length;
            }
          } while (cursor !== '0');
        }
        console.log('[MediaManager] Cache cleared: ' + totalDeleted + ' key(s) for ' + id);
      } catch (e) {
        console.log('[MediaManager] Cache clear note: ' + e.message);
      }
    });

    console.log(`[MediaManager] Override saved for ${id}:`, JSON.stringify(clean));
    res.json({ success: true, override: clean });
  });

  // Clear override
  addon.delete('/api/media-manager/override/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    await redisDel(redis, `${OVERRIDE_PREFIX}${id}`);
    await invalidateTrailerCache(redis, id);
    console.log(`[MediaManager] Override cleared for ${id}`);
    res.json({ success: true });
  });

  // Debug — no auth, open in browser
  addon.get('/api/media-manager/debug', async (req, res) => {
    const redisUrl = process.env.REDIS_URL;
    const result = {
      redis_url_set:      !!redisUrl,
      redis_url_prefix:   redisUrl ? redisUrl.substring(0, 20) + '...' : null,
      redis_url_protocol: redisUrl ? redisUrl.split('://')[0] : null,
      redis_client_passed: !!redis,
      redis_client_status: redis ? (redis.status || 'unknown') : 'not passed',
      tmdb_key_set:  !!process.env.TMDB_API_KEY,
      admin_key_set: !!process.env.ADMIN_KEY,
    };
    try {
      if (redis) {
        await redis.set('debug:ping', 'pong', 'EX', 60);
        const val = await redis.get('debug:ping');
        result.redis_status = val === 'pong' ? 'connected_and_working' : 'connected_but_read_failed';
      } else {
        result.redis_status = 'redis_client_not_provided';
      }
    } catch (e) {
      result.redis_status = 'exception';
      result.redis_error  = e.message;
    }
    res.json(result);
  });

  console.log('[MediaManager] Routes registered: /api/media-manager/*');
}

module.exports = { registerMediaManagerRoutes };
