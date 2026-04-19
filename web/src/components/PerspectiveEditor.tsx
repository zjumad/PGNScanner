import { useState, useRef, useCallback, useEffect } from 'react';
import type { Point2D } from '../services/perspectiveTransform';
import { isValidQuad } from '../services/perspectiveTransform';
import type { ProcessedImage } from '../services/imagePreprocess';

interface PerspectiveEditorProps {
  /** EXIF-corrected images to edit */
  images: ProcessedImage[];
  /** Called when user confirms corners and wants to proceed */
  onApply: (cornersPerImage: Point2D[][]) => void;
  /** Called when user wants to skip perspective correction */
  onSkip: () => void;
  isProcessing: boolean;
}

/**
 * Interactive 4-corner perspective correction editor.
 * Shows each uploaded image with draggable corner handles.
 * Corners are in normalized [0,1] coordinates, ordered: TL, TR, BR, BL.
 */
export default function PerspectiveEditor({
  images,
  onApply,
  onSkip,
  isProcessing,
}: PerspectiveEditorProps) {
  const [pageIndex, setPageIndex] = useState(0);
  // Per-image corners: default to full image edges (identity = no warp)
  const [allCorners, setAllCorners] = useState<Point2D[][]>(() =>
    images.map(() => [
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
    ])
  );
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);

  const imgRef = useRef<HTMLImageElement>(null);

  const corners = allCorners[pageIndex];
  const currentImage = images[pageIndex];

  const valid = isValidQuad(
    corners.map((c) => ({ x: c.x * 1000, y: c.y * 1000 }))
  );

  // Check if any image has been adjusted from default
  const hasAnyAdjustment = allCorners.some((imgCorners) =>
    imgCorners.some(
      (c, i) => {
        const defaults = [
          { x: 0, y: 0 },
          { x: 1, y: 0 },
          { x: 1, y: 1 },
          { x: 0, y: 1 },
        ];
        return Math.abs(c.x - defaults[i].x) > 0.001 || Math.abs(c.y - defaults[i].y) > 0.001;
      }
    )
  );

  const getImageRect = useCallback(() => {
    if (!imgRef.current) return null;
    return imgRef.current.getBoundingClientRect();
  }, []);

  const normalizedFromEvent = useCallback(
    (clientX: number, clientY: number): Point2D | null => {
      const rect = getImageRect();
      if (!rect) return null;
      return {
        x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
        y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
      };
    },
    [getImageRect]
  );

  const handlePointerDown = useCallback(
    (index: number) => (e: React.PointerEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setDraggingIndex(index);
      (e.target as HTMLElement).setPointerCapture(e.pointerId);
    },
    []
  );

  const handlePointerMove = useCallback(
    (e: React.PointerEvent) => {
      if (draggingIndex === null) return;
      const pt = normalizedFromEvent(e.clientX, e.clientY);
      if (!pt) return;
      setAllCorners((prev) => {
        const updated = [...prev];
        const corners = [...updated[pageIndex]];
        corners[draggingIndex] = pt;
        updated[pageIndex] = corners;
        return updated;
      });
    },
    [draggingIndex, normalizedFromEvent, pageIndex]
  );

  const handlePointerUp = useCallback(() => {
    setDraggingIndex(null);
  }, []);

  // Reset corners for current page
  const handleReset = useCallback(() => {
    setAllCorners((prev) => {
      const updated = [...prev];
      updated[pageIndex] = [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ];
      return updated;
    });
  }, [pageIndex]);

  // Keyboard shortcut: Escape to skip
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onSkip();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onSkip]);

  const cornerLabels = ['TL', 'TR', 'BR', 'BL'];
  const cornerColors = ['#ef4444', '#3b82f6', '#22c55e', '#f59e0b'];

  return (
    <div className="flex flex-col items-center gap-4 w-full max-w-2xl mx-auto px-2">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800">
        Adjust Perspective
      </h2>
      <p className="text-gray-500 text-xs sm:text-sm text-center">
        Drag the corner handles to match the score sheet edges, then click Apply &amp; Scan.
        {' '}Skip if the sheet is already flat.
      </p>

      {/* Page navigation for multi-image */}
      {images.length > 1 && (
        <div className="flex items-center gap-3 text-sm">
          <button
            disabled={pageIndex === 0}
            onClick={() => setPageIndex((i) => i - 1)}
            className="px-2 py-1 border rounded disabled:opacity-30"
          >
            ◀
          </button>
          <span className="text-gray-600">
            Page {pageIndex + 1} of {images.length}
          </span>
          <button
            disabled={pageIndex === images.length - 1}
            onClick={() => setPageIndex((i) => i + 1)}
            className="px-2 py-1 border rounded disabled:opacity-30"
          >
            ▶
          </button>
        </div>
      )}

      {/* Image + corner overlay */}
      <div
        className="relative w-full select-none touch-none"
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
      >
        <img
          ref={imgRef}
          src={currentImage.url}
          alt={`Page ${pageIndex + 1}`}
          className="w-full rounded-lg shadow-md"
          draggable={false}
        />

        {/* Quadrilateral overlay (lines) */}
        <svg
          className="absolute inset-0 w-full h-full pointer-events-none"
          viewBox="0 0 1 1"
          preserveAspectRatio="none"
        >
          <polygon
            points={corners.map((c) => `${c.x},${c.y}`).join(' ')}
            fill="rgba(59, 130, 246, 0.08)"
            stroke={valid ? '#3b82f6' : '#ef4444'}
            strokeWidth="0.003"
            vectorEffect="non-scaling-stroke"
          />
        </svg>

        {/* Draggable corner handles */}
        {corners.map((corner, i) => {
          const left = corner.x * 100;
          const top = corner.y * 100;
          return (
            <div
              key={i}
              onPointerDown={handlePointerDown(i)}
              className="absolute w-7 h-7 -ml-3.5 -mt-3.5 rounded-full border-2 border-white shadow-lg cursor-grab active:cursor-grabbing flex items-center justify-center text-[9px] font-bold text-white"
              style={{
                left: `${left}%`,
                top: `${top}%`,
                backgroundColor: cornerColors[i],
                zIndex: draggingIndex === i ? 20 : 10,
              }}
            >
              {cornerLabels[i]}
            </div>
          );
        })}
      </div>

      {/* Validation warning */}
      {!valid && (
        <p className="text-red-500 text-xs">
          ⚠ Corners form an invalid shape. Drag them to form a proper quadrilateral.
        </p>
      )}

      {/* Action buttons */}
      <div className="flex flex-wrap gap-3 items-center justify-center">
        <button
          onClick={() => onApply(allCorners)}
          disabled={!valid || isProcessing}
          className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-md text-sm disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {hasAnyAdjustment ? 'Apply & Scan' : 'Scan'}
        </button>
        <button
          onClick={onSkip}
          disabled={isProcessing}
          className="px-4 py-2.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
        >
          Skip correction
        </button>
        <button
          onClick={handleReset}
          disabled={isProcessing}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Reset corners
        </button>
      </div>

      {isProcessing && (
        <div className="flex items-center gap-3 text-blue-600">
          <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="font-medium">Processing...</span>
        </div>
      )}
    </div>
  );
}
