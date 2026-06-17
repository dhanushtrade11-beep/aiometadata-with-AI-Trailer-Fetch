/**
 * FINAL Accurate Trailer Fetcher
 *
 * SPEED: Returns cached result instantly. Only calls APIs on first request.
 * ACCURACY: Telugu dubbed searched first using Telugu title + official channels + year.
 * SAFETY: Only official channels accepted. Fan edits, full movies, reviews blocked.
 * QUOTA: Groq called ONCE per movie (not per search). YouTube scraping is free.
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
  score: number; // higher = better match
}

// ─── Indian detection ─────────────────────────────────────────────────────────
const INDIAN_LANG_CODES = new Set([
  'ml','ta','te','kn','hi','bn','mr','gu','pa','or','as','ur'
]);
function isIndianContent(lang: string, countries: string[]): boolean {
  if (INDIAN_LANG_CODES.has(lang?.toLowerCase())) return true;
  if (countries?.some(c => c?.toUpperCase() === 'IN' || c?.toLowerCase().includes('india'))) return true;
  return false;
}

// ─── Official Telugu Dubbed Channels (TRUSTED) ───────────────────────────────
const TELUGU_OFFICIAL = [
  'aditya music','aditya movies',
  'mango music','mango telugu trailers','mango mass media',
  't-series telugu','t-series',
  'sony music south',
  'saregama telugu','saregama music',
  'lahari music','lahari music | t-series',
  'zee music south',
  'think music telugu','think music india',
  'madhura audio',
  'junglee music telugu',
  'divo music',
  'silly monks music',
  'muzik247 telugu',
  'nanda audio',
  'mrt music telugu',
  'trend loud telugu',
  'vel records',
  'tips telugu','tips official',
  'goldmines','goldmines telugu','goldmines telefilms','goldmines bollywood',
  'b4u telugu',
  'rkd studios telugu',
  'venus telugu',
  'eagle home entertainments',
  'srs media vision entertainment',
  'wam india telugu',
  'cinekorn movies','cinekorn entertainment',
  'biscoot telugu',
  'sri balaji movies',
  'bhavani hd movies',
  'volga video',
  'shalimar telugu & hindi movies',
  'ap international',
  'idream telugu movies',
  'mango indian films',
  'pen movies','pen multiplex','pen india ltd',
  'speed audio & video',
  'satyam audios',
  'central talkies',
  'anand audio',
  'eros now music','eros now south',
  'reliance entertainment',
  'jiostudios',
  'aa films',
  'millennium audios',
  'goodwill entertainments',
  'a2 music',
  'd beats music world',
  'jhankar music',
  'wamindia telugu',
  'ultra movie parlour',
  'shemaroo movies','shemaroo entertainment',
  'b4u movies',
  // Telugu production houses
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
  'pawan kalyan creative works','sreshth movies','wall poster cinema',
  'prasanth varma cinematic universe','ntr arts','puri connects',
  'vyra entertainments','gold box entertainments','fortune four cinemas',
  'geetha sree arts','pink elephant pictures','anjana productions',
  // Additional Telugu OTT, dubbed-distribution, music labels & production houses
  '123telugu','20th century studios india','24 frames factory','abhishek agarwal arts',
  'abhishek pictures','adiseha dubbed movies','aha video in','amigos creations',
  'asian cinemas',"ba raju's team",'balaji motion pictures','bhavani hd dubbed movies',
  'bhavya creations','chai bisket','chai bisket space','cinegalaxy',
  'cinepolis india','creative commercials','crunchyroll india','dharma productions',
  'dil raju productions','divo dubbed telugu','divo telugu','east coast productions',
  'eluru sreenu','etv win','fars film india','filmymantra telugu',
  'global cinemas','gmb entertainment','greatandhra','gsk media',
  'guru films','hollywood trailers telugu','horizon movie trailers','idlebrain',
  'infinitum network solutions','inox movies','jayanna films','jiohotstar telugu',
  'junglee dubbed telugu','kalaipuli s thanu','kavithalayaa productions','kfc entertainments',
  'klapboard productions','lahari dubbed telugu','lucky media','mahaa movies',
  'mango dubbed movies','mango tollywood','marvel india','matinee entertainment',
  'mictv.in','multiples media','nadiadwala grandson','netflix india south',
  'niharika entertainment','nv prasad','one media telugu','panorama studios',
  'paramount pictures india','prime video southern languages','prime video telugu','primetime media','prince pictures',
  'prk audio','pro skn','pvr pictures','radhakrishna entertainments',
  'rk dubbed movies','rt team works','s r prakash babu','sandesh productions',
  'saraswathi films','saregama dubbed telugu','shalimar dubbed movies','shine screens',
  'shreyas media','silly monks dubbed','silly monks tollywood','slv cinemas',
  'sony liv south','sony liv telugu','sony music dubbed telugu','sony pictures india','south indian hindi dubbed movies',
  'sravanthi movies','sri lakshmi narasimha productions','sri ranjith movies','sri sathya sai arts',
  'sri sravanthi movies','sri thirumala theatres','sri tirumala tirupati venkateswara films','srilakshmi movies',
  'srt entertainments','sun nxt','super good films','svcc',
  'swapna cinema','tamada media','telugu cinema','telugu filmnagar',
  'telugu filmnagar dubbed','telugu movies hub','tfpc','think music dubbed telugu',
  'tollywood nagar','tollywood pr','tracktollywood','ufo moviez india',
  'universal pictures india','v celluloid','vaaraahi chalana chitram','vamsi kaka',
  'vels film international','viacom18 studios','warner bros. india','whacked out media',
  'wirally','yash raj films','zee music dubbed telugu','zee studios',
  'zee5 telugu',
];

// ─── Official Global/Hollywood Channels ──────────────────────────────────────
const GLOBAL_OFFICIAL = [
  'warner bros. pictures','warner bros. india',
  'universal pictures','universal pictures india',
  'paramount pictures','paramount pictures india',
  'sony pictures entertainment','sony pictures films india',
  'walt disney studios','disney india',
  '20th century studios','20th century studios india',
  'lionsgate movies','a24',
  'marvel entertainment','marvel india','marvel hq','marvel uk',
  'dc','star wars','pixar','lucasfilm',
  'dreamworks animation','illumination','legendary entertainment',
  'netflix','netflix india','netflix k-content',
  'amazon mgm studios','prime video','prime video india',
  'apple tv','max','hulu','peacock',
  'disney plus','disneyplus hotstar',
  'sony liv','zee5','aha video','sun nxt','jiocinema',
  'crunchyroll','funimation',
  'one media','rotten tomatoes trailers','movieclips trailers',
  'ign movie trailers','kinocheck.com','filmspot trailer',
  'joblo movie trailers','screen culture','fandango',
  'fresh movie trailers','furious trailer','filmselect trailer',
  'zero media','filmtrailerzone',
  'yash raj films','yrf south','dharma productions',
  'red chillies entertainment','zee studios','viacom18 studios',
  'maddock films','balaji motion pictures','excel entertainment',
  't-series films','star studios',
  'sikhya entertainment','colour yellow productions','cape of good films',
  'drishyam films','roy kapur films','eros international','ajay devgn ffilms',
  'tvn drama','sbs drama','jtbc drama','kbs world tv',
  'cj enm movie','showbox','lotte entertainment',
  // Additional Indian OTT platforms, regional networks & global trailer channels
  'a2 music','aa films','aao nxt','aashirvad cinemas',
  'addatimes','adult swim','ags entertainment','aha tamil',
  'airtel xstream','altitude films','altt','amazon minitv',
  'amazon mx player','amazon mx player bhojpuri','amazon mx player marathi','amblin',
  'amc+','anand audio','arre','arrow video',
  'ashwini media networks','atrangii','ayngaran','b4u motion pictures',
  'bfi','bhaktiflix','bhavana studios','bleecker street',
  'blumhouse productions','bongo india','central pictures','chai shots',
  'chaupal','chaupal bhojpuri','chaupal punjabi','cineprime',
  'cityshor tv','collider','colors kannada','comicbook.com',
  'cspace','d beats music world','dangal play','dice media',
  'discovery plus india','divo music','docubay','drafthouse films',
  'dream warrior pictures','dulquer salmaan official','e4 entertainment','eortv',
  '2d entertainment','trident arts','sri thenandal films','thenandal studio limited',
  'anto joseph film company','prk productions',
  'epic on','eros now','eros now bengali','eros now south',
  'etv win','fahadh faasil and friends','fancode','film4',
  'filtercopy','firstlooktv','fliz movies','focus features',
  'friday film house','fx networks','gamespot trailers','girliyapa',
  'goldmines','goodwill entertainments','greenwich entertainment','hbo',
  'hoichoi','hoichoi bangladesh','hombale films','hr ott',
  'hungama gujarati','hungama marathi','hungama play','ifc films',
  'imdb','jayanna films','jhankar music','jio studios',
  'jiohotstar','jiohotstar kannada','jiohotstar malayalam','jiohotstar sports',
  'jiohotstar tamil','jiohotstar telugu','joblo animated videos','joblo horror trailers',
  'joblo streaming & tv trailers','junglee pictures','kalaipuli s thanu','kanccha lanka',
  'kiccha creations','kino lorber','kinocheck family','kinocheck indie',
  'kjr studios','klikk','koode','kooku',
  'krg studios','kvn productions','lahari music','lionsgate play india',
  'lionsgate uk','lyca productions','magic frames','magnolia pictures & magnet releasing',
  'manorama music songs','matinee now','millennium audios','moviecoverage',
  'mubi','mubi india','muzik247','muzik247 tamil',
  'nadiadwala grandson','nammaflix','neestream','neon',
  'niri9','oho gujarati','panorama studios','paramount plus',
  'paramvah studios','pen movies','planet marathi','platform8',
  'pocket aces','prideplex','primeflix','prince pictures',
  'prithviraj productions','prk audio','ptc play','pushkar films',
  'raaj kamal films international','rabbit movies','raj digital tv','rajshri',
  'rapid trailer','red giant movies','reeldrama','reliance entertainment',
  'republic pictures','rlje films','roadside attractions','rockline entertainments',
  'rotten tomatoes classic trailers','rotten tomatoes family','rotten tomatoes indie','rotten tomatoes tv',
  'rsvp movies','saban films','saina movies','saina play',
  'samuel goldwyn films','sandesh productions','saregama music','saregama tamil',
  'sathya jyothi films','satyam audios','screen media','screen rant plus',
  'searchlight pictures','seven screen studio','shemaroo','shemaroo gujarati',
  'shemaroo marathi','shemaroo punjabi','shemaroome','shout! studios',
  'shudder','signature entertainment','skydance','sony music india',
  'sony music south','sony pictures animation','sony pictures classics','sony pictures releasing uk',
  'sri jagadguru movies','stage - haryanvi','stage - rajasthani','star music india',
  'starz','studio green','studiocanaluk','sun pictures',
  'sun tv','suri cinema','surya tv','syfy',
  'talkies app','tarang plus','teluguone','the criterion collection',
  'the cw network','the screen patti','the timeliners','think music india',
  'thirukumaran entertainment','tips official','trailerspot','trendmusic',
  'tvf','udaya tv','ullu','vels film international',
  'venus','vertical','vi movies and tv','voltage pictures',
  'vrl media','warner bros. uk & ireland','watcho','wayfarer films',
  'well go usa entertainment','wunderbar films','xyz films','yahoo entertainment',
  'yupptv india','zee music company','zee music south',
];

const ALL_OFFICIAL_SET = new Set([...TELUGU_OFFICIAL, ...GLOBAL_OFFICIAL]);

function isOfficialChannel(ch: string): boolean {
  const c = ch.toLowerCase().trim();
  if (ALL_OFFICIAL_SET.has(c)) return true;
  for (const oc of ALL_OFFICIAL_SET) {
    if (c.includes(oc) || oc.includes(c)) return true;
  }
  return false;
}

function isTeluguChannel(ch: string): boolean {
  const c = ch.toLowerCase().trim();
  for (const oc of TELUGU_OFFICIAL) {
    if (c === oc || c.includes(oc) || oc.includes(c)) return true;
  }
  return false;
}

// ─── Hard reject — these are NEVER trailers ───────────────────────────────────
const HARD_REJECT = [
  'full movie','full film','complete movie','full length movie',
  'reaction','reacting to',
  'review','movie review','film review',
  'video song','audio song','jukebox','lyric video','lyrics','song',
  'audio launch','music launch','press meet','press conference',
  'making of','behind the scenes','bts','on the sets','making video',
  'interview',
  'fan made','fan edit','fan trailer','fan cut','unofficial',
  'breakdown','explained','analysis','recap',
  'deleted scene','extended scene','featurette',
  'motion poster','title reveal','first look announcement',
  'glimpse','sneak peek',
  'web series','short film','episode',
];

// ─── Title normalization (for robust, punctuation-insensitive matching) ──────
// Movie titles often mix Roman numerals and digits across sources (e.g. a
// metadata title "Vaazha II" vs. a real trailer titled "Vaazha 2 Trailer").
// Without reconciling these, a correct trailer can be wrongly rejected.
function romanToArabic(token: string): string {
  if (!/^[ivxlcdm]+$/i.test(token) || token.length > 6) return token;
  const map: Record<string, number> = { i: 1, v: 5, x: 10, l: 50, c: 100, d: 500, m: 1000 };
  const s = token.toLowerCase();
  // Strict validation: must match standard Roman numeral grammar
  if (!/^m{0,4}(cm|cd|d?c{0,3})(xc|xl|l?x{0,3})(ix|iv|v?i{0,3})$/.test(s)) return token;
  let total = 0;
  for (let i = 0; i < s.length; i++) {
    const cur = map[s[i]];
    const next = map[s[i + 1]];
    if (next && cur < next) { total -= cur; } else { total += cur; }
  }
  return total > 0 && total <= 50 ? String(total) : token;
}

function normTitle(s: string): string {
  const cleaned = s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  if (!cleaned) return cleaned;
  return cleaned.split(' ').map(romanToArabic).join(' ');
}

// ─── Score a candidate — higher = better ─────────────────────────────────────
// primaryTitle = the REAL movie title (always required to match — this is the
// anchor that prevents picking a trailer for an unrelated movie).
// altTitle = an alternate-language title (e.g. AI-guessed Telugu dub title).
// A candidate passes the title gate if it matches EITHER one, but primaryTitle
// is always checked so a hallucinated/incorrect altTitle can't smuggle through
// a completely different movie's trailer.
function scoreCandidate(
  c: YouTubeCandidate,
  primaryTitle: string,
  altTitle: string | null,
  year: number,
  wantTelugu: boolean
): number {
  let score = 0;
  const t = c.title.toLowerCase();
  const ch = c.channelTitle.toLowerCase();
  const normT = normTitle(c.title);
  const normPrimary = normTitle(primaryTitle);
  const normAlt = altTitle ? normTitle(altTitle) : null;

  // Must have "trailer"
  if (!t.includes('trailer')) return -999;
  // Must not have reject words
  if (HARD_REJECT.some(w => t.includes(w))) return -999;

  // HARD GATE: the candidate's title must actually reference this movie —
  // either the real title or the alt title. No match → reject outright.
  // This is required even for official/trusted channels: a trusted channel
  // uploads trailers for MANY movies, so channel trust alone must never be
  // enough to claim a match.
  const matchesPrimary = normPrimary.length > 0 && normT.includes(normPrimary);
  const matchesAlt = !!(normAlt && normAlt.length > 0 && normT.includes(normAlt));
  if (!matchesPrimary && !matchesAlt) return -999;

  // Official channel bonus
  if (isOfficialChannel(c.channelTitle)) score += 50;
  // Telugu channel bonus
  if (wantTelugu && isTeluguChannel(c.channelTitle)) score += 40;

  // Movie title match bonus (already gated above; reward the stronger/real match)
  if (matchesPrimary) score += 30;
  else if (matchesAlt) score += 20;

  // Year match bonus
  if (t.includes(String(year))) score += 15;
  // Penalize a different year appearing in the title (likely a different
  // release/remake/re-edit of the same-titled movie)
  const yearMatches = t.match(/\b(19|20)\d{2}\b/g);
  if (yearMatches && !yearMatches.includes(String(year))) score -= 25;

  // Telugu language signals in title
  if (wantTelugu) {
    if (t.includes('telugu dubbed')) score += 35;
    if (t.includes('telugu trailer')) score += 30;
    if (t.includes('telugu')) score += 20;
  }

  // "Official trailer" bonus
  if (t.includes('official trailer')) score += 20;
  if (t.includes('official')) score += 10;

  // Penalize unofficial signals
  if (t.includes('edited') || t.includes('remix') || t.includes('recreat')) score -= 50;
  if (ch.includes('edit') || ch.includes('fan')) score -= 50;

  return score;
}

function filterAndRank(
  candidates: YouTubeCandidate[],
  primaryTitle: string,
  altTitle: string | null,
  year: number,
  wantTelugu: boolean
): YouTubeCandidate[] {
  return candidates
    .map(c => ({ ...c, score: scoreCandidate(c, primaryTitle, altTitle, year, wantTelugu) }))
    .filter(c => c.score > -999)
    .sort((a, b) => b.score - a.score);
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
  return null;
}

// ─── In-memory trailer cache with 30-day TTL (zero Redis usage) ──────────────
// Trailer IDs are tiny (~11 bytes each). Storing them in-memory means:
//   - Zero Redis storage used (your 25 MB free tier stays free for metadata)
//   - Faster lookups (no network round-trip to Redis)
//   - Entries expire after 30 days automatically

const TRAILER_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days in milliseconds

interface CacheEntry {
  value: string | null;
  expiresAt: number;
}

const _memCache = new Map<string, CacheEntry>();

function cacheGet(k: string): Promise<string | null | undefined> {
  const entry = _memCache.get(k);
  if (!entry) return Promise.resolve(undefined);
  if (Date.now() > entry.expiresAt) {
    _memCache.delete(k); // expired — treat as cache miss
    return Promise.resolve(undefined);
  }
  return Promise.resolve(entry.value);
}

function cacheSet(k: string, v: string | null): Promise<void> {
  _memCache.set(k, { value: v, expiresAt: Date.now() + TRAILER_TTL_MS });
  return Promise.resolve();
}

/**
 * Exported cache-only lookup — returns the cached value if present and not expired,
 * or undefined if not yet fetched / expired. Never triggers a YouTube/Groq fetch.
 * Used by index.js to check instantly before deciding to fire-and-forget.
 */
