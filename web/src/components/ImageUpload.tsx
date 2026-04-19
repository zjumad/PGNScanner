import { useCallback, useState, useRef } from 'react';

interface ImageUploadProps {
  onImageSelected: (file: File) => void;
  isProcessing: boolean;
}

export default function ImageUpload({ onImageSelected, isProcessing }: ImageUploadProps) {
  const [preview, setPreview] = useState<string | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFile = useCallback(
    (file: File) => {
      if (!file.type.startsWith('image/')) return;
      const url = URL.createObjectURL(file);
      setPreview(url);
      onImageSelected(file);
    },
    [onImageSelected]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setDragOver(false);
      const file = e.dataTransfer.files[0];
      if (file) handleFile(file);
    },
    [handleFile]
  );

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-2xl mx-auto">
      <h2 className="text-2xl font-bold text-gray-800">Upload Score Sheet Photo</h2>
      <p className="text-gray-500 text-sm text-center">
        Take a photo of a US Chess Official Score Sheet or upload an existing image.
        The photo can be rotated — the system will auto-detect orientation.
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
        {preview ? (
          <img
            src={preview}
            alt="Score sheet preview"
            className="max-h-80 mx-auto rounded-lg shadow-md"
          />
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
              Drop image here or click to browse
            </p>
            <p className="text-gray-400 text-sm mt-1">
              Supports JPG, PNG, WEBP
            </p>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFile(file);
          }}
        />
      </div>

      {preview && !isProcessing && (
        <button
          onClick={() => {
            setPreview(null);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          className="text-sm text-gray-500 hover:text-gray-700 underline"
        >
          Choose a different image
        </button>
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
          <span className="font-medium">Recognizing moves...</span>
        </div>
      )}
    </div>
  );
}
