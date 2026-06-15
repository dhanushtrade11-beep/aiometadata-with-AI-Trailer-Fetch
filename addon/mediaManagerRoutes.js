/**
 * Media Manager API Routes
 * Overrides are stored in PostgreSQL (permanent) with Redis as a fast-read cache.
 *
 * Routes:
 *   GET    /api/media-manager/search?q=&type=   → search TMDB by title
 *   GET    /api/media-manager/lookup?id=&type=  → lookup by TMDB or IMDB id
 *   GET    /api/media-manager/override/:id      → get existing override
 *   POST   /api/media-manager/override/:id      → save override
 *   DELETE /api/media-manager/override/:id      → clear override
 *   GET    /api/media-manager/list              → list all overrides
 *   GET    /api/media-manager/debug             → diagnostics (no auth)
 */

'use strict';

const database = require('./lib/database');

const OVERRIDE_PREFIX = 'override:v1:';
const REDIS_CACHE_TTL = 86400; // 24 hours in Redis (just as cache, DB is source of truth)

// ─── Admin check ──────────────────────────────────────────────────────────────
function requireAdmin(req, res) {
  const adminKey = process.env.ADMIN_KEY;
  if (adminKey && req.headers['x-admin-key'] !== adminKey) {
    res.status(401).json({ error: 'Unauthorized' });
    return false;
  }
  return true;
}

// ─── Database helpers ─────────────────────────────────────────────────────────

async function ensureOverridesTable() {
  try {
    const isPostgres = database.type === 'postgres';
    const query = isPostgres
      ? `CREATE TABLE IF NOT EXISTS media_overrides (
           id SERIAL PRIMARY KEY,
           stremio_id VARCHAR(255) UNIQUE NOT NULL,
           override_data JSONB NOT NULL,
           created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
           updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
         )`
      : `CREATE TABLE IF NOT EXISTS media_overrides (
           id INTEGER PRIMARY KEY AUTOINCREMENT,
           stremio_id TEXT UNIQUE NOT NULL,
           override_data TEXT NOT NULL,
           created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
           updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
         )`;
    await database.runQuery(query);
    console.log('[MediaManager] media_overrides table ready');
  } catch (e) {
    console.error('[MediaManager] Failed to create overrides table:', e.message);
  }
}

async function dbGetOverride(stremioId) {
  try {
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
    console.error('[MediaManager] DB get error:', e.message);
    return null;
  }
}

async function dbSetOverride(stremioId, data) {
  try {
    await database.initialize();
    const isPostgres = database.type === 'postgres';
    const dataStr = JSON.stringify(data);
    if (isPostgres) {
      await database.runQuery(
        `INSERT INTO media_overrides (stremio_id, override_data, updated_at)
         VALUES ($1, $2, CURRENT_TIMESTAMP)
         ON CONFLICT (stremio_id)
         DO UPDATE SET override_data = $2, updated_at = CURRENT_TIMESTAMP`,
        [stremioId, dataStr]
      );
    } else {
      await database.runQuery(
        `INSERT INTO media_overrides (stremio_id, override_data, updated_at)
         VALUES (?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(stremio_id)
         DO UPDATE SET override_data = ?, updated_at = CURRENT_TIMESTAMP`,
        [stremioId, dataStr, dataStr]
      );
    }
    return true;
  } catch (e) {
    console.error('[MediaManager] DB set error:', e.message);
    return false;
  }
}

async function dbDeleteOverride(stremioId) {
  try {
    await database.initialize();
    const isPostgres = database.type === 'postgres';
    const query = isPostgres
      ? 'DELETE FROM media_overrides WHERE stremio_id = $1'
      : 'DELETE FROM media_overrides WHERE stremio_id = ?';
    await database.runQuery(query, [stremioId]);
    return true;
  } catch (e) {
    console.error('[MediaManager] DB delete error:', e.message);
    return false;
  }
}

async function dbListAllOverrides() {
  try {
    await database.initialize();
    const rows = await database.allQuery(
      'SELECT stremio_id, override_data, updated_at FROM media_overrides ORDER BY updated_at DESC'
    );
    return rows.map(row => ({
      id: row.stremio_id,
      override: typeof row.override_data === 'string'
        ? JSON.parse(row.override_data)
        : row.override_data,
      updated_at: row.updated_at,
    }));
  } catch (e) {
    console.error('[MediaManager] DB list error:', e.message);
    return [];
  }
}

// ─── Redis helpers (cache layer only) ────────────────────────────────────────
async function redisCacheGet(redis, key) {
  try {
    if (!redis) return null;
    const v = await redis.get(key);
    return v ? JSON.parse(v) : null;
  } catch { return null; }
}

