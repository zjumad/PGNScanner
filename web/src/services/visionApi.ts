import type { GameHeader, RecognizedMove } from '../types';

export type ApiProvider = 'gemini' | 'openai';

export interface OcrResult {
  header: GameHeader;
  moves: RecognizedMove[];
}

const SYSTEM_PROMPT = `You are a chess score sheet OCR system. You read handwritten chess notation from US Chess Official Score Sheets.

The score sheet has:
- Header fields: Event, Date, Round, Board, Section, White, Black, Opening, Pairing No.
- A grid with 60 rows (1-30 on left, 31-60 on right), each row has a White move and Black move column.
- Result circled at bottom: WHITE WON, DRAW, or BLACK WON.

IMPORTANT:
- The photo may be rotated 90° (taken sideways). Detect orientation automatically.
- Handwriting may be messy. Do your best to read each move.
- Use standard algebraic notation (SAN): e.g., e4, Nf3, Bxc6, O-O, Qd1+, exd5
- For castling, always use O-O (kingside) or O-O-O (queenside) with capital letter O, not zero.
- Include check (+) and checkmate (#) symbols if visible.
- Include capture (x) if present.
- If a move is crossed out or illegible, put "?" as the move.
- Only include moves that are actually written. Do not invent moves.
- The result should be "1-0" for White Won, "0-1" for Black Won, "1/2-1/2" for Draw, or "*" if unclear.

Return your response as a JSON object with this exact structure:
{
  "header": {
    "event": "...",
    "date": "YYYY.MM.DD",
    "round": "...",
    "white": "Player Name",
    "black": "Player Name",
    "whiteElo": "",
    "blackElo": "",
    "opening": "",
    "eco": "",
    "result": "1-0 | 0-1 | 1/2-1/2 | *"
  },
  "moves": [
    { "moveNumber": 1, "whiteMove": "e4", "blackMove": "e5", "whiteConfidence": "high", "blackConfidence": "high" },
    { "moveNumber": 2, "whiteMove": "Nf3", "blackMove": "Nc6", "whiteConfidence": "high", "blackConfidence": "medium" }
  ]
}

Confidence levels:
- "high": clearly readable
- "medium": somewhat unclear but best guess
- "low": very hard to read, uncertain

Return ONLY valid JSON, no markdown code blocks or other text.`;

function parseOcrResponse(content: string): OcrResult {
  let jsonStr = content.trim();
  if (jsonStr.startsWith('```')) {
    jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
  }

  // Try parsing as-is first
  try {
    return normalizeOcrResult(JSON.parse(jsonStr));
  } catch {
    // Attempt to salvage truncated JSON
  }

  // Try increasingly aggressive repairs
  for (const repaired of repairAttempts(jsonStr)) {
    try {
      return normalizeOcrResult(JSON.parse(repaired));
    } catch {
      continue;
    }
  }

  throw new Error('Failed to parse OCR response. The API response may be too long or malformed.');
}

function normalizeOcrResult(parsed: Record<string, unknown>): OcrResult {
  const header = parsed.header as Record<string, unknown> | undefined;
  const moves = parsed.moves as Record<string, unknown>[] | undefined;
  return {
    header: {
      event: (header?.event as string) || '',
      date: (header?.date as string) || '',
      round: (header?.round as string) || '',
      white: (header?.white as string) || '',
      black: (header?.black as string) || '',
      whiteElo: (header?.whiteElo as string) || '',
      blackElo: (header?.blackElo as string) || '',
      opening: (header?.opening as string) || '',
      eco: (header?.eco as string) || '',
      result: (header?.result as string) || '*',
    },
    moves: (moves || []).map((m) => ({
      moveNumber: m.moveNumber as number,
      whiteMove: (m.whiteMove as string) || '',
      blackMove: (m.blackMove as string) || '',
      whiteConfidence: (m.whiteConfidence as 'high' | 'medium' | 'low') || 'medium',
      blackConfidence: (m.blackConfidence as 'high' | 'medium' | 'low') || 'medium',
    })),
  };
}

/**
 * Generate multiple repair attempts for truncated JSON, from least to most aggressive.
 */
function* repairAttempts(json: string): Generator<string> {
  let s = json.trimEnd();

  // Attempt 1: just close open structures
  yield closeJson(s);

  // Attempt 2: remove last incomplete value, then close
  // Truncation often cuts mid-value, e.g.: ..."whiteMove": "Nf
  // Strip back to last complete key-value pair
  s = stripToLastCompleteValue(s);
  yield closeJson(s);

  // Attempt 3: strip back to last complete array element (move object)
  s = stripToLastCompleteElement(json.trimEnd());
  yield closeJson(s);
}

