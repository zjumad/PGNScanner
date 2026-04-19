import React, { useRef, useEffect } from 'react';
import type { ValidatedMove } from '../types';

const ROWS_PER_COLUMN = 30;

interface MoveListProps {
  moves: ValidatedMove[];
  selectedIndex: number;
  onSelectMove: (index: number) => void;
  onInsertMove: (afterIndex: number, san: string) => void;
  onDeleteMove: (index: number) => void;
  insertLegalMoves: string[];
  onRequestInsert: (afterIndex: number) => void;
  insertingAfterIndex: number | null;
  onCancelInsert: () => void;
  onNavigateToError: (direction: 'next' | 'prev') => void;
  imageUrls?: string[];
  imagePageInfo?: {
    total: number;
    current: number;
    onPrev: () => void;
    onNext: () => void;
  };
  selectedMove?: ValidatedMove | null;
}

export default function MoveList({
  moves,
  selectedIndex,
  onSelectMove,
  onDeleteMove,
  onRequestInsert,
  insertingAfterIndex,
  onCancelInsert,
  onNavigateToError,
  imageUrls,
  imagePageInfo,
  selectedMove,
}: MoveListProps) {
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to center the selected move in the 3-move window
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [selectedIndex]);

  const hasImages = imageUrls && imageUrls.length > 0;

  // Get the cropped image background style for a given move pair row.
  // Uses bounding box data from OCR when available; falls back to heuristic.
  const getCropStyle = (bbox?: import('../types').CellBoundingBox, moveNumber?: number): React.CSSProperties | null => {
    if (!imageUrls || imageUrls.length === 0) return null;

    // Determine which image to use
    let url: string;
    if (imageUrls.length === 1) {
      url = imageUrls[0];
    } else {
      const pageIdx = moveNumber
        ? Math.min(Math.floor((moveNumber - 1) / ROWS_PER_COLUMN), imageUrls.length - 1)
        : 0;
      url = imageUrls[pageIdx];
    }

    // If we have bbox data, use it for precise cropping
    if (bbox) {
      let cropX = bbox.x;
      let cropW = bbox.width;
      // Use exact row Y boundaries for seamless tiling — no vertical padding
      const cropY = bbox.y;
      const cropH = bbox.height;

      // Add horizontal padding only (10% of width on each side)
      const padX = cropW * 0.1;
      cropX = Math.max(0, cropX - padX);
      cropW = Math.min(1 - cropX, cropW + 2 * padX);

      // Zoom so that the crop fills the container
      const zoomX = 1 / cropW;
      const zoomY = 1 / cropH;

      // CSS background-position % formula:
      //   posPercent = cropStart / (1 - 1/zoom)
      const posX = cropX > 0 ? Math.max(0, Math.min(100, (cropX / (1 - 1 / zoomX)) * 100)) : 0;
      const posY = cropY > 0 ? Math.max(0, Math.min(100, (cropY / (1 - 1 / zoomY)) * 100)) : 0;

      const style: React.CSSProperties = {
        backgroundImage: `url(${url})`,
        backgroundSize: `${zoomX * 100}% ${zoomY * 100}%`,
        backgroundPositionX: `${posX}%`,
        backgroundPositionY: `${posY}%`,
        backgroundRepeat: 'no-repeat',
      };
      return style;
    }

    // Fallback: heuristic positioning based on move number
    if (!moveNumber) return null;

    const GRID_TOP = 0.15;
    const GRID_HEIGHT = 0.75;
    const VERTICAL_ZOOM = 20;

    let adjustedMove: number;
    if (imageUrls.length === 1) {
      adjustedMove = moveNumber <= ROWS_PER_COLUMN ? moveNumber : moveNumber - ROWS_PER_COLUMN;
    } else {
      adjustedMove = ((moveNumber - 1) % ROWS_PER_COLUMN) + 1;
    }

    const targetCenter = GRID_TOP + ((adjustedMove - 0.5) / ROWS_PER_COLUMN) * GRID_HEIGHT;
    const posY = Math.max(0, Math.min(100,
      100 * (targetCenter * VERTICAL_ZOOM - 0.5) / (VERTICAL_ZOOM - 1)
    ));

    return {
      backgroundImage: `url(${url})`,
      backgroundSize: `100% ${VERTICAL_ZOOM * 100}%`,
      backgroundPositionX: 'center',
      backgroundPositionY: `${posY}%`,
      backgroundRepeat: 'no-repeat',
    };
  };

  const confidenceColor = (move: ValidatedMove) => {
    if (move.matchType === 'speculative') return 'bg-gray-100 text-gray-400 border-gray-200 border-dashed';
    if (!move.isValid) return 'bg-red-100 text-red-800 border-red-300';
    if (move.matchType === 'forced') return 'bg-orange-100 text-orange-800 border-orange-300';
    if (move.matchType === 'corrected') return 'bg-blue-50 text-blue-800 border-blue-200';
    switch (move.confidence) {
      case 'high':
        return 'bg-green-50 text-green-800 border-green-200';
      case 'medium':
        return 'bg-yellow-50 text-yellow-800 border-yellow-200';
      case 'low':
        return 'bg-red-50 text-red-800 border-red-200';
    }
  };

  const confidenceDot = (move: ValidatedMove) => {
    if (move.matchType === 'speculative') return 'bg-gray-400';
    if (!move.isValid) return 'bg-red-500';
    if (move.matchType === 'forced') return 'bg-orange-500';
    if (move.matchType === 'corrected') return 'bg-blue-500';
    switch (move.confidence) {
      case 'high':
        return 'bg-green-500';
      case 'medium':
        return 'bg-yellow-500';
      case 'low':
        return 'bg-red-500';
    }
  };

  // Group moves into pairs (white + black)
  const movePairs: { moveNumber: number; white?: { move: ValidatedMove; index: number }; black?: { move: ValidatedMove; index: number } }[] = [];
  for (let i = 0; i < moves.length; i++) {
    const m = moves[i];
    if (m.color === 'w') {
      movePairs.push({ moveNumber: m.moveNumber, white: { move: m, index: i } });
    } else {
      const last = movePairs[movePairs.length - 1];
      if (last && last.moveNumber === m.moveNumber) {
        last.black = { move: m, index: i };
      } else {
        movePairs.push({ moveNumber: m.moveNumber, black: { move: m, index: i } });
      }
    }
  }

  // Insert row render helper — just highlights the insert position; actual move selection
  // happens via the board or Legal Moves panel.
  const renderInsertButton = (afterIndex: number, label?: string) => {
    const isActive = insertingAfterIndex === afterIndex;
    if (isActive) {
      return (
        <div className="flex items-center gap-1">
          <span className="text-xs text-green-600 font-medium">← Insert here (use board or Legal Moves)</span>
          <button
            className="text-xs text-gray-400 hover:text-gray-600"
            onClick={(e) => { e.stopPropagation(); onCancelInsert(); }}
          >✕</button>
        </div>
      );
    }
    return (
      <button
        className="px-1 py-0 text-xs rounded transition-colors text-gray-300 hover:text-green-600 hover:bg-green-50"
        onClick={(e) => { e.stopPropagation(); onRequestInsert(afterIndex); }}
        title={label || `Insert move here`}
      >
        +
      </button>
    );
  };

  // Count moves by category for summary bar
  // Helper to render a move cell with insert/delete buttons
  const renderMoveCell = (side: { move: ValidatedMove; index: number }, isInsertingAfter: boolean) => (
    <>
      <div className="flex-1 min-w-0">
        <MoveCell
          move={side.move}
          index={side.index}
          isSelected={selectedIndex === side.index}
          confidenceColor={confidenceColor(side.move)}
          confidenceDot={confidenceDot(side.move)}
          onSelect={() => onSelectMove(side.index)}
          selectedRef={selectedIndex === side.index ? selectedRef : undefined}
        />
      </div>
      {!isInsertingAfter && (
        <button
          className="text-gray-300 hover:text-green-600 px-0.5 text-[10px] rounded transition-colors flex-shrink-0"
          onClick={(e) => { e.stopPropagation(); onRequestInsert(side.index); }}
          title="Insert after"
        >+</button>
      )}
      {selectedIndex === side.index && (
        <button
          className="text-gray-400 hover:text-red-500 text-[10px] flex-shrink-0"
          title="Delete"
          onClick={() => onDeleteMove(side.index)}
        >✕</button>
      )}
    </>
  );

  // Row height for 3-move display (each row ~40px, show 3 rows = 120px)
  const ROW_HEIGHT = 'min-h-[38px]';

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col">
      {/* Summary bar */}
      <div className="px-3 py-2 border-b border-gray-200 font-semibold text-gray-700 flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <span className="text-sm">Moves</span>
          <div className="flex items-center gap-1">
            <span className="text-[10px] text-gray-400">Jump to issue</span>
            <button onClick={() => onNavigateToError('prev')} className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-100 text-gray-500" title="Previous issue">▲</button>
            <button onClick={() => onNavigateToError('next')} className="px-1.5 py-0.5 text-xs rounded hover:bg-gray-100 text-gray-500" title="Next issue">▼</button>
          </div>
        </div>
        <div className="flex flex-wrap gap-3 text-[10px] text-gray-500 font-normal">
          {(() => {
            const counts = { exact: 0, fuzzy: 0, forced: 0, corrected: 0, invalid: 0, speculative: 0 };
            for (const m of moves) {
              if (m.matchType === 'speculative') counts.speculative++;
              else if (!m.isValid) counts.invalid++;
              else if (m.matchType === 'corrected') counts.corrected++;
              else if (m.matchType === 'forced') counts.forced++;
              else if (m.matchType === 'fuzzy') counts.fuzzy++;
              else counts.exact++;
            }
            return (
              <>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />Exact {counts.exact}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />Fuzzy {counts.fuzzy}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />Forced {counts.forced}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />Corrected {counts.corrected}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />Invalid {counts.invalid}</span>
                <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-gray-400 inline-block" />Speculative {counts.speculative}</span>
              </>
            );
          })()}
          <span className="text-gray-400 ml-auto">{moves.filter(m => m.isValid).length}/{moves.length}</span>
        </div>
      </div>

      {/* Column headers with image controls */}
      <div className="flex items-center bg-gray-50 border-b border-gray-200">
        <div style={{ width: hasImages ? '20%' : '50%' }} className="px-2 py-1 text-xs text-gray-500 font-medium">White</div>
        {hasImages && (
          <div style={{ width: '60%' }} className="flex-shrink-0 px-1 py-1 text-xs text-gray-500 font-medium border-x border-gray-200 flex items-center justify-between">
            <span>Sheet</span>
            <div className="flex items-center gap-0.5">
              {imagePageInfo && imagePageInfo.total > 1 && (
                <>
                  <button onClick={imagePageInfo.onPrev} disabled={imagePageInfo.current === 0} className="p-0.5 rounded hover:bg-gray-200 text-gray-500 text-[10px] disabled:opacity-30" title="Previous page">◀</button>
                  <span className="text-[9px] text-gray-400">{imagePageInfo.current + 1}/{imagePageInfo.total}</span>
                  <button onClick={imagePageInfo.onNext} disabled={imagePageInfo.current >= imagePageInfo.total - 1} className="p-0.5 rounded hover:bg-gray-200 text-gray-500 text-[10px] disabled:opacity-30" title="Next page">▶</button>
                </>
              )}
            </div>
          </div>
        )}
        <div style={{ width: hasImages ? '20%' : '50%' }} className="px-2 py-1 text-xs text-gray-500 font-medium">Black</div>
      </div>

      {/* Move position indicator */}
      {hasImages && selectedMove && (
        <div className="px-2 py-1 bg-blue-50 text-[10px] text-blue-700 border-b border-blue-200 flex items-center gap-2">
          <span className="font-medium">
            {selectedMove.moveNumber}.{selectedMove.color === 'w' ? 'White' : 'Black'} {selectedMove.san}
          </span>
          <span className="text-blue-400">
            — {selectedMove.moveNumber <= 30 ? `Left col, row ${selectedMove.moveNumber}` : `Right col, row ${selectedMove.moveNumber - 30}`}
          </span>
        </div>
      )}

      {/* Scrollable move rows — shows ~3 rounds at a time */}
      <div ref={listRef} className="overflow-y-auto" style={{ height: '120px' }}>
        {/* Insert before first move */}
        {moves.length > 0 && (
          <div className={`flex items-stretch border-b ${insertingAfterIndex === -1 ? 'border-green-200 bg-green-50' : 'border-gray-50'} ${ROW_HEIGHT}`}>
            <div style={{ width: hasImages ? '20%' : '50%' }} className="px-1 py-0.5 flex items-center">
              {renderInsertButton(-1, insertingAfterIndex === -1 ? undefined : 'Insert before first move')}
            </div>
            {hasImages && <div style={{ width: '60%' }} className="border-x border-gray-100" />}
            <div style={{ width: hasImages ? '20%' : '50%' }} />
          </div>
        )}

        {/* Move pair rows */}
        {movePairs.map((pair, pairIdx) => {
          const whiteIdx = pair.white?.index;
          const blackIdx = pair.black?.index;
          const isInsertAfterWhite = whiteIdx !== undefined && insertingAfterIndex === whiteIdx;
          const isInsertAfterBlack = blackIdx !== undefined && insertingAfterIndex === blackIdx;
          const isCurrentRow = selectedIndex === whiteIdx || selectedIndex === blackIdx;

          return (
            <React.Fragment key={`${pair.moveNumber}-${pairIdx}`}>
              {/* Main move row */}
              <div
                ref={isCurrentRow ? selectedRef : undefined}
                className={`flex items-stretch border-b border-gray-100 ${ROW_HEIGHT}`}
              >
                {/* White cell */}
                <div style={{ width: hasImages ? '20%' : '50%' }} className="min-w-0 flex items-center gap-0.5 px-1 py-0.5">
                  <span className="text-[11px] text-gray-400 w-5 flex-shrink-0 font-mono">{pair.moveNumber}.</span>
                  {pair.white ? renderMoveCell(pair.white, isInsertAfterWhite) : <div className="flex-1" />}
                </div>

                {/* Image crop cell */}
                {hasImages && (
                  <div
                    style={{ width: '60%', ...(getCropStyle(pair.white?.move.bbox ?? pair.black?.move.bbox, pair.moveNumber) || {}) }}
                    className="border-x border-gray-100"
                  />
                )}

                {/* Black cell */}
                <div style={{ width: hasImages ? '20%' : '50%' }} className="min-w-0 flex items-center gap-0.5 px-1 py-0.5">
                  {pair.black && !isInsertAfterWhite ? (
                    renderMoveCell(pair.black, isInsertAfterBlack)
                  ) : isInsertAfterWhite ? (
                    renderInsertButton(pair.white!.index)
                  ) : <div className="flex-1" />}
                </div>
              </div>

              {/* Displaced black indicator when inserting after white */}
              {isInsertAfterWhite && pair.black && (
                <div className={`flex items-stretch border-b border-gray-100 bg-gray-50 ${ROW_HEIGHT}`}>
                  <div style={{ width: hasImages ? '20%' : '50%' }} className="px-1 py-0.5 flex items-center">
                    <span className="text-xs text-gray-300 italic pl-5">↓</span>
                  </div>
                  {hasImages && <div style={{ width: '60%' }} className="border-x border-gray-100" />}
                  <div style={{ width: hasImages ? '20%' : '50%' }} className="px-1 py-0.5 flex items-center">
                    <span className="text-xs text-gray-400 italic">{pair.black.move.san} (shifts)</span>
                  </div>
                </div>
              )}

              {/* Insert after black */}
              {isInsertAfterBlack && (
                <div className={`flex items-stretch border-b border-green-200 bg-green-50 ${ROW_HEIGHT}`}>
                  <div style={{ width: hasImages ? '20%' : '50%' }} className="px-1 py-0.5" />
                  {hasImages && <div style={{ width: '60%' }} className="border-x border-gray-100" />}
                  <div style={{ width: hasImages ? '20%' : '50%' }} className="px-1 py-0.5 flex items-center">
                    {renderInsertButton(pair.black!.index)}
                  </div>
                </div>
              )}
            </React.Fragment>
          );
        })}

        {/* Append at end */}
        {moves.length > 0 && (
          <div className={`flex items-stretch border-b ${insertingAfterIndex === moves.length - 1 ? 'border-green-200 bg-green-50' : ''} ${ROW_HEIGHT}`}>
            <div style={{ width: hasImages ? '20%' : '50%' }} className="px-1 py-0.5 flex items-center">
              {renderInsertButton(moves.length - 1, insertingAfterIndex === moves.length - 1 ? undefined : 'Append move at end')}
            </div>
            {hasImages && <div style={{ width: '60%' }} className="border-x border-gray-100" />}
            <div style={{ width: hasImages ? '20%' : '50%' }} />
          </div>
        )}
      </div>
    </div>
  );
}

