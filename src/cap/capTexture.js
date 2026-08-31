import { ClampToEdgeWrapping } from 'three';
import { makeCanvasTexture } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';

/**
 * Placeholder artwork for the panel — the slot a player's own picture drops into
 * later. Drawn at 128, the largest texture this project allows.
 *
 * Deliberately near-greyscale. The panel material multiplies this by the cap
 * colour, so a neutral placeholder retints with the rest of the cap and the
 * whole thing still reads as one painted piece of metal. A player's own artwork
 * will be full colour and will set that material's colour to white instead.
 *
 * The single long spoke at 12 o'clock is an orientation mark. It is the only way
 * to see, while dragging, that the panel UVs are not spinning independently of
 * the mesh — and it is what the affine warp visibly bends as the cap tips away.
 */
export function makeCapTopTexture() {
  /**
   * 512. 드로잉 코드는 이미 전부 `size` 비율이라 숫자만 올리면 된다 — 이 파일이
   * 처음부터 정규화되어 있었기 때문이고, 나머지 텍스처들이 PHASE 4 에서 하게 된
   * 작업을 이미 해 둔 셈이다.
   */
  return makeCanvasTexture(512, drawCapTop, {
    // The panel's UVs cover exactly [0, 1] and nothing samples outside it, but
    // clamping means a rounding error at the rim cannot wrap round to the far
    // edge of the image.
    wrapS: ClampToEdgeWrapping,
    wrapT: ClampToEdgeWrapping,
  });
}

const PANEL = PALETTE.metal.panel;

function drawCapTop(ctx, size) {
  const c = size * 0.5;

  ctx.fillStyle = PANEL.base;
  ctx.fillRect(0, 0, size, size);

  // The panel is the inscribed circle of this square; the corners are never
  // sampled, so everything below stays inside it.
  ctx.strokeStyle = PANEL.ringOuter;
  ctx.lineWidth = size * 0.035;
  ring(ctx, c, size * 0.44);

  ctx.strokeStyle = PANEL.ringInner;
  ctx.lineWidth = size * 0.016;
  ring(ctx, c, size * 0.365);

  ctx.fillStyle = PANEL.hub;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.2, 0, Math.PI * 2);
  ctx.fill();

  // Spokes. Chunky, because at 128 texels seen across maybe 90 screen pixels
  // anything finer than this is a grey smudge once the quantiser has been at it.
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 - Math.PI / 2;
    const isMark = i === 0;
    spoke(
      ctx,
      c,
      a,
      size * 0.2,
      size * (isMark ? 0.415 : 0.335),
      size * 0.05,
      isMark ? PANEL.spokeMark : PANEL.spoke,
    );
  }

  ctx.fillStyle = PANEL.spokeMark;
  ctx.beginPath();
  ctx.arc(c, c, size * 0.075, 0, Math.PI * 2);
  ctx.fill();
}

function ring(ctx, c, r) {
  ctx.beginPath();
  ctx.arc(c, c, r, 0, Math.PI * 2);
  ctx.stroke();
}

function spoke(ctx, c, angle, r0, r1, width, color) {
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(angle);
  ctx.fillStyle = color;
  ctx.fillRect(r0, -width * 0.5, r1 - r0, width);
  ctx.restore();
}
