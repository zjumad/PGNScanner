import { useState, useRef, useEffect } from 'react';
import type { ValidatedMove } from '../types';

interface MoveListProps {
  moves: ValidatedMove[];
  selectedIndex: number;
  onSelectMove: (index: number) => void;
  onCorrectMove: (index: number, newSan: string) => void;
}

export default function MoveList({
  moves,
  selectedIndex,
  onSelectMove,
  onCorrectMove,
}: MoveListProps) {
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [searchText, setSearchText] = useState('');
  const listRef = useRef<HTMLDivElement>(null);
  const selectedRef = useRef<HTMLDivElement>(null);

  // Scroll selected move into view
  useEffect(() => {
    selectedRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selectedIndex]);

  const confidenceColor = (move: ValidatedMove) => {
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

  // Filter legal alternatives by search text
  const filteredAlternatives = (move: ValidatedMove) => {
    if (!searchText) return move.legalAlternatives;
    return move.legalAlternatives.filter((m) =>
      m.toLowerCase().includes(searchText.toLowerCase())
    );
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

  return (
    <div className="bg-white rounded-lg border border-gray-200 shadow-sm flex flex-col h-full">
      <div className="px-4 py-3 border-b border-gray-200 font-semibold text-gray-700 flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span>Moves</span>
          <span className="text-xs text-gray-400 font-normal">
            {moves.filter((m) => m.isValid).length} / {moves.length} valid
          </span>
        </div>
        <div className="flex gap-3 text-[10px] text-gray-400 font-normal">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-500 inline-block" />exact</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-yellow-500 inline-block" />fuzzy</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-orange-500 inline-block" />guess</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-500 inline-block" />corrected</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-500 inline-block" />invalid</span>
        </div>
      </div>

      <div ref={listRef} className="overflow-y-auto flex-1 min-h-0">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-gray-50">
            <tr>
              <th className="px-2 py-1.5 text-left text-xs text-gray-500 w-10">#</th>
              <th className="px-2 py-1.5 text-left text-xs text-gray-500">White</th>
              <th className="px-2 py-1.5 text-left text-xs text-gray-500">Black</th>
            </tr>
          </thead>
          <tbody>
            {movePairs.map((pair) => (
              <tr key={pair.moveNumber} className="border-b border-gray-100">
                <td className="px-2 py-1 text-gray-400 font-mono text-xs">
                  {pair.moveNumber}.
                </td>
                <td className="px-1 py-1">
                  {pair.white && (
                    <MoveCell
                      move={pair.white.move}
                      index={pair.white.index}
                      isSelected={selectedIndex === pair.white.index}
                      isEditing={editingIndex === pair.white.index}
                      confidenceColor={confidenceColor(pair.white.move)}
                      confidenceDot={confidenceDot(pair.white.move)}
                      searchText={searchText}
                      filteredAlternatives={filteredAlternatives(pair.white.move)}
                      onSelect={() => onSelectMove(pair.white!.index)}
                      onStartEdit={() => {
                        setEditingIndex(pair.white!.index);
                        setSearchText('');
                      }}
                      onCorrect={(san) => {
                        onCorrectMove(pair.white!.index, san);
                        setEditingIndex(null);
                        setSearchText('');
                      }}
                      onCancelEdit={() => {
                        setEditingIndex(null);
                        setSearchText('');
                      }}
                      onSearchChange={setSearchText}
                      selectedRef={selectedIndex === pair.white.index ? selectedRef : undefined}
                    />
                  )}
                </td>
                <td className="px-1 py-1">
                  {pair.black && (
                    <MoveCell
                      move={pair.black.move}
                      index={pair.black.index}
                      isSelected={selectedIndex === pair.black.index}
                      isEditing={editingIndex === pair.black.index}
                      confidenceColor={confidenceColor(pair.black.move)}
                      confidenceDot={confidenceDot(pair.black.move)}
                      searchText={searchText}
                      filteredAlternatives={filteredAlternatives(pair.black.move)}
                      onSelect={() => onSelectMove(pair.black!.index)}
                      onStartEdit={() => {
                        setEditingIndex(pair.black!.index);
                        setSearchText('');
                      }}
                      onCorrect={(san) => {
                        onCorrectMove(pair.black!.index, san);
                        setEditingIndex(null);
                        setSearchText('');
                      }}
                      onCancelEdit={() => {
                        setEditingIndex(null);
                        setSearchText('');
                      }}
                      onSearchChange={setSearchText}
                      selectedRef={selectedIndex === pair.black.index ? selectedRef : undefined}
                    />
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface MoveCellProps {
  move: ValidatedMove;
  index: number;
  isSelected: boolean;
  isEditing: boolean;
  confidenceColor: string;
  confidenceDot: string;
  searchText: string;
  filteredAlternatives: string[];
  onSelect: () => void;
  onStartEdit: () => void;
  onCorrect: (san: string) => void;
  onCancelEdit: () => void;
  onSearchChange: (text: string) => void;
  selectedRef?: React.Ref<HTMLDivElement>;
}

function MoveCell({
  move,
  isSelected,
  isEditing,
  confidenceColor,
  confidenceDot,
  filteredAlternatives,
  onSelect,
  onStartEdit,
  onCorrect,
  onCancelEdit,
  onSearchChange,
  selectedRef,
}: MoveCellProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) {
      inputRef.current?.focus();
    }
  }, [isEditing]);

  if (isEditing) {
    return (
      <div ref={selectedRef} className="relative">
        <input
          ref={inputRef}
          type="text"
          defaultValue={move.san}
          placeholder="Type move..."
          className="w-full px-2 py-1 text-sm border-2 border-blue-500 rounded focus:outline-none font-mono"
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') onCancelEdit();
            if (e.key === 'Enter') {
              const val = (e.target as HTMLInputElement).value;
              if (move.legalAlternatives.includes(val)) {
                onCorrect(val);
              }
            }
          }}
        />
        <div className="absolute z-10 left-0 right-0 mt-1 bg-white border border-gray-200 rounded-md shadow-lg max-h-48 overflow-y-auto">
          {filteredAlternatives.map((alt) => (
            <button
              key={alt}
              className={`w-full text-left px-3 py-1.5 text-sm font-mono hover:bg-blue-50 ${
                alt === move.san ? 'bg-blue-50 font-bold' : ''
              }`}
              onClick={() => onCorrect(alt)}
            >
              {alt}
            </button>
          ))}
          {filteredAlternatives.length === 0 && (
            <div className="px-3 py-2 text-xs text-gray-400">No matching moves</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div
      ref={selectedRef}
      className={`flex items-center gap-1.5 px-2 py-1 rounded cursor-pointer transition-all border ${
        isSelected
          ? 'ring-2 ring-blue-500 border-blue-300 bg-blue-50'
          : confidenceColor
      } hover:opacity-80`}
      onClick={onSelect}
      onDoubleClick={onStartEdit}
      title={
        move.matchType === 'forced'
          ? `⚠ Forced guess from OCR: "${move.rawOcr}"`
          : move.matchType === 'corrected'
            ? `✓ Manually corrected${move.rawOcr ? ` (OCR: "${move.rawOcr}")` : ''}`
            : move.rawOcr && move.rawOcr !== move.san
              ? `OCR: "${move.rawOcr}" → ${move.san}`
              : `Click to select, double-click to edit`
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
