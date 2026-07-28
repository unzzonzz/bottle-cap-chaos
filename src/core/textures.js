import { CanvasTexture, NearestFilter, RepeatWrapping } from 'three';

/**
 * The console's texture cache was 128x128 pages, and nothing in this project is
 * allowed to be bigger than one. Enforced here rather than left to each caller,
 * because a single 256px texture is enough to make everything else on screen
 * look wrong by comparison.
 */
export const MAX_TEXTURE = 128;

/**
 * Every texture in this project is drawn at runtime with the canvas 2D API —
 * there are no image files anywhere. This wrapper enforces the settings the
 * retro look depends on: point sampling, no mipmaps, and no smoothing inside the
 * 2D context either.
 *
 * @param {number} size  square edge in texels, clamped to MAX_TEXTURE
 * @param {(ctx: CanvasRenderingContext2D, size: number) => void} draw
 */
export function makeCanvasTexture(size, draw, options = {}) {
  const edge = Math.max(8, Math.min(MAX_TEXTURE, Math.round(size)));

  const canvas = document.createElement('canvas');
  canvas.width = edge;
  canvas.height = edge;

  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  draw(ctx, edge);

  const texture = new CanvasTexture(canvas);
  texture.magFilter = NearestFilter;
  texture.minFilter = NearestFilter; // mipmaps would reintroduce filtering
  texture.generateMipmaps = false;
  texture.wrapS = options.wrapS ?? RepeatWrapping;
  texture.wrapT = options.wrapT ?? RepeatWrapping;
  texture.anisotropy = 1;
  texture.needsUpdate = true;

  return texture;
}
