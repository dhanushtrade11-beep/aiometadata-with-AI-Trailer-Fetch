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

// Step 1: YouTube Data API v3 — search and return top candidates
async function searchYouTubeCandidates(
  query: string,
  youtubeApiKey: string
): Promise<YouTubeCandidate[]> {
  const url = new URL('https://www.googleapis.com/youtube/v3/search');
  url.searchParams.set('part', 'snippet');
  url.searchParams.set('q', query);
  url.searchParams.set('type', 'video');
  url.searchParams.set('maxResults', '5');
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

// Step 2: Gemini 1.5 Flash (free) — pick the best candidate from YouTube results
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

  const prompt = `You are picking the best official trailer from YouTube search results.

MOVIE: "${movieTitle}" (${year})
PREFERRED LANGUAGE: ${preferredLang} dubbed trailer
FALLBACK LANGUAGE: ${fallbackLang} official trailer

CANDIDATES:
${candidateList}

SELECTION RULES (in order of priority):
1. Pick a ${preferredLang} DUBBED official trailer if available
2. If not, pick a ${fallbackLang} official trailer
3. If not, pick any official trailer in any language
4. REJECT: teasers, songs, reviews, reactions, breakdowns, fan-made, glimpses, promos
5. REJECT: anything that is NOT a full trailer
6. ONLY pick from official studio or distributor channels

RETURN: Only the video ID of the best match (11 characters). Nothing else. No explanation.
If NONE of the candidates are acceptable, return exactly: NULL`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
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

// Basic keyword filter fallback if Gemini is unavailable
function pickBestBasic(candidates: YouTubeCandidate[]): string | null {
  const junkWords = ['reaction', 'review', 'breakdown', 'fan made', 'fan-made', 'explained', 'teaser only', 'song', 'lyric'];
  for (const c of candidates) {
    const t = c.title.toLowerCase();
    const isTrailer = t.includes('trailer');
    const isJunk = junkWords.some(w => t.includes(w));
    if (isTrailer && !isJunk) return c.videoId;
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

  // Search queries in priority order:
  // 1. Telugu dubbed
  // 2. Fallback language (Original for Indian, English for non-Indian)
  // 3. Any official trailer
  const queries = [
    `${title} ${year} Telugu dubbed official trailer`,
    `${title} ${year} ${fallbackLang} official trailer`,
    `${title} ${year} official trailer`,
  ];

  console.log(`[Trailer] "${title}" | Year: ${year} | Indian: ${indian} | Fallback lang: ${fallbackLang}`);

  for (let i = 0; i < queries.length; i++) {
    const query = queries[i];
    console.log(`[Trailer] Query ${i + 1}/${queries.length}: "${query}"`);

    let ytId: string | null = null;

    if (youtubeApiKey) {
      // Get real YouTube search candidates
      const candidates = await searchYouTubeCandidates(query, youtubeApiKey);
      console.log(`[Trailer] YouTube returned ${candidates.length} candidates for query ${i + 1}`);

      if (candidates.length > 0) {
        if (geminiApiKey) {
          // Best combo: Gemini picks the most accurate from real YouTube results
          ytId = await pickBestWithGemini(title, year, 'Telugu', fallbackLang, candidates, geminiApiKey);
        } else {
          // YouTube only: basic keyword filter
          ytId = pickBestBasic(candidates);
        }
      }
    } else if (geminiApiKey) {
      // No YouTube API: Gemini 1.5 Flash alone (free 1500/day, less accurate)
      const prompt = `Find the official YouTube trailer ID for this search query: "${query}"

Rules:
- ONLY official studio or distributor channels
- ONLY full trailers, NOT teasers/reviews/reactions/fan edits
- Return ONLY the 11-character YouTube video ID
- If not found or unsure, return exactly: NULL`;

      try {
        const response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiApiKey}`,
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
      console.log(`[Trailer] ✓ Found for "${title}": ${ytId} (query ${i + 1})`);
      return ytId;
    }
  }

  console.log(`[Trailer] ✗ No trailer found for "${title}"`);
  return null;
}
