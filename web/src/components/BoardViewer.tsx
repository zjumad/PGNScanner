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
  const [draggingFrom, setDraggingFrom] = useState<string | null>(null);

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

  // Highlight squares for selected or dragging piece's legal destinations
  const activeSquare = draggingFrom || selectedSquare;
  const squareStyles = useMemo(() => {
    const styles: Record<string, React.CSSProperties> = {};
    if (activeSquare && moveMap.has(activeSquare)) {
      styles[activeSquare] = { backgroundColor: 'rgba(255, 255, 0, 0.4)' };
      for (const m of moveMap.get(activeSquare)!) {
        styles[m.to] = {
          background: 'radial-gradient(circle, rgba(0, 180, 0, 0.4) 25%, transparent 25%)',
          borderRadius: '0',
        };
      }
    }
    return styles;
  }, [activeSquare, moveMap]);

  const handleSquareClick = useCallback(({ square }: { piece: unknown; square: string }) => {
    if (!interactive || !onMoveMade) return;

    if (selectedSquare && moveMap.has(selectedSquare)) {
      const targets = moveMap.get(selectedSquare)!;
      const match = targets.find(m => m.to === square);
      if (match) {
        onMoveMade(match.san);
        setSelectedSquare(null);
        return;
      }
    }

    if (moveMap.has(square)) {
      setSelectedSquare(prev => prev === square ? null : square);
    } else {
      setSelectedSquare(null);
    }
  }, [interactive, onMoveMade, selectedSquare, moveMap]);

  const handlePieceDrag = useCallback(({ square }: { isSparePiece: boolean; piece: unknown; square: string | null }) => {
    if (square && moveMap.has(square)) {
      setDraggingFrom(square);
    }
  }, [moveMap]);

  const handlePieceDrop = useCallback(({ sourceSquare, targetSquare }: {
    piece: unknown; sourceSquare: string; targetSquare: string | null;
  }): boolean => {
    setDraggingFrom(null);
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
          onPieceDrag: interactive ? handlePieceDrag : undefined,
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
