/**
 * Accurate Trailer Fetcher — Strict & Smart Edition
 * - YouTube HTML scraping (free, no quota)
 * - Groq AI llama-3.1-8b-instant (free, 14,400/day)
 * - Hard pre-filter before AI sees candidates
 * - Strict prompt with mandatory title match check
 * - Sequential queue for rate limiting
 * - Redis 30-day cache
 */

interface TrailerRequest {
  title: string;
  year: number;
  originalLang: string;
  productionCountries?: string[];
  stremioId?: string;
}

interface YouTubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
}

// ─── Indian detection ─────────────────────────────────────────────────────────
const INDIAN_LANG_CODES = new Set([
  'ml','ta','te','kn','hi','bn','mr','gu','pa','or','as','ur'
]);
function isIndianContent(lang: string, countries: string[]): boolean {
  if (INDIAN_LANG_CODES.has(lang?.toLowerCase())) return true;
  if (countries?.some(c =>
    c?.toUpperCase() === 'IN' || c?.toLowerCase().includes('india')
  )) return true;
  return false;
}

// ─── Telugu dubbed channels ───────────────────────────────────────────────────
const TELUGU_DUBBED_CHANNELS = [
  'Aditya Music','Aditya Movies','Mango Music','Mango Telugu Trailers',
  'T-Series Telugu','T-Series','Sony Music South','Saregama Telugu',
  'Lahari Music','Zee Music South','Think Music Telugu','Think Music India',
  'Madhura Audio','Junglee Music Telugu','Divo Music','Silly Monks Music',
  'Muzik247 Telugu','Nanda Audio','MRT Music Telugu','Trend Loud Telugu',
  'Vel Records','Tips Telugu','Tips Official','Sony Music India',
  'Goldmines','Goldmines Telugu','Goldmines Telefilms','Goldmines Bollywood',
  'B4U Telugu','RKD Studios Telugu','Venus Telugu','Eagle Home Entertainments',
  'SRS Media Vision Entertainment','Wam India Telugu','Cinekorn Movies',
  'Cinekorn Entertainment','Biscoot Telugu','Sri Balaji Movies',
  'Bhavani HD Movies','Volga Video','Shalimar Telugu & Hindi Movies',
  'AP International','iDream Telugu Movies','Mango Indian Films',
  'Pen Movies','Pen Multiplex','Speed Audio & Video','Satyam Audios',
  'Central Talkies','Anand Audio','Saregama Music','Eros Now Music',
  'Reliance Entertainment','JioStudios','AA Films','Panorama Studios',
  'Pooja Entertainment','Millennium Audios','Goodwill Entertainments',
  'A2 Music','D Beats Music World','Jhankar Music','Wamindia Telugu',
  'Ultra Movie Parlour','Shemaroo Movies','B4U Movies',
];

const ALL_CHANNELS = [...new Set([
  ...TELUGU_DUBBED_CHANNELS,
  'Marvel India','Warner Bros. India','Sony Pictures Films India',
  'Universal Pictures India','Paramount Pictures India',
  '20th Century Studios India','Disney India','Star Studios',
  'Yash Raj Films','YRF South','Dharma Productions',
  'Red Chillies Entertainment','Zee Studios','Viacom18 Studios',
  'Maddock Films','Balaji Motion Pictures','Rajshri','Excel Entertainment',
  'Nadiadwala Grandson Entertainment','T-Series Films',
  'Lyca Productions','Lyca Productions Telugu','Hombale Films','Sun Pictures',
  'Studio Green','Red Giant Movies','KVN Productions','V Creations',
  'Dream Warrior Pictures','KRG Studios','Wunderbar Films',
  'Raaj Kamal Films International','AGS Entertainment','Sathya Jyothi Films',
  'Aashirvad Cinemas','Friday Film House','Anwar Rasheed Entertainments',
  'Wayfarer Films','Magic Frames','Pushkar Films',
  'Mythri Movie Makers','Sithara Entertainments','Geetha Arts',
  'Haarika & Hassine Creations','Suresh Productions','Sri Venkateswara Creations',
  'Vyjayanthi Network','AK Entertainments','People Media Factory','UV Creations',
  'Annapurna Studios','Arka Media Works','DVV Entertainment',
  'Sukumar Writings','Konidela Production Company','PVP Cinema','NTR Arts',
  'Warner Bros. Pictures','Universal Pictures','Paramount Pictures',
  'Sony Pictures Entertainment','Walt Disney Studios','20th Century Studios',
  'Lionsgate Movies','A24','Marvel Entertainment','DC','Star Wars','Pixar',
  'Lucasfilm','DreamWorks Animation','Illumination','Legendary Entertainment',
  'Netflix','Netflix India','Netflix K-Content','Amazon MGM Studios',
  'Apple TV','Max','Hulu','Peacock','Prime Video','Prime Video India',
  'Disney Plus','DisneyPlus Hotstar','Sony LIV','ZEE5','Aha Video',
  'Sun NXT','JioCinema','Crunchyroll','Funimation',
  'ONE Media','Rotten Tomatoes Trailers','Movieclips Trailers',
  'IGN Movie Trailers','KinoCheck.com','FilmSpot Trailer',
  'JoBlo Movie Trailers','Screen Culture','Fandango',
  'Fresh Movie Trailers','Furious Trailer','FilmSelect Trailer',
  'tvN drama','SBS Drama','JTBC Drama','KBS WORLD TV',
  'CJ ENM Movie','Showbox','Lotte Entertainment',
])];

