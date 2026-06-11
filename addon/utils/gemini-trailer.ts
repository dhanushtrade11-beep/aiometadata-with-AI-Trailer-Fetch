/**
 * Accurate Trailer Fetcher — 300 Official Channels Edition
 * Telugu dubbed → Fallback language (Original for Indian, English for others)
 * Results cached in Redis 30 days to protect YouTube quota.
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

// ─── Indian language codes ────────────────────────────────────────────────────
const INDIAN_LANG_CODES = new Set([
  'ml','ta','te','kn','hi','bn','mr','gu','pa','or','as','ur'
]);
function isIndianContent(lang: string, countries: string[]): boolean {
  if (INDIAN_LANG_CODES.has(lang?.toLowerCase())) return true;
  if (countries?.some(c => c?.toUpperCase() === 'IN')) return true;
  return false;
}

// ─── 300 Official Channels ────────────────────────────────────────────────────
// Channels most likely to have Telugu dubbed trailers (searched first)
const TELUGU_DUBBED_CHANNELS = [
  'Goldmines Telefilms','Goldmines Bollywood','Pen Movies','Pen Multiplex',
  'Aditya Music','Aditya Movies','Lahari Music','Lahari Music Kannada',
  'Mango Mass Media','Mango Music','Speed Audio & Video','Satyam Audios',
  'Central Talkies','Anand Audio','Anand Audio Kannada','Saregama Music',
  'Tips Official','T-Series','Sony Music South','Eros Now Music',
  'Reliance Entertainment','JioStudios','AA Films','Panorama Studios',
  'Pooja Entertainment','Millennium Audios','Goodwill Entertainments',
  'Saina Movies','Saina Video Vision','A2 Music','D Beats Music World',
  'Jhankar Music','Jhankar Music Video','Aananda Audio Video',
  'Ashwini Media Networks','Sri Ganesh Video','Bhavani HD Movies',
  'Volga Video','Shalimar Telugu & Hindi Movies','AP International',
  'Telugu Filmnagar','TFPC','SRS Media Vision','MC Audios And Videos',
  'Wamindia Telugu','Ultra Movie Parlour','Shemaroo Movies','B4U Movies',
  'B4U Motion Pictures','Shemaroo Entertainment','Venus Movies',
  'TrendMusic','Cinekorn Movies',
];

// All 300 channels for Gemini reference
const ALL_CHANNELS = [
  // Hollywood Studios
  'Warner Bros. Pictures','Universal Pictures','Paramount Pictures',
  'Sony Pictures Entertainment','Walt Disney Studios','20th Century Studios',
  'Lionsgate Movies','Focus Features','Searchlight Pictures','A24',
  'Marvel Entertainment','Marvel UK','Marvel India','Marvel HQ','Marvel Korea',
  'Marvel UK & Ireland','DC','Star Wars','Star Wars UK','Pixar','Lucasfilm',
  'DreamWorks Animation','Illumination','Working Title Films','Skydance',
  'Amblin','Nickelodeon Movies','Legendary Entertainment','Republic Pictures',
  'Screen Gems','TriStar Pictures','Sony Pictures Animation','Columbia Pictures',
  'Annapurna Pictures','NEON','IFC Films','Magnolia Pictures','STXfilms',
  'Sony Pictures Classics','Roadside Attractions','Samuel Goldwyn Films',
  'BRON Studios','Village Roadshow Pictures','Lucasfilm',
  'BFI (British Film Institute)','Participant','Wētā Workshop',
  'James Bond 007','CBS Studios','Warner Bros. TV','Sony Pictures Television',

  // Streaming Platforms
  'Netflix','Netflix India','Netflix K-Content','Amazon MGM Studios',
  'Apple TV','Max','Hulu','Peacock','Discovery Plus','The Roku Channel',
  'Tubi','STARZ','SHOWTIME','AMC+','Shudder','Crunchyroll','Funimation',
  'Prime Video','Prime Video India','Disney Plus','DisneyPlus Hotstar',
  'Sony LIV','ZEE5','Aha Video','Sun NXT','JioCinema','MX Player',
  'ALTBalaji','Hoichoi','iQIYI','WeTV','KOCOWA TV','Viki Global TV',
  'AsianCrush','GMMTV',

  // Trailer Aggregator Channels
  'ONE Media','Rotten Tomatoes Trailers','Movieclips Trailers',
  'IGN Movie Trailers','KinoCheck.com','FilmSpot Trailer','TrailerSpot',
  'JoBlo Movie Trailers','Screen Culture','Bleecker Street','Fandango',
  'Fresh Movie Trailers','Rapid Trailer','GameSpot Universe Trailers',
  'Beyond The Trailer','Teaser PRO','FirstLookTV','Comicbook.com',
  'Furious Trailer','MovieAccessTrailers','FilmSelect Trailer',
  'Movie Trailers Source','FilmIsNow Family Movie Trailers',
  'MovieTrailers Entertainment','VISO Trailers','Hollywood Streams',
  'Disney Movie Trailers','Cieon Movies','FilmsActu Movie Trailers',
  'ENTV','Young Hollywood Network','Early Movie Trailers','Film State',
  'Movie Bytes','Trivial Trailers','Zero Media','FilmTrailerZone',
  'Streaming No Good Flix','Clevver Movies',

  // TV Networks
  'BBC','Sky TV','The CW Network','MTV','Comedy Central','Adult Swim',
  'HBO','FX Networks','AMC','SYFY','USA Network','Cartoon Network',
  'Adult Swim UK','Comedy Central UK','Doctor Who','National Geographic',
  'VIZ Media','GKIDS Films','IGN','Collider Interviews','Looper',
  'CBR','Screen Rant','Entertainment Tonight',
  'CinemaSins','Screen Junkies','Film Riot','StudioBinder','WatchMojo',

  // Bollywood / Hindi
  'T-Series','Yash Raj Films','Zee Studios','Dharma Productions',
  'Red Chillies Entertainment','Sony Pictures Films India','Viacom18 Studios',
  'BalajiMotionPictures','Maddock Films','RSVP Movies','Eros Now Music',
  'Reliance Entertainment','JioStudios','Saregama Music','Tips Official',
  'Pooja Entertainment','Panorama Studios','AA Films','Rajshri',
  'Excel Movies','Nadiadwala Grandson','Junglee Pictures',
  'Zee Music Company','Sony Music India','B4U Motion Pictures',
  'Shemaroo Entertainment','Venus Movies','Ultra Movie Parlour',
  'Shemaroo Movies','B4U Movies','Goldmines Bollywood',
  'SET India','Zee TV','Colors TV',

  // Telugu / South Indian
  'Sri Venkateswara Creations','Mythri Movie Makers','Haarika & Hassine Creations',
  'Geetha Arts','Suresh Productions','DVV Entertainment','Vyjayanthi Network',
  'AK Entertainments','Sithara Entertainments','People Media Factory',
  'UV Creations','Mango Mass Media','Annapurna Studios','Aditya Music',
  'Aditya Movies','Lahari Music','Think Music India','Sony Music South',
  'Lyca Productions','Sun Pictures','Raaj Kamal Films International',
  'V Creations','Studio Green','Dream Warrior Pictures','AGS Entertainment',
  'Sathya Jyothi Films','Red Giant Movies','Wunderbar Studios','Madras Talkies',
  'U1 Records','Muzik247','Hombale Films','PRK Audio','KRG Studios',
  'KVN Productions','Jayanna Films','Pushkar Films','Sun TV',
  'Friday Film House','Wayfarer Films','Kavya Film Company',
  'Aashirvad Cinemas','Manorama Music Songs','E4 Entertainment',
  'Anwar Rasheed Entertainments','Magic Frames','Divo Movies',
  'Saregama Tamil','Kalaignar TV','Vijay Television','TrendMusic',
  'API Malayalam','Ayngaran','TFPC','Telugu Filmnagar',
  'AP International','Bhavani HD Movies','Volga Video',
  'Shalimar Telugu & Hindi Movies','Star Maa','Zee Telugu',
  'Asianet','Zee Keralam','Colors Kannada','Zee Kannada',
  'Silverscreen India','BehindwoodsTV','IndiaGlitz Tamil',
  'Galatta Tamil','NTV Entertainment','Sun Music',
  'Wamindia Tamil','Wamindia Telugu',

  // Telugu Dubbed Specific
  ...TELUGU_DUBBED_CHANNELS,

  // Korean
  'Netflix K-Content','tvN drama','SBS Drama','JTBC Drama',
  'KBS WORLD TV','KBS Drama','MBC Drama','SBS Catch',
  'CJ ENM Movie','CJ ENM Global','Showbox','Lotte Entertainment',
  'ENA','Next Entertainment World','K-MOVIE Entertainment',
];

// Deduplicate
const OFFICIAL_CHANNELS = [...new Set(ALL_CHANNELS)];

// ─── Reject words ─────────────────────────────────────────────────────────────
const REJECT_WORDS = [
  'glimpse','teaser','reaction','review','breakdown',
  'fan made','fan-made','explained','lyric','song',
  'interview','behind the scenes','bts','making of',
  'deleted scene','featurette','promo','clip','sneak peek',
  'first look','announcement','motion poster','title reveal',
  'video song','audio launch','press meet',
];

function preFilter(candidates: YouTubeCandidate[]): YouTubeCandidate[] {
  return candidates.filter(c => {
    const t = c.title.toLowerCase();
    return !REJECT_WORDS.some(w => t.includes(w));
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
  ]) {
    const m = text.match(p);
    if (m) return m[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const m = text.match(/[a-zA-Z0-9_-]{11}/);
  return m ? m[0] : null;
}

// ─── Redis cache (30 days) ────────────────────────────────────────────────────
const CACHE_TTL = 30 * 24 * 60 * 60;
const CACHE_PFX = 'trailer:v3:';
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
    const r = await getRedis();
    if (!r) return undefined;
    const v = await r.get(`${CACHE_PFX}${k}`);
    if (v === null) return undefined;
    return v === 'NULL' ? null : v;
  } catch { return undefined; }
}

async function cacheSet(k: string, v: string | null): Promise<void> {
  try {
    const r = await getRedis();
    if (!r) return;
    await r.set(`${CACHE_PFX}${k}`, v ?? 'NULL', { EX: CACHE_TTL });
  } catch {}
}

// ─── YouTube search ───────────────────────────────────────────────────────────
let _quotaDead = false;

async function ytSearch(q: string, key: string): Promise<YouTubeCandidate[]> {
  if (_quotaDead) return [];
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
        console.warn('[YouTube] Quota exhausted — Gemini-only mode');
        _quotaDead = true;
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
  } catch (e) {
    console.error('[YouTube] Fetch error:', e);
    return [];
  }
}

// ─── Gemini pick ──────────────────────────────────────────────────────────────
async function geminiPick(
  title: string, year: number,
  preferLang: string, fallbackLang: string,
  candidates: YouTubeCandidate[], apiKey: string
): Promise<string | null> {
  if (!candidates.length) return null;

  // Give Gemini a representative sample of official channels
  const channelRef = [
    ...TELUGU_DUBBED_CHANNELS.slice(0, 15),
    'Warner Bros. Pictures','Universal Pictures','Sony Pictures Entertainment',
    'Netflix','Marvel Entertainment','T-Series','Yash Raj Films',
    'Mythri Movie Makers','Sri Venkateswara Creations','Hombale Films',
    'Sun Pictures','DVV Entertainment','Goldmines Bollywood',
  ].join(', ');

  const list = candidates
    .map((c,i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
    .join('\n');

  const prompt = `Pick the best official trailer for "${title}" (${year}) from these YouTube results.

CANDIDATES:
${list}

OFFICIAL CHANNELS (prefer picks from these):
${channelRef}

PRIORITY ORDER:
1. ${preferLang} dubbed official trailer from any channel above
2. ${preferLang} dubbed trailer from any channel (even unofficial upload)
3. ${fallbackLang} official trailer from any channel above
4. ${fallbackLang} trailer from any channel
5. Any full official trailer in any language

HARD REJECT — skip these completely:
glimpse, teaser, song, lyric, reaction, review, fan made, promo, clip, bts, making of, first look, motion poster, announcement, video song, audio launch, press meet

LENIENCY RULE:
- If a video has "trailer" in the title and is NOT in the reject list above → PICK IT
- Do NOT reject based on channel being unofficial — focus on the video title content
- Better to pick an unofficial upload of a real trailer than NULL

RETURN: Only the 11-character video ID. Nothing else. No explanation.
If absolutely nothing qualifies: NULL`;

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
    if (data?.error) { console.error('[Gemini] Error:', data.error.message); return null; }
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log(`[Gemini] Picked for "${title}": ${raw}`);
    if (!raw || raw === 'NULL') return null;
    return extractYTId(raw);
  } catch (e) { console.error('[Gemini] Error:', e); return null; }
}

// ─── Gemini-only (no YouTube API or quota dead) ───────────────────────────────
async function geminiOnly(
  title: string, year: number,
  preferLang: string, fallbackLang: string, apiKey: string
): Promise<string | null> {
  const dubbed = TELUGU_DUBBED_CHANNELS.slice(0,12).join(', ');

  const prompt = `Find the YouTube video ID for the official trailer of "${title}" (${year}).

PRIORITY:
1. ${preferLang} dubbed trailer — check channels like: ${dubbed}
2. ${fallbackLang} official trailer from the studio channel
3. Any full official trailer in any language

RULES:
- Full trailers ONLY — no glimpse, teaser, song, reaction, review, fan made, promo, clip, bts, making of
- Return ONLY the 11-character YouTube video ID
- If not found or not confident: NULL`;

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
    if (data?.error) { console.error('[Gemini-Only] Error:', data.error.message); return null; }
    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log(`[Gemini-Only] "${title}": ${raw}`);
    if (!raw || raw === 'NULL') return null;
    return extractYTId(raw);
  } catch (e) { console.error('[Gemini-Only] Error:', e); return null; }
}

// ─── Basic fallback (no AI) ───────────────────────────────────────────────────
function basicPick(candidates: YouTubeCandidate[]): string | null {
  // Try official channel + "trailer" in title first
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    const isOfficial = OFFICIAL_CHANNELS.some(oc =>
      c.channelTitle.toLowerCase().includes(oc.toLowerCase())
    );
    if (isOfficial && t.includes('trailer') && !REJECT_WORDS.some(w => t.includes(w)))
      return c.videoId;
  }
  // Any trailer without reject words
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
  const ytKey   = process.env.YOUTUBE_API_KEY;
  const gKey    = process.env.GEMINI_API_KEY;

  if (!ytKey && !gKey) {
    console.error('[Trailer] No API keys configured.');
    return null;
  }

  const indian      = isIndianContent(originalLang, productionCountries);
  const fallbackLang = indian ? (originalLang?.toUpperCase() || 'Original') : 'English';
  const cacheKey    = stremioId || `${title}:${year}`;

  // 1 — Redis cache
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) {
    console.log(`[Trailer] Cache "${title}": ${cached ?? 'none'}`);
    return cached;
  }

  console.log(`[Trailer] "${title}" | ${year} | Indian: ${indian} | Fallback: ${fallbackLang}`);

  let ytId: string | null = null;

  // ── YouTube path ──────────────────────────────────────────────────────────
  if (ytKey && !_quotaDead) {

    // Search A — Telugu dubbed, channel-specific query
    const dubbedChannelQuery = TELUGU_DUBBED_CHANNELS.slice(0,5).join(' OR ');
    const qA = `"${title}" Telugu dubbed trailer`;
    console.log(`[Trailer] Search A (Telugu dubbed): ${qA}`);
    const rA = preFilter(await ytSearch(qA, ytKey));
    console.log(`[Trailer] Search A: ${rA.length} candidates`);

    if (rA.length) {
      ytId = gKey
        ? await geminiPick(title, year, 'Telugu', fallbackLang, rA, gKey)
        : basicPick(rA);
    }

    // Search B — Telugu dubbed broader
    if (!ytId && !_quotaDead) {
      const qB = `${title} ${year} Telugu dubbed official trailer`;
      console.log(`[Trailer] Search B (Telugu broad): ${qB}`);
      const rB = preFilter(await ytSearch(qB, ytKey));
      console.log(`[Trailer] Search B: ${rB.length} candidates`);

      if (rB.length) {
        ytId = gKey
          ? await geminiPick(title, year, 'Telugu', fallbackLang, rB, gKey)
          : basicPick(rB);
      }
    }

    // Search C — Fallback language official trailer
    if (!ytId && !_quotaDead) {
      const qC = `${title} ${year} ${fallbackLang} official trailer`;
      console.log(`[Trailer] Search C (${fallbackLang}): ${qC}`);
      const rC = preFilter(await ytSearch(qC, ytKey));
      console.log(`[Trailer] Search C: ${rC.length} candidates`);

      if (rC.length) {
        ytId = gKey
          ? await geminiPick(title, year, 'Telugu', fallbackLang, rC, gKey)
          : basicPick(rC);
      }
    }
  }

  // ── Gemini-only fallback (quota dead or no YouTube key) ───────────────────
  if (!ytId && gKey) {
    console.log(`[Trailer] Gemini-only for "${title}"`);
    ytId = await geminiOnly(title, year, 'Telugu', fallbackLang, gKey);
  }

  // 2 — Cache result (30 days)
  await cacheSet(cacheKey, ytId);

  console.log(ytId
    ? `[Trailer] ✓ "${title}" → ${ytId}`
    : `[Trailer] ✗ No trailer for "${title}"`
  );
  return ytId;
}
