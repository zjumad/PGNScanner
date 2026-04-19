import type { Point2D } from './perspectiveTransform';
import { warpPerspective, computeOutputSize } from './perspectiveTransform';

/**
 * Client-side image preprocessing: EXIF orientation correction, perspective
 * correction, and multi-image merging.
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

/**
 * Apply perspective warp to a preprocessed image using 4 corner points.
 * Corners are in normalized [0,1] coordinates, ordered: TL, TR, BR, BL.
 * If corners are at the full image edges (identity), returns the original image.
 */
export async function applyPerspectiveWarp(
  image: ProcessedImage,
  corners: Point2D[]
): Promise<ProcessedImage> {
  // Check if corners are identity (no correction needed)
  const identity = [
    { x: 0, y: 0 },
    { x: 1, y: 0 },
    { x: 1, y: 1 },
    { x: 0, y: 1 },
  ];
  const isIdentity = corners.every(
    (c, i) => Math.abs(c.x - identity[i].x) < 0.001 && Math.abs(c.y - identity[i].y) < 0.001
  );
  if (isIdentity) return image;

  // Load the image as a bitmap
  const blob = await fetch(image.url).then((r) => r.blob());
  const bitmap = await createImageBitmap(blob);

  // Convert normalized corners to pixel coordinates
  const pixelCorners: Point2D[] = corners.map((c) => ({
    x: c.x * bitmap.width,
    y: c.y * bitmap.height,
  }));

  // Compute output dimensions from the corner positions
  const { width, height } = computeOutputSize(pixelCorners);

  // Cap max dimension to avoid memory issues on mobile
  const MAX_DIM = 4096;
  const scale = Math.min(1, MAX_DIM / Math.max(width, height));
  const outW = Math.round(width * scale);
  const outH = Math.round(height * scale);

  const canvas = warpPerspective(bitmap, pixelCorners, outW, outH);
  bitmap.close();

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
