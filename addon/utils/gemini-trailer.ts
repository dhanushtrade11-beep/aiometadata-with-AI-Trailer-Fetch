interface TrailerRequest {
  title: string;
  year: number;
  primaryLang: string;
  secondaryLang: string;
  originalLang: string;
}

export async function fetchAccurateTrailer(params: TrailerRequest): Promise<string | null> {
  const { title, year, primaryLang, secondaryLang, originalLang } = params;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    console.error('GEMINI_API_KEY is missing in Render environment variables.');
    return null;
  }

  const prompt = `Find the exact, official YouTube Video ID (11 characters) for this movie trailer.
    
Movie: "${title}"
Release Year: ${year}
Original Language: ${originalLang}

STRICT SEARCH HIERARCHY:
1. First preference: "${title} (${year}) ${primaryLang} Official Trailer"
2. Second preference: "${title} (${year}) ${secondaryLang} Official Trailer"
3. Fallback: "${title} (${year}) Official Trailer" (Original Version)

RULES:
- Example of a search target: "Vaazha 2 (2026) Telugu Official Trailer"
- If the movie is an Indian regional film (e.g., Malayalam, Tamil) not dubbed in English, SKIP the English preference and go straight to the Original Language.
- Absolutely NO reviews, NO glimpses, NO teasers, NO reaction videos, and NO fan-made edits.
- RETURN ONLY THE 11-CHARACTER YOUTUBE ID. Do not add any other text, markdown, or explanation.
- If you cannot find a valid trailer, return the word "NULL".`;

  try {
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0.1 }
      })
    });

    const data = await response.json();
    const ytId = data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim();

    if (ytId && ytId !== 'NULL' && ytId.length === 11) {
      return ytId;
    }
  } catch (error) {
    console.error('Gemini Trailer Fetch Error:', error);
  }
  
  return null;
}