async function redisCacheSet(redis, key, value) {
  try {
    if (!redis) return;
    await redis.set(key, JSON.stringify(value), 'EX', REDIS_CACHE_TTL);
  } catch { }
}

async function redisCacheDel(redis, key) {
  try {
    if (!redis) return;
    await redis.del(key);
  } catch { }
}

// ─── Get override (DB is source of truth, Redis is cache) ────────────────────
async function getOverride(redis, stremioId) {
  const cached = await redisCacheGet(redis, `${OVERRIDE_PREFIX}${stremioId}`);
  if (cached) return cached;
  const fromDb = await dbGetOverride(stremioId);
  if (fromDb) {
    await redisCacheSet(redis, `${OVERRIDE_PREFIX}${stremioId}`, fromDb);
  }
  return fromDb;
}

// ─── Save override (DB = permanent, Redis = cache) ───────────────────────────
async function saveOverride(redis, stremioId, data) {
  const saved = await dbSetOverride(stremioId, data);
  if (!saved) return false;
  await redisCacheSet(redis, `${OVERRIDE_PREFIX}${stremioId}`, data);
  return true;
}

// ─── Delete override ──────────────────────────────────────────────────────────
async function deleteOverride(redis, stremioId) {
  await dbDeleteOverride(stremioId);
  await redisCacheDel(redis, `${OVERRIDE_PREFIX}${stremioId}`);
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
    const ids = new Set([stremioId]);
    if (meta) {
      if (meta.id) ids.add(meta.id);
      if (meta.imdb_id) ids.add(meta.imdb_id);
      if (meta._tmdbId) ids.add(`tmdb:${meta._tmdbId}`);
      if (meta._imdbId) ids.add(meta._imdbId);
    }
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

  // Ensure DB table exists on startup
  ensureOverridesTable().catch(e => console.error('[MediaManager] Table init error:', e.message));

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
      const override = await getOverride(redis, req.params.id);
      res.json({ override: override || null });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  });

  // List all overrides
  addon.get('/api/media-manager/list', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    try {
      const overrides = await dbListAllOverrides();
      res.json({ overrides, total: overrides.length });
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

    const saved = await saveOverride(redis, id, clean);
    if (!saved) return res.status(500).json({ error: 'Failed to save to database' });

    const imdbId = req.body && req.body.imdbId;
    if (imdbId && imdbId.startsWith('tt')) {
      await saveOverride(redis, imdbId, clean).catch(() => {});
      console.log('[MediaManager] Also saved override under IMDB id: ' + imdbId);
    }

    await invalidateTrailerCache(redis, id);

    setImmediate(async () => {
      try {
        const idsToInvalidate = [id];
        if (id.startsWith('tmdb:')) idsToInvalidate.push(id.replace('tmdb:', ''));
        let totalDeleted = 0;
        for (const searchId of idsToInvalidate) {
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

    console.log(`[MediaManager] Override saved to DB for ${id}:`, JSON.stringify(clean));
    res.json({ success: true, override: clean });
  });

  // Clear override
  addon.delete('/api/media-manager/override/:id', async (req, res) => {
    if (!requireAdmin(req, res)) return;
    const { id } = req.params;
    await deleteOverride(redis, id);
    await invalidateTrailerCache(redis, id);
    console.log(`[MediaManager] Override cleared for ${id}`);
    res.json({ success: true });
  });

  // Debug
  addon.get('/api/media-manager/debug', async (req, res) => {
    const redisUrl = process.env.REDIS_URL;
    const result = {
      redis_url_set:       !!redisUrl,
      redis_url_prefix:    redisUrl ? redisUrl.substring(0, 20) + '...' : null,
      redis_client_passed: !!redis,
      redis_client_status: redis ? (redis.status || 'unknown') : 'not passed',
      tmdb_key_set:        !!process.env.TMDB_API_KEY,
      admin_key_set:       !!process.env.ADMIN_KEY,
      database_type:       database.type || 'not initialized',
      storage_backend:     'PostgreSQL (permanent) + Redis (cache)',
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
    try {
      const count = await database.allQuery('SELECT COUNT(*) as count FROM media_overrides');
      result.db_overrides_count = count[0]?.count || 0;
      result.db_status = 'connected_and_working';
    } catch (e) {
      result.db_status = 'error';
      result.db_error  = e.message;
    }
    res.json(result);
  });

  console.log('[MediaManager] Routes registered: /api/media-manager/*');
}

module.exports = { registerMediaManagerRoutes };
