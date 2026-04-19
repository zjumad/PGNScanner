import type { GameHeader, RecognizedMove } from '../types';

export type ApiProvider = 'gemini' | 'openai';

export interface OcrResult {
  header: GameHeader;
  moves: RecognizedMove[];
}

const SYSTEM_PROMPT = `You are a chess score sheet OCR system. You read handwritten chess notation from US Chess Official Score Sheets.

SHEET LAYOUT:
- The photo is often rotated 90° (taken sideways). Detect orientation from the printed text.
- Header fields at top: Event, Date, Round, Board, Section, White, Black, Opening, Pairing No.
- Move grid: 60 rows in two halves — moves 1-30 on the left, 31-60 on the right.
- Each row has a move number, White move column, and Black move column.
- Result circled at bottom: WHITE WON, DRAW, or BLACK WON.

CHESS NOTATION RULES (Standard Algebraic Notation):
- Piece letters: K (King), Q (Queen), R (Rook), B (Bishop), N (Knight). Pawns have no prefix.
- Files: a, b, c, d, e, f, g, h (left to right from White's perspective)
- Ranks: 1-8 (bottom to top from White's perspective)
- Captures use "x": Bxe5, exd4
- Castling: O-O (kingside) or O-O-O (queenside) — always capital letter O, never zero
- Check: +, Checkmate: #
- Disambiguation: when two identical pieces can reach the same square, add file or rank: Nge2, R1d1
- Promotion: e8=Q (pawn reaches last rank and becomes a piece)

COMMON HANDWRITING CONFUSIONS TO WATCH FOR:
- "N" vs "M" vs "H" — Knight is always N in chess notation, never M or H
- "B" (Bishop) vs "b" (b-file) — B is uppercase for the piece, lowercase for the file
- "K" (King) vs "R" (Rook) — look at context: K moves one square, R moves along ranks/files
- "Q" (Queen) vs "O" (castling) — Q followed by a square means Queen move; O-O means castling
- "b" (b-file) vs "h" (h-file) — these look very similar in handwriting; consider board context
- "c" vs "e" — these files are commonly confused in handwriting
- "d" vs "a" — similarly confused
- "1" vs "l" vs "7" — rank 1 often looks like lowercase L
- "5" vs "3" — check which makes sense for the position
- "g" vs "q" vs "y" — the g-file is common; q and y are not valid file letters
- Capture "x" may be omitted or added spuriously

IMPORTANT:
- Read EVERY move that is actually written. Do not skip or invent moves.
- If a move is crossed out or truly illegible, put "?" as the move.
- Pay careful attention to similar-looking letters. When in doubt, consider which reading produces a valid chess move.
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
