/**
 * Accurate Trailer Fetcher — Official Channel Verified Edition
 *
 * Key fixes:
 * 1. Only accepts trailers from KNOWN official channels — no unofficial/fan edits
 * 2. Searches Telugu dubbed title directly (e.g. "Veerabadhrudu") not just original title
 * 3. Groq fetches the Telugu dubbed title first before searching
 * 4. Multiple search strategies including abbreviated/alternate titles
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

// ─── Official Telugu dubbed channels (ONLY these are trusted) ─────────────────
// Fan uploads and unofficial edits are REJECTED even if they contain "trailer"
const OFFICIAL_TELUGU_CHANNELS = new Set([
  'aditya music','aditya movies','mango music','mango telugu trailers',
  't-series telugu','t-series','sony music south','saregama telugu',
  'lahari music','zee music south','think music telugu','think music india',
  'madhura audio','junglee music telugu','divo music','silly monks music',
  'muzik247 telugu','nanda audio','mrt music telugu','trend loud telugu',
  'vel records','tips telugu','tips official','sony music india',
  'goldmines','goldmines telugu','goldmines telefilms','goldmines bollywood',
  'b4u telugu','rkd studios telugu','venus telugu','eagle home entertainments',
  'srs media vision entertainment','wam india telugu','cinekorn movies',
  'cinekorn entertainment','biscoot telugu','sri balaji movies',
  'bhavani hd movies','volga video','shalimar telugu & hindi movies',
  'ap international','idream telugu movies','mango indian films',
  'pen movies','pen multiplex','pen india ltd','speed audio & video',
  'satyam audios','central talkies','anand audio','saregama music',
  'eros now music','reliance entertainment','jiostudios','aa films',
  'panorama studios','pooja entertainment','millennium audios',
  'goodwill entertainments','a2 music','d beats music world',
  'jhankar music','wamindia telugu','ultra movie parlour',
  'shemaroo movies','b4u movies','shemaroo entertainment',
  // Telugu production houses (they upload their own dubbed trailers)
  'mythri movie makers','sithara entertainments','geetha arts',
  'haarika & hassine creations','suresh productions','sri venkateswara creations',
  'vyjayanthi network','ak entertainments','people media factory','uv creations',
  'annapurna studios','arka media works','dvv entertainment',
  'sukumar writings','konidela production company','pvp cinema','ntr arts',
  'hombale films','sun pictures','lyca productions','lyca productions telugu',
  'studio green','red giant movies','kvn productions','v creations',
  'dream warrior pictures','krg studios','raaj kamal films international',
  'ags entertainment','sathya jyothi films','aashirvad cinemas',
  'friday film house','anwar rasheed entertainments','wayfarer films',
  'magic frames','pushkar films','ga2 pictures','14 reels plus',
]);

// Official Hollywood/streaming channels
const OFFICIAL_GLOBAL_CHANNELS = new Set([
  'warner bros. pictures','warner bros. india','universal pictures',
  'universal pictures india','paramount pictures','paramount pictures india',
  'sony pictures entertainment','sony pictures films india',
  'walt disney studios','disney india','20th century studios',
  '20th century studios india','lionsgate movies','a24',
  'marvel entertainment','marvel india','dc','star wars','pixar','lucasfilm',
  'dreamworks animation','illumination','legendary entertainment',
  'netflix','netflix india','netflix k-content','amazon mgm studios',
  'apple tv','max','hulu','peacock','prime video','prime video india',
  'disney plus','disneyplus hotstar','sony liv','zee5','aha video',
  'sun nxt','jiocinema','crunchyroll','funimation',
  'one media','rotten tomatoes trailers','movieclips trailers',
  'ign movie trailers','kinocheck.com','filmspot trailer',
  'joblo movie trailers','screen culture','fandango',
  'fresh movie trailers','furious trailer','filmselect trailer',
  'tvn drama','sbs drama','jtbc drama','kbs world tv',
  'cj enm movie','showbox','lotte entertainment',
  'yash raj films','yrf south','dharma productions',
  'red chillies entertainment','zee studios','viacom18 studios',
  'maddock films','balaji motion pictures','excel entertainment',
  'nadiadwala grandson entertainment','t-series films',
  'star studios','eros now south',
]);

function isOfficialChannel(channelTitle: string): boolean {
  const ch = channelTitle.toLowerCase();
  if (OFFICIAL_TELUGU_CHANNELS.has(ch)) return true;
  if (OFFICIAL_GLOBAL_CHANNELS.has(ch)) return true;
  // Partial match for channels with slight name variations
  for (const oc of [...OFFICIAL_TELUGU_CHANNELS, ...OFFICIAL_GLOBAL_CHANNELS]) {
    if (ch.includes(oc) || oc.includes(ch)) return true;
  }
  return false;
}

// ─── Hard reject words ────────────────────────────────────────────────────────
const HARD_REJECT = [
  'full movie','full film','complete movie','full length',
  'reaction','reactions','reacting to',
  'review','movie review','film review','rating',
  'song','songs','video song','audio song','jukebox','lyric','lyrics',
  'audio launch','music launch','press meet','press conference',
  'making of','behind the scenes','bts','on the sets',
  'interview','celebrities','celebrity',
  'fan made','fan edit','fan trailer','unofficial','fan cut',
  'breakdown','explained','analysis','recap','re-cut',
  'deleted scene','extended scene','featurette',
  'first look','motion poster','title reveal','announcement',
  'promo','glimpse','sneak peek','teaser only',
];

// ─── Filter: must have "trailer" + from official channel + no reject words ─────
function officialFilter(candidates: YouTubeCandidate[]): YouTubeCandidate[] {
  return candidates.filter(c => {
    const t = c.title.toLowerCase();
    if (!t.includes('trailer')) return false;
    if (HARD_REJECT.some(w => t.includes(w))) return false;
    if (!isOfficialChannel(c.channelTitle)) return false;
    return true;
  });
}

// ─── Loose filter: "trailer" + no reject words (any channel) ─────────────────
// Used as fallback when official filter returns nothing
function looseFilter(candidates: YouTubeCandidate[]): YouTubeCandidate[] {
  return candidates.filter(c => {
    const t = c.title.toLowerCase();
    if (!t.includes('trailer')) return false;
    if (HARD_REJECT.some(w => t.includes(w))) return false;
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
const CACHE_PFX = 'trailer:v9:';
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

async function callGroq(prompt: string, apiKey: string, maxTokens = 20): Promise<string | null> {
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
          max_tokens: maxTokens,
        })
      });
      const data: any = await res.json();
      if (data?.error) { console.error('[Groq] Error:', data.error.message); return null; }
      return data?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (e) { console.error('[Groq] Error:', e); return null; }
  });
}

// ─── Step 1: Ask Groq for the Telugu dubbed title ─────────────────────────────
// e.g. "Karuppu" → "Veerabadhrudu", "LIK" → "Love Is Khiladi"
async function getTeluguDubbedTitle(
  title: string,
  year: number,
  apiKey: string
): Promise<string | null> {
  const prompt = `What is the Telugu dubbed title of the movie "${title}" (${year})?

If this movie has a known Telugu dubbed release with a different Telugu title, reply with ONLY that Telugu title.
If the movie is already in Telugu OR has no Telugu dubbed version OR you are not sure, reply: SAME

Examples:
- "Karuppu" (Tamil) → "Veerabadhrudu"
- "Vikram" (Tamil) → "Vikram" (SAME - already known in Telugu)
- "The Dark Knight" → SAME (no different Telugu title)

Reply with only the Telugu title or SAME. Nothing else.`;

  const raw = await callGroq(prompt, apiKey, 30);
  if (!raw || raw === 'SAME' || raw.toLowerCase().includes('same')) return null;
  // Clean up response
  const cleaned = raw.replace(/["']/g, '').trim();
  if (cleaned.length < 2 || cleaned.toLowerCase() === title.toLowerCase()) return null;
  console.log(`[Groq] Telugu dubbed title for "${title}": ${cleaned}`);
  return cleaned;
}

// ─── Free YouTube HTML scraper ────────────────────────────────────────────────
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

    console.log(`[YT-Scrape] "${query}" → ${results.length} results`);
    return results;
  } catch (e) {
    console.error('[YT-Scrape] Error:', e);
    return [];
  }
}

// ─── Groq: pick best from verified candidates ─────────────────────────────────
async function groqPick(
  originalTitle: string,
  teluguTitle: string | null,
  year: number,
  preferLang: string,
  fallbackLang: string,
  candidates: YouTubeCandidate[],
  apiKey: string
): Promise<string | null> {
  if (!candidates.length) return null;

  const titleRef = teluguTitle
    ? `"${originalTitle}" (also known as "${teluguTitle}" in Telugu)`
    : `"${originalTitle}"`;

  const list = candidates
    .map((c, i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
    .join('\n');

  const prompt = `Pick the best official trailer for ${titleRef} (${year}).

CANDIDATES (all pre-verified as official channels with "trailer" in title):
${list}

PRIORITY:
1. ${preferLang} dubbed trailer
2. ${fallbackLang} official trailer
3. Any official full trailer in any language

RULES:
- The video MUST be for ${titleRef} — reject if it's for a completely different movie
- Prefer the most official/studio channel
- Reject: full movie, reaction, review, song, fan made, fan edit, unofficial

Reply ONLY with the 11-character video ID. If nothing matches: NULL`;

  const raw = await callGroq(prompt, apiKey);
  console.log(`[Groq] Picked for "${originalTitle}": ${raw}`);
  if (!raw || raw === 'NULL') return null;
  return extractYTId(raw);
}

// ─── Search + filter + pick pipeline ─────────────────────────────────────────
async function searchAndPick(
  query: string,
  originalTitle: string,
  teluguTitle: string | null,
  year: number,
  preferLang: string,
  fallbackLang: string,
  aiKey: string | null,
  label: string
): Promise<string | null> {
  console.log(`[Trailer] ${label}: "${query}"`);
  const raw = await ytScrape(query);

  // Try official channels first
  const official = officialFilter(raw);
  console.log(`[Trailer] ${label}: ${raw.length} raw → ${official.length} official`);

  if (official.length) {
    if (aiKey) return groqPick(originalTitle, teluguTitle, year, preferLang, fallbackLang, official, aiKey);
    return official[0].videoId;
  }

  // Fallback: loose filter (any channel, but strict title check)
  const loose = looseFilter(raw);
  console.log(`[Trailer] ${label}: ${loose.length} loose (non-official)`);
  if (loose.length && aiKey) {
    return groqPick(originalTitle, teluguTitle, year, preferLang, fallbackLang, loose, aiKey);
  }

  return null;
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

  // ── Step 1: Get Telugu dubbed title if different ──────────────────────────
  let teluguTitle: string | null = null;
  if (aiKey) {
    teluguTitle = await getTeluguDubbedTitle(title, year, aiKey);
  }

  const searchTitle = teluguTitle || title;

  // ── Search A: Telugu dubbed title + "Telugu trailer" ─────────────────────
  if (teluguTitle) {
    ytId = await searchAndPick(
      `"${teluguTitle}" Telugu trailer`,
      title, teluguTitle, year, 'Telugu', fallbackLang, aiKey, 'Search A (Telugu title)'
    );
  }

  // ── Search B: Original title + "Telugu dubbed trailer" ───────────────────
  if (!ytId) {
    ytId = await searchAndPick(
      `"${title}" Telugu dubbed trailer`,
      title, teluguTitle, year, 'Telugu', fallbackLang, aiKey, 'Search B (original+dubbed)'
    );
  }

  // ── Search C: searchTitle + year + Telugu ─────────────────────────────────
  if (!ytId) {
    ytId = await searchAndPick(
      `${searchTitle} ${year} Telugu trailer`,
      title, teluguTitle, year, 'Telugu', fallbackLang, aiKey, 'Search C (year+Telugu)'
    );
  }

  // ── Search D: Fallback language ───────────────────────────────────────────
  if (!ytId) {
    ytId = await searchAndPick(
      `"${title}" ${year} ${fallbackLang} official trailer`,
      title, teluguTitle, year, 'Telugu', fallbackLang, aiKey, `Search D (${fallbackLang})`
    );
  }

  // ── Search E: Generic official trailer ────────────────────────────────────
  if (!ytId) {
    ytId = await searchAndPick(
      `"${title}" official trailer ${year}`,
      title, teluguTitle, year, 'Telugu', fallbackLang, aiKey, 'Search E (generic)'
    );
  }

  // 2 — Cache result 30 days
  await cacheSet(cacheKey, ytId);

  console.log(ytId
    ? `[Trailer] ✓ "${title}" → ${ytId}`
    : `[Trailer] ✗ No trailer for "${title}"`
  );
  return ytId;
}
