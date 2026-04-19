/**
 * Test the chess engine's fuzzy matching against known-correct PGN games.
 * Simulates OCR misreadings based on common handwriting patterns observed
 * in the sample score sheets, and checks if the engine recovers correctly.
 *
 * Run: npx tsx web/tests/test-matching.ts
 */
import { Chess } from 'chess.js';

// --- Engine functions (copied for standalone testing) ---

function generateSanCandidates(raw: string): string[] {
  if (!raw || raw.trim() === '') return [];
  let text = raw.trim();
  text = text
    .replace(/^[oO0]-?[oO0]-?[oO0]$/g, 'O-O-O')
    .replace(/^[oO0]-?[oO0]$/g, 'O-O');
  const candidates = new Set<string>();
  candidates.add(text);
  const pieceConfusions: Record<string, string[]> = {
    'R': ['K'], 'K': ['R'], 'N': ['H', 'M'], 'B': ['D'],
    'Q': ['O', 'G'], 'O': ['Q'], 'D': ['B'], 'H': ['N'], 'M': ['N'], 'G': ['Q'],
  };
  const fileConfusions: Record<string, string[]> = {
    'e': ['c'], 'c': ['e'], 'd': ['a', 'cl'], 'a': ['d'],
    'b': ['d', 'h'], 'h': ['b'], 'f': ['t'], 'g': ['q', 'y'], 'q': ['g'], 'y': ['g'],
  };
  const digitConfusions: Record<string, string[]> = {
    '1': ['l', '7'], '7': ['1'], '5': ['3', 'S'], '3': ['5'],
    '8': ['B', '6'], 'B': ['8'], '6': ['G', 'b', '8'], '2': ['Z', 'z'],
    '4': ['9'], '9': ['4', 'g'], '0': ['O'],
  };
  const globalSubs: [RegExp, string][] = [
    [/l/g, '1'], [/I/g, '1'], [/O/g, '0'], [/0/g, 'O'], [/S/g, '5'], [/Z/g, '2'], [/z/g, '2'],
  ];
  for (const [pattern, replacement] of globalSubs) {
    if (pattern.test(text)) candidates.add(text.replace(pattern, replacement));
  }
  if (text.length >= 2 && /^[A-Z]/.test(text)) {
    const piece = text[0], rest = text.slice(1);
    const alts = pieceConfusions[piece];
    if (alts) for (const alt of alts) candidates.add(alt + rest);
  }
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const subs = [...(fileConfusions[ch] || []), ...(digitConfusions[ch] || [])];
    for (const sub of subs) candidates.add(text.slice(0, i) + sub + text.slice(i + 1));
  }
  const stripped = text.replace(/[+#!?]/g, '');
  candidates.add(stripped);
  candidates.add(stripped + '+');
  candidates.add(stripped + '#');
  if (stripped.length >= 3 && !stripped.includes('x')) {
    for (let i = 1; i < stripped.length; i++) {
      candidates.add(stripped.slice(0, i) + 'x' + stripped.slice(i));
    }
  }
  if (text.includes('x')) candidates.add(text.replace('x', ''));
  const promoMatch = stripped.match(/^([a-h][18])[=()]?([QRBNOGD])[)]?$/);
  if (promoMatch) {
    const sq = promoMatch[1];
    const pieceLetter = promoMatch[2];
    const promoPieces = [pieceLetter, ...(pieceConfusions[pieceLetter] || [])];
    for (const p of promoPieces) {
      if ('QRBN'.includes(p)) {
        candidates.add(`${sq}=${p}`);
        candidates.add(`${sq}${p}`);
      }
    }
  }
  const disambigMatch = stripped.match(/^([KQRBN])([a-h1-8])(x?)([a-h][1-8])$/);
  if (disambigMatch) {
    const [, piece, disambig, capture, dest] = disambigMatch;
    candidates.add(`${piece}${capture}${dest}`);
    const disambigSubs = [...(fileConfusions[disambig] || []), ...(digitConfusions[disambig] || [])];
    for (const sub of disambigSubs) {
      candidates.add(`${piece}${sub}${capture}${dest}`);
    }
  }
  if (text.length >= 3 && /^[A-Z]/.test(text)) {
    const piece = text[0], rest = text.slice(1);
    const pieceAlts = pieceConfusions[piece] || [];
    for (const altPiece of pieceAlts) {
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

function similarity(a: string, b: string): number {
  if (a === b) return 1;
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (longer.length === 0) return 1;
  const costs: number[] = [];
  for (let i = 0; i <= longer.length; i++) {
    let lastValue = i;
    for (let j = 0; j <= shorter.length; j++) {
      if (i === 0) { costs[j] = j; }
      else if (j > 0) {
        let newValue = costs[j - 1];
        if (longer[i - 1] !== shorter[j - 1]) newValue = Math.min(Math.min(newValue, lastValue), costs[j]) + 1;
        costs[j - 1] = lastValue;
        lastValue = newValue;
      }
    }
    if (i > 0) costs[shorter.length] = lastValue;
  }
  return (longer.length - costs[shorter.length]) / longer.length;
}

function matchMoveToLegal(rawText: string, legalMoves: string[], forceMatch = false) {
  if (!rawText || rawText.trim() === '' || legalMoves.length === 0) return null;
  const candidates = generateSanCandidates(rawText);
  let bestMove = '', bestScore = 0;
  for (const candidate of candidates) {
    for (const legal of legalMoves) {
      if (candidate === legal) return { bestMove: legal, confidence: 'high' as const, score: 1.0 };
      if (candidate.toLowerCase() === legal.toLowerCase()) return { bestMove: legal, confidence: 'high' as const, score: 0.95 };
      const score = similarity(candidate, legal);
      if (score > bestScore) { bestScore = score; bestMove = legal; }
    }
  }
  if (bestScore >= 0.8) return { bestMove, confidence: 'medium' as const, score: bestScore };
  if (bestScore >= 0.5) return { bestMove, confidence: 'low' as const, score: bestScore };
  if (forceMatch && bestMove) return { bestMove, confidence: 'low' as const, score: bestScore };
  return null;
}

// --- Simulated OCR errors based on handwriting analysis ---
// For each correct SAN, list plausible OCR misreadings from the score sheet images
// These are realistic errors that Gemini/GPT-4o might produce from messy handwriting

type OcrVariants = Record<string, string[]>;

const game1Variants: OcrVariants = {
  // Pawn moves - generally readable
  'c4': ['c4', 'e4'],
  'e5': ['e5', 'c5', 'e3'],
  'g3': ['g3', 'q3', 'g5'],
  'd6': ['d6', 'a6', 'd8'],
  'e3': ['e3', 'c3', 'e5'],
  'd4': ['d4', 'a4', 'd9'],
  'a3': ['a3', 'd3', 'a5'],
  'c5': ['c5', 'e5'],
  'b3': ['b3', 'h3', 'd3'],
  'h3': ['h3', 'b3'],
  'h4': ['h4', 'b4'],
  'g5': ['g5', 'q5', 'g3'],
  'f4': ['f4', 'f9'],
  'a5': ['a5', 'd5', 'a3'],
  'f5': ['f5', 'f3'],
  'h5': ['h5', 'b5'],
  'b5': ['b5', 'h5'],
  'f7': ['f7', 'f1'],
  'b4': ['b4', 'h4'],
  // Captures without piece prefix
  'exd4': ['exd4', 'cxd4', 'exd9'],
  'hxg5': ['hxg5', 'bxg5', 'hxq5'],
  'axb4': ['axb4', 'axh4', 'dxb4'],
  'cxb4': ['cxb4', 'exb4'],
  'gxh4': ['gxh4', 'qxh4', 'gxb4'],
  // Knight moves - N often confused with M, H
  'Nc3': ['Nc3', 'Mc3', 'Hc3', 'Ne3'],
  'Nf6': ['Nf6', 'Mf6', 'Nf8'],
  'Nc6': ['Nc6', 'Mc6', 'Ne6'],
  'Nb4': ['Nb4', 'Mb4', 'Nh4'],
  'Nge2': ['Nge2', 'Nye2', 'Mqe2', 'Nqe2'],
  'Nf4': ['Nf4', 'Mf4'],
  'Nxd4': ['Nxd4', 'Mxd4'],
  'Ng4': ['Ng4', 'Mg4', 'Nq4'],
  'Ne5': ['Ne5', 'Me5', 'Nc5'],
  'Nxc4': ['Nxc4', 'Mxc4', 'Nxe4'],
  'Ncd5': ['Ncd5', 'Mcd5', 'Ned5', 'Ncd3'],
  'Ne2': ['Ne2', 'Me2'],
  'Nd3': ['Nd3', 'Md3', 'Nd5'],
  'Ne1': ['Ne1', 'Me1', 'Nel'],
  'Nec3': ['Nec3', 'Mec3', 'Nee3'],
  'Nxe4': ['Nxe4', 'Mxe4'],
  'Nf3': ['Nf3', 'Mf3', 'Nf5'],
  'Nh2+': ['Nh2+', 'Mh2+', 'Nb2+'],
  'Nxf3': ['Nxf3', 'Mxf3'],
  'Ng5': ['Ng5', 'Mg5', 'Nq5'],
  'Ne3': ['Ne3', 'Me3'],
  'Nxf7': ['Nxf7', 'Mxf7'],
  'Nxd6+': ['Nxd6+', 'Mxd6+', 'Nxd6'],
  'Ndc4': ['Ndc4', 'Mdc4', 'Nde4', 'Nac4'],
  'Nxa5': ['Nxa5', 'Mxa5'],
  'Nd5+': ['Nd5+', 'Md5+', 'Nd3+'],
  // Bishop moves
  'Bg2': ['Bg2', 'Bq2', 'By2', 'Dg2'],
  'Bf5': ['Bf5', 'Bf3', 'Bfs'],
  'Bd3': ['Bd3', 'Ba3', 'Bd5'],
  'Bc2': ['Bc2', 'Be2'],
  'Bxe3': ['Bxe3', 'Bxc3'],
  'Bd2': ['Bd2', 'Ba2'],
  'Bg2': ['Bg2', 'Bq2'],
  'Bc1': ['Bc1', 'Bcl', 'Be1'],
  'Be7': ['Be7', 'Bc7', 'Be1'],
  'Bg5': ['Bg5', 'Bq5', 'Bg3'],
  'Bxc1': ['Bxc1', 'Bxcl'],
  'Bh1': ['Bh1', 'Bhl', 'Bb1'],
  'Be4': ['Be4', 'Bc4', 'Be9'],
  'Bf1': ['Bf1', 'Bfl'],
  // Rook moves
  'Re1': ['Re1', 'Rel', 'Ke1', 'Re7'],
  'Re8': ['Re8', 'ReB', 'Ke8'],
  'Rxe8+': ['Rxe8+', 'RxeB+', 'Rxe8'],
  'Rxc1': ['Rxc1', 'Kxc1', 'Rxcl'],
  'Rc2': ['Rc2', 'Ke2', 'Re2'],
  'Rd2': ['Rd2', 'Kd2', 'Ra2'],
  'Re5': ['Re5', 'Ke5'],
  'Rh5': ['Rh5', 'Kh5', 'Rb5'],
  'Rxg5': ['Rxg5', 'Kxg5'],
  'Rxe4': ['Rxe4', 'Kxe4'],
  'Rd3': ['Rd3', 'Kd3', 'Ra3'],
  'Re3': ['Re3', 'Ke3'],
  'Rf3': ['Rf3', 'Kf3'],
  // Queen moves
  'Qe7+': ['Qe7+', 'Qe7', 'Oe7+'],
  'Qd2': ['Qd2', 'Od2', 'Qd7'],
  'Qd7': ['Qd7', 'Od7'],
  'Qxc2': ['Qxc2', 'Oxc2'],
  'Qd1': ['Qd1', 'Odl', 'Qdl'],
  'Qxe8': ['Qxe8', 'OxeB'],
  'Qxd4': ['Qxd4', 'Oxd4'],
  'Qe1+': ['Qe1+', 'Oel+', 'Qel+'],
  'Qe5': ['Qe5', 'Oe5'],
  'Qe3': ['Qe3', 'Oe3'],
  'Qxe3': ['Qxe3', 'Oxe3'],
  'Qc8': ['Qc8', 'OcB', 'QcB'],
  'Qc7': ['Qc7', 'Oc7'],
  'Qb6#': ['Qb6#', 'Ob6#', 'Qb6'],
  // King moves
  'Kf1': ['Kf1', 'Kfl', 'Rf1'],
  'Ke2': ['Ke2', 'Re2'],
  'Kxf3': ['Kxf3', 'Rxf3'],
  'Kd7': ['Kd7', 'Rd7'],
  'Kc6': ['Kc6', 'Rc6'],
  'Kb5': ['Kb5', 'Kh5', 'Rb5'],
  'Ke4': ['Ke4', 'Re4'],
  'Kc5': ['Kc5', 'Re5'],
  'Kxa5': ['Kxa5', 'Rxa5'],
  'Ka6': ['Ka6', 'Ra6'],
  // Castling
  'O-O': ['O-O', '0-0', 'o-o'],
  'O-O-O': ['O-O-O', '0-0-0', 'o-o-o'],
  // Promotion
  'f8=Q': ['f8=Q', 'f8Q', 'fB=Q', 'f8=O', 'tB=Q'],
};

const game2Variants: OcrVariants = {
  'c4': ['c4', 'e4'],
  'e6': ['e6', 'c6', 'e8'],
  'd4': ['d4', 'a4'],
  'Bb4+': ['Bb4+', 'Bb4', 'Bh4+', 'Db4+'],
  'Bd2': ['Bd2', 'Ba2', 'Dd2'],
  'Qe7': ['Qe7', 'Oe7', 'Qc7'],
  'g3': ['g3', 'q3'],
  'Bxd2+': ['Bxd2+', 'Bxd2', 'Bxa2+'],
  'Qxd2': ['Qxd2', 'Oxd2'],
  'Nf6': ['Nf6', 'Mf6', 'Nf8'],
  'Nc3': ['Nc3', 'Mc3', 'Hc3'],
  'b6': ['b6', 'h6', 'd6'],
  'e3': ['e3', 'c3'],
  'O-O': ['O-O', '0-0', 'o-o'],
  'Be2': ['Be2', 'Bc2', 'De2'],
  'Bb7': ['Bb7', 'Bh7', 'Db7', 'Bb1'],
  'Nf3': ['Nf3', 'Mf3', 'Nf5'],
  'd5': ['d5', 'a5', 'd3'],
  'cxd5': ['cxd5', 'exd5', 'cxd3'],
  'exd5': ['exd5', 'cxd5'],
  'Ne4': ['Ne4', 'Me4', 'Ne9'],
  'Nxe4': ['Nxe4', 'Mxe4'],
  'dxe4': ['dxe4', 'axe4'],
  'Ne1': ['Ne1', 'Me1', 'Nel'],
  'Qg5': ['Qg5', 'Oq5', 'Og5'],
  'Rc1': ['Rc1', 'Rcl', 'Kc1'],
  'c6': ['c6', 'e6'],
  'Qc2': ['Qc2', 'Oc2', 'Qe2'],
  'Re8': ['Re8', 'Ke8', 'ReB'],
  'h3': ['h3', 'b3'],
  'Bc8': ['Bc8', 'BcB', 'Be8'],
  'Kh1': ['Kh1', 'Khl', 'Rh1', 'Kb1'],
  'Re6': ['Re6', 'Ke6', 'Re8'],
  'Bg4': ['Bg4', 'Bq4', 'Bg9'],
  'f5': ['f5', 'f3'],
  'Be2': ['Be2', 'Bc2'],
  'Rh6': ['Rh6', 'Kh6', 'Rb6'],
  'Qc4+': ['Qc4+', 'Qc4', 'Oe4+', 'Qe4+'],
};

function parsePgnMoves(moveText: string): { moveNumber: number; white: string; black: string }[] {
  const moves: { moveNumber: number; white: string; black: string }[] = [];
  const cleaned = moveText.replace(/\s+(1-0|0-1|1\/2-1\/2|\*)$/, '').trim();
  const tokens = cleaned.split(/\s+/);
  let currentMove: { moveNumber: number; white: string; black: string } | null = null;
  for (const token of tokens) {
    const numMatch = token.match(/^(\d+)\./);
    if (numMatch) {
      if (currentMove) moves.push(currentMove);
      const moveNum = parseInt(numMatch[1]);
      const san = token.replace(/^\d+\./, '');
      currentMove = { moveNumber: moveNum, white: san || '', black: '' };
    } else if (currentMove) {
      if (!currentMove.white) currentMove.white = token;
      else currentMove.black = token;
    }
  }
  if (currentMove) moves.push(currentMove);
  return moves;
}

function testGame(name: string, moveText: string, variants: OcrVariants) {
  console.log(`\n${'='.repeat(70)}`);
  console.log(`Testing: ${name}`);
  console.log('='.repeat(70));

  const moves = parsePgnMoves(moveText);
  const chess = new Chess();
  let totalMoves = 0;
  let totalVariants = 0;
  let variantFailures = 0;
  const failureDetails: string[] = [];

  for (const move of moves) {
    for (const side of ['white', 'black'] as const) {
      const san = move[side];
      if (!san) continue;
      totalMoves++;

      const legalMoves = chess.moves();
      if (legalMoves.length === 0) break;

      const ocrVariants = variants[san] || [san];

      for (const ocrText of ocrVariants) {
        totalVariants++;
        const result = matchMoveToLegal(ocrText, legalMoves, true);
        if (!result || result.bestMove !== san) {
          variantFailures++;
          const detail = `  ${move.moveNumber}${side === 'white' ? '.' : '...'} "${ocrText}" → ${
            result ? `"${result.bestMove}" (${result.score.toFixed(2)})` : 'NO MATCH'
          } (expected "${san}")`;
          failureDetails.push(detail);
        }
      }

      try { chess.move(san); } catch { break; }
    }
  }

  if (failureDetails.length > 0) {
    console.log(`\n❌ Failed OCR variant matches:`);
    for (const d of failureDetails) console.log(d);
  }

  console.log(`\n✅ ${totalMoves} moves, ${totalVariants} OCR variants tested`);
  console.log(`   ${totalVariants - variantFailures}/${totalVariants} variants matched correctly (${variantFailures} failures)`);
  const rate = ((totalVariants - variantFailures) / totalVariants * 100).toFixed(1);
  console.log(`   Match rate: ${rate}%`);
}

testGame(
  'Game 1: Louis Liu vs Sebastian Lam (61 moves)',
  '1. c4 e5 2. Nc3 Nf6 3. g3 Nc6 4. Bg2 d6 5. e3 Nb4 6. d4 exd4 7. exd4 Qe7+ 8. Nge2 Bf5 9. O-O Bd3 10. Re1 O-O-O 11. Nf4 Bc2 12. Qd2 Qd7 13. a3 Nc6 14. Qxc2 Nxd4 15. Qd1 Re8 16. Rxe8+ Qxe8 17. Qxd4 Qe1+ 18. Bf1 c5 19. Qd2 Qe5 20. Qe3 Qxe3 21. Bxe3 Ng4 22. Bd2 Ne5 23. Bg2 Nxc4 24. Bc1 Be7 25. b3 Ne5 26. Ncd5 Bg5 27. h3 Re8 28. Ne2 Bxc1 29. Rxc1 Nd3 30. Rc2 Ne1 31. Rd2 Re5 32. Bh1 Rh5 33. h4 g5 34. hxg5 Rxg5 35. Kf1 Rh5 36. Be4 Re5 37. Nec3 Rxe4 38. Nxe4 Nf3 39. Rd3 Ne5 40. Re3 Ng4 41. Rf3 Nh2+ 42. Ke2 Nxf3 43. Kxf3 Kd7 44. Ng5 Kc6 45. Ne3 b5 46. Nxf7 b4 47. axb4 cxb4 48. Ke4 Kb5 49. f4 a5 50. Nxd6+ Kc5 51. Ndc4 Kb5 52. Nxa5 Kxa5 53. f5 h5 54. f6 h4 55. gxh4 Kb5 56. f7 Kc6 57. f8=Q Kb5 58. Qc8 Kb6 59. Nd5+ Kb5 60. Qc7 Ka6 61. Qb6# 1-0',
  game1Variants
);

testGame(
  'Game 2: Louis Liu vs Divyansh Mr Yadav (20 moves)',
  '1. c4 e6 2. d4 Bb4+ 3. Bd2 Qe7 4. g3 Bxd2+ 5. Qxd2 Nf6 6. Nc3 b6 7. e3 O-O 8. Be2 Bb7 9. Nf3 d5 10. cxd5 exd5 11. O-O Ne4 12. Nxe4 dxe4 13. Ne1 Qg5 14. Rc1 c6 15. Qc2 Re8 16. h3 Bc8 17. Kh1 Re6 18. Bg4 f5 19. Be2 Rh6 20. Qc4+ 1/2-1/2',
  game2Variants
);
