export interface GameHeader {
  event: string;
  date: string;
  round: string;
  white: string;
  black: string;
  whiteElo: string;
  blackElo: string;
  opening: string;
  eco: string;
  result: string;
}

export interface RecognizedMove {
  moveNumber: number;
  whiteMove: string;
  blackMove: string;
  whiteConfidence: 'high' | 'medium' | 'low';
  blackConfidence: 'high' | 'medium' | 'low';
  whiteRawOcr?: string;
  blackRawOcr?: string;
}

export type MatchType = 'exact' | 'fuzzy' | 'forced' | 'corrected';

export interface ValidatedMove {
  moveNumber: number;
  color: 'w' | 'b';
  san: string;
  rawOcr?: string;
  confidence: 'high' | 'medium' | 'low';
  matchType: MatchType;
  isValid: boolean;
  legalAlternatives: string[];
  fenAfter: string;
  fenBefore: string;
}

/** Immutable OCR pairs from the vision API */
export interface RawOcrMovePair {
  moveNumber: number;
  white: string;
  black: string;
}

export interface GameState {
  header: GameHeader;
  moves: ValidatedMove[];
  rawOcrMoves: RawOcrMovePair[];
  /** User corrections keyed by move index → corrected SAN */
  corrections: Record<number, string>;
  selectedMoveIndex: number;
  imageUrl: string | null;
}

export type AppStep = 'upload' | 'processing' | 'review';