interface MoveCellProps {
  move: ValidatedMove;
  index: number;
  isSelected: boolean;
  confidenceColor: string;
  confidenceDot: string;
  onSelect: () => void;
  selectedRef?: React.Ref<HTMLDivElement>;
}

function MoveCell({
  move,
  isSelected,
  confidenceColor,
  confidenceDot,
  onSelect,
  selectedRef,
}: MoveCellProps) {
  return (
    <div
      ref={selectedRef}
      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-all border ${
        isSelected
          ? 'ring-2 ring-blue-500 border-blue-300 bg-blue-50'
          : confidenceColor
      } hover:opacity-80`}
      onClick={onSelect}
      title={
        move.matchType === 'forced'
          ? `⚠ Forced guess from OCR: "${move.rawOcr}"`
          : move.matchType === 'corrected'
            ? `✓ Manually corrected${move.rawOcr ? ` (OCR: "${move.rawOcr}")` : ''}`
            : move.rawOcr && move.rawOcr !== move.san
              ? `OCR: "${move.rawOcr}" → ${move.san}`
              : `Click to select`
      }
    >
      <span className={`w-2 h-2 rounded-full flex-shrink-0 ${confidenceDot}`} />
      <span className="font-mono text-sm font-medium">{move.san}</span>
      {move.rawOcr && move.rawOcr !== move.san && (
        <span className="text-[10px] text-gray-400 truncate" title={`OCR: ${move.rawOcr}`}>
          ← {move.rawOcr}
        </span>
      )}
    </div>
  );
}
