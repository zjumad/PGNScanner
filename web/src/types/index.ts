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

export interface ValidatedMove {
  moveNumber: number;
  color: 'w' | 'b';
  san: string;
  rawOcr?: string;
  confidence: 'high' | 'medium' | 'low';
  isValid: boolean;
  legalAlternatives: string[];
  fenAfter: string;
  fenBefore: string;
}

export interface GameState {
  header: GameHeader;
  moves: ValidatedMove[];
  selectedMoveIndex: number;
}

export type AppStep = 'upload' | 'processing' | 'review';
