import { Chess } from 'chess.js';

/**
 * Normalize OCR text into plausible SAN candidates.
 * Handles common handwriting/OCR confusions.
 */
function generateSanCandidates(raw: string): string[] {
  if (!raw || raw.trim() === '') return [];

  let text = raw.trim();

  // Normalize castling variants (broad: 0/O/o, with or without hyphens)
  text = text
    .replace(/^[oO0]-?[oO0]-?[oO0]$/g, 'O-O-O')
    .replace(/^[oO0]-?[oO0]$/g, 'O-O');

  const candidates = new Set<string>();
  candidates.add(text);

  // Position-aware substitutions: piece letters (uppercase prefix) vs
  // file/rank characters (lowercase + digits in the rest of the move).
  // This avoids destructive global replacements like B→8 that corrupt valid SAN.

  // Piece-letter confusions (only applied to uppercase first char)
  const pieceConfusions: Record<string, string[]> = {
    'R': ['K'],       // R ↔ K in handwriting
    'K': ['R'],
    'N': ['H', 'M'],  // N ↔ H/M
    'B': ['D'],       // B ↔ D
    'Q': ['O', 'G'],  // Q ↔ O/G
    'O': ['Q'],       // O misread as piece → probably Q
    'D': ['B'],
    'H': ['N'],
    'M': ['N'],
    'G': ['Q'],
  };

  // File-letter confusions (for lowercase a-h in positions)
  const fileConfusions: Record<string, string[]> = {
    'e': ['c'],       // e ↔ c
    'c': ['e'],
    'd': ['a', 'cl'],
    'a': ['d'],
    'b': ['d', 'h'],  // b ↔ d/h in handwriting
    'h': ['b'],
    'f': ['t'],
    'g': ['q', 'y'],
    'q': ['g'],
    'y': ['g'],       // y misread → probably g
  };

  // Digit confusions (for rank numbers)
  const digitConfusions: Record<string, string[]> = {
    '1': ['l', '7'],
    '7': ['1'],
    '5': ['3', 'S'],
    '3': ['5'],
    '8': ['B', '6'],
    'B': ['8'],       // uppercase B in digit position → probably 8
    '6': ['G', 'b', '8'],
    '2': ['Z', 'z'],
    '4': ['9'],
    '9': ['4', 'g'],
    '0': ['O'],
  };

  // General OCR substitutions (safe for any position)
  const globalSubs: [RegExp, string][] = [
    [/l/g, '1'], [/I/g, '1'],
    [/O/g, '0'], [/0/g, 'O'],
    [/S/g, '5'],
    [/Z/g, '2'], [/z/g, '2'],
  ];

  // Generate single global-substitution variants
  for (const [pattern, replacement] of globalSubs) {
    if (pattern.test(text)) {
      candidates.add(text.replace(pattern, replacement));
    }
  }

  // Position-aware substitutions: try swapping first char if it looks like a piece
  if (text.length >= 2 && /^[A-Z]/.test(text)) {
    const piece = text[0];
    const rest = text.slice(1);
    const alts = pieceConfusions[piece];
    if (alts) {
      for (const alt of alts) {
        candidates.add(alt + rest);
      }
    }
  }

  // Try file and digit confusions at each character position
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const fileSubs = fileConfusions[ch];
    const digitSubs = digitConfusions[ch];
    const subs = [...(fileSubs || []), ...(digitSubs || [])];
    for (const sub of subs) {
      candidates.add(text.slice(0, i) + sub + text.slice(i + 1));
    }
  }

  // Try adding/removing common chess notation symbols
  const stripped = text.replace(/[+#!?]/g, '');
  candidates.add(stripped);
  candidates.add(stripped + '+');
  candidates.add(stripped + '#');

  // Try adding 'x' for captures (common to omit)
  if (stripped.length >= 3 && !stripped.includes('x')) {
    for (let i = 1; i < stripped.length; i++) {
      candidates.add(stripped.slice(0, i) + 'x' + stripped.slice(i));
    }
  }

  // Try removing 'x' if present
  if (text.includes('x')) {
    candidates.add(text.replace('x', ''));
  }

  // Handle pawn promotions: e.g., "e8Q", "e8=Q", "e8(Q)"
  const promoMatch = stripped.match(/^([a-h][18])[=()]?([QRBNOGD])[)]?$/);
  if (promoMatch) {
    const sq = promoMatch[1];
    const pieceLetter = promoMatch[2];
    // Try the literal piece and its confusions
    const promoPieces = [pieceLetter, ...(pieceConfusions[pieceLetter] || [])];
    for (const p of promoPieces) {
      if ('QRBN'.includes(p)) {
        candidates.add(`${sq}=${p}`);
        candidates.add(`${sq}${p}`);
      }
    }
  }

  // Handle disambiguation: if OCR misread a disambiguating piece move,
  // try substituting the disambiguation char AND removing it entirely
  const disambigMatch = stripped.match(/^([KQRBN])([a-h1-8])(x?)([a-h][1-8])$/);
  if (disambigMatch) {
    const [, piece, disambig, capture, dest] = disambigMatch;
    // Try without disambiguation
    candidates.add(`${piece}${capture}${dest}`);
    // Try file confusions on the disambiguation character
    const disambigSubs = [...(fileConfusions[disambig] || []), ...(digitConfusions[disambig] || [])];
    for (const sub of disambigSubs) {
      candidates.add(`${piece}${sub}${capture}${dest}`);
    }
  }

  // Pairwise substitutions: try piece + one position swap for short moves
  // This catches cases like "Ke2" when the real move is "Rc2" (both piece AND file wrong)
  if (text.length >= 3 && /^[A-Z]/.test(text)) {
    const piece = text[0];
    const rest = text.slice(1);
    const pieceAlts = pieceConfusions[piece] || [];
    for (const altPiece of pieceAlts) {
      // For each piece alt, also try file/digit subs on remaining chars
      for (let i = 0; i < rest.length; i++) {
        const ch = rest[i];
        const subs = [...(fileConfusions[ch] || []), ...(digitConfusions[ch] || [])];
        for (const sub of subs) {
          candidates.add(altPiece + rest.slice(0, i) + sub + rest.slice(i + 1));
        }
      }
    }
  }

  return Array.from(candidates);
}

