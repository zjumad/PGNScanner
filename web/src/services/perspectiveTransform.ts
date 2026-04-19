/**
 * Pure-JS perspective transform: 4-corner homography + mesh-based canvas warp.
 * No OpenCV dependency — uses Gaussian elimination to solve the 8-coefficient
 * homography matrix, then renders via a subdivided quad mesh on Canvas 2D.
 */

export interface Point2D {
  x: number;
  y: number;
}

/**
 * Solve the 3×3 homography matrix H that maps src[i] → dst[i] for 4 point pairs.
 * Returns the 9 coefficients [h0..h8] where h8 = 1 (normalized).
 *
 * H maps (x,y) → (x',y') via:
 *   w = h6*x + h7*y + 1
 *   x' = (h0*x + h1*y + h2) / w
 *   y' = (h3*x + h4*y + h5) / w
 */
export function solveHomography(src: Point2D[], dst: Point2D[]): number[] {
  if (src.length !== 4 || dst.length !== 4) {
    throw new Error('Exactly 4 point pairs required');
  }

  // Build the 8×9 system: A * h = 0 (with h8 = 1, rearranged to A8×8 * h8 = b)
  const A: number[][] = [];
  const b: number[] = [];

  for (let i = 0; i < 4; i++) {
    const sx = src[i].x, sy = src[i].y;
    const dx = dst[i].x, dy = dst[i].y;

    A.push([sx, sy, 1, 0, 0, 0, -dx * sx, -dx * sy]);
    b.push(dx);

    A.push([0, 0, 0, sx, sy, 1, -dy * sx, -dy * sy]);
    b.push(dy);
  }

  const h = gaussianElimination(A, b);
  return [...h, 1]; // h0..h7 + h8=1
}

/**
 * Apply inverse homography to map a destination point back to source coordinates.
 */
export function applyHomographyInverse(
  H: number[],
  dx: number,
  dy: number
): Point2D {
  // H maps src→dst. We need the inverse: dst→src.
  // Invert the 3×3 matrix.
  const inv = invert3x3(H);
  const w = inv[6] * dx + inv[7] * dy + inv[8];
  return {
    x: (inv[0] * dx + inv[1] * dy + inv[2]) / w,
    y: (inv[3] * dx + inv[4] * dy + inv[5]) / w,
  };
}

/**
 * Warp an image using perspective transform with a mesh-based approach.
 * Subdivides the destination rectangle into a grid and draws each cell
 * using canvas affine approximations.
 *
 * @param srcImage - Source image (already loaded HTMLImageElement or ImageBitmap)
 * @param srcCorners - 4 corners in source image pixel coordinates [TL, TR, BR, BL]
 * @param dstWidth - Output width in pixels
 * @param dstHeight - Output height in pixels
 * @param meshSize - Grid subdivisions (default 20)
 * @returns Canvas with the warped image
 */
export function warpPerspective(
  srcImage: HTMLImageElement | ImageBitmap,
  srcCorners: Point2D[],
  dstWidth: number,
  dstHeight: number,
  meshSize = 20
): HTMLCanvasElement {
  // Map from destination rectangle corners to source corners
  const dstCorners: Point2D[] = [
    { x: 0, y: 0 },
    { x: dstWidth, y: 0 },
    { x: dstWidth, y: dstHeight },
    { x: 0, y: dstHeight },
  ];

  // H maps dst → src (inverse direction for sampling)
  const H = solveHomography(dstCorners, srcCorners);

  const canvas = document.createElement('canvas');
  canvas.width = dstWidth;
  canvas.height = dstHeight;
  const ctx = canvas.getContext('2d')!;

  const cellW = dstWidth / meshSize;
  const cellH = dstHeight / meshSize;

  for (let row = 0; row < meshSize; row++) {
    for (let col = 0; col < meshSize; col++) {
      const dx = col * cellW;
      const dy = row * cellH;
      const dw = cellW;
      const dh = cellH;

      const d0 = { x: dx, y: dy };
      const d1 = { x: dx + dw, y: dy };
      const d3 = { x: dx, y: dy + dh };

      // Map to source coordinates
      const s0 = applyHomography(H, d0.x, d0.y);
      const s1 = applyHomography(H, d1.x, d1.y);
      const s3 = applyHomography(H, d3.x, d3.y);

      drawAffineQuad(ctx, srcImage, s0, s1, s3, d0, d1, d3, dw, dh);
    }
  }

  return canvas;
}

