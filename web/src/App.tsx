import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import type { AppStep, GameHeader, GameState } from './types';
import { validateMoveSequence, revalidateFromIndex, insertMoveAtIndex, deleteMoveAtIndex, generatePgn, getLegalMovesAtPosition, buildSpeculativeTail, getSmartSuggestions } from './services/chessEngine';
import { recognizeScoreSheet, computeRowBBox } from './services/visionApi';
import { correctImageOrientation, mergeImages, applyPerspectiveWarp } from './services/imagePreprocess';
import type { ProcessedImage } from './services/imagePreprocess';
import type { Point2D } from './services/perspectiveTransform';
import type { ModelId, GridDescriptor } from './services/visionApi';
import ImageUpload from './components/ImageUpload';
import HeaderEditor from './components/HeaderEditor';
import MoveList from './components/MoveList';
import BoardViewer from './components/BoardViewer';
import PerspectiveEditor from './components/PerspectiveEditor';
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
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const [rawOcrJson, setRawOcrJson] = useState<string>('');
  const [ocrGrid, setOcrGrid] = useState<GridDescriptor | null>(null);
  const [boardFlipped, setBoardFlipped] = useState(false);
  const [preprocessedImages, setPreprocessedImages] = useState<ProcessedImage[]>([]);
  const preprocessedImagesRef = useRef<ProcessedImage[]>([]);
  const [originalImages, setOriginalImages] = useState<ProcessedImage[]>([]);
  const [selectedModelId, setSelectedModelId] = useState<ModelId>('gemini-2.5-flash');
  const [gameState, setGameState] = useState<GameState>({
    header: DEFAULT_HEADER,
    moves: [],
    rawOcrMoves: [],
    corrections: {},
    selectedMoveIndex: -1,
    imageUrls: [],
    ocrImageUrl: '',
  });
  const imageFilesRef = useRef<File[]>([]);

  // Keep ref in sync with preprocessedImages state
  useEffect(() => {
    preprocessedImagesRef.current = preprocessedImages;
  }, [preprocessedImages]);

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
      if (gameState.ocrImageUrl) URL.revokeObjectURL(gameState.ocrImageUrl);
    };
  }, [gameState.imageUrls, gameState.ocrImageUrl]);

  const handleImagesSelected = useCallback(
    async (files: File[], modelId: ModelId = 'gemini-2.5-flash') => {
      imageFilesRef.current = files;
      setSelectedModelId(modelId);
      setIsProcessing(true);
      setProcessingStatus('Correcting image orientation...');
      setError(null);
      setStep('processing');

      try {
        const processed = [];
        for (let i = 0; i < files.length; i++) {
          processed.push(await correctImageOrientation(files[i]));
        }
        setPreprocessedImages(processed);
        setOriginalImages(processed);
        setIsProcessing(false);
        setProcessingStatus('');
        setStep('perspective');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to process image');
        setStep('upload');
        setIsProcessing(false);
        setProcessingStatus('');
      }
    },
    []
  );

  /** Run perspective warp (if adjusted) → merge → OCR */
  const runOcrPipeline = useCallback(
    async (images: ProcessedImage[]) => {
      setIsProcessing(true);
      setStep('processing');

      try {
        // Merge multiple images into one for a single OCR call
        let ocrImage = images[0];
        let mergedSeparately = false;
        if (images.length > 1) {
          setProcessingStatus('Merging images...');
          ocrImage = await mergeImages(images);
          mergedSeparately = true;
        }

        // Single OCR call on the (possibly merged) image
        setProcessingStatus('Recognizing moves...');
        const result = await recognizeScoreSheet(ocrImage.base64, ocrImage.mimeType, selectedModelId);

        // Keep the OCR image URL for Sheet column crops (grid coords are relative to it)
        const ocrImageUrl = ocrImage.url;
        setRawOcrJson(JSON.stringify(result, null, 2));
        if (result.grid) setOcrGrid(result.grid);

        const rawMoves = result.moves.map((m) => ({
          moveNumber: m.moveNumber,
          white: m.whiteMove,
          black: m.blackMove,
          rowBBox: m.rowBBox,
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

        // Per-page URLs for Debug tab; merged URL for Sheet column crops
        const imageUrls = mergedSeparately ? images.map((p) => p.url) : [];

        setGameState((prev) => {
          prev.imageUrls.forEach((url) => URL.revokeObjectURL(url));
          if (prev.ocrImageUrl) URL.revokeObjectURL(prev.ocrImageUrl);
          return {
            header: result.header,
            moves: allMoves,
            rawOcrMoves: rawMoves.map(m => ({ moveNumber: m.moveNumber, white: m.white, black: m.black, rowBBox: m.rowBBox })),
            corrections: {},
            selectedMoveIndex: allMoves.length > 0 ? 0 : -1,
            imageUrls,
            ocrImageUrl,
          };
        });
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
    [selectedModelId]
  );

  /** Called when user clicks "Apply" — warp images and show preview, stay on perspective step */
  const handlePerspectivePreview = useCallback(
    async (cornersPerImage: Point2D[][]) => {
      setIsProcessing(true);
      setProcessingStatus('Applying perspective correction...');

      try {
        // Warp from the current preprocessed images (so repeated Apply compounds)
        const currentImages = preprocessedImagesRef.current;
        const warped: ProcessedImage[] = [];
        for (let i = 0; i < currentImages.length; i++) {
          warped.push(await applyPerspectiveWarp(currentImages[i], cornersPerImage[i]));
        }
        // Revoke old warped URLs (but not originals)
        setPreprocessedImages((prev) => {
          prev.forEach((img) => {
            if (!originalImages.some((orig) => orig.url === img.url)) {
              URL.revokeObjectURL(img.url);
            }
          });
          return warped;
        });
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Perspective correction failed');
      } finally {
        setIsProcessing(false);
        setProcessingStatus('');
      }
    },
    [originalImages]
  );

  /** Called when user clicks "Scan" — proceed to OCR with current images */
  const handlePerspectiveScan = useCallback(() => {
    runOcrPipeline(preprocessedImages);
  }, [preprocessedImages, runOcrPipeline]);

  /** Called when user clicks "Reset" — restore original EXIF-corrected images */
  const handlePerspectiveReset = useCallback(() => {
    setPreprocessedImages(originalImages);
  }, [originalImages]);

  const handleSelectMove = useCallback((index: number) => {
    setGameState((prev) => ({ ...prev, selectedMoveIndex: index }));
    setMobileTab('board');
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
    const roundNum = parseInt(gameState.header.round, 10);
    const roundPart = !isNaN(roundNum) ? String(roundNum).padStart(2, '0') : (gameState.header.round || 'R');
    a.download = `${datePart} - ${roundPart} - ${whitePart} vs ${blackPart}.pgn`;
    a.click();
    URL.revokeObjectURL(url);
  }, [gameState]);

  const handleStartOver = useCallback(() => {
    setStep('upload');
    setActiveImageIndex(0);
    undoStackRef.current = [];
    redoStackRef.current = [];
    setGameState((prev) => {
      prev.imageUrls.forEach((url) => URL.revokeObjectURL(url));
      if (prev.ocrImageUrl) URL.revokeObjectURL(prev.ocrImageUrl);
      return {
        header: DEFAULT_HEADER,
        moves: [],
        rawOcrMoves: [],
        corrections: {},
        selectedMoveIndex: -1,
        imageUrls: [],
        ocrImageUrl: '',
      };
    });
    setError(null);
    imageFilesRef.current = [];
    setOcrGrid(null);
  }, []);

  const handleGridUpdate = useCallback((newGrid: GridDescriptor) => {
    setOcrGrid(newGrid);
    setGameState((prev) => ({
      ...prev,
      moves: prev.moves.map((m) => {
        const computed = computeRowBBox(m.moveNumber, newGrid);
        return { ...m, bbox: computed.bbox };
      }),
    }));
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

        {step === 'perspective' && (
          <div className="py-4 sm:py-8">
            <PerspectiveEditor
              images={preprocessedImages}
              onApplyPreview={handlePerspectivePreview}
              onScan={handlePerspectiveScan}
              onReset={handlePerspectiveReset}
              isProcessing={isProcessing}
            />
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
                      orientation={boardFlipped ? 'black' : 'white'}
                    />
                  </div>
                  <NavigationControls
                    isInserting={isInserting}
                    selectedMove={selectedMove}
                    onNavigate={handleNavigate}
                    onFlipBoard={() => setBoardFlipped(f => !f)}
                    compact
                  />
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
                      imageUrls={gameState.ocrImageUrl ? [gameState.ocrImageUrl] : gameState.imageUrls}
                      imagePageInfo={gameState.imageUrls.length > 0 ? {
                        total: gameState.imageUrls.length,
                        current: activeImageIndex,
                        onPrev: () => setActiveImageIndex(Math.max(0, activeImageIndex - 1)),
                        onNext: () => setActiveImageIndex(Math.min(gameState.imageUrls.length - 1, activeImageIndex + 1)),
                      } : undefined}
                      selectedMove={selectedMove}
                      legalMoves={legalMovesAtSelected}
                      smartSuggestions={smartSuggestions}
                      legalMovesLabel={legalMovesLabel}
                      legalMovesSide={legalMovesSide}
                      showLegalMoves={(selectedMove !== null || isInserting) && !isSpeculativeSelected}
                      onLegalMoveSelect={(san) => {
                        if (isInserting) {
                          handleInsertMove(insertingAfterIndex!, san);
                        } else {
                          handleCorrectMove(gameState.selectedMoveIndex, san);
                        }
                      }}
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
                  {(gameState.ocrImageUrl || gameState.imageUrls.length > 0) && (
                    <div className="bg-white rounded-lg border border-gray-200 shadow-sm p-3">
                      <h3 className="text-sm font-semibold text-gray-700 mb-2">Processed Images</h3>
                      <div className="flex flex-col gap-2">
                        {/* Show OCR image (merged or single) with grid overlay */}
                        {gameState.ocrImageUrl && (
                          <DebugImage url={gameState.ocrImageUrl} pageIndex={0} grid={ocrGrid} onGridUpdate={handleGridUpdate} />
                        )}
                        {/* Show individual pages if multi-image */}
                        {gameState.imageUrls.length > 1 && gameState.imageUrls.map((url, idx) => (
                          <DebugImage key={idx} url={url} pageIndex={idx + 1} grid={null} onGridUpdate={handleGridUpdate} />
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
  onFlipBoard,
  compact,
}: {
  isInserting: boolean;
  selectedMove: import('./types').ValidatedMove | null;
  onNavigate: (dir: 'prev' | 'next' | 'start' | 'end') => void;
  onFlipBoard?: () => void;
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
      {onFlipBoard && (
        <button onClick={onFlipBoard} className={btnClass} title="Flip board">🔄</button>
      )}
    </div>
  );
}

/** Debug image with interactive grid overlay and coordinate display */
function DebugImage({ url, pageIndex, grid, onGridUpdate }: {
  url: string;
  pageIndex: number;
  grid: GridDescriptor | null;
  onGridUpdate: (grid: GridDescriptor) => void;
}) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  // Number of visible grids (1, 2, or 3)
  const gridCount = !grid ? 1 : grid.thirdHalf && grid.thirdHalf.width > 0 ? 3 : grid.rightHalf.width > 0 ? 2 : 1;

  const getNormalizedCoords = useCallback((e: React.PointerEvent<HTMLElement> | React.MouseEvent<HTMLElement>) => {
    const el = containerRef.current;
    if (!el) return { x: 0, y: 0 };
    const img = el.querySelector('img') as HTMLElement;
    if (!img) return { x: 0, y: 0 };
    const rect = img.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height)),
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLElement>) => {
    setCoords(getNormalizedCoords(e));
  }, [getNormalizedCoords]);

  const handleMouseLeave = useCallback(() => setCoords(null), []);

  // Update grid count
  const setGridCount = useCallback((count: number) => {
    if (!grid) return;
    const makeHalf = (xOffset: number) => ({
      x: grid.leftHalf.x + xOffset,
      y: grid.leftHalf.y,
      width: grid.leftHalf.width,
      height: grid.leftHalf.height,
      rows: grid.leftHalf.rows,
    });
    const zeroHalf = { x: 0, y: 0, width: 0, height: 0, rows: grid.leftHalf.rows };
    if (count === 1) {
      onGridUpdate({ ...grid, rightHalf: zeroHalf, thirdHalf: undefined });
    } else if (count === 2) {
      onGridUpdate({
        ...grid,
        rightHalf: grid.rightHalf.width > 0 ? grid.rightHalf : makeHalf(grid.leftHalf.width + 0.05),
        thirdHalf: undefined,
      });
    } else if (count === 3) {
      const gap = grid.leftHalf.width + 0.03;
      onGridUpdate({
        ...grid,
        rightHalf: grid.rightHalf.width > 0 ? grid.rightHalf : makeHalf(gap),
        thirdHalf: grid.thirdHalf && grid.thirdHalf.width > 0 ? grid.thirdHalf : makeHalf(gap * 2),
      });
    }
  }, [grid, onGridUpdate]);

  // Update rows for a half
  const setHalfRows = useCallback((half: 'left' | 'right' | 'third', rows: number) => {
    if (!grid) return;
    const clamped = Math.max(1, Math.min(60, rows));
    if (half === 'left') {
      onGridUpdate({ ...grid, leftHalf: { ...grid.leftHalf, rows: clamped } });
    } else if (half === 'right') {
      onGridUpdate({ ...grid, rightHalf: { ...grid.rightHalf, rows: clamped } });
    } else {
      onGridUpdate({ ...grid, thirdHalf: { ...(grid.thirdHalf || grid.leftHalf), rows: clamped } });
    }
  }, [grid, onGridUpdate]);

  // Commit a rectangle update from drag/resize
  const handleRectUpdate = useCallback((half: 'left' | 'right' | 'third', updated: { x: number; y: number; width: number; height: number }) => {
    if (!grid) return;
    const clamped = {
      x: Math.max(0, Math.min(1, updated.x)),
      y: Math.max(0, Math.min(1, updated.y)),
      width: Math.max(0.02, Math.min(1, updated.width)),
      height: Math.max(0.02, Math.min(1, updated.height)),
    };
    if (half === 'left') {
      onGridUpdate({ ...grid, leftHalf: { ...grid.leftHalf, ...clamped } });
    } else if (half === 'right') {
      onGridUpdate({ ...grid, rightHalf: { ...grid.rightHalf, ...clamped } });
    } else {
      onGridUpdate({ ...grid, thirdHalf: { ...(grid.thirdHalf || grid.leftHalf), ...clamped } });
    }
  }, [grid, onGridUpdate]);

  return (
    <div className="border border-gray-300 rounded overflow-hidden">
      <div className="text-xs text-gray-500 px-2 py-1 bg-gray-50 flex justify-between items-center">
        <span>Page {pageIndex + 1}</span>
        <div className="flex items-center gap-2">
          {coords && (
            <span className="font-mono text-blue-600">
              x: {coords.x.toFixed(3)}, y: {coords.y.toFixed(3)}
            </span>
          )}
        </div>
      </div>
      {/* Grid controls */}
      {grid && (
        <div className="px-2 py-1.5 bg-gray-50 border-t border-gray-200 flex flex-wrap items-center gap-3 text-xs">
          <label className="flex items-center gap-1">
            <span className="text-gray-600"># Grids:</span>
            <select
              value={gridCount}
              onChange={(e) => setGridCount(Number(e.target.value))}
              className="border border-gray-300 rounded px-1.5 py-0.5 text-xs bg-white"
            >
              <option value={1}>1</option>
              <option value={2}>2</option>
              <option value={3}>3</option>
            </select>
          </label>
          <label className="flex items-center gap-1">
            <span className="text-red-600">Grid 1 rows:</span>
            <input
              type="number"
              value={grid.leftHalf.rows}
              onChange={(e) => setHalfRows('left', Number(e.target.value))}
              min={1}
              max={60}
              className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-14 bg-white"
            />
          </label>
          {gridCount >= 2 && (
            <label className="flex items-center gap-1">
              <span className="text-blue-600">Grid 2 rows:</span>
              <input
                type="number"
                value={grid.rightHalf.rows}
                onChange={(e) => setHalfRows('right', Number(e.target.value))}
                min={1}
                max={60}
                className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-14 bg-white"
              />
            </label>
          )}
          {gridCount >= 3 && grid.thirdHalf && (
            <label className="flex items-center gap-1">
              <span className="text-green-600">Grid 3 rows:</span>
              <input
                type="number"
                value={grid.thirdHalf.rows}
                onChange={(e) => setHalfRows('third', Number(e.target.value))}
                min={1}
                max={60}
                className="border border-gray-300 rounded px-1.5 py-0.5 text-xs w-14 bg-white"
              />
            </label>
          )}
        </div>
      )}
      <div ref={containerRef} className="relative" onMouseMove={handleMouseMove} onMouseLeave={handleMouseLeave}>
        <img
          src={url}
          alt={`Uploaded page ${pageIndex + 1}`}
          className="w-full cursor-crosshair"
          draggable={false}
        />
        {/* Interactive grid overlays */}
        {grid && grid.leftHalf.width > 0 && (
          <DraggableRect
            half={grid.leftHalf}
            color="red"
            label={`Grid 1 (1-${grid.leftHalf.rows})`}
            containerRef={containerRef}
            onUpdate={(rect) => handleRectUpdate('left', rect)}
            disabled={false}
          />
        )}
        {grid && grid.rightHalf.width > 0 && (
          <DraggableRect
            half={grid.rightHalf}
            color="blue"
            label={`Grid 2 (${grid.leftHalf.rows + 1}-${grid.leftHalf.rows + grid.rightHalf.rows})`}
            containerRef={containerRef}
            onUpdate={(rect) => handleRectUpdate('right', rect)}
            disabled={false}
          />
        )}
        {grid && grid.thirdHalf && grid.thirdHalf.width > 0 && (
          <DraggableRect
            half={grid.thirdHalf}
            color="green"
            label={`Grid 3 (${grid.leftHalf.rows + grid.rightHalf.rows + 1}-${grid.leftHalf.rows + grid.rightHalf.rows + grid.thirdHalf.rows})`}
            containerRef={containerRef}
            onUpdate={(rect) => handleRectUpdate('third', rect)}
            disabled={false}
          />
        )}
      </div>
    </div>
  );
}

/** Draggable and resizable rectangle overlay for grid halves */
function DraggableRect({ half, color, label, containerRef, onUpdate, disabled }: {
  half: { x: number; y: number; width: number; height: number };
  color: 'red' | 'blue' | 'green';
  label: string;
  containerRef: React.RefObject<HTMLDivElement | null>;
  onUpdate: (rect: { x: number; y: number; width: number; height: number }) => void;
  disabled?: boolean;
}) {
  const [dragState, setDragState] = useState<{
    type: 'move' | 'resize';
    edge?: 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
    startX: number;
    startY: number;
    origRect: { x: number; y: number; width: number; height: number };
  } | null>(null);
  const [localRect, setLocalRect] = useState<{ x: number; y: number; width: number; height: number } | null>(null);

  // Use the localRect during drag, otherwise the committed half
  const rect = localRect || half;
  const EDGE_PX = 8;

  const getImgRect = useCallback(() => {
    const el = containerRef.current;
    if (!el) return null;
    const img = el.querySelector('img');
    return img?.getBoundingClientRect() || null;
  }, [containerRef]);

  const detectEdge = useCallback((e: React.PointerEvent<HTMLDivElement>): string | null => {
    const el = e.currentTarget;
    const br = el.getBoundingClientRect();
    const x = e.clientX - br.left;
    const y = e.clientY - br.top;
    const w = br.width;
    const h = br.height;
    const nearL = x < EDGE_PX;
    const nearR = x > w - EDGE_PX;
    const nearT = y < EDGE_PX;
    const nearB = y > h - EDGE_PX;
    if (nearT && nearL) return 'nw';
    if (nearT && nearR) return 'ne';
    if (nearB && nearL) return 'sw';
    if (nearB && nearR) return 'se';
    if (nearT) return 'n';
    if (nearB) return 's';
    if (nearL) return 'w';
    if (nearR) return 'e';
    return null;
  }, []);

  const getCursorForEdge = (edge: string | null): string => {
    if (!edge) return 'move';
    const map: Record<string, string> = { n: 'ns-resize', s: 'ns-resize', e: 'ew-resize', w: 'ew-resize', ne: 'nesw-resize', sw: 'nesw-resize', nw: 'nwse-resize', se: 'nwse-resize' };
    return map[edge] || 'move';
  };

  const handlePointerDown = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
    const edge = detectEdge(e);
    setDragState({
      type: edge ? 'resize' : 'move',
      edge: edge as typeof dragState extends null ? never : NonNullable<typeof dragState>['edge'],
      startX: e.clientX,
      startY: e.clientY,
      origRect: { x: half.x, y: half.y, width: half.width, height: half.height },
    });
    setLocalRect({ x: half.x, y: half.y, width: half.width, height: half.height });
  }, [disabled, half, detectEdge]);

  const handlePointerMove = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) {
      // Just update cursor based on edge proximity
      if (!disabled) {
        const edge = detectEdge(e);
        (e.currentTarget as HTMLElement).style.cursor = getCursorForEdge(edge);
      }
      return;
    }
    e.preventDefault();
    e.stopPropagation();
    const imgRect = getImgRect();
    if (!imgRect) return;
    const dx = (e.clientX - dragState.startX) / imgRect.width;
    const dy = (e.clientY - dragState.startY) / imgRect.height;
    const orig = dragState.origRect;
    let { x, y, width, height } = orig;

    if (dragState.type === 'move') {
      x = orig.x + dx;
      y = orig.y + dy;
    } else {
      const edge = dragState.edge || '';
      if (edge.includes('w')) { x = orig.x + dx; width = orig.width - dx; }
      if (edge.includes('e')) { width = orig.width + dx; }
      if (edge.includes('n')) { y = orig.y + dy; height = orig.height - dy; }
      if (edge.includes('s')) { height = orig.height + dy; }
    }

    // Clamp to valid range
    width = Math.max(0.02, width);
    height = Math.max(0.02, height);
    x = Math.max(0, Math.min(1 - width, x));
    y = Math.max(0, Math.min(1 - height, y));

    setLocalRect({ x, y, width, height });
  }, [dragState, getImgRect, detectEdge, disabled]);

  const handlePointerUp = useCallback((e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragState) return;
    e.preventDefault();
    e.stopPropagation();
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (localRect) {
      onUpdate(localRect);
    }
    setDragState(null);
    setLocalRect(null);
  }, [dragState, localRect, onUpdate]);

  const borderColor = color === 'red' ? 'border-red-500' : color === 'blue' ? 'border-blue-500' : 'border-green-500';
  const bgColor = color === 'red' ? 'bg-red-500/10' : color === 'blue' ? 'bg-blue-500/10' : 'bg-green-500/10';
  const textColor = color === 'red' ? 'text-red-600' : color === 'blue' ? 'text-blue-600' : 'text-green-600';

  return (
    <div
      className={`absolute border-2 ${borderColor} ${bgColor} ${disabled ? 'pointer-events-none' : ''}`}
      style={{
        left: `${rect.x * 100}%`,
        top: `${rect.y * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`,
        opacity: 0.7,
        cursor: disabled ? 'default' : 'move',
        touchAction: 'none',
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
    >
      <span className={`absolute -top-4 left-0 text-[10px] ${textColor} bg-white/80 px-1 rounded pointer-events-none`}>
        {label}
      </span>
      {/* Resize handles at corners */}
      {!disabled && (
        <>
          <div className="absolute -top-1 -left-1 w-2.5 h-2.5 bg-white border border-gray-500 cursor-nwse-resize pointer-events-none" />
          <div className="absolute -top-1 -right-1 w-2.5 h-2.5 bg-white border border-gray-500 cursor-nesw-resize pointer-events-none" />
          <div className="absolute -bottom-1 -left-1 w-2.5 h-2.5 bg-white border border-gray-500 cursor-nesw-resize pointer-events-none" />
          <div className="absolute -bottom-1 -right-1 w-2.5 h-2.5 bg-white border border-gray-500 cursor-nwse-resize pointer-events-none" />
        </>
      )}
    </div>
  );
}
