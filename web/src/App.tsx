import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AppStep, GameHeader, GameState, RawOcrMovePair } from './types';
import { validateMoveSequence, revalidateFromIndex, insertMoveAtIndex, deleteMoveAtIndex, generatePgn, getLegalMovesAtPosition } from './services/chessEngine';
import { recognizeScoreSheet, fileToBase64 } from './services/visionApi';
import type { ApiProvider } from './services/visionApi';
import ImageUpload from './components/ImageUpload';
import HeaderEditor from './components/HeaderEditor';
import MoveList from './components/MoveList';
import BoardViewer from './components/BoardViewer';
import ApiKeyDialog from './components/ApiKeyDialog';
import LegalMovesPanel from './components/LegalMovesPanel';
import './index.css';

const DEFAULT_HEADER: GameHeader = {
  event: '',
  date: '',
  round: '',
  white: '',
  black: '',
  whiteElo: '',
  blackElo: '',
  opening: '',
  eco: '',
  result: '*',
};

const STARTING_FEN = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

export default function App() {
  const [step, setStep] = useState<AppStep>('upload');
  const [apiKey, setApiKey] = useState<string>('');
  const [apiProvider, setApiProvider] = useState<ApiProvider>('gemini');
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gameState, setGameState] = useState<GameState>({
    header: DEFAULT_HEADER,
    moves: [],
    rawOcrMoves: [],
    corrections: {},
    selectedMoveIndex: -1,
    imageUrl: null,
  });
  const imageFileRef = useRef<File | null>(null);

  // Cleanup image URL on unmount or new scan
  useEffect(() => {
    return () => {
      if (gameState.imageUrl) URL.revokeObjectURL(gameState.imageUrl);
    };
  }, [gameState.imageUrl]);

  const handleApiKeySet = useCallback((key: string, provider: ApiProvider) => {
    setApiKey(key);
    setApiProvider(provider);
  }, []);

  const handleImageSelected = useCallback(
    async (file: File) => {
      imageFileRef.current = file;

      if (!apiKey) {
        setError('Please set your API key first.');
        return;
      }

      setIsProcessing(true);
      setError(null);
      setStep('processing');

      try {
        const base64 = await fileToBase64(file);
        const result = await recognizeScoreSheet(base64, apiKey, file.type, apiProvider);

        const rawMoves: RawOcrMovePair[] = result.moves.map((m) => ({
          moveNumber: m.moveNumber,
          white: m.whiteMove,
          black: m.blackMove,
        }));

        const validatedMoves = validateMoveSequence(rawMoves);

        for (const vm of validatedMoves) {
          const ocrMove = result.moves.find((m) => m.moveNumber === vm.moveNumber);
          if (ocrMove) {
            vm.rawOcr = vm.color === 'w' ? ocrMove.whiteMove : ocrMove.blackMove;
          }
        }

        const imageUrl = URL.createObjectURL(file);

        setGameState((prev) => {
          if (prev.imageUrl) URL.revokeObjectURL(prev.imageUrl);
          return {
            header: result.header,
            moves: validatedMoves,
            rawOcrMoves: rawMoves,
            corrections: {},
            selectedMoveIndex: validatedMoves.length > 0 ? 0 : -1,
            imageUrl,
          };
        });
        setStep('review');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process image');
        setStep('upload');
      } finally {
        setIsProcessing(false);
      }
    },
    [apiKey, apiProvider]
  );

  const handleSelectMove = useCallback((index: number) => {
    setGameState((prev) => ({ ...prev, selectedMoveIndex: index }));
  }, []);

  const handleCorrectMove = useCallback((index: number, newSan: string) => {
    setGameState((prev) => {
      const newMoves = revalidateFromIndex(prev.moves, index, newSan);
      const newCorrections = { ...prev.corrections, [index]: newSan };
      // Advance to next move so the board shows the result of the correction
      const nextIndex = Math.min(index + 1, newMoves.length - 1);
      return {
        ...prev,
        moves: newMoves,
        corrections: newCorrections,
        selectedMoveIndex: nextIndex,
      };
    });
  }, []);

  // Insert move state and handlers
  const [insertingAfterIndex, setInsertingAfterIndex] = useState<number | null>(null);

  const insertLegalMoves = useMemo(() => {
    if (insertingAfterIndex === null) return [];
    return getLegalMovesAtPosition(gameState.moves, insertingAfterIndex);
  }, [insertingAfterIndex, gameState.moves]);

  const handleRequestInsert = useCallback((afterIndex: number) => {
    setInsertingAfterIndex(afterIndex);
  }, []);

  const handleCancelInsert = useCallback(() => {
    setInsertingAfterIndex(null);
  }, []);

  const handleInsertMove = useCallback((afterIndex: number, san: string) => {
    setGameState((prev) => {
      const newMoves = insertMoveAtIndex(prev.moves, afterIndex, san);
      // Advance past the inserted move to show its result
      const insertedAt = afterIndex + 1;
      const nextIndex = Math.min(insertedAt + 1, newMoves.length - 1);
      return {
        ...prev,
        moves: newMoves,
        selectedMoveIndex: nextIndex,
      };
    });
    setInsertingAfterIndex(null);
  }, []);

  const handleDeleteMove = useCallback((index: number) => {
    setGameState((prev) => {
      const newMoves = deleteMoveAtIndex(prev.moves, index);
      return {
        ...prev,
        moves: newMoves,
        selectedMoveIndex: Math.min(Math.max(index - 1, 0), newMoves.length - 1),
      };
    });
  }, []);

  const handleHeaderChange = useCallback((header: GameHeader) => {
    setGameState((prev) => ({ ...prev, header }));
  }, []);

  const handleExportPgn = useCallback(() => {
    const pgn = generatePgn(gameState.header, gameState.moves);
    const blob = new Blob([pgn], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const datePart = gameState.header.date || 'game';
    const whitePart = gameState.header.white || 'White';
    const blackPart = gameState.header.black || 'Black';
    a.href = url;
    a.download = `${datePart} - ${gameState.header.round || 'R'} - ${whitePart} - ${blackPart}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  }, [gameState]);

  const handleStartOver = useCallback(() => {
    setStep('upload');
    setGameState((prev) => {
      if (prev.imageUrl) URL.revokeObjectURL(prev.imageUrl);
      return {
        header: DEFAULT_HEADER,
        moves: [],
        rawOcrMoves: [],
        corrections: {},
        selectedMoveIndex: -1,
        imageUrl: null,
      };
    });
    setError(null);
    imageFileRef.current = null;
  }, []);

  const handleNavigate = useCallback(
    (direction: 'prev' | 'next' | 'start' | 'end') => {
      setGameState((prev) => {
        let newIndex = prev.selectedMoveIndex;
        switch (direction) {
          case 'prev':
            newIndex = Math.max(-1, prev.selectedMoveIndex - 1);
            break;
          case 'next':
            newIndex = Math.min(prev.moves.length - 1, prev.selectedMoveIndex + 1);
            break;
          case 'start':
            newIndex = -1;
            break;
          case 'end':
            newIndex = prev.moves.length - 1;
            break;
        }
        return { ...prev, selectedMoveIndex: newIndex };
      });
    },
    []
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (step !== 'review') return;
      if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
        e.preventDefault();
        handleNavigate('prev');
      } else if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
        e.preventDefault();
        handleNavigate('next');
      } else if (e.key === 'Home') {
        e.preventDefault();
        handleNavigate('start');
      } else if (e.key === 'End') {
        e.preventDefault();
        handleNavigate('end');
      }
    },
    [step, handleNavigate]
  );

  // When inserting, show the position and legal moves at the insert point
  const isInserting = insertingAfterIndex !== null;

  // Show the position BEFORE the selected move (so legal moves match what the user sees)
  const selectedMove = gameState.selectedMoveIndex >= 0
    ? gameState.moves[gameState.selectedMoveIndex]
    : null;

  // Board position: during insert, show position after the insert point
  const insertPointMove = isInserting && insertingAfterIndex >= 0
    ? gameState.moves[insertingAfterIndex]
    : null;

  // For the interactive board, show the position BEFORE the current move
  // so the user can drag pieces to make/correct the move
  const boardFen = isInserting
    ? (insertPointMove?.isValid ? insertPointMove.fenAfter : insertPointMove?.fenBefore ?? STARTING_FEN)
    : selectedMove
      ? selectedMove.fenBefore
      : STARTING_FEN;

  // Legal moves: during insert, use the insert legal moves; otherwise from selected move
  const legalMovesAtSelected = isInserting
    ? insertLegalMoves
    : selectedMove?.legalAlternatives ?? [];

  // Label for legal moves panel
  const legalMovesLabel = isInserting
    ? `Insert after ${insertingAfterIndex < 0 ? 'start' : `${insertPointMove?.moveNumber ?? '?'}${insertPointMove?.color === 'w' ? '.' : '...'}`}`
    : selectedMove
      ? `${selectedMove.moveNumber}${selectedMove.color === 'w' ? '.' : '...'}`
      : 'Start';

  // Side to move for piece filter icons
  const legalMovesSide: 'w' | 'b' = isInserting
    ? (insertingAfterIndex < 0 ? 'w' : (insertPointMove?.color === 'w' ? 'b' : 'w'))
    : selectedMove?.color ?? 'w';

  const handleBoardMove = useCallback((san: string) => {
    if (isInserting && insertingAfterIndex !== null) {
      handleInsertMove(insertingAfterIndex, san);
    } else if (gameState.selectedMoveIndex >= 0) {
      handleCorrectMove(gameState.selectedMoveIndex, san);
    }
  }, [isInserting, insertingAfterIndex, gameState.selectedMoveIndex, handleInsertMove, handleCorrectMove]);

  return (
    <div
      className="min-h-screen bg-gray-100 text-gray-900"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <header className="bg-white border-b border-gray-200 shadow-sm">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span className="text-2xl">{'\u265F'}</span>
            <h1 className="text-xl font-bold text-gray-800">PGN Scanner</h1>
          </div>
          <div className="flex items-center gap-4">
            <ApiKeyDialog onKeySet={handleApiKeySet} />
            {step === 'review' && (
              <button
                onClick={handleStartOver}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                New Scan
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-[1600px] mx-auto px-4 mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-4 py-3 text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              {'\u2715'}
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[1600px] mx-auto px-4 py-6">
        {(step === 'upload' || step === 'processing') && (
          <div className="py-12">
            <ImageUpload onImageSelected={handleImageSelected} isProcessing={isProcessing} />
          </div>
        )}

        {step === 'review' && (
          <div className="grid grid-cols-1 lg:grid-cols-[1fr_1fr_auto] gap-6" style={{ maxHeight: 'calc(100vh - 140px)' }}>
            {/* Left: Original image */}
            <div className="flex flex-col gap-4 min-h-0 overflow-y-auto">
              <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
                <h3 className="text-sm font-semibold text-gray-600 mb-2">Original Score Sheet</h3>
                {gameState.imageUrl && (
                  <img
                    src={gameState.imageUrl}
                    alt="Score sheet"
                    className="w-full rounded-md"
                  />
                )}
              </div>
            </div>

            {/* Center: Header + Move list */}
            <div className="flex flex-col gap-4 min-h-0" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              <HeaderEditor header={gameState.header} onChange={handleHeaderChange} />
              <div className="flex-1 min-h-0">
                <MoveList
                  moves={gameState.moves}
                  selectedIndex={gameState.selectedMoveIndex}
                  onSelectMove={handleSelectMove}
                  onCorrectMove={handleCorrectMove}
                  onInsertMove={handleInsertMove}
                  onDeleteMove={handleDeleteMove}
                  insertLegalMoves={insertLegalMoves}
                  onRequestInsert={handleRequestInsert}
                  insertingAfterIndex={insertingAfterIndex}
                  onCancelInsert={handleCancelInsert}
                />
              </div>
            </div>

            {/* Right: Board + Legal moves + Controls */}
            <div className="flex flex-col items-center gap-4">
              <BoardViewer
                fen={boardFen}
                interactive={selectedMove !== null || isInserting}
                legalMoves={legalMovesAtSelected}
                onMoveMade={handleBoardMove}
              />

              <div className="flex items-center gap-2">
                <button onClick={() => handleNavigate('start')} className="p-2 rounded hover:bg-gray-200 text-gray-600" title="Go to start">{'\u23EE'}</button>
                <button onClick={() => handleNavigate('prev')} className="p-2 rounded hover:bg-gray-200 text-gray-600" title="Previous move">{'\u25C0'}</button>
                <span className="px-3 text-sm text-gray-500 font-mono min-w-[80px] text-center">
                  {isInserting
                    ? <span className="text-green-600">Inserting...</span>
                    : selectedMove
                      ? `${selectedMove.moveNumber}${selectedMove.color === 'w' ? '.' : '...'}`
                      : 'Start'}
                </span>
                <button onClick={() => handleNavigate('next')} className="p-2 rounded hover:bg-gray-200 text-gray-600" title="Next move">{'\u25B6'}</button>
                <button onClick={() => handleNavigate('end')} className="p-2 rounded hover:bg-gray-200 text-gray-600" title="Go to end">{'\u23ED'}</button>
              </div>

              {/* Legal moves panel */}
              {(selectedMove || isInserting) && (
                <LegalMovesPanel
                  legalMoves={legalMovesAtSelected}
                  currentSan={isInserting ? '' : selectedMove!.san}
                  moveLabel={legalMovesLabel}
                  sideToMove={legalMovesSide}
                  onSelectMove={(san) => {
                    if (isInserting) {
                      handleInsertMove(insertingAfterIndex!, san);
                    } else {
                      handleCorrectMove(gameState.selectedMoveIndex, san);
                    }
                  }}
                />
              )}

              <button
                onClick={handleExportPgn}
                className="w-full px-6 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-md"
              >
                Export PGN
              </button>

              <div className="w-full bg-gray-800 text-green-400 rounded-lg p-4 font-mono text-xs overflow-x-auto max-h-32 overflow-y-auto">
                <pre className="whitespace-pre-wrap">
                  {generatePgn(gameState.header, gameState.moves)}
                </pre>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
