import { Chess } from 'chess.js';

/**
 * Normalize OCR text into plausible SAN candidates.
 * Handles common handwriting/OCR confusions.
 */
function generateSanCandidates(raw: string): string[] {
  if (!raw || raw.trim() === '') return [];

  let text = raw.trim();

  // Normalize castling variants
  text = text.replace(/0-0-0/g, 'O-O-O').replace(/0-0/g, 'O-O');

  const candidates = new Set<string>();
  candidates.add(text);

  // Common OCR substitutions
  const subs: [RegExp, string][] = [
    [/l/g, '1'], [/1/g, 'l'],
    [/O/g, '0'], [/0/g, 'O'],
    [/I/g, '1'], [/S/g, '5'],
    [/B/g, '8'], [/g/g, '9'],
    [/q/g, 'g'], [/G/g, '6'],
    [/Z/g, '2'], [/z/g, '2'],
    [/b/g, '6'], // 'b' confused with 6
  ];

  // Generate single-substitution variants
  for (const [pattern, replacement] of subs) {
    if (pattern.test(text)) {
      candidates.add(text.replace(pattern, replacement));
    }
  }

  // Try adding/removing common chess notation symbols
  const stripped = text.replace(/[+#!?]/g, '');
  candidates.add(stripped);
  candidates.add(stripped + '+');
  candidates.add(stripped + '#');

  // Try adding 'x' for captures (common to omit)
  if (stripped.length >= 3 && !stripped.includes('x')) {
    // Try inserting 'x' at various positions
    for (let i = 1; i < stripped.length; i++) {
      candidates.add(stripped.slice(0, i) + 'x' + stripped.slice(i));
    }
  }

  // Try removing 'x' if present
  if (text.includes('x')) {
    candidates.add(text.replace('x', ''));
  }

  // Handle pawn promotions: e.g., "e8Q" or "e8=Q"
  const promoMatch = stripped.match(/^([a-h][18])([QRBN])$/);
  if (promoMatch) {
    candidates.add(`${promoMatch[1]}=${promoMatch[2]}`);
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
  legalMoves: string[]
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
      const match = matchMoveToLegal(move.white, legalMoves);

      if (match) {
        try {
          chess.move(match.bestMove);
          validated.push({
            moveNumber: move.moveNumber,
            color: 'w',
            san: match.bestMove,
            rawOcr: move.white,
            confidence: match.confidence,
            isValid: true,
            legalAlternatives: legalMoves,
            fenAfter: chess.fen(),
            fenBefore,
          });
        } catch {
          validated.push({
            moveNumber: move.moveNumber,
            color: 'w',
            san: move.white,
            rawOcr: move.white,
            confidence: 'low',
            isValid: false,
            legalAlternatives: legalMoves,
            fenAfter: fenBefore,
            fenBefore,
          });
          break; // Can't continue if move is invalid
        }
      } else {
        validated.push({
          moveNumber: move.moveNumber,
          color: 'w',
          san: move.white,
          rawOcr: move.white,
          confidence: 'low',
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
      const match = matchMoveToLegal(move.black, legalMoves);

      if (match) {
        try {
          chess.move(match.bestMove);
          validated.push({
            moveNumber: move.moveNumber,
            color: 'b',
            san: match.bestMove,
            rawOcr: move.black,
            confidence: match.confidence,
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
 * Replays the game from the start, applying the corrected move at the given index.
 */
export function revalidateFromIndex(
  currentMoves: import('../types').ValidatedMove[],
  correctionIndex: number,
  newSan: string
): import('../types').ValidatedMove[] {
  // Rebuild move list as raw pairs
  const rawMoves: { moveNumber: number; white: string; black: string }[] = [];
  let currentPair: { moveNumber: number; white: string; black: string } | null = null;

  for (let i = 0; i < currentMoves.length; i++) {
    const m = currentMoves[i];
    const san = i === correctionIndex ? newSan : m.san;

    if (m.color === 'w') {
      if (currentPair) rawMoves.push(currentPair);
      currentPair = { moveNumber: m.moveNumber, white: san, black: '' };
    } else {
      if (!currentPair) {
        currentPair = { moveNumber: m.moveNumber, white: '', black: san };
      } else {
        currentPair.black = san;
      }
    }
  }
  if (currentPair) rawMoves.push(currentPair);

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
  }

  moveText += header.result;

  return `${tags}\n\n${moveText.trim()}`;
}

