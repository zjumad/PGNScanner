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
}

/** Immutable OCR pairs from the vision API */
export interface RawOcrMovePair {
  moveNumber: number;
  white: string;
  black: string;
  /** Bounding box covering this row (normalized 0-1), used for image crops */
  rowBBox?: CellBoundingBox;
}

export interface GameState {
  header: GameHeader;
  moves: ValidatedMove[];
  rawOcrMoves: RawOcrMovePair[];
  /** User corrections keyed by move index → corrected SAN */
  corrections: Record<number, string>;
  selectedMoveIndex: number;
  /** Per-page image URLs (for Debug tab page carousel) */
  imageUrls: string[];
  /** The single image URL sent to OCR (merged if multi-page). Grid/bbox coords are relative to this. */
  ocrImageUrl: string;
}

export type AppStep = 'upload' | 'perspective' | 'processing' | 'review' | 'export';