/**
 * Calculate similarity between two strings (0-1 scale).
 */
function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;

  const costs: number[] = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) {
        costs[j] = j;
      } else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer[i - 1] !== shorter[j - 1]) {
          newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        }
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (longer.length - costs[shorter.length]) / longer.length;
}

export interface MatchResult {
  bestMove: string;
  confidence: 'high' | 'medium' | 'low';
  score: number;
}

/**
 * Match raw OCR text against legal moves at the current position.
 */
export function matchMoveToLegal(
  rawText: string,
  legalMoves: string[],
  forceMatch: boolean = false
): MatchResult | null {
  if (!rawText || rawText.trim() === '' || legalMoves.length === 0) return null;

  const candidates = generateSanCandidates(rawText);
  let bestMove = '';
  let bestScore = 0;

  for (const candidate of candidates) {
    for (const legal of legalMoves) {
      // Exact match
      if (candidate === legal) {
        return { bestMove: legal, confidence: 'high', score: 1.0 };
      }
      // Case-insensitive exact match (but preserve piece letters)
      if (candidate.toLowerCase() === legal.toLowerCase()) {
        return { bestMove: legal, confidence: 'high', score: 0.95 };
      }

      const score = similarity(candidate, legal);
      if (score > bestScore) {
        bestScore = score;
        bestMove = legal;
      }
    }
  }

  if (bestScore >= 0.8) {
    return { bestMove, confidence: 'medium', score: bestScore };
  }
  if (bestScore >= 0.5) {
    return { bestMove, confidence: 'low', score: bestScore };
  }
  // Force-match: return best legal move even below threshold
  if (forceMatch && bestMove) {
    return { bestMove, confidence: 'low', score: bestScore };
  }
  return null;
}

/**
 * Validate and process a sequence of moves, matching OCR output
 * to legal moves at each position.
 */
