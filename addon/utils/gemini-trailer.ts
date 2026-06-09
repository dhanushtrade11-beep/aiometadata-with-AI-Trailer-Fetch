interface TrailerRequest {
  title: string;
  year: number;
  originalLang: string;
  productionCountries?: string[];
}

interface YouTubeCandidate {
  videoId: string;
  title: string;
  channelTitle: string;
}

// Indian language codes (TMDB)
const INDIAN_LANG_CODES = new Set([
  'ml', 'ta', 'te', 'kn', 'hi', 'bn', 'mr', 'gu', 'pa', 'or', 'as', 'ur'
]);

function isIndianContent(originalLang: string, productionCountries: string[]): boolean {
  if (INDIAN_LANG_CODES.has(originalLang?.toLowerCase())) return true;
  if (productionCountries?.some(c => c?.toUpperCase() === 'IN')) return true;
  return false;
}

function extractYouTubeId(text: string): string | null {
  if (!text) return null;
  text = text.trim();
  const urlPatterns = [
    /youtube\.com\/watch\?v=([a-zA-Z0-9_-]{11})/,
    /youtu\.be\/([a-zA-Z0-9_-]{11})/,
    /youtube\.com\/embed\/([a-zA-Z0-9_-]{11})/,
  ];
  for (const pattern of urlPatterns) {
    const match = text.match(pattern);
    if (match) return match[1];
  }
  if (/^[a-zA-Z0-9_-]{11}$/.test(text)) return text;
  const idMatch = text.match(/[a-zA-Z0-9_-]{11}/);
  if (idMatch) return idMatch[0];
  return null;
}

// Hard reject words — these are NEVER trailers
const REJECT_WORDS = [
  'glimpse', 'teaser', 'reaction', 'review', 'breakdown',
  'fan made', 'fan-made', 'explained', 'song', 'lyric',
  'interview', 'behind the scenes', 'bts', 'making of',
  'deleted scene', 'clip', 'featurette', 'promo'
];

// Pre-filter candidates before sending to Gemini
// This removes obvious junk so Gemini sees only real trailer candidates
function preFilterCandidates(candidates: YouTubeCandidate[]): YouTubeCandidate[] {
  return candidates.filter(c => {
    const t = c.title.toLowerCase();
    const hasRejectWord = REJECT_WORDS.some(w => t.includes(w));
    if (hasRejectWord) return false;
    return true; // Keep everything else — let Gemini decide
  });
}

// Search YouTube Data API v3
async function searchYouTubeCandidates(
  query: string,
  youtubeApiKey: string
): Promise<YouTubeCandidate[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '8'); // Get more candidates to improve chances
  url.searchParams.set('videoEmbeddable', 'true');
  url.searchParams.set('key', youtubeApiKey);

  try {
    const response = await fetch(url.toString());
    const data: any = await response.json();

    if (data?.error) {
      console.error('[YouTube] API error:', data.error.message);
      return [];
    }

    return (data?.items || [])
      .filter((item: any) => item?.id?.videoId)
      .map((item: any) => ({
        videoId: item.id.videoId,
        title: item.snippet?.title || '',
        channelTitle: item.snippet?.channelTitle || '',
      }));
  } catch (e) {
    console.error('[YouTube] Fetch error:', e);
    return [];
  }
}

