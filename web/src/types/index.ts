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

export interface CellBoundingBox {
  /** Fraction of image width (0-1) for left edge */
  x: number;
  /** Fraction of image height (0-1) for top edge */
  y: number;
  /** Fraction of image width (0-1) */
  width: number;
  /** Fraction of image height (0-1) */
  height: number;
}

export interface RecognizedMove {
  moveNumber: number;
  whiteMove: string;
  blackMove: string;
  whiteConfidence: 'high' | 'medium' | 'low';
  blackConfidence: 'high' | 'medium' | 'low';
  whiteRawOcr?: string;
  blackRawOcr?: string;
  /** Bounding box covering both white and black cells for this move row (normalized 0-1) */
  rowBBox?: CellBoundingBox;
  /** Clockwise rotation needed to orient this portion upright (0, 90, 180, 270) */
  rotation?: 0 | 90 | 180 | 270;
}

export type MatchType = 'exact' | 'fuzzy' | 'forced' | 'corrected' | 'speculative';

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
  /** Bounding box of this move's cell in the source image (normalized 0-1) */
  bbox?: CellBoundingBox;
  /** Clockwise rotation needed to orient the cell's image portion upright */
  rotation?: 0 | 90 | 180 | 270;
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
  imageUrls: string[];
}

export type AppStep = 'upload' | 'processing' | 'review' | 'export';