/**
 * Compute the output dimensions from the source corner positions.
 * Uses the average of opposite edge lengths.
 */
export function computeOutputSize(corners: Point2D[]): { width: number; height: number } {
  const [tl, tr, br, bl] = corners;
  const topLen = dist(tl, tr);
  const bottomLen = dist(bl, br);
  const leftLen = dist(tl, bl);
  const rightLen = dist(tr, br);

  return {
    width: Math.round((topLen + bottomLen) / 2),
    height: Math.round((leftLen + rightLen) / 2),
  };
}

/**
 * Validate that 4 corners form a proper convex quadrilateral (not self-intersecting).
 * Corners must be in order: TL, TR, BR, BL.
 */
export function isValidQuad(corners: Point2D[]): boolean {
  if (corners.length !== 4) return false;

  // Check convexity via cross products — all should have the same sign
  let positiveCount = 0;
  let negativeCount = 0;
  for (let i = 0; i < 4; i++) {
    const a = corners[i];
    const b = corners[(i + 1) % 4];
    const c = corners[(i + 2) % 4];
    const cross = (b.x - a.x) * (c.y - b.y) - (b.y - a.y) * (c.x - b.x);
    if (cross > 0) positiveCount++;
    else if (cross < 0) negativeCount++;
  }
  // All cross products must have the same sign (convex quad)
  if (positiveCount > 0 && negativeCount > 0) return false;
  // At least some non-zero cross products (not degenerate/collinear)
  if (positiveCount === 0 && negativeCount === 0) return false;

  // Check minimum area (at least 1% of bounding box)
  const xs = corners.map(p => p.x);
  const ys = corners.map(p => p.y);
  const bboxArea = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const quadArea = Math.abs(shoelaceArea(corners));
  if (bboxArea > 0 && quadArea < bboxArea * 0.01) return false;

  return true;
}

// --- Internal helpers ---

function applyHomography(H: number[], x: number, y: number): Point2D {
  const w = H[6] * x + H[7] * y + H[8];
  return {
    x: (H[0] * x + H[1] * y + H[2]) / w,
    y: (H[3] * x + H[4] * y + H[5]) / w,
  };
}

