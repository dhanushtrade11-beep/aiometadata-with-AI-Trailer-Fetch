/**
 * Accurate Trailer Fetcher — Rate-Limited + Queue Edition
 * - Gemini 2.5 Flash Lite: 20 RPM limit → requests are queued with delay
 * - YouTube Data API v3: 100 searches/day → cached 30 days in Redis
 * - Telugu dubbed → Fallback (Original for Indian, English for others)
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

// Indian country names as they sometimes appear in meta.country string
const INDIAN_COUNTRY_NAMES = new Set([
  'IN','India','india','INDIA'
]);

function isIndianContent(lang: string, countries: string[]): boolean {
  if (INDIAN_LANG_CODES.has(lang?.toLowerCase())) return true;
  if (countries?.some(c =>
    INDIAN_COUNTRY_NAMES.has(c) ||
    c?.toUpperCase() === 'IN' ||
    c?.toLowerCase().includes('india')
  )) return true;
  return false;
}

// ─── Telugu dubbed channels (searched first) ──────────────────────────────────
const TELUGU_DUBBED_CHANNELS = [
  'Goldmines Telefilms','Goldmines Bollywood','Pen Movies','Pen Multiplex',
  'Aditya Music','Aditya Movies','Lahari Music','Lahari Music Kannada',
  'Mango Mass Media','Mango Music','Speed Audio & Video','Satyam Audios',
  'Central Talkies','Anand Audio','Saregama Music','Tips Official',
  'T-Series','Sony Music South','Eros Now Music','Reliance Entertainment',
  'JioStudios','AA Films','Panorama Studios','Pooja Entertainment',
  'Millennium Audios','Goodwill Entertainments','Saina Movies',
  'A2 Music','D Beats Music World','Jhankar Music','Bhavani HD Movies',
  'Volga Video','Shalimar Telugu & Hindi Movies','AP International',
  'Telugu Filmnagar','TFPC','Wamindia Telugu','Ultra Movie Parlour',
  'Shemaroo Movies','B4U Movies','Shemaroo Entertainment',
];

// ─── All 300 official channels for Gemini reference ───────────────────────────
const ALL_CHANNELS = [
  ...TELUGU_DUBBED_CHANNELS,
  'Warner Bros. Pictures','Universal Pictures','Paramount Pictures',
  'Sony Pictures Entertainment','Walt Disney Studios','20th Century Studios',
  'Lionsgate Movies','Focus Features','Searchlight Pictures','A24',
  'Marvel Entertainment','Marvel UK','Marvel India','Marvel HQ','DC',
  'Star Wars','Pixar','Lucasfilm','DreamWorks Animation','Illumination',
  'Legendary Entertainment','CBS Studios','Warner Bros. TV',
  'Sony Pictures Television','Screen Gems','TriStar Pictures',
  'Sony Pictures Animation','Columbia Pictures','Annapurna Pictures',
  'NEON','IFC Films','Magnolia Pictures','STXfilms','Sony Pictures Classics',
  'Samuel Goldwyn Films','Republic Pictures',
  'Netflix','Netflix India','Netflix K-Content','Amazon MGM Studios',
  'Apple TV','Max','Hulu','Peacock','Prime Video','Prime Video India',
  'Disney Plus','DisneyPlus Hotstar','Sony LIV','ZEE5','Aha Video',
  'Sun NXT','JioCinema','MX Player','ALTBalaji','Hoichoi',
  'Crunchyroll','Funimation','iQIYI','WeTV','KOCOWA TV','Viki Global TV',
  'ONE Media','Rotten Tomatoes Trailers','Movieclips Trailers',
  'IGN Movie Trailers','KinoCheck.com','FilmSpot Trailer','TrailerSpot',
  'JoBlo Movie Trailers','Screen Culture','Fandango',
  'Fresh Movie Trailers','Rapid Trailer','Furious Trailer',
  'MovieAccessTrailers','FilmSelect Trailer','Movie Trailers Source',
  'MovieTrailers Entertainment','Zero Media','FilmTrailerZone',
  'Disney Movie Trailers','Early Movie Trailers',
  'T-Series','Yash Raj Films','Zee Studios','Dharma Productions',
  'Red Chillies Entertainment','Sony Pictures Films India','Viacom18 Studios',
  'BalajiMotionPictures','Maddock Films','RSVP Movies',
  'Excel Movies','Nadiadwala Grandson','Junglee Pictures',
  'Zee Music Company','Sony Music India','B4U Motion Pictures',
  'Rajshri','SET India','Zee TV','Colors TV',
  'Sri Venkateswara Creations','Mythri Movie Makers','Haarika & Hassine Creations',
  'Geetha Arts','Suresh Productions','DVV Entertainment','Vyjayanthi Network',
  'AK Entertainments','Sithara Entertainments','People Media Factory',
  'UV Creations','Annapurna Studios','Think Music India',
  'Lyca Productions','Sun Pictures','Raaj Kamal Films International',
  'V Creations','Studio Green','Dream Warrior Pictures','AGS Entertainment',
  'Sathya Jyothi Films','Red Giant Movies','Wunderbar Studios','Madras Talkies',
  'U1 Records','Muzik247','Hombale Films','PRK Audio','KRG Studios',
  'KVN Productions','Jayanna Films','Pushkar Films','Sun TV',
  'Friday Film House','Wayfarer Films','Kavya Film Company',
  'Aashirvad Cinemas','Manorama Music Songs','E4 Entertainment',
  'Anwar Rasheed Entertainments','Magic Frames','Divo Movies',
  'Saregama Tamil','Kalaignar TV','Vijay Television','TrendMusic',
  'Ayngaran','Star Maa','Zee Telugu','Asianet','Zee Keralam',
  'Colors Kannada','Zee Kannada','Sun Music','NTV Entertainment',
  'BehindwoodsTV','IndiaGlitz Tamil','Galatta Tamil',
  'tvN drama','SBS Drama','JTBC Drama','KBS WORLD TV','KBS Drama',
  'MBC Drama','SBS Catch','CJ ENM Movie','CJ ENM Global',
  'Showbox','Lotte Entertainment','ENA','Next Entertainment World',
  'Goldmines Bollywood','Cinekorn Movies','Venus Movies',
  'BBC','Sky TV','The CW Network','HBO','AMC','SHOWTIME','STARZ',
  'FX Networks','SYFY','National Geographic','Discovery Plus',
  'James Bond 007','Doctor Who',
];

const OFFICIAL_CHANNELS = [...new Set(ALL_CHANNELS)];

// ─── Reject words ─────────────────────────────────────────────────────────────
const REJECT_WORDS = [
  'glimpse','teaser','reaction','review','breakdown',
  'fan made','fan-made','explained','lyric','song',
  'interview','behind the scenes','bts','making of',
  'deleted scene','featurette','promo','clip','sneak peek',
  'first look','announcement','motion poster','title reveal',
  'video song','audio launch','press meet','jukebox',
];

function preFilter(candidates: YouTubeCandidate[]): YouTubeCandidate[] {
  return candidates.filter(c =>
    !REJECT_WORDS.some(w => c.title.toLowerCase().includes(w))
  );
}

// ─── YouTube ID extractor ─────────────────────────────────────────────────────
function extractYTId(text: string): string | null {
  if (!text) return null;
  text = text.trim();
  for (const p of [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ]) {
    const m = text.match(p); if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/[a-zA-Z0-9_-]{11}/);
  return m ? m[0] : null;
}

// ─── Redis cache (30 days) ────────────────────────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;
const CACHE_PFX = 'trailer:v4:';
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

// ─── Gemini rate limiter ──────────────────────────────────────────────────────
// Free tier: 20 RPM → enforce minimum 3.5s between calls to be safe
let _lastGeminiCall = 0;
const GEMINI_MIN_INTERVAL_MS = 3500; // 3.5 seconds between calls

async function waitForGeminiSlot(): Promise<void> {
  const now = Date.now();
  const elapsed = now - _lastGeminiCall;
  if (elapsed < GEMINI_MIN_INTERVAL_MS) {
    const wait = GEMINI_MIN_INTERVAL_MS - elapsed;
    await new Promise(r => setTimeout(r, wait));
  }
  _lastGeminiCall = Date.now();
}

// ─── Gemini API call (with rate limiting + retry) ─────────────────────────────
async function callGemini(prompt: string, apiKey: string): Promise<string | null> {
  await waitForGeminiSlot();

  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20 }
        })
      }
    );
    const data: any = await res.json();

    if (data?.error) {
      const msg: string = data.error.message || '';
      // Rate limit hit — wait and retry once
      if (msg.includes('429') || msg.toLowerCase().includes('quota')) {
        const retryMatch = msg.match(/retry in (\d+)/i);
        const waitSec = retryMatch ? parseInt(retryMatch[1]) + 2 : 30;
        console.warn(`[Gemini] Rate limited — waiting ${waitSec}s`);
        await new Promise(r => setTimeout(r, waitSec * 1000));
        _lastGeminiCall = 0; // reset so next call goes immediately
        return callGemini(prompt, apiKey); // retry once
      }
      console.error('[Gemini] Error:', msg);
      return null;
    }

    return data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() ?? null;
  } catch (e) {
    console.error('[Gemini] Fetch error:', e);
    return null;
  }
}

// ─── YouTube search ───────────────────────────────────────────────────────────
let _ytQuotaDead = false;

async function ytSearch(q: string, key: string): Promise<YouTubeCandidate[]> {
  if (_ytQuotaDead) return [];
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part','snippet');
  url.searchParams.set('q', q);
  url.searchParams.set('type','video');
  url.searchParams.set('maxResults','10');
  url.searchParams.set('videoEmbeddable','true');
  url.searchParams.set('key', key);
  try {
    const res = await fetch(url.toString());
    const data: any = await res.json();
    if (data?.error) {
      const msg: string = data.error.message || '';
      if (msg.toLowerCase().includes('quota')) {
        console.warn('[YouTube] Daily quota exhausted');
        _ytQuotaDead = true;
      } else {
        console.error('[YouTube] Error:', msg);
      }
      return [];
    }
    return (data?.items || [])
      .filter((i: any) => i?.id?.videoId)
      .map((i: any) => ({
        videoId: i.id.videoId,
        title: i.snippet?.title || '',
        channelTitle: i.snippet?.channelTitle || '',
      }));
  } catch (e) { console.error('[YouTube] Error:', e); return []; }
}

// ─── Gemini pick from YouTube candidates ──────────────────────────────────────
async function geminiPick(
  title: string, year: number,
  preferLang: string, fallbackLang: string,
  candidates: YouTubeCandidate[], apiKey: string
): Promise<string | null> {
  if (!candidates.length) return null;

  const channelRef = [
    ...TELUGU_DUBBED_CHANNELS.slice(0,12),
    'Warner Bros. Pictures','Universal Pictures','Netflix',
    'Marvel Entertainment','T-Series','Yash Raj Films',
    'Mythri Movie Makers','Sri Venkateswara Creations','Hombale Films',
    'Sun Pictures','DVV Entertainment',
  ].join(', ');

  const list = candidates
    .map((c,i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
    .join('\n');

  const prompt = `Pick the best official trailer for "${title}" (${year}) from these YouTube results.

CANDIDATES:
${list}

KNOWN OFFICIAL CHANNELS (prefer these):
${channelRef}

PRIORITY:
1. ${preferLang} dubbed trailer (any channel)
2. ${fallbackLang} official trailer (known channel preferred)
3. Any full official trailer in any language

HARD REJECT — never pick:
glimpse, teaser, song, lyric, reaction, review, fan made, promo, clip, bts, making of, first look, motion poster, video song, audio launch, press meet, jukebox

LENIENCY: If title contains "trailer" and is NOT in reject list → PICK IT regardless of channel.

RETURN: Only the 11-character video ID. Nothing else.
If nothing qualifies: NULL`;

  const raw = await callGemini(prompt, apiKey);
  console.log(`[Gemini] Picked for "${title}": ${raw}`);
  if (!raw || raw === 'NULL') return null;
  return extractYTId(raw);
}

// ─── Gemini-only (no YouTube or quota dead) ───────────────────────────────────
async function geminiOnly(
  title: string, year: number,
  preferLang: string, fallbackLang: string, apiKey: string
): Promise<string | null> {
  const dubbed = TELUGU_DUBBED_CHANNELS.slice(0,10).join(', ');

  const prompt = `Find the YouTube video ID for the official trailer of "${title}" (${year}).

PRIORITY:
1. ${preferLang} dubbed trailer — channels like: ${dubbed}
2. ${fallbackLang} official trailer from studio channel
3. Any official full trailer

RULES: Full trailers only. Reject: glimpse, teaser, song, reaction, review, fan made, promo, clip, bts, making of, video song, audio launch.
RETURN: Only the 11-character YouTube video ID or NULL.`;

  const raw = await callGemini(prompt, apiKey);
  console.log(`[Gemini-Only] "${title}": ${raw}`);
  if (!raw || raw === 'NULL') return null;
  return extractYTId(raw);
}

// ─── Basic fallback (no AI) ───────────────────────────────────────────────────
function basicPick(candidates: YouTubeCandidate[]): string | null {
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    const official = OFFICIAL_CHANNELS.some(oc =>
      c.channelTitle.toLowerCase().includes(oc.toLowerCase())
    );
    if (official && t.includes('trailer') && !REJECT_WORDS.some(w => t.includes(w)))
      return c.videoId;
  }
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    if (t.includes('trailer') && !REJECT_WORDS.some(w => t.includes(w)))
      return c.videoId;
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, originalLang, productionCountries = [], stremioId } = params;
  const ytKey = process.env.YOUTUBE_API_KEY;
  const gKey  = process.env.GEMINI_API_KEY;

  if (!ytKey && !gKey) { console.error('[Trailer] No API keys.'); return null; }

  const indian       = isIndianContent(originalLang, productionCountries);
  const fallbackLang = indian ? (originalLang?.toUpperCase() || 'Original') : 'English';
  const cacheKey     = stremioId || `${title}:${year}`;

  // 1 — Redis cache check
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) {
    console.log(`[Trailer] Cache "${title}": ${cached ?? 'none'}`);
    return cached;
  }

  console.log(`[Trailer] "${title}" | ${year} | Indian: ${indian} | Fallback: ${fallbackLang}`);

  let ytId: string | null = null;

  // ── YouTube + Gemini path ─────────────────────────────────────────────────
  if (ytKey && !_ytQuotaDead) {

    // Search A — Telugu dubbed
    const qA = `"${title}" Telugu dubbed trailer`;
    console.log(`[Trailer] Search A: ${qA}`);
    const rA = preFilter(await ytSearch(qA, ytKey));
    console.log(`[Trailer] Search A: ${rA.length} candidates`);
    if (rA.length) {
      ytId = gKey
        ? await geminiPick(title, year, 'Telugu', fallbackLang, rA, gKey)
        : basicPick(rA);
    }

    // Search B — Telugu dubbed broader
    if (!ytId && !_ytQuotaDead) {
      const qB = `${title} ${year} Telugu dubbed official trailer`;
      console.log(`[Trailer] Search B: ${qB}`);
      const rB = preFilter(await ytSearch(qB, ytKey));
      console.log(`[Trailer] Search B: ${rB.length} candidates`);
      if (rB.length) {
        ytId = gKey
          ? await geminiPick(title, year, 'Telugu', fallbackLang, rB, gKey)
          : basicPick(rB);
      }
    }

    // Search C — Fallback language
    if (!ytId && !_ytQuotaDead) {
      const qC = `${title} ${year} ${fallbackLang} official trailer`;
      console.log(`[Trailer] Search C: ${qC}`);
      const rC = preFilter(await ytSearch(qC, ytKey));
      console.log(`[Trailer] Search C: ${rC.length} candidates`);
      if (rC.length) {
        ytId = gKey
          ? await geminiPick(title, year, 'Telugu', fallbackLang, rC, gKey)
          : basicPick(rC);
      }
    }
  }

  // ── Gemini-only fallback ──────────────────────────────────────────────────
  if (!ytId && gKey) {
    ytId = await geminiOnly(title, year, 'Telugu', fallbackLang, gKey);
  }

  // 2 — Cache result 30 days
  await cacheSet(cacheKey, ytId);

  console.log(ytId
    ? `[Trailer] ✓ "${title}" → ${ytId}`
    : `[Trailer] ✗ No trailer for "${title}"`
  );
  return ytId;
}
