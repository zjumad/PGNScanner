import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AppStep, GameHeader, GameState } from './types';
import { validateMoveSequence, revalidateFromIndex, insertMoveAtIndex, deleteMoveAtIndex, generatePgn, getLegalMovesAtPosition, buildSpeculativeTail, getSmartSuggestions } from './services/chessEngine';
import { recognizeScoreSheet, fileToBase64, mergeOcrResults } from './services/visionApi';
import type { ApiProvider } from './services/visionApi';
import ImageUpload from './components/ImageUpload';
import HeaderEditor from './components/HeaderEditor';
import MoveList from './components/MoveList';
import BoardViewer from './components/BoardViewer';
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
  const [isProcessing, setIsProcessing] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [mobileTab, setMobileTab] = useState<'board' | 'info' | 'debug'>('board');
  const [_imageRotations, setImageRotations] = useState<(0 | 90 | 180 | 270)[]>([]);
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [rawOcrJson, setRawOcrJson] = useState<string>('');
  const [gameState, setGameState] = useState<GameState>({
    header: DEFAULT_HEADER,
    moves: [],
    rawOcrMoves: [],
    corrections: {},
    selectedMoveIndex: -1,
    imageUrls: [],
  });
  const imageFilesRef = useRef<File[]>([]);

  // Undo/redo stacks — store snapshots of moves, corrections, and selectedMoveIndex
  interface UndoSnapshot {
    moves: import('./types').ValidatedMove[];
    corrections: Record<number, string>;
    selectedMoveIndex: number;
  }
  const undoStackRef = useRef<UndoSnapshot[]>([]);
  const redoStackRef = useRef<UndoSnapshot[]>([]);

  const pushUndo = useCallback((state: GameState) => {
    undoStackRef.current = [...undoStackRef.current, {
      moves: state.moves,
      corrections: state.corrections,
      selectedMoveIndex: state.selectedMoveIndex,
    }];
    redoStackRef.current = [];
  }, []);

  const handleUndo = useCallback(() => {
    const stack = undoStackRef.current;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    undoStackRef.current = stack.slice(0, -1);
    setGameState((prev) => {
      redoStackRef.current = [...redoStackRef.current, {
        moves: prev.moves,
        corrections: prev.corrections,
        selectedMoveIndex: prev.selectedMoveIndex,
      }];
      return { ...prev, ...snapshot };
    });
  }, []);

  const handleRedo = useCallback(() => {
    const stack = redoStackRef.current;
    if (stack.length === 0) return;
    const snapshot = stack[stack.length - 1];
    redoStackRef.current = stack.slice(0, -1);
    setGameState((prev) => {
      undoStackRef.current = [...undoStackRef.current, {
        moves: prev.moves,
        corrections: prev.corrections,
        selectedMoveIndex: prev.selectedMoveIndex,
      }];
      return { ...prev, ...snapshot };
    });
  }, []);

  // Cleanup image URLs on unmount or new scan
  useEffect(() => {
    return () => {
      gameState.imageUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [gameState.imageUrls]);

  const handleImagesSelected = useCallback(
    async (files: File[], provider: ApiProvider = 'gemini') => {
      imageFilesRef.current = files;

      setIsProcessing(true);
      setProcessingStatus(`Recognizing image 1 of ${files.length}...`);
      setError(null);
      setStep('processing');

      try {
        // OCR each image sequentially
        const ocrResults = [];
        for (let i = 0; i < files.length; i++) {
          setProcessingStatus(`Recognizing image ${i + 1} of ${files.length}...`);
          const base64 = await fileToBase64(files[i]);
          const result = await recognizeScoreSheet(base64, files[i].type, provider);
          ocrResults.push(result);
        }

        // Merge results from all pages
        const result = mergeOcrResults(ocrResults);
        setRawOcrJson(JSON.stringify(result, null, 2));

        const rawMoves = result.moves.map((m) => ({
          moveNumber: m.moveNumber,
          white: m.whiteMove,
          black: m.blackMove,
          rowBBox: m.rowBBox,
          rotation: m.rotation,
        }));

        const validatedMoves = validateMoveSequence(rawMoves);

        for (const vm of validatedMoves) {
          const ocrMove = result.moves.find((m) => m.moveNumber === vm.moveNumber);
          if (ocrMove) {
            vm.rawOcr = vm.color === 'w' ? ocrMove.whiteMove : ocrMove.blackMove;
          }
        }

        // Append speculative tail for unvalidated moves
        const lastFen = validatedMoves.length > 0
          ? validatedMoves[validatedMoves.length - 1].fenAfter
          : STARTING_FEN;
        const speculative = buildSpeculativeTail(rawMoves, validatedMoves.length, lastFen);
        const allMoves = [...validatedMoves, ...speculative];

        const imageUrls = files.map((f) => URL.createObjectURL(f));

        setGameState((prev) => {
          prev.imageUrls.forEach((url) => URL.revokeObjectURL(url));
          return {
            header: result.header,
            moves: allMoves,
            rawOcrMoves: rawMoves.map(m => ({ moveNumber: m.moveNumber, white: m.white, black: m.black })),
            corrections: {},
            selectedMoveIndex: allMoves.length > 0 ? 0 : -1,
            imageUrls,
          };
        });
        setImageRotations(files.map(() => 0));
        setActiveImageIndex(0);
        setStep('review');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process image');
        setStep('upload');
      } finally {
        setIsProcessing(false);
        setProcessingStatus('');
      }
    },
    []
  );

  const handleSelectMove = useCallback((index: number) => {
    setGameState((prev) => ({ ...prev, selectedMoveIndex: index }));
  }, []);

  const handleCorrectMove = useCallback((index: number, newSan: string) => {
    setGameState((prev) => {
      pushUndo(prev);
      const newMoves = revalidateFromIndex(prev.moves, index, newSan);
      // Rebuild speculative tail from rawOcrMoves
      const lastFen = newMoves.length > 0
        ? newMoves[newMoves.length - 1].fenAfter
        : STARTING_FEN;
      const speculative = buildSpeculativeTail(prev.rawOcrMoves, newMoves.length, lastFen);
      const allMoves = [...newMoves, ...speculative];
      const newCorrections = { ...prev.corrections, [index]: newSan };
      // Advance to next move so the board shows the result of the correction
      const nextIndex = Math.min(index + 1, allMoves.length - 1);
      return {
        ...prev,
        moves: allMoves,
        corrections: newCorrections,
        selectedMoveIndex: nextIndex,
      };
    });
  }, [pushUndo]);

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
      pushUndo(prev);
      const newMoves = insertMoveAtIndex(prev.moves, afterIndex, san);
      const lastFen = newMoves.length > 0
        ? newMoves[newMoves.length - 1].fenAfter
        : STARTING_FEN;
      const speculative = buildSpeculativeTail(prev.rawOcrMoves, newMoves.length, lastFen);
      const allMoves = [...newMoves, ...speculative];
      const insertedAt = afterIndex + 1;
      const nextIndex = Math.min(insertedAt + 1, allMoves.length - 1);
      return {
        ...prev,
        moves: allMoves,
        selectedMoveIndex: nextIndex,
      };
    });
    setInsertingAfterIndex(null);
  }, [pushUndo]);

  const handleDeleteMove = useCallback((index: number) => {
    setGameState((prev) => {
      pushUndo(prev);
      const newMoves = deleteMoveAtIndex(prev.moves, index);
      const lastFen = newMoves.length > 0
        ? newMoves[newMoves.length - 1].fenAfter
        : STARTING_FEN;
      const speculative = buildSpeculativeTail(prev.rawOcrMoves, newMoves.length, lastFen);
      const allMoves = [...newMoves, ...speculative];
      return {
        ...prev,
        moves: allMoves,
        selectedMoveIndex: Math.min(Math.max(index - 1, 0), allMoves.length - 1),
      };
    });
  }, [pushUndo]);

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
    setImageRotations([]);
    setActiveImageIndex(0);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setGameState((prev) => {
      prev.imageUrls.forEach((url) => URL.revokeObjectURL(url));
      return {
        header: DEFAULT_HEADER,
        moves: [],
        rawOcrMoves: [],
        corrections: {},
        selectedMoveIndex: -1,
        imageUrls: [],
      };
    });
    setError(null);
    imageFilesRef.current = [];
  }, []);

  const handleNavigate = useCallback(
    (direction: 'prev' | 'next' | 'start' | 'end') => {
      setGameState((prev) => {
        let newIndex = prev.selectedMoveIndex;
        switch (direction) {
          case 'prev':
            newIndex = Math.max(0, prev.selectedMoveIndex - 1);
            break;
          case 'next':
            newIndex = Math.min(prev.moves.length - 1, prev.selectedMoveIndex + 1);
            break;
          case 'start':
            newIndex = prev.moves.length > 0 ? 0 : -1;
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

  // "Needs attention" = invalid, forced, or fuzzy (but not corrected)
  const needsAttention = useCallback((m: import('./types').ValidatedMove) => {
    if (m.matchType === 'speculative') return true;
    if (!m.isValid) return true;
    if (m.matchType === 'forced') return true;
    if (m.matchType === 'fuzzy') return true;
    return false;
  }, []);

  const handleNavigateToError = useCallback(
    (direction: 'next' | 'prev') => {
      setGameState((prev) => {
        const { moves, selectedMoveIndex } = prev;
        if (direction === 'next') {
          for (let i = selectedMoveIndex + 1; i < moves.length; i++) {
            if (needsAttention(moves[i])) return { ...prev, selectedMoveIndex: i };
          }
        } else {
          for (let i = selectedMoveIndex - 1; i >= 0; i--) {
            if (needsAttention(moves[i])) return { ...prev, selectedMoveIndex: i };
          }
        }
        return prev;
      });
    },
    [needsAttention]
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (step !== 'review') return;
      // Undo/Redo — skip when inside text inputs
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && !e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleUndo();
        return;
      }
      if (e.key === 'z' && (e.ctrlKey || e.metaKey) && e.shiftKey) {
        const target = e.target as HTMLElement;
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        handleRedo();
        return;
      }
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
    [step, handleNavigate, handleUndo, handleRedo]
  );

  // When inserting, show the position and legal moves at the insert point
  const isInserting = insertingAfterIndex !== null;

  // Show the position BEFORE the selected move (so legal moves match what the user sees)
  const selectedMove = gameState.selectedMoveIndex >= 0
    ? gameState.moves[gameState.selectedMoveIndex]
    : null;

  const isSpeculativeSelected = selectedMove?.matchType === 'speculative';

  // Board position: during insert, show position after the insert point
  const insertPointMove = isInserting && insertingAfterIndex >= 0
    ? gameState.moves[insertingAfterIndex]
    : null;

  // For the interactive board, show the position BEFORE the current move
  // so the user can drag pieces to make/correct the move.
  // For speculative moves, show the last known valid position.
  const boardFen = isInserting
    ? (insertPointMove?.isValid ? insertPointMove.fenAfter : insertPointMove?.fenBefore ?? STARTING_FEN)
    : selectedMove
      ? (isSpeculativeSelected ? selectedMove.fenBefore : selectedMove.fenBefore)
      : STARTING_FEN;

  // Legal moves: during insert, use the insert legal moves; otherwise from selected move
  // Speculative moves have no legal alternatives
  const legalMovesAtSelected = isInserting
    ? insertLegalMoves
    : (isSpeculativeSelected ? [] : selectedMove?.legalAlternatives ?? []);

  // Smart suggestions: when a move needs attention, suggest based on the next move
  const smartSuggestions = useMemo(() => {
    if (isInserting || !selectedMove) return [];
    if (selectedMove.matchType === 'corrected' || selectedMove.matchType === 'exact') return [];
    return getSmartSuggestions(gameState.moves, gameState.selectedMoveIndex);
  }, [isInserting, selectedMove, gameState.moves, gameState.selectedMoveIndex]);

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
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 py-2 sm:py-3 flex items-center justify-between">
          <div className="flex items-center gap-2 sm:gap-3">
            <span className="text-xl sm:text-2xl">{'\u265F'}</span>
            <h1 className="text-lg sm:text-xl font-bold text-gray-800">PGN Scanner</h1>
          </div>
          <div className="flex items-center gap-2 sm:gap-4">
            {step === 'review' && (
              <button
                onClick={handleStartOver}
                className="px-2 sm:px-3 py-1 sm:py-1.5 text-xs sm:text-sm text-gray-600 border border-gray-300 rounded-md hover:bg-gray-50"
              >
                New Scan
              </button>
            )}
          </div>
        </div>
      </header>

      {error && (
        <div className="max-w-[1600px] mx-auto px-3 sm:px-4 mt-2 sm:mt-4">
          <div className="bg-red-50 border border-red-200 text-red-700 rounded-lg px-3 sm:px-4 py-2 sm:py-3 text-xs sm:text-sm flex items-center justify-between">
            <span>{error}</span>
            <button onClick={() => setError(null)} className="text-red-500 hover:text-red-700">
              {'\u2715'}
            </button>
          </div>
        </div>
      )}

      <main className="max-w-[600px] mx-auto px-2 sm:px-4 py-2 sm:py-6">
        {(step === 'upload' || step === 'processing') && (
          <div className="py-6 sm:py-12">
            <ImageUpload onImagesSelected={handleImagesSelected} isProcessing={isProcessing} processingStatus={processingStatus} />
          </div>
        )}

        {step === 'review' && (
          <>
            {/* Tab bar — always visible */}
            <div className="flex border-b border-gray-200 bg-white rounded-t-lg mb-2">
              {[
                { id: 'board' as const, label: '♟ Board' },
                { id: 'info' as const, label: 'ℹ️ Game Info' },
                { id: 'debug' as const, label: '🐛 Debug' },
              ].map((tab) => (
                <button
                  key={tab.id}
                  className={`flex-1 py-2.5 text-sm font-medium transition-colors ${
                    mobileTab === tab.id
                      ? 'text-blue-600 border-b-2 border-blue-600 bg-blue-50'
                      : 'text-gray-500 hover:text-gray-700'
                  }`}
                  onClick={() => setMobileTab(tab.id)}
                >
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Desktop layout: 3-column grid (hidden — use tab layout toggle in header to restore) */}
            {/* <div className="hidden lg:grid lg:grid-cols-[1fr_1fr_auto] gap-6" style={{ maxHeight: 'calc(100vh - 140px)' }}>
              ...
            </div> */}

            {/* Tabbed single-column layout */}
            <div>
              {/* Board tab */}
              {mobileTab === 'board' && (
                <div className="flex flex-col items-center gap-3">
                  <div className="w-full max-w-[480px]">
                    <BoardViewer
                      fen={boardFen}
                      interactive={(selectedMove !== null && !isSpeculativeSelected) || isInserting}
                      legalMoves={legalMovesAtSelected}
                      onMoveMade={handleBoardMove}
                    />
                  </div>
                  <NavigationControls
                    isInserting={isInserting}
                    selectedMove={selectedMove}
                    onNavigate={handleNavigate}
                    compact
                  />
                  {(selectedMove || isInserting) && !isSpeculativeSelected && (
                    <LegalMovesPanel
                      legalMoves={legalMovesAtSelected}
                      currentSan={isInserting ? '' : selectedMove!.san}
                      moveLabel={legalMovesLabel}
                      sideToMove={legalMovesSide}
                      smartSuggestions={smartSuggestions}
                      onSelectMove={(san) => {
                        if (isInserting) {
                          handleInsertMove(insertingAfterIndex!, san);
                        } else {
                          handleCorrectMove(gameState.selectedMoveIndex, san);
                        }
                      }}
                    />
                  )}
                  <div className="w-full">
                    <MoveList
                      moves={gameState.moves}
                      selectedIndex={gameState.selectedMoveIndex}
                      onSelectMove={handleSelectMove}
                      onInsertMove={handleInsertMove}
                      onDeleteMove={handleDeleteMove}
                      insertLegalMoves={insertLegalMoves}
                      onRequestInsert={handleRequestInsert}
                      insertingAfterIndex={insertingAfterIndex}
                      onCancelInsert={handleCancelInsert}
                      onNavigateToError={handleNavigateToError}
                      imageUrls={gameState.imageUrls}
                      imagePageInfo={gameState.imageUrls.length > 0 ? {
                        total: gameState.imageUrls.length,
                        current: activeImageIndex,
                        onPrev: () => setActiveImageIndex(Math.max(0, activeImageIndex - 1)),
                        onNext: () => setActiveImageIndex(Math.min(gameState.imageUrls.length - 1, activeImageIndex + 1)),
                        onRotateCW: () => setImageRotations(prev => {
                          const next = [...prev];
                          next[activeImageIndex] = ((next[activeImageIndex] + 90) % 360) as 0 | 90 | 180 | 270;
                          return next;
                        }),
                        onRotateCCW: () => setImageRotations(prev => {
                          const next = [...prev];
                          next[activeImageIndex] = ((next[activeImageIndex] + 270) % 360) as 0 | 90 | 180 | 270;
                          return next;
                        }),
                      } : undefined}
                      selectedMove={selectedMove}
                    />
                  </div>
                  <div className="w-full bg-gray-800 text-green-400 rounded-lg p-3 font-mono text-xs overflow-x-auto max-h-24 overflow-y-auto">
                    <pre className="whitespace-pre-wrap">
                      {generatePgn(gameState.header, gameState.moves)}
                    </pre>
                  </div>
                  <div className="w-full">
                    <button
                      onClick={handleExportPgn}
                      className="w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-md text-sm"
                    >
                      Export PGN
                    </button>
                  </div>
                </div>
              )}

              {/* Game Info tab */}
              {mobileTab === 'info' && (
                <div className="flex flex-col gap-3">
                  <HeaderEditor header={gameState.header} onChange={handleHeaderChange} />
                  <button
                    onClick={handleExportPgn}
                    className="w-full px-4 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 transition-colors shadow-md text-sm"
                  >
                    Export PGN
                  </button>
                </div>
              )}

              {/* Debug tab */}
              {mobileTab === 'debug' && (
                <div className="flex flex-col gap-3">
                  {/* Uploaded Images */}
                  {gameState.imageUrls.length > 0 && (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Uploaded Images</h3>
                      <div className="flex flex-col gap-2">
                        {gameState.imageUrls.map((url, idx) => (
                          <DebugImage key={idx} url={url} pageIndex={idx} />
                        ))}
                      </div>
                    </div>
                  )}
                  {/* OCR Output */}
                  <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
                    <h3 className="text-sm font-semibold text-gray-700 mb-2">OCR Output</h3>
                    <pre className="bg-gray-900 text-green-400 text-xs font-mono p-3 rounded-lg overflow-auto max-h-[70vh] whitespace-pre-wrap break-words">
                      {rawOcrJson || 'No OCR data available. Scan an image first.'}
                    </pre>
                  </div>
                </div>
              )}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

/** Reusable navigation controls */
function NavigationControls({
  isInserting,
  selectedMove,
  onNavigate,
  compact,
}: {
  isInserting: boolean;
  selectedMove: import('./types').ValidatedMove | null;
  onNavigate: (dir: 'prev' | 'next' | 'start' | 'end') => void;
  compact?: boolean;
}) {
  const btnClass = compact
    ? 'p-1.5 rounded hover:bg-gray-200 text-gray-600 text-lg'
    : 'p-2 rounded hover:bg-gray-200 text-gray-600';
  return (
    <div className="flex items-center gap-1 sm:gap-2">
      <button onClick={() => onNavigate('start')} className={btnClass} title="Go to start">{'\u23EE'}</button>
      <button onClick={() => onNavigate('prev')} className={btnClass} title="Previous move">{'\u25C0'}</button>
      <span className={`px-2 sm:px-3 text-xs sm:text-sm text-gray-500 font-mono min-w-[60px] sm:min-w-[80px] text-center`}>
        {isInserting
          ? <span className="text-green-600">Insert...</span>
          : selectedMove
            ? `${selectedMove.moveNumber}.${selectedMove.color === 'w' ? 'White' : 'Black'}`
            : '1.White'}
      </span>
      <button onClick={() => onNavigate('next')} className={btnClass} title="Next move">{'\u25B6'}</button>
      <button onClick={() => onNavigate('end')} className={btnClass} title="Go to end">{'\u23ED'}</button>
    </div>
  );
}

/** Debug image with normalized coordinate overlay on hover */
function DebugImage({ url, pageIndex }: { url: string; pageIndex: number }) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    const rect = img.getBoundingClientRect();
    const x = (e.clientX - rect.left) / rect.width;
    const y = (e.clientY - rect.top) / rect.height;
    setCoords({ x: Math.max(0, Math.min(1, x)), y: Math.max(0, Math.min(1, y)) });
  }, []);

  const handleMouseLeave = useCallback(() => setCoords(null), []);

  return (
    <div className="border border-gray-300 rounded overflow-hidden">
      <div className="text-xs text-gray-500 px-2 py-1 bg-gray-50 flex justify-between">
        <span>Page {pageIndex + 1}</span>
        {coords && (
          <span className="font-mono text-blue-600">
            x: {coords.x.toFixed(3)}, y: {coords.y.toFixed(3)}
          </span>
        )}
      </div>
      <div className="relative">
        <img
          src={url}
          alt={`Uploaded page ${pageIndex + 1}`}
          className="w-full cursor-crosshair"
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
        />
      </div>
    </div>
  );
}