/**
 * Close all open strings, arrays, and objects in a JSON fragment.
 */
function closeJson(s: string): string {
  // Remove trailing comma
  s = s.replace(/,\s*$/, '');

  // Check if we're inside an unterminated string
  let inString = false;
  let escaped = false;
  for (const ch of s) {
    if (escaped) { escaped = false; continue; }
    if (ch === '\\') { escaped = true; continue; }
    if (ch === '"') inString = !inString;
  }
  if (inString) s += '"';

  // Remove trailing incomplete key-value (e.g., `"key":` or `"key": `)
  s = s.replace(/,?\s*"[^"]*"\s*:\s*"[^"]*"?\s*$/, '');
  s = s.replace(/,?\s*"[^"]*"\s*:\s*$/, '');
  s = s.replace(/,\s*$/, '');

  // Count unmatched brackets and close them
  const closers = computeClosers(s);
  return s + closers;
}

function computeClosers(s: string): string {
  const stack: string[] = [];
  let inStr = false;
  let esc = false;
  for (const ch of s) {
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') stack.push('}');
    else if (ch === '[') stack.push(']');
    else if (ch === '}' || ch === ']') stack.pop();
  }
  return stack.reverse().join('');
}

/**
 * Strip back to the last character that ends a complete JSON value.
 */
function stripToLastCompleteValue(s: string): string {
  // Find the last position that ends a complete value: ", }, ], digit, true/false/null
  for (let i = s.length - 1; i >= 0; i--) {
    const ch = s[i];
    if (ch === '"' || ch === '}' || ch === ']') {
      // Make sure this quote isn't escaped
      if (ch === '"' && i > 0 && s[i - 1] === '\\') continue;
      return s.slice(0, i + 1);
    }
    if (/[0-9]/.test(ch)) return s.slice(0, i + 1);
    if (s.slice(Math.max(0, i - 3), i + 1).match(/(true|null)$/)) return s.slice(0, i + 1);
    if (s.slice(Math.max(0, i - 4), i + 1).match(/false$/)) return s.slice(0, i + 1);
  }
  return s;
}

/**
 * Strip back to the last complete object in an array (last `}`).
 */
function stripToLastCompleteElement(s: string): string {
  // Find the last `}` that closes a complete move object
  let depth = 0;
  let inStr = false;
  let esc = false;
  let lastCompleteObj = -1;

  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (esc) { esc = false; continue; }
    if (ch === '\\') { esc = true; continue; }
    if (ch === '"') { inStr = !inStr; continue; }
    if (inStr) continue;
    if (ch === '{') depth++;
    if (ch === '}') { depth--; lastCompleteObj = i; }
  }

  if (lastCompleteObj > 0) {
    return s.slice(0, lastCompleteObj + 1);
  }
  return s;
}

async function recognizeWithGemini(
  imageBase64: string,
  apiKey: string,
  imageType: string
): Promise<OcrResult> {
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: SYSTEM_PROMPT + '\n\nPlease read this chess score sheet and return the moves as JSON.' },
              {
                inline_data: {
                  mime_type: imageType,
                  data: imageBase64,
                },
              },
            ],
          },
        ],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: 8192,
        },
      }),
    }
  );

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const msg = (error as { error?: { message?: string } }).error?.message || response.statusText;
    throw new Error(`Gemini API error: ${response.status} - ${msg}`);
  }

  const data = await response.json();
  const content = data.candidates?.[0]?.content?.parts?.[0]?.text;

  if (!content) {
    throw new Error('No response content from Gemini API');
  }

  return parseOcrResponse(content);
}

async function recognizeWithOpenAI(
  imageBase64: string,
  apiKey: string,
  imageType: string
): Promise<OcrResult> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: 'Please read this chess score sheet and return the moves as JSON.',
            },
            {
              type: 'image_url',
              image_url: {
                url: `data:${imageType};base64,${imageBase64}`,
                detail: 'high',
              },
            },
          ],
        },
      ],
      max_tokens: 8192,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `OpenAI API error: ${response.status} - ${(error as { error?: { message?: string } }).error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No response content from OpenAI API');
  }

  return parseOcrResponse(content);
}

export async function recognizeScoreSheet(
  imageBase64: string,
  apiKey: string,
  imageType: string = 'image/jpeg',
  provider: ApiProvider = 'gemini'
): Promise<OcrResult> {
  switch (provider) {
    case 'gemini':
      return recognizeWithGemini(imageBase64, apiKey, imageType);
    case 'openai':
      return recognizeWithOpenAI(imageBase64, apiKey, imageType);
    default:
      throw new Error(`Unknown API provider: ${provider}`);
  }
}

/**
 * Convert a File to base64 string.
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Remove data URL prefix
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