// ─── HARD reject — these video types are NEVER trailers ──────────────────────
const HARD_REJECT_WORDS = [
  'full movie','full film','complete movie',
  'reaction','reactions','reacting to',
  'review','movie review','film review',
  'song','songs','video song','audio song','jukebox','lyric','lyrics',
  'audio launch','music launch','press meet','press conference',
  'making of','behind the scenes','bts','on the sets',
  'interview','celebrities','celebrity',
  'fan made','fan edit','fan trailer','unofficial',
  'breakdown','explained','analysis','recap',
  'deleted scene','clip','extended scene','featurette',
  'first look','motion poster','title reveal','announcement',
  'promo','tv spot','tv promo',
  'glimpse','sneak peek','preview only',
];

// Words that must appear in a real trailer title
const TRAILER_KEYWORDS = ['trailer','trailers'];

function hardFilter(candidates: YouTubeCandidate[]): YouTubeCandidate[] {
  return candidates.filter(c => {
    const t = c.title.toLowerCase();
    // Must have trailer keyword
    const hasTrailer = TRAILER_KEYWORDS.some(w => t.includes(w));
    if (!hasTrailer) return false;
    // Must NOT have any hard reject word
    const hasReject = HARD_REJECT_WORDS.some(w => t.includes(w));
    if (hasReject) return false;
    return true;
  });
}

// ─── YouTube ID extractor ─────────────────────────────────────────────────────
function extractYTId(text: string): string | null {
  if (!text) return null;
  text = text.trim();
  for (const p of [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ]) { const m = text.match(p); if (m) return m[1]; }
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/\b[a-zA-Z0-9_-]{11}\b/);
  return m ? m[0] : null;
}

// ─── Redis cache (30 days) ────────────────────────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;
const CACHE_PFX = 'trailer:v8:';
let _redis: any = null;

async function getRedis(): Promise<any> {
  if (_redis?.status === 'ready') return _redis;
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

async function cacheGet(k: string): Promise<string | null | undefined> {
  try {
    const r = await getRedis(); if (!r) return undefined;
    const v = await r.get(`${CACHE_PFX}${k}`);
    if (v === null) return undefined;
    return v === 'NULL' ? null : v;
  } catch { return undefined; }
}

async function cacheSet(k: string, v: string | null): Promise<void> {
  try {
    const r = await getRedis(); if (!r) return;
    await r.set(`${CACHE_PFX}${k}`, v ?? 'NULL', { EX: CACHE_TTL });
  } catch {}
}

// ─── Sequential Groq Queue (30 RPM → 1 per 2.5s) ────────────────────────────
const GROQ_GAP_MS = 2500;
let _queueTail: Promise<any> = Promise.resolve();
let _lastGroqCall = 0;

function enqueueGroq<T>(fn: () => Promise<T>): Promise<T> {
  const result = _queueTail.then(async () => {
    const gap = Date.now() - _lastGroqCall;
    if (gap < GROQ_GAP_MS) await new Promise(r => setTimeout(r, GROQ_GAP_MS - gap));
    _lastGroqCall = Date.now();
    return fn();
  });
  _queueTail = result.catch(() => {});
  return result;
}

async function callGroq(prompt: string, apiKey: string): Promise<string | null> {
  return enqueueGroq(async () => {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: 20,
        })
      });
      const data: any = await res.json();
      if (data?.error) { console.error('[Groq] Error:', data.error.message); return null; }
      return data?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (e) { console.error('[Groq] Error:', e); return null; }
  });
}