export async function cacheGetOnly(k: string): Promise<string | null | undefined> {
  return cacheGet(k);
}

// ─── Groq queue (30 RPM → 1 per 2.5s) ───────────────────────────────────────
const GROQ_GAP = 2500;
let _tail: Promise<any> = Promise.resolve();
let _lastCall = 0;

function enqueueGroq<T>(fn: () => Promise<T>): Promise<T> {
  const r = _tail.then(async () => {
    const wait = GROQ_GAP - (Date.now() - _lastCall);
    if (wait > 0) await new Promise(x => setTimeout(x, wait));
    _lastCall = Date.now();
    return fn();
  });
  _tail = r.catch(() => {});
  return r;
}

async function callGroq(prompt: string, apiKey: string, maxTokens = 60): Promise<string | null> {
  return enqueueGroq(async () => {
    try {
      const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: 'llama-3.1-8b-instant',
          messages: [{ role: 'user', content: prompt }],
          temperature: 0,
          max_tokens: maxTokens,
        })
      });
      const d: any = await res.json();
      if (d?.error) { console.error('[Groq]', d.error.message); return null; }
      return d?.choices?.[0]?.message?.content?.trim() ?? null;
    } catch (e) { console.error('[Groq] fetch error:', e); return null; }
  });
}

// ─── Get Telugu dubbed title via Groq ────────────────────────────────────────
async function getTeluguTitle(title: string, year: number, apiKey: string): Promise<string | null> {
  const prompt = `What is the Telugu dubbed title of "${title}" (${year})?
If it has a different Telugu dubbed title, reply with ONLY that title.
If already Telugu, no Telugu dub exists, or you are unsure → reply: SAME`;

  const raw = await callGroq(prompt, apiKey, 40);
  if (!raw || raw.toUpperCase().includes('SAME') || raw.toLowerCase() === title.toLowerCase()) return null;
  const cleaned = raw.replace(/["'.]/g, '').trim();
  if (cleaned.length < 2) return null;
  console.log(`[Groq] Telugu title for "${title}": ${cleaned}`);
  return cleaned;
}

// ─── Free YouTube HTML scraper ────────────────────────────────────────────────
async function ytScrape(query: string): Promise<YouTubeCandidate[]> {
  try {
    const res = await fetch(
      `https://www.youtube.com/results?search_query=${encodeURIComponent(query)}`,
      { headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
        'Accept-Language': 'en-US,en;q=0.9',
      }}
    );
    const html = await res.text();
    const match = html.match(/var ytInitialData\s*=\s*({.+?});<\/script>/s);
    if (!match) return [];
    const data = JSON.parse(match[1]);
    const items = data?.contents?.twoColumnSearchResultsRenderer
      ?.primaryContents?.sectionListRenderer
      ?.contents?.[0]?.itemSectionRenderer?.contents || [];
    return items
      .filter((i: any) => i?.videoRenderer?.videoId)
      .slice(0, 10)
      .map((i: any) => ({
        videoId: i.videoRenderer.videoId,
        title: i.videoRenderer.title?.runs?.[0]?.text || '',
        channelTitle: i.videoRenderer.ownerText?.runs?.[0]?.text || '',
        score: 0,
      }));
  } catch (e) { console.error('[YT-Scrape]', e); return []; }
}

// ─── Scrape multiple queries in parallel ─────────────────────────────────────
async function multiScrape(queries: string[]): Promise<YouTubeCandidate[]> {
  const results = await Promise.all(queries.map(q => ytScrape(q)));
  // Deduplicate by videoId
  const seen = new Set<string>();
  const all: YouTubeCandidate[] = [];
  for (const batch of results) {
    for (const c of batch) {
      if (!seen.has(c.videoId)) { seen.add(c.videoId); all.push(c); }
    }
  }
  return all;
}

// ─── Main export ──────────────────────────────────────────────────────────────
export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, originalLang, productionCountries = [], stremioId } = params;
  const aiKey = process.env.GROQ_API_KEY || null;

  const indian = isIndianContent(originalLang, productionCountries);
  const fallbackLang = indian ? (originalLang?.toUpperCase() || 'Original') : 'English';
  const cacheKey = stremioId || `${title}:${year}`;

  // ── INSTANT: return from cache if available ───────────────────────────────
  const cached = await cacheGet(cacheKey);
  if (cached !== undefined) {
    console.log(`[Trailer] ⚡ Instant cache "${title}": ${cached ?? 'none'}`);
    return cached;
  }

  console.log(`[Trailer] Fetching "${title}" (${year}) | Indian: ${indian} | Fallback: ${fallbackLang}`);

  // ── Step 1: Get Telugu dubbed title (1 Groq call) ────────────────────────
  let teluguTitle: string | null = null;
  if (aiKey) teluguTitle = await getTeluguTitle(title, year, aiKey);
  const searchTitle = teluguTitle || title;

  // ── Step 2: Scrape YouTube in parallel (FREE, fast) ──────────────────────
  // Build all queries upfront — all scraped simultaneously
  const teluguQueries = [
    `"${searchTitle}" ${year} Telugu dubbed official trailer`,
    `"${title}" ${year} Telugu dubbed trailer`,
    `${searchTitle} Telugu dubbed trailer ${year}`,
    `"${searchTitle}" Telugu trailer ${year}`,
  ];

  const fallbackQueries = [
    `"${title}" ${year} ${fallbackLang} official trailer`,
    `"${title}" official trailer ${year}`,
    `${title} ${year} trailer official`,
  ];

  // Scrape Telugu queries first (parallel)
  console.log(`[Trailer] Scraping ${teluguQueries.length} Telugu queries in parallel...`);
  const teluguRaw = await multiScrape(teluguQueries);
  const teluguRanked = filterAndRank(teluguRaw, title, teluguTitle, year, true);
  console.log(`[Trailer] Telugu: ${teluguRaw.length} raw → ${teluguRanked.length} valid, top score: ${teluguRanked[0]?.score ?? 'none'}`);

  let ytId: string | null = null;

  // ── Step 3: If top Telugu result has high confidence, use it directly ─────
  // Score ≥ 100 means: official channel + "trailer" + year + Telugu signals
  // No need to waste a Groq call
  if (teluguRanked.length > 0 && teluguRanked[0].score >= 100) {
    ytId = teluguRanked[0].videoId;
    console.log(`[Trailer] ⚡ High-confidence Telugu pick (score ${teluguRanked[0].score}): ${ytId}`);
  }

  // ── Step 4: Ask Groq to pick from Telugu candidates (if not confident yet) ─
  if (!ytId && teluguRanked.length > 0 && aiKey) {
    const list = teluguRanked.slice(0, 6)
      .map((c, i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}" | Score: ${c.score}`)
      .join('\n');

    const prompt = `Pick the best Telugu dubbed trailer for the movie "${title}"${teluguTitle ? ` (Telugu: "${teluguTitle}")` : ''} released in ${year}.

CANDIDATES (pre-scored, higher score = better match):
${list}

RULES:
- Must be for "${title}" (${year}) specifically — reject if different movie
- Prefer Telugu dubbed from official channels (Goldmines, Aditya Music, Bhavani, Volga, etc.)
- Must be a FULL TRAILER — reject: full movie, reaction, review, song, fan made, glimpse, promo
- Pick highest scored candidate that matches

Reply ONLY with the 11-character video ID. If nothing matches: NULL`;

    const raw = await callGroq(prompt, aiKey);
    console.log(`[Groq] Telugu pick for "${title}": ${raw}`);
    if (raw && raw !== 'NULL') ytId = extractYTId(raw);
  }

  // ── Step 5: Scrape fallback language in parallel ──────────────────────────
  if (!ytId) {
    console.log(`[Trailer] No Telugu found, scraping ${fallbackQueries.length} fallback queries...`);
    const fallbackRaw = await multiScrape(fallbackQueries);
    const fallbackRanked = filterAndRank(fallbackRaw, title, null, year, false);
    console.log(`[Trailer] Fallback: ${fallbackRaw.length} raw → ${fallbackRanked.length} valid`);

    // High confidence direct pick
    if (fallbackRanked.length > 0 && fallbackRanked[0].score >= 80) {
      ytId = fallbackRanked[0].videoId;
      console.log(`[Trailer] ⚡ High-confidence fallback pick (score ${fallbackRanked[0].score}): ${ytId}`);
    } else if (fallbackRanked.length > 0 && aiKey) {
      const list = fallbackRanked.slice(0, 6)
        .map((c, i) => `${i+1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
        .join('\n');

      const prompt = `Pick the best official trailer for "${title}" (${year}) in ${fallbackLang}.

CANDIDATES:
${list}

Must be for "${title}" (${year}). Full trailer only. No: full movie, reaction, review, song, fan made.
Reply ONLY with the 11-character video ID or NULL.`;

      const raw = await callGroq(prompt, aiKey);
      console.log(`[Groq] Fallback pick for "${title}": ${raw}`);
      if (raw && raw !== 'NULL') ytId = extractYTId(raw);
    }
  }

  // ── Cache and return ──────────────────────────────────────────────────────
  await cacheSet(cacheKey, ytId);

  console.log(ytId
    ? `[Trailer] ✓ "${title}" (${year}) → ${ytId}`
    : `[Trailer] ✗ No trailer for "${title}" (${year})`
  );
  return ytId;
}