// Gemini 2.5 Flash Lite — pick best candidate from pre-filtered YouTube results
async function pickBestWithGemini(
  movieTitle: string,
  year: number,
  preferredLang: string,
  fallbackLang: string,
  candidates: YouTubeCandidate[],
  geminiApiKey: string
): Promise<string | null> {
  if (candidates.length === 0) return null;

  const candidateList = candidates
    .map((c, i) => `${i + 1}. ID: ${c.videoId} | Title: "${c.title}" | Channel: "${c.channelTitle}"`)
    .join('\n');

  const prompt = `Pick the best official trailer for the movie "${movieTitle}" (${year}) from these YouTube results.

CANDIDATES:
${candidateList}

PRIORITY ORDER:
1. ${preferredLang} dubbed official trailer (best choice)
2. ${fallbackLang} official trailer
3. Any official full trailer in any language

HARD REJECT (never pick these):
- Videos with words: glimpse, teaser, reaction, review, song, lyric, fan made, promo, clip, interview, making
- Videos that are NOT a full trailer

ACCEPTANCE RULES:
- Official studio or distributor channels are preferred but NOT required — independent uploads of full trailers are acceptable
- The word "trailer" should appear in the title OR it should clearly be a full trailer from the channel name
- If a video looks like a legitimate full trailer, pick it even if the channel is not verified
- Be LENIENT — if it looks like a real trailer, pick it

RETURN: Only the 11-character video ID of your best pick. Nothing else.
If truly none are acceptable, return: NULL`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 20 }
        })
      }
    );

    const data: any = await response.json();

    if (data?.error) {
      console.error('[Gemini] API error:', data.error.message);
      return null;
    }

    const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log(`[Gemini] Picked for "${movieTitle}": ${raw}`);

    if (!raw || raw === 'NULL') return null;
    return extractYouTubeId(raw);
  } catch (e) {
    console.error('[Gemini] Error:', e);
    return null;
  }
}

// Basic fallback picker if Gemini fails
function pickBestBasic(candidates: YouTubeCandidate[]): string | null {
  // First try: must have "trailer" in title and no reject words
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    const hasRejectWord = REJECT_WORDS.some(w => t.includes(w));
    if (t.includes('trailer') && !hasRejectWord) return c.videoId;
  }
  // Second try: anything without reject words
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    const hasRejectWord = REJECT_WORDS.some(w => t.includes(w));
    if (!hasRejectWord) return c.videoId;
  }
  return null;
}

export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, originalLang, productionCountries = [] } = params;

  const youtubeApiKey = process.env.YOUTUBE_API_KEY;
  const geminiApiKey = process.env.GEMINI_API_KEY;

  if (!youtubeApiKey && !geminiApiKey) {
    console.error('[Trailer] Neither YOUTUBE_API_KEY nor GEMINI_API_KEY is set.');
    return null;
  }

  const indian = isIndianContent(originalLang, productionCountries);
  const fallbackLang = indian
    ? (originalLang?.toUpperCase() || 'Original')
    : 'English';

  const queries = [
    `${title} ${year} Telugu dubbed official trailer`,
    `${title} ${year} ${fallbackLang} official trailer`,
    `${title} ${year} official trailer`,
  ];

  console.log(`[Trailer] "${title}" | Year: ${year} | Indian: ${indian} | Fallback: ${fallbackLang}`);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`[Trailer] Query ${i + 1}/${queries.length}: "${query}"`);

    let ytId: string | null = null;

    if (youtubeApiKey) {
      const rawCandidates = await searchYouTubeCandidates(query, youtubeApiKey);
      const candidates = preFilterCandidates(rawCandidates);
      console.log(`[Trailer] YouTube: ${rawCandidates.length} raw → ${candidates.length} after filter`);

      if (candidates.length > 0) {
        if (geminiApiKey) {
          ytId = await pickBestWithGemini(title, year, 'Telugu', fallbackLang, candidates, geminiApiKey);
        } else {
          ytId = pickBestBasic(candidates);
        }
      }
    } else if (geminiApiKey) {
      // Gemini only (no YouTube API)
      const prompt = `Find the official YouTube trailer ID for: "${query}"
Rules: Full trailers only. No glimpses, teasers, reactions, songs.
Return ONLY the 11-character YouTube video ID or NULL.`;

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${geminiApiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: prompt }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 20 }
            })
          }
        );
        const data: any = await response.json();
        if (data?.error) {
          console.error('[Gemini Solo] API error:', data.error.message);
        } else {
          const raw = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
          if (raw && raw !== 'NULL') ytId = extractYouTubeId(raw);
        }
      } catch (e) {
        console.error('[Gemini Solo] Error:', e);
      }
    }

    if (ytId) {
      console.log(`[Trailer] ✓ "${title}" → ${ytId} (query ${i + 1})`);
      return ytId;
    }
  }

  console.log(`[Trailer] ✗ No trailer found for "${title}"`);
  return null;
}
