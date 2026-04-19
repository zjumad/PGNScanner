import type { GameHeader, RecognizedMove } from '../types';

export type ApiProvider = 'gemini' | 'github';

const BUILTIN_GITHUB_TOKEN = import.meta.env.VITE_GITHUB_TOKEN as string || '';
const BUILTIN_GEMINI_KEY = import.meta.env.VITE_GEMINI_API_KEY as string || '';

export interface OcrResult {
  header: GameHeader;
  moves: RecognizedMove[];
}

// Base prompt shared by all models — chess notation rules, sheet layout, response format
const BASE_PROMPT = `You are a chess score sheet OCR system. You read handwritten chess notation from US Chess Official Score Sheets.

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

Confidence levels:
- "high": clearly readable
- "medium": somewhat unclear but best guess
- "low": very hard to read, uncertain

Do NOT include rowBBox in individual moves — the grid descriptor is used to compute row positions.

Return ONLY valid JSON, no markdown code blocks or other text.`;

// Gemini-specific grid instructions — Gemini handles spatial tasks well
const GEMINI_GRID_INSTRUCTIONS = `

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
  "grid": {
    "rotation": 0,
    "leftHalf": { "x": 0.08, "y": 0.15, "width": 0.38, "height": 0.72, "rows": 30 },
    "rightHalf": { "x": 0.54, "y": 0.15, "width": 0.38, "height": 0.72, "rows": 30 }
  },
  "moves": [
    {
      "moveNumber": 1,
      "whiteMove": "e4", "blackMove": "e5",
      "whiteConfidence": "high", "blackConfidence": "high"
    }
  ]
}

GRID DESCRIPTOR INSTRUCTIONS:
You MUST provide a "grid" object describing the move table layout in the image. All coordinates are NORMALIZED fractions (0.0 to 1.0) relative to the ORIGINAL image dimensions, where (0,0) = top-left and (1,1) = bottom-right.

- "rotation": The clockwise rotation angle (0, 90, 180, or 270) needed to orient the sheet upright. 0 means text is already upright. The coordinates below are relative to the image AS-IS (before rotation).
- "leftHalf": Bounding box of the LEFT move grid (moves 1-30).
  - "x": left edge of the White notation column (excluding printed move numbers)
  - "y": top edge of row 1 (the FIRST move row, NOT the header area)
  - "width": width from left edge of White column to right edge of Black column
  - "height": total height from top of row 1 to bottom of row 30 (the full printed grid, all 30 rows)
  - "rows": always 30 (the printed grid always has 30 rows per half)
- "rightHalf": Same as leftHalf but for the RIGHT move grid (moves 31-60). If no moves exist in the right half, set all values to 0.

The bounding boxes should cover ONLY the notation cells (White + Black columns), NOT the printed move number column.`;

// GPT-4o-specific grid instructions — needs more explicit anchoring guidance
const GPT4O_GRID_INSTRUCTIONS = `

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
  "grid": {
    "rotation": 0,
    "leftHalf": { "x": 0.08, "y": 0.22, "width": 0.38, "height": 0.65, "rows": 30 },
    "rightHalf": { "x": 0.54, "y": 0.22, "width": 0.38, "height": 0.65, "rows": 30 }
  },
  "moves": [
    {
      "moveNumber": 1,
      "whiteMove": "e4", "blackMove": "e5",
      "whiteConfidence": "high", "blackConfidence": "high"
    }
  ]
}

GRID DESCRIPTOR INSTRUCTIONS — READ CAREFULLY:
You MUST provide a "grid" object locating the move table in the image. All coordinates are NORMALIZED fractions (0.0 to 1.0) relative to the ORIGINAL image dimensions, where (0,0) = top-left and (1,1) = bottom-right.

CRITICAL — How to find the correct "y" (top edge):
1. Find the printed number "1" in the left move grid — this is the FIRST move row.
2. The "y" value must be the TOP EDGE of that row (row 1), where the printed "1" appears.
3. The header area (Event, Date, Round, White, Black, etc.) is ABOVE the move grid. DO NOT include it.
4. Common mistake: DO NOT set "y" to the top of the entire table or the header section. It must start at the first MOVE row.

SELF-CHECK before returning: Verify that leftHalf.y points to the row containing the printed number "1" (first move), NOT to the Event/Date/Player header fields above it.

Field definitions:
- "rotation": The clockwise rotation angle (0, 90, 180, or 270) needed to orient the sheet upright. 0 means text is already upright. Coordinates are relative to the image AS-IS (before rotation).
- "leftHalf": Bounding box of the LEFT move grid (moves 1-30).
  - "x": left edge of the White notation column (EXCLUDE the printed move number column on the left)
  - "y": top edge of ROW 1 — the first row with a printed move number "1". NOT the header. NOT the column labels.
  - "width": from left edge of White column to right edge of Black column
  - "height": from top of row 1 to bottom of row 30 — cover ALL 30 printed rows, even if some are empty
  - "rows": always 30 (the printed grid has exactly 30 rows per half, regardless of how many moves were played)
- "rightHalf": Same structure for the RIGHT move grid (moves 31-60). If unused, set all numeric values to 0.

The bounding boxes must cover ONLY the handwritten notation cells (White + Black columns), NOT the printed move number column.`;

