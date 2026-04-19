import { Chessboard } from 'react-chessboard';
import { Chess } from 'chess.js';
import { useState, useMemo, useCallback } from 'react';

interface BoardViewerProps {
  fen: string;
  orientation?: 'white' | 'black';
  interactive?: boolean;
  legalMoves?: string[];
  onMoveMade?: (san: string) => void;
}

export default function BoardViewer({
  fen,
  orientation = 'white',
  interactive = false,
  legalMoves = [],
  onMoveMade,
}: BoardViewerProps) {
  const [selectedSquare, setSelectedSquare] = useState<string | null>(null);

  // Build a map: fromSquare → [{toSquare, san, promotion?}]
  const moveMap = useMemo(() => {
    if (!interactive) return new Map<string, { to: string; san: string; promotion?: string }[]>();
    const chess = new Chess(fen);
    const map = new Map<string, { to: string; san: string; promotion?: string }[]>();
    for (const san of legalMoves) {
      try {
        const moveObj = chess.move(san);
        const entry = { to: moveObj.to, san, promotion: moveObj.promotion || undefined };
        const list = map.get(moveObj.from) || [];
        list.push(entry);
        map.set(moveObj.from, list);
        chess.undo();
      } catch {
        // skip invalid
      }
    }
    return map;
  }, [fen, legalMoves, interactive]);

  // Highlight squares for selected piece's legal destinations
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (selectedSquare && moveMap.has(selectedSquare)) {
      styles[selectedSquare] = { backgroundColor: 'rgba(255, 255, 0, 0.4)' };
      for (const m of moveMap.get(selectedSquare)!) {
        styles[m.to] = { backgroundColor: 'rgba(0, 180, 0, 0.3)', borderRadius: '50%' };
      }
    }
    return styles;
  }, [selectedSquare, moveMap]);

  const handleSquareClick = useCallback(({ square }: { piece: unknown; square: string }) => {
    if (!interactive || !onMoveMade) return;

    // If clicking a destination square of the selected piece, make the move
    if (selectedSquare && moveMap.has(selectedSquare)) {
      const targets = moveMap.get(selectedSquare)!;
      const match = targets.find(m => m.to === square);
      if (match) {
        onMoveMade(match.san);
        setSelectedSquare(null);
        return;
      }
    }

    // Select this square if it has moves
    if (moveMap.has(square)) {
      setSelectedSquare(prev => prev === square ? null : square);
    } else {
      setSelectedSquare(null);
    }
  }, [interactive, onMoveMade, selectedSquare, moveMap]);

  const handlePieceDrop = useCallback(({ sourceSquare, targetSquare }: {
    piece: unknown; sourceSquare: string; targetSquare: string | null;
  }): boolean => {
    if (!interactive || !onMoveMade || !targetSquare) return false;

    const targets = moveMap.get(sourceSquare);
    if (!targets) return false;

    const match = targets.find(m => m.to === targetSquare);
    if (match) {
      onMoveMade(match.san);
      setSelectedSquare(null);
      return true;
    }
    return false;
  }, [interactive, onMoveMade, moveMap]);

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
      <Chessboard
        options={{
          position: fen,
          boardOrientation: orientation,
          allowDragging: interactive,
          squareStyles,
          onSquareClick: interactive ? handleSquareClick : undefined,
          onPieceDrop: interactive ? handlePieceDrop : undefined,
          boardStyle: {
            borderRadius: '4px',
            boxShadow: '0 1px 3px rgba(0,0,0,0.12)',
          },
          darkSquareStyle: { backgroundColor: '#779952' },
          lightSquareStyle: { backgroundColor: '#edeed1' },
        }}
      />
    </div>
  );
}