export function validateMoveSequence(
  moves: { moveNumber: number; white: string; black: string; rowBBox?: import('../types').CellBoundingBox }[]
): import('../types').ValidatedMove[] {
  const chess = new Chess();
  const validated: import('../types').ValidatedMove[] = [];

  for (const move of moves) {
    // White move
    if (move.white && move.white.trim() !== '') {
      const fenBefore = chess.fen();
      const legalMoves = chess.moves();

      if (legalMoves.length === 0) break; // Game is over

      const match = matchMoveToLegal(move.white, legalMoves, true);

      if (match) {
        const isExact = match.score >= 0.95;
        const isFuzzy = !isExact && match.score >= 0.5;
        const isForced = !isExact && !isFuzzy;
        try {
          chess.move(match.bestMove);
          validated.push({
            moveNumber: move.moveNumber,
            color: 'w',
            san: match.bestMove,
            rawOcr: move.white,
            confidence: match.confidence,
            matchType: isForced ? 'forced' : isFuzzy ? 'fuzzy' : 'exact',
            isValid: true,
            legalAlternatives: legalMoves,
            fenAfter: chess.fen(),
            fenBefore,
            bbox: move.rowBBox,
          });
        } catch {
          // Shouldn't happen since we matched against legal moves, but be defensive
          validated.push({
            moveNumber: move.moveNumber,
            color: 'w',
            san: move.white,
            rawOcr: move.white,
            confidence: 'low',
            matchType: 'forced',
            isValid: false,
            legalAlternatives: legalMoves,
            fenAfter: fenBefore,
            fenBefore,
            bbox: move.rowBBox,
          });
          break;
        }
      } else {
        // No match at all (empty OCR or no legal moves) — mark invalid, can't continue
        validated.push({
          moveNumber: move.moveNumber,
          color: 'w',
          san: move.white,
          rawOcr: move.white,
          confidence: 'low',
          matchType: 'forced',
          isValid: false,
          legalAlternatives: legalMoves,
          fenAfter: fenBefore,
          fenBefore,
          bbox: move.rowBBox,
        });
        break;
      }
    }

    // Black move
    if (move.black && move.black.trim() !== '') {
      const fenBefore = chess.fen();
      const legalMoves = chess.moves();

      if (legalMoves.length === 0) break; // Game is over

      const match = matchMoveToLegal(move.black, legalMoves, true);

      if (match) {
        const isExact = match.score >= 0.95;
        const isFuzzy = !isExact && match.score >= 0.5;
        const isForced = !isExact && !isFuzzy;
        try {
          chess.move(match.bestMove);
          validated.push({
            moveNumber: move.moveNumber,
            color: 'b',
            san: match.bestMove,
            rawOcr: move.black,
            confidence: match.confidence,
            matchType: isForced ? 'forced' : isFuzzy ? 'fuzzy' : 'exact',
            isValid: true,
            legalAlternatives: legalMoves,
            fenAfter: chess.fen(),
            fenBefore,
            bbox: move.rowBBox,
          });
        } catch {
          validated.push({
            moveNumber: move.moveNumber,
            color: 'b',
            san: move.black,
            rawOcr: move.black,
            confidence: 'low',
            matchType: 'forced',
            isValid: false,
            legalAlternatives: legalMoves,
            fenAfter: fenBefore,
            fenBefore,
            bbox: move.rowBBox,
          });
          break;
        }
      } else {
        validated.push({
          moveNumber: move.moveNumber,
          color: 'b',
          san: move.black,
          rawOcr: move.black,
          confidence: 'low',
          matchType: 'forced',
          isValid: false,
          legalAlternatives: legalMoves,
          fenAfter: fenBefore,
          fenBefore,
          bbox: move.rowBBox,
        });
        break;
      }
    }
  }

  return validated;
}

/**
 * Re-validate moves from a given index forward after a correction.
 * Uses rawOcr for all moves except the corrected one, preserving original OCR data.
 */
