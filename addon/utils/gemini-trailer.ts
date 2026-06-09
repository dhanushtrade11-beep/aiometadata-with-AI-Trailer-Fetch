interface TrailerRequest {
  title: string;
  year: number;
  originalLang: string;
  productionCountries?: string[]; // e.g. ['IN', 'US', 'KR']
}

// Extract YouTube ID from various URL formats or plain ID
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

// Indian language codes used by TMDB
const INDIAN_LANG_CODES = new Set([
  'ml', // Malayalam
  'ta', // Tamil
  'te', // Telugu
  'kn', // Kannada
  'hi', // Hindi
  'bn', // Bengali
  'mr', // Marathi
  'gu', // Gujarati
  'pa', // Punjabi
  'or', // Odia
  'as', // Assamese
  'ur', // Urdu
]);

// Indian country codes
const INDIAN_COUNTRY_CODES = new Set(['IN']);

function isIndianContent(originalLang: string, productionCountries: string[]): boolean {
  if (INDIAN_LANG_CODES.has(originalLang?.toLowerCase())) return true;
  if (productionCountries?.some(c => INDIAN_COUNTRY_CODES.has(c?.toUpperCase()))) return true;
  return false;
}

function buildSearchQueries(
  title: string,
  year: number,
  originalLangLabel: string,
  isIndian: boolean
): { queries: string[]; fallbackLabel: string } {
  if (isIndian) {
    // Indian content: Telugu → Original language
    return {
      queries: [
        `"${title}" ${year} Telugu dubbed official trailer site:youtube.com`,
        `"${title}" Telugu official trailer site:youtube.com`,
        `"${title}" ${year} ${originalLangLabel} official trailer site:youtube.com`,
        `"${title}" ${originalLangLabel} official trailer site:youtube.com`,
      ],
      fallbackLabel: originalLangLabel,
    };
  } else {
    // Non-Indian content: Telugu → English
    return {
      queries: [
        `"${title}" ${year} Telugu dubbed official trailer site:youtube.com`,
        `"${title}" Telugu official trailer site:youtube.com`,
        `"${title}" ${year} English official trailer site:youtube.com`,
        `"${title}" ${year} official trailer site:youtube.com`,
      ],
      fallbackLabel: 'English',
    };
  }
}

export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, originalLang, productionCountries = [] } = params;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('[Gemini Trailer] GEMINI_API_KEY is missing.');
    return null;
  }

  const indian = isIndianContent(originalLang, productionCountries);
  const originalLangLabel = originalLang?.toUpperCase() || 'Original';
  const { queries, fallbackLabel } = buildSearchQueries(title, year, originalLangLabel, indian);

  const prompt = `You are a YouTube trailer finder. Use Google Search to find the official trailer for this movie/show on YouTube.

TITLE: "${title}"
YEAR: ${year}
ORIGINAL LANGUAGE: ${originalLangLabel}
IS INDIAN CONTENT: ${indian}

SEARCH PRIORITY (in order):
1. Telugu dubbed official trailer → Search: ${queries[0]}
2. Telugu official trailer (alternate query) → Search: ${queries[1]}
3. If NO Telugu trailer exists → ${indian ? `Original language (${originalLangLabel})` : 'English'} official trailer → Search: ${queries[2]}
4. Last fallback → Search: ${queries[3]}

STRICT RULES:
- ONLY accept videos from official studio, distributor, or verified YouTube channels
- ONLY full trailers — NO teasers, NO glimpses, NO songs, NO reviews, NO reactions, NO fan edits
- The video title MUST contain the word "Trailer"
- Telugu dubbed version is STRONGLY preferred if it genuinely exists on YouTube
- If Telugu dubbed trailer does NOT exist: ${indian ? `use ${originalLangLabel} original trailer` : 'use English trailer'}
- Do NOT guess or hallucinate a YouTube ID — if you are not 100% sure, return NULL

RETURN FORMAT:
Return ONLY the YouTube video URL or 11-character video ID. Nothing else. No explanation. No markdown.
If not found with confidence, return exactly: NULL`;

  try {
    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          tools: [{ google_search: {} }],
          generationConfig: {
            temperature: 0,
            maxOutputTokens: 50,
          },
        }),
      }
    );

    const data: any = await response.json();

    if (data?.error) {
      console.error('[Gemini Trailer] API error:', data.error.message);
      return null;
    }

    const rawText = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();
    console.log(`[Gemini Trailer] "${title}" (${indian ? 'Indian' : 'Non-Indian'}, fallback: ${fallbackLabel}) → Raw: ${rawText}`);

    if (!rawText || rawText === 'NULL') return null;

    const ytId = extractYouTubeId(rawText);
    if (ytId) {
      console.log(`[Gemini Trailer] ✓ Trailer ID for "${title}": ${ytId}`);
      return ytId;
    }

    return null;
  } catch (error) {
    console.error('[Gemini Trailer] Fetch error:', error);
    return null;
  }
}