function drawAffineQuad(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement | ImageBitmap,
  s0: Point2D, s1: Point2D, s3: Point2D,
  d0: Point2D, d1: Point2D, d3: Point2D,
  dw: number, dh: number
) {
  // We need an affine transform that maps:
  //   (0,0) → s0,  (dw,0) → s1,  (0,dh) → s3
  // in the source image, drawn into the destination at d0.

  // The affine matrix maps destination-local coords to source coords:
  //   sx = a*lx + c*ly + e
  //   sy = b*lx + d_*ly + f
  // where (lx, ly) are local coords (0..dw, 0..dh)
  const a = (s1.x - s0.x) / dw;
  const b = (s1.y - s0.y) / dw;
  const c = (s3.x - s0.x) / dh;
  const d_ = (s3.y - s0.y) / dh;
  const e = s0.x;
  const f = s0.y;

  // Canvas setTransform maps canvas coords to... we need the inverse.
  // We want: when we drawImage the entire source image, the canvas transform
  // maps destination-local coords to source coords.
  // Actually, canvas transform works differently: it maps user-space to device-space.
  // We need to set the transform so that drawing the source image at its natural
  // coordinates results in the correct region appearing at (d0.x, d0.y).

  // Simpler approach: use clip + inverse transform
  ctx.save();

  // Clip to destination quad
  ctx.beginPath();
  ctx.moveTo(d0.x, d0.y);
  ctx.lineTo(d1.x, d1.y);
  ctx.lineTo(d0.x + dw, d0.y + dh); // d2
  ctx.lineTo(d3.x, d3.y);
  ctx.closePath();
  ctx.clip();

  // We need: canvas setTransform such that drawing img at (0,0) puts
  // source pixel (e, f) at canvas pixel (d0.x, d0.y), with the affine stretch.
  // Canvas transform: [m11, m12, m21, m22, dx, dy]
  // canvas_x = m11 * src_x + m21 * src_y + dx
  // canvas_y = m12 * src_x + m22 * src_y + dy
  //
  // We want: src(e, f) → canvas(d0.x, d0.y)
  //          src(e + (s1.x-s0.x), f + (s1.y-s0.y)) → canvas(d1.x, d1.y)
  //
  // The forward affine from source→canvas is the inverse of canvas→source.
  // Local-to-source: S = [[a, c, e], [b, d_, f], [0, 0, 1]]
  // Local-to-canvas: C = [[dw-direction], translates to d0]
  // Actually local-to-canvas is just identity offset by d0 (local coords = canvas coords - d0)
  //
  // So source-to-canvas = local-to-canvas * inverse(local-to-source)

  // Inverse of 2x2 [a,c; b,d_]
  const det = a * d_ - b * c;
  if (Math.abs(det) < 1e-10) {
    ctx.restore();
    return;
  }
  const ia = d_ / det;
  const ib = -b / det;
  const ic = -c / det;
  const id = a / det;

  // source-to-local: lx = ia*(sx-e) + ic*(sy-f), ly = ib*(sx-e) + id*(sy-f)
  // local-to-canvas: cx = lx + d0.x, cy = ly + d0.y
  // So source-to-canvas:
  //   cx = ia*sx + ic*sy + (d0.x - ia*e - ic*f)
  //   cy = ib*sx + id*sy + (d0.y - ib*e - id*f)

  ctx.setTransform(
    ia, ib,
    ic, id,
    d0.x - ia * e - ic * f,
    d0.y - ib * e - id * f
  );

  ctx.drawImage(img, 0, 0);
  ctx.restore();
}

function gaussianElimination(A: number[][], b: number[]): number[] {
  const n = A.length;
  // Augmented matrix
  const M = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    // Partial pivoting
    let maxRow = col;
    let maxVal = Math.abs(M[col][col]);
    for (let row = col + 1; row < n; row++) {
      if (Math.abs(M[row][col]) > maxVal) {
        maxVal = Math.abs(M[row][col]);
        maxRow = row;
      }
    }
    [M[col], M[maxRow]] = [M[maxRow], M[col]];

    if (Math.abs(M[col][col]) < 1e-12) {
      throw new Error('Singular matrix in homography solve');
    }

    // Eliminate below
    for (let row = col + 1; row < n; row++) {
      const factor = M[row][col] / M[col][col];
      for (let j = col; j <= n; j++) {
        M[row][j] -= factor * M[col][j];
      }
    }
  }

  // Back substitution
  const x = new Array(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    x[i] = M[i][n];
    for (let j = i + 1; j < n; j++) {
      x[i] -= M[i][j] * x[j];
    }
    x[i] /= M[i][i];
  }
  return x;
}

function invert3x3(H: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = H;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  if (Math.abs(det) < 1e-12) throw new Error('Singular homography matrix');
  const invDet = 1 / det;
  return [
    (e * i - f * h) * invDet, (c * h - b * i) * invDet, (b * f - c * e) * invDet,
    (f * g - d * i) * invDet, (a * i - c * g) * invDet, (c * d - a * f) * invDet,
    (d * h - e * g) * invDet, (b * g - a * h) * invDet, (a * e - b * d) * invDet,
  ];
}

function dist(a: Point2D, b: Point2D): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function shoelaceArea(pts: Point2D[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    area += pts[i].x * pts[j].y;
    area -= pts[j].x * pts[i].y;
  }
  return area / 2;
}
