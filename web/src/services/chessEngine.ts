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
  moves: { moveNumber: number; white: string; black: string }[]
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
  const rawMoves: { moveNumber: number; white: string; black: string }[] = [];
  let currentPair: { moveNumber: number; white: string; black: string } | null = null;

  for (let i = 0; i < currentMoves.length; i++) {
    const m = currentMoves[i];
    // Use the corrected SAN at the correction index, rawOcr everywhere else
    const text = i === correctionIndex ? newSan : (m.rawOcr || m.san);

    if (m.color === 'w') {
      if (currentPair) rawMoves.push(currentPair);
      currentPair = { moveNumber: m.moveNumber, white: text, black: '' };
    } else {
      if (!currentPair) {
        currentPair = { moveNumber: m.moveNumber, white: '', black: text };
      } else {
        currentPair.black = text;
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
    if (!move.isValid) break;
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

