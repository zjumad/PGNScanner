/**
 * Client-side image preprocessing: EXIF orientation correction.
 * Uses createImageBitmap with imageOrientation: 'from-image' to auto-correct
 * rotation from EXIF metadata, then re-encodes as JPEG for consistent output.
 */

export interface ProcessedImage {
  /** Base64-encoded JPEG data (no data URL prefix) */
  base64: string;
  /** Object URL for UI display — caller must revoke when done */
  url: string;
  /** Always 'image/jpeg' */
  mimeType: string;
}

/**
 * Correct EXIF orientation and normalize to JPEG.
 * The output image is always upright regardless of how the photo was taken.
 */
export async function correctImageOrientation(file: File): Promise<ProcessedImage> {
  const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const canvas = document.createElement('canvas');
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(bitmap, 0, 0);
  bitmap.close();

  // Encode as JPEG blob for consistent format and smaller size
  const blob = await new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Canvas toBlob failed'))),
      'image/jpeg',
      0.92
    );
  });

  const base64 = await blobToBase64(blob);
  const url = URL.createObjectURL(blob);

  return { base64, url, mimeType: 'image/jpeg' };
}

function blobToBase64(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      resolve(result.split(',')[1]);
    };
    reader.onerror = reject;
    reader.readAsDataURL(blob);
  });
}