export function revalidateFromIndex(
  currentMoves: import('../types').ValidatedMove[],
  correctionIndex: number,
  newSan: string
): import('../types').ValidatedMove[] {
  // Rebuild move list as raw pairs, using rawOcr to preserve original text
  const rawMoves: { moveNumber: number; white: string; black: string; rowBBox?: import('../types').CellBoundingBox; }[] = [];
  let currentPair: { moveNumber: number; white: string; black: string; rowBBox?: import('../types').CellBoundingBox; } | null = null;

  for (let i = 0; i < currentMoves.length; i++) {
    const m = currentMoves[i];
    // Use the corrected SAN at the correction index, rawOcr everywhere else
    const text = i === correctionIndex ? newSan : (m.rawOcr || m.san);

    if (m.color === 'w') {
      if (currentPair) rawMoves.push(currentPair);
      currentPair = { moveNumber: m.moveNumber, white: text, black: '', rowBBox: m.bbox };
    } else {
      if (!currentPair) {
        currentPair = { moveNumber: m.moveNumber, white: '', black: text, rowBBox: m.bbox };
      } else {
        currentPair.black = text;
        if (!currentPair.rowBBox) currentPair.rowBBox = m.bbox;
      }
    }
  }
  if (currentPair) rawMoves.push(currentPair);

  const result = validateMoveSequence(rawMoves);

  // Mark the corrected move
  if (correctionIndex < result.length) {
    result[correctionIndex].matchType = 'corrected';
  }

  return result;
}

/**
 * Insert a new move after a given index and revalidate the entire sequence.
 * insertAfterIndex = -1 means insert before all moves (new first move).
 * The inserted SAN must be a legal move at that position.
 */
export function insertMoveAtIndex(
  currentMoves: import('../types').ValidatedMove[],
  insertAfterIndex: number,
  newSan: string
): import('../types').ValidatedMove[] {
  // Build raw pairs from current moves, inserting the new move
  const flatMoves: { san: string; color: 'w' | 'b'; moveNumber: number; rawOcr?: string; bbox?: import('../types').CellBoundingBox; isInserted?: boolean }[] = [];

  for (let i = 0; i < currentMoves.length; i++) {
    flatMoves.push({
      san: currentMoves[i].rawOcr || currentMoves[i].san,
      color: currentMoves[i].color,
      moveNumber: currentMoves[i].moveNumber,
      rawOcr: currentMoves[i].rawOcr,
      bbox: currentMoves[i].bbox,
    });
  }

  // Determine the color for the inserted move
  let insertColor: 'w' | 'b';
  if (insertAfterIndex < 0) {
    insertColor = 'w'; // first move is always white
  } else if (insertAfterIndex < flatMoves.length) {
    const prev = flatMoves[insertAfterIndex];
    insertColor = prev.color === 'w' ? 'b' : 'w';
  } else {
    // Appending at end
    const last = flatMoves[flatMoves.length - 1];
    insertColor = last ? (last.color === 'w' ? 'b' : 'w') : 'w';
  }

  // Insert the new move
  const insertPos = insertAfterIndex + 1;
  flatMoves.splice(insertPos, 0, {
    san: newSan,
    color: insertColor,
    moveNumber: 0, // will be recalculated
    isInserted: true,
  });

  // Recalculate move numbers and colors based on position
  for (let i = 0; i < flatMoves.length; i++) {
    flatMoves[i].color = i % 2 === 0 ? 'w' : 'b';
    flatMoves[i].moveNumber = Math.floor(i / 2) + 1;
  }

  // Convert back to raw pairs
  const rawMoves: { moveNumber: number; white: string; black: string; rowBBox?: import('../types').CellBoundingBox; }[] = [];
  for (let i = 0; i < flatMoves.length; i++) {
    const fm = flatMoves[i];
    if (fm.color === 'w') {
      rawMoves.push({ moveNumber: fm.moveNumber, white: fm.san, black: '', rowBBox: fm.bbox });
    } else {
      const last = rawMoves[rawMoves.length - 1];
      if (last && last.moveNumber === fm.moveNumber) {
        last.black = fm.san;
        if (!last.rowBBox) last.rowBBox = fm.bbox;
      } else {
        rawMoves.push({ moveNumber: fm.moveNumber, white: '', black: fm.san, rowBBox: fm.bbox });
      }
    }
  }

  const result = validateMoveSequence(rawMoves);

  // Mark the inserted move as corrected
  if (insertPos < result.length) {
    result[insertPos].matchType = 'corrected';
  }

  return result;
}

