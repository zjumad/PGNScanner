import { useCallback, useState, useRef } from 'react';
import { MODEL_OPTIONS } from '../services/visionApi';
import type { ModelId } from '../services/visionApi';

interface ImageUploadProps {
  onImagesSelected: (files: File[], modelId: ModelId) => void;
  isProcessing: boolean;
  processingStatus?: string;
}

export default function ImageUpload({ onImagesSelected, isProcessing, processingStatus }: ImageUploadProps) {
  const [previews, setPreviews] = useState<string[]>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [modelId, setModelId] = useState<ModelId>(() => {
    return (localStorage.getItem('pgn_scanner_model') as ModelId) || 'gemini-2.5-flash';
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(
    (newFiles: File[]) => {
      const imageFiles = newFiles.filter((f) => f.type.startsWith('image/'));
      if (imageFiles.length === 0) return;
      const urls = imageFiles.map((f) => URL.createObjectURL(f));
      setFiles((prev) => [...prev, ...imageFiles]);
      setPreviews((prev) => [...prev, ...urls]);
    },
    []
  );

  const removeFile = useCallback((index: number) => {
    setPreviews((prev) => {
      URL.revokeObjectURL(prev[index]);
      return prev.filter((_, i) => i !== index);
    });
    setFiles((prev) => prev.filter((_, i) => i !== index));
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      addFiles([...e.dataTransfer.files]);
    },
    [addFiles]
  );

  const handleSubmit = useCallback(() => {
    if (files.length > 0) onImagesSelected(files, modelId);
  }, [files, onImagesSelected, modelId]);

  return (
    <div className="flex flex-col items-center gap-4 sm:gap-6 w-full max-w-2xl mx-auto px-2">
      <h2 className="text-xl sm:text-2xl font-bold text-gray-800">Upload Score Sheet Photo</h2>
      <p className="text-gray-500 text-xs sm:text-sm text-center">
        Take a photo of a US Chess Official Score Sheet or upload an existing image.
        {' '}For 2-sided sheets, add both pages.
      </p>

      {/* Drop zone */}
      <div
        className={`w-full border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-colors ${
          dragOver
            ? 'border-blue-500 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
        } ${isProcessing ? 'opacity-50 pointer-events-none' : ''}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragOver(true);
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        {previews.length > 0 ? (
          <div className="flex gap-3 justify-center flex-wrap">
            {previews.map((url, i) => (
              <div key={i} className="relative">
                <img
                  src={url}
                  alt={`Page ${i + 1}`}
                  className="max-h-60 rounded-lg shadow-md"
                />
                {!isProcessing && (
                  <button
                    onClick={(e) => { e.stopPropagation(); removeFile(i); }}
                    className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full text-xs flex items-center justify-center hover:bg-red-600 shadow"
                  >
                    ✕
                  </button>
                )}
                <span className="absolute bottom-1 left-1 bg-black/60 text-white text-[10px] px-1.5 py-0.5 rounded">
                  Page {i + 1}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="py-8">
            <svg
              className="w-12 h-12 mx-auto mb-4 text-gray-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5"
              />
            </svg>
            <p className="text-gray-600 font-medium">
              Drop image(s) here or click to browse
            </p>
            <p className="text-gray-400 text-sm mt-1">
              Supports JPG, PNG, WEBP — multiple pages supported
            </p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => {
            const selected = e.target.files;
            if (selected && selected.length > 0) addFiles([...selected]);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
        />
      </div>

      {previews.length > 0 && !isProcessing && (
        <div className="flex flex-col gap-3 items-center w-full max-w-xs">
          {/* Model selector */}
          <div className="flex items-center gap-2 w-full">
            <label className="text-xs text-gray-500 font-medium whitespace-nowrap">Model:</label>
            <select
              value={modelId}
              onChange={(e) => {
                const m = e.target.value as ModelId;
                setModelId(m);
                localStorage.setItem('pgn_scanner_model', m);
              }}
              className="flex-1 text-sm border border-gray-300 rounded-lg px-2 py-1.5 bg-white focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {MODEL_OPTIONS.map((opt) => (
                <option key={opt.id} value={opt.id}>{opt.label}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 items-center">
            <button
              onClick={handleSubmit}
              className="px-6 py-2.5 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 transition-colors shadow-md text-sm"
            >
              Scan {files.length === 1 ? 'Image' : `${files.length} Images`}
            </button>
            <button
              onClick={() => {
                previews.forEach((url) => URL.revokeObjectURL(url));
                setPreviews([]);
                setFiles([]);
              }}
              className="text-sm text-gray-500 hover:text-gray-700 underline"
            >
              Clear all
            </button>
          </div>
        </div>
      )}

      {isProcessing && (
        <div className="flex items-center gap-3 text-blue-600">
          <svg
            className="animate-spin h-5 w-5"
            viewBox="0 0 24 24"
            fill="none"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
            />
          </svg>
          <span className="font-medium">{processingStatus || 'Recognizing moves...'}</span>
        </div>
      )}
    </div>
  );
}
