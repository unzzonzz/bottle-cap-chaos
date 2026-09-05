import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';

/**
 * The score tag that hangs off a candidate trajectory.
 *
 * ── a tuning instrument, drawn to the game's rules anyway ──────────────────
 * It only ever appears behind the panel's switch, so it could reasonably be a
 * scruffy label. It is not, for one specific reason: it is read AGAINST the
 * board at 320x240, over lines that cross each other, and a soft-edged number
 * there is unreadable — which would make the visualisation that exists to
 * explain the AI the one thing on screen you cannot make out.
 *
 * So it goes through the same alpha threshold and the same nearest-neighbour
 * filtering every other piece of type in the project does. The threshold is
 * `hudTextures`'; it is repeated rather than imported because this is a WORLD
 * sprite and importing the HUD's module would tie a debug overlay to the cache
 * that `clearHudTextureCache` empties on a texture-scale change.
 *
 * ── sized to its content, like `notePlateTexture` ──────────────────────────
 * `userData` carries the frame dimensions back so the caller can scale the
 * sprite to match. Scaling it to anything else resamples the type and undoes
 * the thresholding.
 */

const HEIGHT = 16;

/**
 * Matches `AiCandidateView.RANK_COLORS`, as text rather than as line colour.
 *
 * It used to be a separate, lighter set of five: the tag sat on a near-black
 * plate and the LINE colours would have been too dark to read on it. The plate
 * is a light one now, so the tag can use the rank colours themselves and the two
 * halves of the overlay can no longer drift apart.
 */
const RANK_TEXT = PALETTE.debug.rank;

const cache = new Map();

export function scoreTagTexture(score, intent, rank) {
  // Rounded before it is keyed: a score moving by a hundredth is the same label
  // and must not be a cache miss on every turn.
  const shown = Math.round(score);
  const key = `${shown}:${intent}:${rank}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const text = `${shown}  ${intent}`;
  const probe = document.createElement('canvas').getContext('2d');
  const font = '11px ui-monospace, Menlo, monospace';
  probe.font = font;
  const width = Math.ceil(probe.measureText(text).width) + 10;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  const color = RANK_TEXT[Math.min(rank, RANK_TEXT.length - 1)];
  ctx.fillStyle = withAlpha(PALETTE.ui.surface, 0.85);
  ctx.fillRect(0, 0, width, HEIGHT);
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 2, HEIGHT);

  // 바로 그린다. 스크래치 캔버스에 그려 알파를 잘라 blit 하던 것을 없앴다 —
  // 그 임계 처리가 막으려던 디더와 양자화가 파이프라인에 없다.
  ctx.font = font;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  ctx.fillText(text, 6, HEIGHT - 4);

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData = { width, height: HEIGHT };

  /**
   * Bounded, unlike the HUD's caches.
   *
   * Those are keyed on things that change a handful of times a match — a score,
   * a turn number. This is keyed on an arbitrary float and an intent string, so
   * a long match generates a new entry on most turns and nothing would ever
   * evict them. A flat cap with a wholesale clear is enough for a debug overlay
   * and cannot leak.
   */
  if (cache.size > 240) {
    for (const t of cache.values()) t.dispose();
    cache.clear();
  }
  cache.set(key, tex);
  return tex;
}