/**
 * Delete a move at a given index and revalidate the entire sequence.
 */
export function deleteMoveAtIndex(
  currentMoves: import('../types').ValidatedMove[],
  deleteIndex: number,
): import('../types').ValidatedMove[] {
  const flatMoves: { san: string; rawOcr?: string; bbox?: import('../types').CellBoundingBox; }[] = [];

  for (let i = 0; i < currentMoves.length; i++) {
    if (i === deleteIndex) continue;
    flatMoves.push({
      san: currentMoves[i].rawOcr || currentMoves[i].san,
      rawOcr: currentMoves[i].rawOcr,
      bbox: currentMoves[i].bbox,
    });
  }

  // Rebuild raw pairs
  const rawMoves: { moveNumber: number; white: string; black: string; rowBBox?: import('../types').CellBoundingBox; }[] = [];
  for (let i = 0; i < flatMoves.length; i++) {
    const color = i % 2 === 0 ? 'w' : 'b';
    const moveNum = Math.floor(i / 2) + 1;
    if (color === 'w') {
      rawMoves.push({ moveNumber: moveNum, white: flatMoves[i].san, black: '', rowBBox: flatMoves[i].bbox });
    } else {
      const last = rawMoves[rawMoves.length - 1];
      if (last && last.moveNumber === moveNum) {
        last.black = flatMoves[i].san;
        if (!last.rowBBox) last.rowBBox = flatMoves[i].bbox;
      } else {
        rawMoves.push({ moveNumber: moveNum, white: '', black: flatMoves[i].san, rowBBox: flatMoves[i].bbox });
      }
    }
  }

  return validateMoveSequence(rawMoves);
}

/**
 * Get legal moves at a specific position (after applying moves up to index).
 */
export function getLegalMovesAtPosition(
  moves: import('../types').ValidatedMove[],
  upToIndex: number
): string[] {
  const chess = new Chess();
  for (let i = 0; i <= upToIndex && i < moves.length; i++) {
    if (moves[i].isValid) {
      try {
        chess.move(moves[i].san);
      } catch {
        break;
      }
    } else {
      break;
    }
  }
  return chess.moves();
}

/**
 * Generate PGN string from validated moves and header.
 * Forced guesses are annotated with comments.
 * Speculative moves are excluded.
 */
export function generatePgn(
  header: import('../types').GameHeader,
  moves: import('../types').ValidatedMove[]
): string {
  const tags = [
    `[Event "${header.event}"]`,
    `[Date "${header.date}"]`,
    `[Round "${header.round}"]`,
    `[White "${header.white}"]`,
    `[Black "${header.black}"]`,
    header.whiteElo ? `[WhiteElo "${header.whiteElo}"]` : '',
    header.blackElo ? `[BlackElo "${header.blackElo}"]` : '',
    header.opening ? `[Opening "${header.opening}"]` : '',
    header.eco ? `[ECO "${header.eco}"]` : '',
    `[Result "${header.result}"]`,
  ]
    .filter(Boolean)
    .join('\n');

  let moveText = '';
  for (const move of moves) {
    if (!move.isValid || move.matchType === 'speculative') break;
    if (move.color === 'w') {
      moveText += `${move.moveNumber}. ${move.san} `;
    } else {
      moveText += `${move.san} `;
    }
    if (move.matchType === 'forced') {
      moveText += `{uncertain: OCR read "${move.rawOcr || '?'}"} `;
    }
  }

  moveText += header.result;

  return `${tags}\n\n${moveText.trim()}`;
}

/**
 * Build speculative tail entries for raw OCR moves that were not validated.
 * These are appended after the validated moves so the user can see the full
 * OCR output even when validation stops early.
 */
