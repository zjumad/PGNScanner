/**
 * Client-side image preprocessing: EXIF orientation correction and multi-image merging.
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

  return canvasToProcessedImage(canvas);
}

/**
 * Merge multiple preprocessed images into a single image by stacking them
 * side by side (horizontally). All images are scaled to the same height.
 * The merged image is used for a single OCR call instead of multiple calls.
 */
export async function mergeImages(images: ProcessedImage[]): Promise<ProcessedImage> {
  if (images.length === 0) throw new Error('No images to merge');
  if (images.length === 1) return images[0];

  // Load all images as bitmaps
  const bitmaps: ImageBitmap[] = [];
  for (const img of images) {
    const blob = await fetch(img.url).then(r => r.blob());
    bitmaps.push(await createImageBitmap(blob));
  }

  // Use the max height as the target; scale widths proportionally
  const targetHeight = Math.max(...bitmaps.map(b => b.height));
  const scaledWidths = bitmaps.map(b => Math.round(b.width * (targetHeight / b.height)));
  const totalWidth = scaledWidths.reduce((sum, w) => sum + w, 0);

  const canvas = document.createElement('canvas');
  canvas.width = totalWidth;
  canvas.height = targetHeight;
  const ctx = canvas.getContext('2d')!;

  // Draw each image side by side
  let xOffset = 0;
  for (let i = 0; i < bitmaps.length; i++) {
    ctx.drawImage(bitmaps[i], xOffset, 0, scaledWidths[i], targetHeight);
    xOffset += scaledWidths[i];
    bitmaps[i].close();
  }

  return canvasToProcessedImage(canvas);
}

async function canvasToProcessedImage(canvas: HTMLCanvasElement): Promise<ProcessedImage> {
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
