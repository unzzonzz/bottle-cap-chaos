import { makeCanvasTexture } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';

/**
 * Turf, drawn rather than loaded — the same argument the board's weave makes.
 *
 * A flat green field under per-vertex Gouraud has no shading variation anywhere
 * on it, so a ball crossing it has nothing to cross: no texture flow, no scale
 * reference, nothing for the eye to measure speed against. On a pitch two and a
 * half times the width of the knockout board that matters more, not less,
 * because a ball travelling the same speed covers a smaller fraction of what is
 * on screen and looks slower for it.
 *
 * ── the grain is here, the stripes are not ───────────────────────────────────
 * Mown stripes belong to the PITCH, not to the texture: they are a fixed number
 * of bands across a fixed length, so baking them into a tile that repeats every
 * ten units would put a seam wherever the tile edge fell and change the band
 * count whenever the pitch was resized. `PitchView` cuts the surface into bands
 * of geometry and gives alternate ones a slightly different tint, which is the
 * same trick a groundsman uses and survives any pitch length.
 *
 * So this texture is only the grain: fine, near-monochrome, and low contrast on
 * purpose. It has to read as grass under a 5-bit quantiser without competing
 * with the white lines drawn on top of it, which are the things the player is
 * actually reading the pitch by.
 */

/**
 * World units (cm) covered by one repeat. This number is a MEASUREMENT.
 *
 * There are no mipmaps in this pipeline, so a texture minified past one texel
 * per screen pixel does not soften — it picks one texel out of however many fell
 * inside that pixel, and which one it picks changes as the camera moves by a
 * fraction of a pixel. That is not a static artefact, it crawls, and a
 * ground-plane-sized field of it swims under any camera movement at all.
 *
 * So the tile is sized so that the widest view lands at about 1:1. Measured on
 * the 640x480 target with the pitch standing up and framed by its bounding
 * circle, the ground runs about 3.0 screen pixels per world unit; a 128-texel
 * tile therefore wants to span about 128/3.0 ≈ 36 units.
 *
 * It was 12, carried over from the board — which is a third of the size, seen
 * from a third of the distance, and worked out at 1.07 texels per pixel. On the
 * pitch the same number came to 2.9 and the whole field shimmered. Changing the
 * pitch's size or the render resolution a long way from the defaults is the
 * thing that would make this need re-measuring.
 */
export const TURF_TILE = 36;

const BASE = PALETTE.pitch.grassA;
const BLADE_A = PALETTE.pitch.grassB;
const BLADE_B = PALETTE.pitch.grassC;
const DRY = PALETTE.pitch.grassDry;

/**
 * 텍셀 한 변.
 *
 * 128 이었다. 그때는 파이프라인에 밉맵이 없어서 1텍셀:1픽셀 근처를 맞추는 게
 * 전부였고, `TURF_TILE` 이 그 계산의 결과다. 이제 밉맵과 이방성이 있으므로
 * 축소는 필터가 처리하고, 해상도는 "가까이서 볼 때 잔디가 잔디로 보이는가"만
 * 결정한다.
 */
const SIZE = 512;

export function makeTurfTexture() {
  return makeCanvasTexture(SIZE, drawTurf);
}

function drawTurf(ctx, size) {
  ctx.fillStyle = BASE;
  ctx.fillRect(0, 0, size, size);

  // Tufts, two texels wide, at scattered positions. Taller than they are wide,
  // because that asymmetry is most of what separates grass from noise.
  //
  // The width is the point and it used to be one texel. A one-texel feature has
  // energy at exactly the frequency the sampler cannot represent, so even at a
  // clean 1:1 it sparkles the moment anything moves — the tile size stops the
  // texture being minified, and this stops what is left of it from twinkling in
  // place. Fewer of them too: at two texels each, 900 covered most of the tile
  // and the tones averaged out into a flat wash.
  /**
   * 잎의 크기와 개수는 해상도에 비례한다.
   *
   * 예전엔 "폭 2텍셀, 320개"였다. 128 에서 2텍셀은 36cm 타일에서 5.6mm — 잔디
   * 잎의 두께로 맞는 값이다. 상한만 1024 로 올리고 2텍셀을 그대로 두면 0.7mm
   * 짜리 실오라기가 되어 잔디가 아니라 카펫 보풀이 된다. 그래서 폭도 개수도
   * `k` 로 비례시킨다 — 같은 물리 크기의 잎이 면적에 비례해 더 많이 깔린다.
   */
  const k = size / 128;

  /**
   * 잎은 더 가늘고 더 많고 더 흐리다.
   *
   * 예전 값을 그대로 비례시켰더니 화면에서 4픽셀짜리 블록이 됐다. 물리 크기는
   * 이전과 같았지만 — nearest 로 축소되며 모아레에 묻혀 있던 것이 필터링이
   * 제대로 되면서 또렷해졌을 뿐이다 — 또렷해지고 나니 잔디가 아니라 모자이크로
   * 보였다. 필터가 좋아지면 없던 문제가 보이는 게 아니라, 있던 문제가 드러난다.
   *
   * 폭을 절반으로 줄이고 개수를 네 배로 늘렸다. 알파를 넣은 건 텍스처가 무늬가
   * 아니라 질감이어야 하기 때문이다 — 잔디의 색 단계는 `BAND_TINT` 의 깎은
   * 줄무늬가 맡고, 이 파일은 그 위의 미세한 결만 담당한다.
   */
  const blades = Math.round(1280 * k * k);
  const w = Math.max(1, Math.round(k));
  ctx.globalAlpha = 0.5;
  for (let i = 0; i < blades; i++) {
    const h = hash2(i, 11);
    const x = h % size;
    const y = Math.floor(h / size) % size;
    const len = Math.max(1, Math.round((2 + ((h >>> 9) % 3)) * k * 0.7));
    ctx.fillStyle = (h >>> 3) & 1 ? BLADE_A : BLADE_B;
    ctx.fillRect(x, y, w, len);
  }
  ctx.globalAlpha = 1;

  // A handful of drier patches, to break up the regularity at a scale the eye
  // picks up before it picks up individual tufts.
  // 마른 자국. 잎보다 더 흐리다 — 이건 눈에 띄면 얼룩이지 잔디가 아니다.
  const patches = Math.round(60 * k * k);
  ctx.globalAlpha = 0.25;
  for (let i = 0; i < patches; i++) {
    const h = hash2(i, 29);
    ctx.fillStyle = DRY;
    ctx.fillRect(
      h % size,
      Math.floor(h / size) % size,
      Math.round((4 + ((h >>> 7) % 4)) * k),
      Math.round(2 * k),
    );
  }
  ctx.globalAlpha = 1;
}

/** Deterministic 32-bit integer hash. Same pitch every run — see boardTexture. */
function hash2(a, b) {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ b, 0xc2b2ae35) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}
