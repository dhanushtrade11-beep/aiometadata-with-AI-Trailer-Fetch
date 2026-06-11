/**
 * Accurate Trailer Fetcher — 100% Free Edition
 * - YouTube HTML scraping (no API key, no quota)
 * - Groq AI with llama-3.1-8b-instant (free, 14,400 req/day, 30 RPM)
 * - Sequential queue to respect Groq rate limits
 * - Redis cache 30 days — each movie costs quota only once
 *
 * Priority: Telugu dubbed → Fallback (Original for Indian, English for others)
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

// ─── Telugu dubbed channels (for Groq context) ────────────────────────────────
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
  'Pen Movies','Pen Multiplex','Pen India Ltd','Speed Audio & Video',
  'Satyam Audios','Central Talkies','Anand Audio','Saregama Music',
  'Eros Now Music','Reliance Entertainment','JioStudios','AA Films',
  'Panorama Studios','Pooja Entertainment','Millennium Audios',
  'Goodwill Entertainments','Saina Movies','A2 Music','D Beats Music World',
  'Jhankar Music','Wamindia Telugu','Ultra Movie Parlour',
  'Shemaroo Movies','B4U Movies','Shemaroo Entertainment',
];

// ─── All official channels ────────────────────────────────────────────────────
const ALL_CHANNELS = [...new Set([
  ...TELUGU_DUBBED_CHANNELS,
  'Marvel India','Warner Bros. India','Sony Pictures Films India',
  'Universal Pictures India','Paramount Pictures India',
  '20th Century Studios India','Disney India','Star Studios',
  'Yash Raj Films','YRF South','Dharma Productions',
  'Red Chillies Entertainment','Zee Studios','Viacom18 Studios',
  'Maddock Films','Balaji Motion Pictures','Rajshri','Excel Entertainment',
  'Nadiadwala Grandson Entertainment','T-Series Films','Cape of Good Films',
  'Lyca Productions','Lyca Productions Telugu','Hombale Films','Sun Pictures',
  'Studio Green','Studio Green Telugu','Red Giant Movies','KVN Productions',
  'V Creations','Dream Warrior Pictures','Y NOT Studios','KRG Studios',
  '2D Entertainment','Wunderbar Films','Raaj Kamal Films International',
  'AGS Entertainment','Sathya Jyothi Films','Aashirvad Cinemas',
  'Friday Film House','Anwar Rasheed Entertainments','Mammootty Kampany',
  'Wayfarer Films','Prithviraj Productions','Magic Frames','Pushkar Films',
  'Mythri Movie Makers','Sithara Entertainments','Geetha Arts',
  'Haarika & Hassine Creations','Suresh Productions','Sri Venkateswara Creations',
  'Vyjayanthi Network','AK Entertainments','People Media Factory','UV Creations',
  'GA2 Pictures','Annapurna Studios','Arka Media Works','DVV Entertainment',
  'Sukumar Writings','Konidela Production Company','PVP Cinema',
  'Puri Connects','NTR Arts','Prasanth Varma Cinematic Universe',
  'Warner Bros. Pictures','Universal Pictures','Paramount Pictures',
  'Sony Pictures Entertainment','Walt Disney Studios','20th Century Studios',
  'Lionsgate Movies','Focus Features','Searchlight Pictures','A24',
  'Marvel Entertainment','Marvel UK','Marvel HQ','DC','Star Wars','Pixar',
  'Lucasfilm','DreamWorks Animation','Illumination','Legendary Entertainment',
  'Netflix','Netflix India','Netflix K-Content','Amazon MGM Studios',
  'Apple TV','Max','Hulu','Peacock','Prime Video','Prime Video India',
  'Disney Plus','DisneyPlus Hotstar','Sony LIV','ZEE5','Aha Video',
  'Sun NXT','JioCinema','MX Player','Hoichoi','Crunchyroll','Funimation',
  'ONE Media','Rotten Tomatoes Trailers','Movieclips Trailers',
  'IGN Movie Trailers','KinoCheck.com','FilmSpot Trailer','TrailerSpot',
  'JoBlo Movie Trailers','Screen Culture','Fandango',
  'Fresh Movie Trailers','Furious Trailer','FilmSelect Trailer',
  'tvN drama','SBS Drama','JTBC Drama','KBS WORLD TV',
  'CJ ENM Movie','Showbox','Lotte Entertainment','ENA',
])];

// ─── Reject words ─────────────────────────────────────────────────────────────
const REJECT_WORDS = [
  'glimpse','teaser','reaction','review','breakdown',
  'fan made','fan-made','explained','lyric','song',
  'interview','behind the scenes','bts','making of',
  'deleted scene','featurette','promo','clip','sneak peek',
  'first look','announcement','motion poster','title reveal',
  'video song','audio launch','press meet','jukebox','full movie',
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
  ]) { const m = text.match(p); if (m) return m[1]; }
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/[a-zA-Z0-9_-]{11}/);
  return m ? m[0] : null;
}

// ─── Redis cache (30 days) ────────────────────────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;
const CACHE_PFX = 'trailer:v7:';
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

// ─── Sequential Groq Queue (30 RPM = 1 per 2.1s, use 2.5s to be safe) ────────
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

// ─── FREE YouTube HTML scraper (no API key, no quota) ────────────────────────
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

    // YouTube embeds search results as JSON inside ytInitialData
    const match = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s);
    if (!match) {
      console.warn('[YT-Scrape] Could not find ytInitialData');
      return [];
    }

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

    console.log(`[YT-Scrape] "${query}" → ${results.length} results`);
    return results;
  } catch (e) {
    console.error('[YT-Scrape] Error:', e);
    return [];
  }
}

// ─── Groq AI: pick best candidate ────────────────────────────────────────────
async function groqPick(
  title: string, year: number,
  preferLang: string, fallbackLang: string,
  candidates: YouTubeCandidate[], apiKey: string
): Promise<string | null> {
  if (!candidates.length) return null;

  const channelRef = TELUGU_DUBBED_CHANNELS.slice(0, 18).join(', ');
  const list = candidates
    .map((c, i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
    .join('\n');

  const prompt = `Pick the best official trailer for "${title}" (${year}) from these YouTube results.

CANDIDATES:
${list}

PREFERRED CHANNELS (Telugu dubbed): ${channelRef}

SELECTION PRIORITY:
1. ${preferLang} dubbed trailer from a preferred channel
2. ${preferLang} dubbed trailer from any channel
3. ${fallbackLang} official trailer
4. Any full official trailer in any language

HARD REJECT - never pick if title contains:
glimpse, teaser, song, lyric, reaction, review, fan made, promo, clip, bts, making of, first look, motion poster, video song, audio launch, press meet, jukebox, full movie

ACCEPT RULE: If title contains "trailer" and is NOT in reject list above → pick it.

Reply with ONLY the 11-character YouTube video ID of your best pick.
If nothing qualifies, reply: NULL`;

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

      if (data?.error) {
        console.error('[Groq] Error:', data.error.message);
        return null;
      }

      const raw = data?.choices?.[0]?.message?.content?.trim();
      console.log(`[Groq] Picked for "${title}": ${raw}`);
      if (!raw || raw === 'NULL') return null;
      return extractYTId(raw);
    } catch (e) {
      console.error('[Groq] Fetch error:', e);
      return null;
    }
  });
}

// ─── Groq-only (no YouTube results available) ─────────────────────────────────
async function groqOnly(
  title: string, year: number,
  preferLang: string, fallbackLang: string, apiKey: string
): Promise<string | null> {
  const dubbed = TELUGU_DUBBED_CHANNELS.slice(0, 10).join(', ');

  const prompt = `Find the YouTube video ID for the official trailer of "${title}" (${year}).

Search priority:
1. ${preferLang} dubbed trailer from channels like: ${dubbed}
2. ${fallbackLang} official trailer from the studio channel
3. Any official full trailer in any language

Rules: Full trailers only. Never return IDs for: glimpse, teaser, song, reaction, review, fan made, promo, clip, bts, making of, video song, audio launch, full movie.

Reply with ONLY the 11-character YouTube video ID, or NULL if not found/unsure.`;

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
      if (data?.error) { console.error('[Groq-Only] Error:', data.error.message); return null; }
      const raw = data?.choices?.[0]?.message?.content?.trim();
      console.log(`[Groq-Only] "${title}": ${raw}`);
      if (!raw || raw === 'NULL') return null;
      return extractYTId(raw);
    } catch (e) {
      console.error('[Groq-Only] Fetch error:', e);
      return null;
    }
  });
}

// ─── Basic fallback (no AI available) ────────────────────────────────────────
function basicPick(candidates: YouTubeCandidate[]): string | null {
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    const official = ALL_CHANNELS.some(ch => c.channelTitle.toLowerCase().includes(ch.toLowerCase()));
    if (official && t.includes('trailer') && !REJECT_WORDS.some(w => t.includes(w))) return c.videoId;
  }
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    if (t.includes('trailer') && !REJECT_WORDS.some(w => t.includes(w))) return c.videoId;
  }
  return null;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, originalLang, productionCountries = [], stremioId } = params;

  // Supports both old Gemini key and new Groq key
  const groqKey   = process.env.GROQ_API_KEY;
  const geminiKey = process.env.GEMINI_API_KEY; // kept as fallback label if someone still has it

  if (!groqKey && !geminiKey) {
    console.warn('[Trailer] No AI key set (GROQ_API_KEY). Will use basic picker.');
  }

  const aiKey = groqKey || null; // only Groq used now

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

  // ── Search A: Telugu dubbed (quoted title for precision) ─────────────────
  const qA = `"${title}" Telugu dubbed trailer`;
  console.log(`[Trailer] Search A: ${qA}`);
  const rA = preFilter(await ytScrape(qA));
  console.log(`[Trailer] Search A: ${rA.length} candidates after filter`);
  if (rA.length) {
    ytId = aiKey ? await groqPick(title, year, 'Telugu', fallbackLang, rA, aiKey) : basicPick(rA);
  }

  // ── Search B: Telugu dubbed broader ──────────────────────────────────────
  if (!ytId) {
    const qB = `${title} ${year} Telugu dubbed official trailer`;
    console.log(`[Trailer] Search B: ${qB}`);
    const rB = preFilter(await ytScrape(qB));
    console.log(`[Trailer] Search B: ${rB.length} candidates after filter`);
    if (rB.length) {
      ytId = aiKey ? await groqPick(title, year, 'Telugu', fallbackLang, rB, aiKey) : basicPick(rB);
    }
  }

  // ── Search C: Fallback language ───────────────────────────────────────────
  if (!ytId) {
    const qC = `${title} ${year} ${fallbackLang} official trailer`;
    console.log(`[Trailer] Search C: ${qC}`);
    const rC = preFilter(await ytScrape(qC));
    console.log(`[Trailer] Search C: ${rC.length} candidates after filter`);
    if (rC.length) {
      ytId = aiKey ? await groqPick(title, year, 'Telugu', fallbackLang, rC, aiKey) : basicPick(rC);
    }
  }

  // ── Groq-only fallback (if scraping returned nothing) ────────────────────
  if (!ytId && aiKey) {
    console.log(`[Trailer] Groq-only fallback for "${title}"`);
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
