import { useState, useMemo } from 'react';

interface LegalMovesPanelProps {
  legalMoves: string[];
  currentSan: string;
  moveLabel: string;
  sideToMove: 'w' | 'b';
  onSelectMove: (san: string) => void;
}

/** Map SAN prefix to piece type */
function getPieceType(san: string): string {
  if (san.startsWith('O-O')) return 'K'; // castling is a king move
  const first = san[0];
  if ('KQRBN'.includes(first)) return first;
  return 'P'; // pawn
}

/** Unicode piece symbols */
const PIECE_SYMBOLS: Record<string, { w: string; b: string; label: string }> = {
  K: { w: '\u2654', b: '\u265A', label: 'King' },
  Q: { w: '\u2655', b: '\u265B', label: 'Queen' },
  R: { w: '\u2656', b: '\u265C', label: 'Rook' },
  B: { w: '\u2657', b: '\u265D', label: 'Bishop' },
  N: { w: '\u2658', b: '\u265E', label: 'Knight' },
  P: { w: '\u2659', b: '\u265F', label: 'Pawn' },
};

/** Piece display order */
const PIECE_ORDER = ['K', 'Q', 'R', 'B', 'N', 'P'];

export default function LegalMovesPanel({
  legalMoves,
  currentSan,
  moveLabel,
  sideToMove,
  onSelectMove,
}: LegalMovesPanelProps) {
  const [pieceFilter, setPieceFilter] = useState<string | null>(null);

  // Group moves by piece type
  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    for (const move of legalMoves) {
      const piece = getPieceType(move);
      if (!groups[piece]) groups[piece] = [];
      groups[piece].push(move);
    }
    return groups;
  }, [legalMoves]);

  // Available pieces (in order)
  const availablePieces = useMemo(
    () => PIECE_ORDER.filter((p) => grouped[p]?.length),
    [grouped]
  );

  // Sorted and filtered moves
  const displayMoves = useMemo(() => {
    if (pieceFilter) return grouped[pieceFilter] || [];
    // Sort all moves grouped by piece order
    const sorted: string[] = [];
    for (const piece of PIECE_ORDER) {
      if (grouped[piece]) sorted.push(...grouped[piece]);
    }
    return sorted;
  }, [grouped, pieceFilter]);

  return (
    <div className="w-full bg-white rounded-lg border border-gray-200 shadow-sm p-3">
      <h3 className="text-sm font-semibold text-gray-600 mb-2">
        Legal Moves at {moveLabel}
        <span className="text-xs font-normal text-gray-400 ml-2">
          ({legalMoves.length} moves)
        </span>
      </h3>

      {/* Piece filter icons */}
      <div className="flex gap-1 mb-2">
        <button
          className={`px-2 py-1 text-xs rounded border transition-colors ${
            pieceFilter === null
              ? 'bg-blue-100 border-blue-400 text-blue-800 font-bold'
              : 'bg-gray-50 border-gray-200 text-gray-600 hover:bg-gray-100'
          }`}
          onClick={() => setPieceFilter(null)}
          title="Show all moves"
        >
          All
        </button>
        {availablePieces.map((piece) => {
          const sym = PIECE_SYMBOLS[piece];
          const icon = sideToMove === 'w' ? sym.w : sym.b;
          const count = grouped[piece]?.length || 0;
          return (
            <button
              key={piece}
              className={`px-2 py-1 text-base rounded border transition-colors flex items-center gap-1 ${
                pieceFilter === piece
                  ? 'bg-blue-100 border-blue-400 text-blue-800 font-bold'
                  : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-gray-100'
              }`}
              onClick={() => setPieceFilter(pieceFilter === piece ? null : piece)}
              title={`${sym.label} moves (${count})`}
            >
              <span>{icon}</span>
              <span className="text-[10px] text-gray-400">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Move buttons */}
      <div className="flex flex-wrap gap-1 max-h-32 overflow-y-auto">
        {displayMoves.map((move) => (
          <button
            key={move}
            className={`px-2 py-0.5 text-xs font-mono rounded border transition-colors ${
              move === currentSan
                ? 'bg-blue-100 border-blue-400 text-blue-800 font-bold'
                : 'bg-gray-50 border-gray-200 text-gray-700 hover:bg-blue-50 hover:border-blue-300'
            }`}
            onClick={() => onSelectMove(move)}
            title={move === currentSan ? 'Current move' : `Change to ${move}`}
          >
            {move}
          </button>
        ))}
        {displayMoves.length === 0 && (
          <span className="text-xs text-gray-400">No moves for this piece</span>
        )}
      </div>
    </div>
  );
}