function getSystemPrompt(provider: ApiProvider): string {
  const gridInstructions = provider === 'gemini' ? GEMINI_GRID_INSTRUCTIONS : GPT4O_GRID_INSTRUCTIONS;
  return BASE_PROMPT + gridInstructions;
}

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

function parseBBox(raw: unknown): import('../types').CellBoundingBox | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const b = raw as Record<string, unknown>;
  const x = Number(b.x);
  const y = Number(b.y);
  const w = Number(b.width);
  const h = Number(b.height);
  if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(h)) return undefined;
  return { x, y, width: w, height: h };
}

interface GridHalf {
  x: number;
  y: number;
  width: number;
  height: number;
  rows: number;
}

interface GridDescriptor {
  rotation: 0 | 90 | 180 | 270;
  leftHalf: GridHalf;
  rightHalf: GridHalf;
}

function parseGridDescriptor(raw: unknown): GridDescriptor | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const g = raw as Record<string, unknown>;
  const rot = Number(g.rotation);
  const rotation = (rot === 0 || rot === 90 || rot === 180 || rot === 270 ? rot : 0) as 0 | 90 | 180 | 270;

  const parseHalf = (h: unknown): GridHalf | undefined => {
    if (!h || typeof h !== 'object') return undefined;
    const hh = h as Record<string, unknown>;
    const x = Number(hh.x); const y = Number(hh.y);
    const w = Number(hh.width); const height = Number(hh.height);
    const rows = Number(hh.rows);
    if (isNaN(x) || isNaN(y) || isNaN(w) || isNaN(height) || isNaN(rows)) return undefined;
    return { x, y, width: w, height, rows: Math.max(1, rows) };
  };

  const leftHalf = parseHalf(g.leftHalf);
  if (!leftHalf) return undefined;
  const rightHalf = parseHalf(g.rightHalf) || { x: 0, y: 0, width: 0, height: 0, rows: 30 };

  // Sanity checks — reject obviously bad grids
  if (!validateGridHalf(leftHalf)) return undefined;
  if (rightHalf.width > 0 && !validateGridHalf(rightHalf)) {
    // Right half is bad but left is ok — zero out right half
    return { rotation, leftHalf, rightHalf: { x: 0, y: 0, width: 0, height: 0, rows: 30 } };
  }

  return { rotation, leftHalf, rightHalf };
}

/** Validate a grid half has reasonable normalized values */
function validateGridHalf(half: GridHalf): boolean {
  // All coordinates must be in [0, 1]
  if (half.x < 0 || half.x > 1 || half.y < 0 || half.y > 1) return false;
  if (half.width <= 0 || half.width > 1 || half.height <= 0 || half.height > 1) return false;
  // Box must not extend beyond image
  if (half.x + half.width > 1.05 || half.y + half.height > 1.05) return false;
  // Grid y should not start too close to top (header is above moves)
  // A score sheet typically has the move grid starting at ~10-25% from top
  if (half.y < 0.05) return false;
  // Row height must be reasonable (not too tiny or too large)
  const rowHeight = half.height / half.rows;
  if (rowHeight < 0.005 || rowHeight > 0.1) return false;
  // Rows must be a sensible count
  if (half.rows < 1 || half.rows > 60) return false;
  return true;
}

function computeRowBBox(moveNumber: number, grid: GridDescriptor): { bbox: import('../types').CellBoundingBox; rotation: 0 | 90 | 180 | 270 } {
  const half = moveNumber <= grid.leftHalf.rows ? grid.leftHalf : grid.rightHalf;
  const rowIndex = moveNumber <= grid.leftHalf.rows
    ? moveNumber - 1
    : moveNumber - grid.leftHalf.rows - 1;
  const rowHeight = half.height / half.rows;

  return {
    bbox: {
      x: half.x,
      y: half.y + rowIndex * rowHeight,
      width: half.width,
      height: rowHeight,
    },
    rotation: grid.rotation,
  };
}