export function buildSpeculativeTail(
  rawMoves: { moveNumber: number; white: string; black: string }[],
  validatedCount: number,
  lastFen: string
): import('../types').ValidatedMove[] {
  // Count how many half-moves the raw data contains
  let totalHalfMoves = 0;
  for (const m of rawMoves) {
    if (m.white && m.white.trim()) totalHalfMoves++;
    if (m.black && m.black.trim()) totalHalfMoves++;
  }

  if (totalHalfMoves <= validatedCount) return [];

  // Skip the first validatedCount half-moves, then emit the rest as speculative
  const speculative: import('../types').ValidatedMove[] = [];
  let halfIndex = 0;

  for (const m of rawMoves) {
    if (m.white && m.white.trim()) {
      if (halfIndex >= validatedCount) {
        speculative.push({
          moveNumber: m.moveNumber,
          color: 'w',
          san: m.white,
          rawOcr: m.white,
          confidence: 'low',
          matchType: 'speculative',
          isValid: false,
          legalAlternatives: [],
          fenAfter: lastFen,
          fenBefore: lastFen,
        });
      }
      halfIndex++;
    }
    if (m.black && m.black.trim()) {
      if (halfIndex >= validatedCount) {
        speculative.push({
          moveNumber: m.moveNumber,
          color: 'b',
          san: m.black,
          rawOcr: m.black,
          confidence: 'low',
          matchType: 'speculative',
          isValid: false,
          legalAlternatives: [],
          fenAfter: lastFen,
          fenBefore: lastFen,
        });
      }
      halfIndex++;
    }
  }

  return speculative;
}

/**
 * Generate a CSV string comparing raw OCR text with corrected SAN for each move.
 * Useful for quality tracking and OCR improvement analysis.
 */
export function generateRawOcrCsv(
  moves: import('../types').ValidatedMove[]
): string {
  const header = 'MoveNumber,Color,RawOCR,CorrectedSAN,MatchType,Confidence';
  const rows = moves.map((m) => {
    const raw = (m.rawOcr || '').replace(/"/g, '""');
    const san = m.san.replace(/"/g, '""');
    const color = m.color === 'w' ? 'White' : 'Black';
    return `${m.moveNumber},${color},"${raw}","${san}",${m.matchType},${m.confidence}`;
  });
  return [header, ...rows].join('\n');
}

/**
 * Get smart move suggestions by checking which legal moves at the current position
 * lead to a position where the NEXT raw OCR move can be matched.
 * Returns suggested moves sorted by how well the next move matches.
 */
export function getSmartSuggestions(
  moves: import('../types').ValidatedMove[],
  currentIndex: number
): string[] {
  if (currentIndex < 0 || currentIndex >= moves.length) return [];
  const current = moves[currentIndex];

  // Find the next non-empty raw OCR text after the current move
  let nextRawOcr = '';
  for (let i = currentIndex + 1; i < moves.length; i++) {
    const raw = moves[i].rawOcr || moves[i].san;
    if (raw && raw.trim()) {
      nextRawOcr = raw.trim();
      break;
    }
  }
  if (!nextRawOcr) return [];

  // Get legal moves at the current position
  const chess = new Chess();
  try {
    chess.load(current.fenBefore);
  } catch {
    return [];
  }
  const legalMoves = chess.moves();
  if (legalMoves.length === 0) return [];

  // For each legal move, try it, then check if the next OCR text matches
  const scored: { move: string; score: number }[] = [];

  for (const candidate of legalMoves) {
    const trial = new Chess();
    trial.load(current.fenBefore);
    try {
      trial.move(candidate);
    } catch {
      continue;
    }
    const nextLegal = trial.moves();
    if (nextLegal.length === 0) continue;

    const match = matchMoveToLegal(nextRawOcr, nextLegal, false);
    if (match && match.score >= 0.5) {
      scored.push({ move: candidate, score: match.score });
    }
  }

  // Sort by how well the next move matches (higher is better)
  scored.sort((a, b) => b.score - a.score);
  return scored.map((s) => s.move);
}