// ─── FREE YouTube HTML scraper ────────────────────────────────────────────────
async function ytScrape(query: string): Promise<YouTubeCandidate[]> {
  try {
    const url = `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`;
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      }
    });
    const html = await res.text();
    const match = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s);
    if (!match) { console.warn('[YT-Scrape] ytInitialData not found'); return []; }

    const data = JSON.parse(match[1]);
    const contents =
      data?.contents?.twoColumnSearchResultsRenderer
        ?.primaryContents?.sectionListRenderer
        ?.contents?.[0]?.itemSectionRenderer?.contents || [];

    const results: YouTubeCandidate[] = contents
      .filter((i: any) => i?.videoRenderer?.videoId)
      .slice(0, 10)
      .map((i: any) => ({
        videoId: i.videoRenderer.videoId,
        title: i.videoRenderer.title?.runs?.[0]?.text || '',
        channelTitle: i.videoRenderer.ownerText?.runs?.[0]?.text || '',
      }));

    console.log(`[YT-Scrape] "${query}" → ${results.length} raw results`);
    return results;
  } catch (e) {
    console.error('[YT-Scrape] Error:', e);
    return [];
  }
}

// ─── Groq: pick best from pre-filtered candidates ────────────────────────────
async function groqPick(
  title: string,
  year: number,
  preferLang: string,
  fallbackLang: string,
  candidates: YouTubeCandidate[],
  apiKey: string
): Promise<string | null> {
  if (!candidates.length) return null;

  const channelRef = TELUGU_DUBBED_CHANNELS.slice(0, 15).join(', ');
  const list = candidates
    .map((c, i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
    .join('\n');

  const prompt = `You are selecting a trailer for the movie/show: "${title}" (${year}).

CANDIDATES (already pre-filtered, all contain "trailer" in title):
${list}

RULES:
1. The video MUST be for "${title}" — reject anything for a different movie/show
2. Prefer ${preferLang} dubbed trailer from channels like: ${channelRef}
3. If no ${preferLang} dubbed version, pick ${fallbackLang} official trailer
4. Pick the most official-looking channel (studio/distributor preferred)
5. REJECT: full movie, reaction, review, song, fan made, promo, clip, bts

Reply with ONLY the 11-character video ID of your pick.
If none match "${title}" correctly, reply: NULL`;

  const raw = await callGroq(prompt, apiKey);
  console.log(`[Groq] Picked for "${title}": ${raw}`);
  if (!raw || raw === 'NULL') return null;
  return extractYTId(raw);
}

// ─── Groq-only (when scraping returns nothing) ────────────────────────────────
async function groqOnly(
  title: string,
  year: number,
  preferLang: string,
  fallbackLang: string,
  apiKey: string
): Promise<string | null> {
  const dubbed = TELUGU_DUBBED_CHANNELS.slice(0, 10).join(', ');

  const prompt = `Find the YouTube video ID for the OFFICIAL TRAILER of the movie/show "${title}" (${year}).

Priority:
1. ${preferLang} dubbed official trailer from: ${dubbed}
2. ${fallbackLang} official trailer from the studio/distributor channel
3. Any official full trailer in any language

Strict rules:
- Must be a FULL TRAILER for "${title}" specifically
- Never return IDs for: full movie, reaction, review, song, fan made, promo, clip, bts, glimpse, teaser
- If you are not 100% sure the video exists and matches "${title}", return NULL

Reply with ONLY the 11-character YouTube video ID, or NULL.`;

  const raw = await callGroq(prompt, apiKey);
  console.log(`[Groq-Only] "${title}": ${raw}`);
  if (!raw || raw === 'NULL') return null;
  return extractYTId(raw);
}

// ─── Basic pick (no AI) ───────────────────────────────────────────────────────
function basicPick(candidates: YouTubeCandidate[]): string | null {
  // Prefer official channel
  for (const c of candidates) {
    const isOfficial = ALL_CHANNELS.some(ch =>
      c.channelTitle.toLowerCase().includes(ch.toLowerCase())
    );
    if (isOfficial) return c.videoId;
  }
  // Any remaining candidate (already hard-filtered)
  return candidates[0]?.videoId ?? null;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, originalLang, productionCountries = [], stremioId } = params;
  const aiKey = process.env.GROQ_API_KEY || null;

  const indian       = isIndianContent(originalLang, productionCountries);
  const fallbackLang = indian ? (originalLang?.toUpperCase() || 'Original') : 'English';
  const cacheKey     = stremioId || `${title}:${year}`;

  // 1 — Redis cache
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) {
    console.log(`[Trailer] Cache "${title}": ${cached ?? 'none'}`);
    return cached;
  }

  console.log(`[Trailer] "${title}" | ${year} | Indian: ${indian} | Fallback: ${fallbackLang}`);

  let ytId: string | null = null;

  // ── Search A: Telugu dubbed, exact title ─────────────────────────────────
  {
    const q = `"${title}" Telugu dubbed trailer`;
    console.log(`[Trailer] Search A: ${q}`);
    const raw = await ytScrape(q);
    const filtered = hardFilter(raw);
    console.log(`[Trailer] Search A: ${raw.length} raw → ${filtered.length} after hard filter`);
    if (filtered.length) {
      ytId = aiKey
        ? await groqPick(title, year, 'Telugu', fallbackLang, filtered, aiKey)
        : basicPick(filtered);
    }
  }

  // ── Search B: Telugu dubbed, year included ────────────────────────────────
  if (!ytId) {
    const q = `${title} ${year} Telugu dubbed trailer`;
    console.log(`[Trailer] Search B: ${q}`);
    const raw = await ytScrape(q);
    const filtered = hardFilter(raw);
    console.log(`[Trailer] Search B: ${raw.length} raw → ${filtered.length} after hard filter`);
    if (filtered.length) {
      ytId = aiKey
        ? await groqPick(title, year, 'Telugu', fallbackLang, filtered, aiKey)
        : basicPick(filtered);
    }
  }

  // ── Search C: Fallback language ───────────────────────────────────────────
  if (!ytId) {
    const q = `"${title}" ${year} ${fallbackLang} official trailer`;
    console.log(`[Trailer] Search C: ${q}`);
    const raw = await ytScrape(q);
    const filtered = hardFilter(raw);
    console.log(`[Trailer] Search C: ${raw.length} raw → ${filtered.length} after hard filter`);
    if (filtered.length) {
      ytId = aiKey
        ? await groqPick(title, year, 'Telugu', fallbackLang, filtered, aiKey)
        : basicPick(filtered);
    }
  }

  // ── Search D: Any official trailer ───────────────────────────────────────
  if (!ytId) {
    const q = `"${title}" official trailer ${year}`;
    console.log(`[Trailer] Search D: ${q}`);
    const raw = await ytScrape(q);
    const filtered = hardFilter(raw);
    console.log(`[Trailer] Search D: ${raw.length} raw → ${filtered.length} after hard filter`);
    if (filtered.length) {
      ytId = aiKey
        ? await groqPick(title, year, 'Telugu', fallbackLang, filtered, aiKey)
        : basicPick(filtered);
    }
  }

  // ── Groq-only fallback ────────────────────────────────────────────────────
  if (!ytId && aiKey) {
    console.log(`[Trailer] All searches empty — Groq-only for "${title}"`);
    ytId = await groqOnly(title, year, 'Telugu', fallbackLang, aiKey);
  }

  // 2 — Cache result 30 days
  await cacheSet(cacheKey, ytId);

  console.log(ytId
    ? `[Trailer] ✓ "${title}" → ${ytId}`
    : `[Trailer] ✗ No trailer for "${title}"`
  );
  return ytId;
}