function normalizeOcrResult(parsed: Record<string, unknown>): OcrResult {
  const header = parsed.header as Record<string, unknown> | undefined;
  const moves = parsed.moves as Record<string, unknown>[] | undefined;
  const grid = parseGridDescriptor(parsed.grid);

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
    moves: (moves || []).map((m) => {
      const moveNum = m.moveNumber as number;
      // Compute rowBBox from grid descriptor if available; fall back to per-move rowBBox
      let rowBBox: import('../types').CellBoundingBox | undefined;
      let rotation: 0 | 90 | 180 | 270 | undefined;

      if (grid && moveNum) {
        const computed = computeRowBBox(moveNum, grid);
        rowBBox = computed.bbox;
        rotation = computed.rotation;
      } else {
        rowBBox = parseBBox(m.rowBBox);
        const rot = Number(m.rotation);
        rotation = (rot === 0 || rot === 90 || rot === 180 || rot === 270 ? rot : undefined) as 0 | 90 | 180 | 270 | undefined;
      }

      return {
        moveNumber: moveNum,
        whiteMove: (m.whiteMove as string) || '',
        blackMove: (m.blackMove as string) || '',
        whiteConfidence: (m.whiteConfidence as 'high' | 'medium' | 'low') || 'medium',
        blackConfidence: (m.blackConfidence as 'high' | 'medium' | 'low') || 'medium',
        rowBBox,
        rotation,
      };
    }),
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
              { text: getSystemPrompt('gemini') + '\n\nPlease read this chess score sheet and return the moves as JSON.' },
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
          maxOutputTokens: 16384,
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

async function recognizeWithGitHub(
  imageBase64: string,
  token: string,
  imageType: string
): Promise<OcrResult> {
  const response = await fetch('https://models.inference.ai.azure.com/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: getSystemPrompt('github') },
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
      max_tokens: 16384,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      `GitHub Models API error: ${response.status} - ${(error as { error?: { message?: string } }).error?.message || response.statusText}`
    );
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;

  if (!content) {
    throw new Error('No response content from GitHub Models API');
  }

  return parseOcrResponse(content);
}

export async function recognizeScoreSheet(
  imageBase64: string,
  imageType: string = 'image/jpeg',
  provider: ApiProvider = 'gemini'
): Promise<OcrResult> {
  switch (provider) {
    case 'gemini': {
      const key = BUILTIN_GEMINI_KEY;
      if (!key) throw new Error('Gemini API key is not configured. Set VITE_GEMINI_API_KEY in web/.env');
      return recognizeWithGemini(imageBase64, key, imageType);
    }
    case 'github': {
      const token = BUILTIN_GITHUB_TOKEN;
      if (!token) throw new Error('GitHub token is not configured. Set VITE_GITHUB_TOKEN in web/.env');
      return recognizeWithGitHub(imageBase64, token, imageType);
    }
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

/**
 * Merge OCR results from multiple pages into a single result.
 * Moves are merged by moveNumber + color: for overlapping half-moves,
 * the version with higher confidence is kept.
 * Header fields use the first non-empty value across pages.
 */
export function mergeOcrResults(results: OcrResult[]): OcrResult {
  if (results.length === 0) {
    return { header: { event: '', date: '', round: '', white: '', black: '', whiteElo: '', blackElo: '', opening: '', eco: '', result: '*' }, moves: [] };
  }
  if (results.length === 1) return results[0];

  // Merge headers: first non-empty value wins
  const mergedHeader = { ...results[0].header };
  for (const r of results.slice(1)) {
    for (const key of Object.keys(mergedHeader) as (keyof typeof mergedHeader)[]) {
      if (!mergedHeader[key] && r.header[key]) {
        mergedHeader[key] = r.header[key];
      }
    }
  }

  // Merge moves by moveNumber: combine white/black from all pages
  const moveMap = new Map<number, import('../types').RecognizedMove>();
  const confRank = { high: 3, medium: 2, low: 1 };

  for (const r of results) {
    for (const m of r.moves) {
      const existing = moveMap.get(m.moveNumber);
      if (!existing) {
        moveMap.set(m.moveNumber, { ...m });
      } else {
        // Merge white half-move: keep higher confidence
        if (m.whiteMove && m.whiteMove.trim()) {
          if (!existing.whiteMove || !existing.whiteMove.trim() || confRank[m.whiteConfidence] > confRank[existing.whiteConfidence]) {
            existing.whiteMove = m.whiteMove;
            existing.whiteConfidence = m.whiteConfidence;
            existing.rowBBox = m.rowBBox;
          }
        }
        // Merge black half-move: keep higher confidence
        if (m.blackMove && m.blackMove.trim()) {
          if (!existing.blackMove || !existing.blackMove.trim() || confRank[m.blackConfidence] > confRank[existing.blackConfidence]) {
            existing.blackMove = m.blackMove;
            existing.blackConfidence = m.blackConfidence;
            if (!existing.rowBBox) existing.rowBBox = m.rowBBox;
          }
        }
      }
    }
  }

  const mergedMoves = [...moveMap.values()].sort((a, b) => a.moveNumber - b.moveNumber);
  return { header: mergedHeader, moves: mergedMoves };
}
