import { CanvasTexture, ClampToEdgeWrapping, NearestFilter, RepeatWrapping } from 'three';
import { PALETTE } from '../core/palette.js';
import { registerTextureCache } from '../ui/fonts.js';

/**
 * The card effects' artwork, drawn as the hardware would have had it.
 *
 * ── everything here is small, and that is the technique ─────────────────────
 * A stun star is 24 texels across. A ring is 32. These are not compromises to
 * be raised later: the whole scene is resolved into a 640x480 buffer and
 * quantised to five bits a channel, and a 256-texel sprite reaching that buffer
 * has most of its detail thrown away by the nearest-neighbour sampler on the way
 * — which does not look like detail, it looks like noise. Drawing at roughly the
 * size the sprite will occupy is what makes it look drawn rather than crushed.
 *
 * ── no gradients ────────────────────────────────────────────────────────────
 * Every falloff in this file is a small number of hard STEPS. A smooth radial
 * gradient is the single most modern-looking thing a 2D canvas can produce, and
 * the 5-bit quantiser turns it into banding anyway — so the bands are drawn
 * deliberately, at a count that reads as shading, instead of being left to fall
 * out of the arithmetic at whatever count the quantiser picks.
 *
 * ── sheets, with few frames ─────────────────────────────────────────────────
 * The stun sprite is eight frames of a rotating star laid out in a row, and it
 * is played by moving the UV window rather than by rotating a quad. Eight frames
 * over a full turn is 45 degrees a frame, which is visibly steppy — that is the
 * intent. A smoothly rotated quad would be free and would look like it came from
 * a different game.
 */

/** Every texture in this file, so a mode change can drop them all. */
const cache = new Map();

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

function finish(key, cv, { repeat = false } = {}) {
  const tex = new CanvasTexture(cv);
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  cache.set(key, tex);
  return tex;
}

/** Fill whole pixels only. Nothing in this file draws a fractional edge. */
function px(ctx, x, y, w, h, style) {
  ctx.fillStyle = style;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

/**
 * One frame of the stun star, drawn into `ctx` at `(ox, oy)`.
 *
 * A four-point star with a stepped core. Rotated by resampling onto the pixel
 * grid rather than by `ctx.rotate` — a canvas rotation antialiases the edges,
 * and an antialiased sprite in this pipeline arrives as a fringe of intermediate
 * colours that the quantiser turns into dirt.
 */
function drawStar(ctx, ox, oy, size, angle) {
  const c = size / 2;
  const arm = size * 0.46;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  // Long axis, short axis, and the core. Three tones, hard-stepped.
  const tones = PALETTE.fx.star;

  for (let k = 0; k < 4; k++) {
    const a = angle + (k * Math.PI) / 2;
    const len = k % 2 === 0 ? arm : arm * 0.55;
    const dx = Math.cos(a);
    const dy = Math.sin(a);
    const steps = Math.round(len);
    for (let i = 0; i <= steps; i++) {
      const t = i / Math.max(1, steps);
      const w = Math.max(1, Math.round((1 - t) * size * 0.16));
      px(ctx, ox + c + dx * i - w / 2, oy + c + dy * i - w / 2, w, w, tones[t > 0.6 ? 2 : 1]);
    }
  }
  // The core: two concentric squares, not a disc. A disc at this size is a
  // blurry blob; a stepped square reads as a shape.
  const r = Math.max(1, Math.round(size * 0.13));
  px(ctx, ox + c - r, oy + c - r, r * 2, r * 2, tones[1]);
  px(ctx, ox + c - r / 2, oy + c - r / 2, r, r, tones[0]);
  // Keep the rotation honest even when the star is symmetric: one asymmetric
  // pip, so eight frames read as eight rather than as two.
  px(ctx, ox + c + cos * arm * 0.7 - 1, oy + c + sin * arm * 0.7 - 1, 2, 2, tones[0]);
}

/**
 * The stun star, `frames` of it in a row.
 *
 * @param {number} frames  few. Eight is a 45-degree step and looks it.
 * @param {number} size    texels per frame
 */
export function stunSheet(frames = 8, size = 24) {
  const f = Math.max(1, Math.round(frames));
  const s = Math.max(8, Math.round(size));
  const key = `stun:${f}:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(f * s, s);
  ctx.clearRect(0, 0, f * s, s);
  for (let i = 0; i < f; i++) drawStar(ctx, i * s, 0, s, (i / f) * Math.PI * 2);
  return finish(key, cv);
}

/**
 * An additive ring: bright rim, hollow middle, hard steps.
 *
 * For the swap's expand-and-collapse. Hollow because a filled disc expanding
 * out of a cap reads as the cap growing; a ring reads as something leaving it.
 */
export function ringTexture(size = 32) {
  const s = Math.max(8, Math.round(size));
  const key = `ring:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const c = s / 2;
  // Four bands. Anything more and it stops reading as bands.
  const bands = [
    { r0: 0.72, r1: 1.0, fill: 'rgba(0,0,0,0)' },
    { r0: 0.56, r1: 0.72, fill: PALETTE.fx.ring[0] },
    { r0: 0.40, r1: 0.56, fill: PALETTE.fx.ring[1] },
    { r0: 0.26, r1: 0.40, fill: PALETTE.fx.ring[2] },
  ];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      const band = bands.find((b) => d >= b.r0 && d < b.r1);
      if (band && band.fill !== 'rgba(0,0,0,0)') px(ctx, x, y, 1, 1, band.fill);
    }
  }
  return finish(key, cv);
}

/**
 * Concentric hard rings, for the 강타 aura that stands under an armed cap.
 *
 * Three separated rings rather than one thick band, because this one is not an
 * event — it holds for as long as the card does, and a solid halo sitting under
 * a cap for a whole turn stops being read after two seconds. Separated rings
 * keep a shape the eye can still find, and the gaps are what the palette cycle
 * shows up in.
 *
 * Hard steps and hollow, for the same reasons as `ringTexture`, and because a
 * soft one would be a gradient — which is the one thing this file must not
 * produce, since the 5-bit quantiser downstream would band it anyway and the
 * banding would look like a bug rather than like a decision.
 */
export function auraTexture(size = 32) {
  const s = Math.max(8, Math.round(size));
  const key = `aura:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const c = s / 2;
  // Outer thin, middle brightest, inner thin. Read from the outside in, which
  // is the direction the card's whole idea runs.
  const bands = [
    { r0: 0.86, r1: 0.98, fill: PALETTE.fx.aura[0] },
    { r0: 0.62, r1: 0.74, fill: PALETTE.fx.aura[1] },
    { r0: 0.40, r1: 0.48, fill: PALETTE.fx.aura[2] },
  ];
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      const band = bands.find((b) => d >= b.r0 && d < b.r1);
      if (band) px(ctx, x, y, 1, 1, band.fill);
    }
  }
  return finish(key, cv);
}

/**
 * ── why a tinted sprite needs a GREY source ─────────────────────────────────
 * `trailTexture` below is `flashTexture` repainted in grey. It exists because the
 * victory screen colours the winner's afterimage from whichever TEAM won, and a
 * tint is a MULTIPLY — so the source has to be neutral or the source's own hue
 * wins. Measured, not assumed: against `flashTexture`'s gold, a blue cap charged
 * in behind three GOLD sparks, which reads as some other effect happening nearby
 * rather than as where that cap came from.
 *
 * Everything else is unchanged — same radii, same hard steps. Only the palette
 * moved out of the texture and into the uniform, which is where it has to live
 * for a tint to mean anything.
 */

/**
 * `flashTexture`'s shape in greyscale. For a tinted afterimage.
 *
 * A filled stepped disc, not a ring — this one marks where the cap WAS, and a
 * hollow shape at that size reads as a second smaller cap rather than as a
 * ghost of the one that has gone past. Three tones, hard-stepped, so a row of
 * them at falling opacity is a streak the eye can count.
 */
export function trailTexture(size = 32) {
  const s = Math.max(8, Math.round(size));
  const key = `trail:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const c = s / 2;
  const tones = PALETTE.fx.trail;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      if (d >= 0.92) continue;
      px(ctx, x, y, 1, 1, tones[d < 0.34 ? 0 : d < 0.62 ? 1 : 2]);
    }
  }
  return finish(key, cv);
}

/** A stepped disc. For the one-more flash on a cap. */
export function flashTexture(size = 32) {
  const s = Math.max(8, Math.round(size));
  const key = `flash:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  const c = s / 2;
  const tones = PALETTE.fx.flash;
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.hypot(x + 0.5 - c, y + 0.5 - c) / c;
      if (d >= 0.92) continue;
      px(ctx, x, y, 1, 1, tones[d < 0.34 ? 0 : d < 0.62 ? 1 : 2]);
    }
  }
  return finish(key, cv);
}

/**
 * One opaque white texel.
 *
 * For the full-frame darkening flash, which has no shape — the strength is a
 * uniform and the quad is the whole frame. It exists so the subtractive material
 * can keep ONE fragment shader for both the bolt and the flash: a second shader
 * with the texture read taken out would be the same arithmetic written twice,
 * and the two would eventually disagree about what `uOpacity` means.
 */
export function flatTexture() {
  const key = 'flat';
  if (cache.has(key)) return cache.get(key);
  const { canvas: cv, ctx } = canvas(1, 1);
  px(ctx, 0, 0, 1, 1, PALETTE.fx.white);
  return finish(key, cv);
}

/**
 * The padlock. 침묵's whole vocabulary, in three shapes.
 *
 * Alpha-blended rather than additive, and it is the only sprite in this file
 * that is: everything else here is light being ADDED to the picture, and a seal
 * is the opposite statement. An additive padlock over a dark pitch would be a
 * glowing lock, which reads as a power-up.
 *
 * So it is drawn as an OBJECT — a dark outline, a mid body, one highlight — and
 * the outline is what makes it survive being stamped over anything. Without it
 * a pale lock on the pale end of the pitch simply disappears.
 *
 * The shackle is a stepped arc walked in whole pixels rather than an `arc()`
 * call, for the reason `drawStar` is: a canvas curve antialiases, and an
 * antialiased edge arrives at the 5-bit quantiser as a fringe of dirt.
 */
export function lockTexture(size = 16) {
  const s = Math.max(8, Math.round(size));
  const key = `lock:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);

  const { outline: OUTLINE, body: BODY, shade: SHADE, light: LIGHT } = PALETTE.fx.lock;

  // Body: a plain rectangle across the bottom half. A lock is a box.
  const bx = Math.round(s * 0.18);
  const bw = s - bx * 2;
  const by = Math.round(s * 0.46);
  const bh = Math.round(s * 0.38);
  px(ctx, bx - 1, by - 1, bw + 2, bh + 2, OUTLINE);
  px(ctx, bx, by, bw, bh, BODY);
  // One lit column down the left. Not a gradient — the era lit a face, not a
  // surface.
  px(ctx, bx, by, Math.max(1, Math.round(s * 0.08)), bh, LIGHT);

  // Shackle: an upside-down U, walked pixel by pixel.
  const r = Math.round(s * 0.22);
  const cx = Math.round(s / 2);
  const cy = by;
  const t = Math.max(1, Math.round(s * 0.1));
  for (let a = 180; a <= 360; a += 6) {
    const rad = (a * Math.PI) / 180;
    const x = cx + Math.cos(rad) * r;
    const y = cy + Math.sin(rad) * r;
    px(ctx, x - t / 2 - 1, y - t / 2 - 1, t + 2, t + 2, OUTLINE);
  }
  for (let a = 180; a <= 360; a += 6) {
    const rad = (a * Math.PI) / 180;
    const x = cx + Math.cos(rad) * r;
    const y = cy + Math.sin(rad) * r;
    px(ctx, x - t / 2, y - t / 2, t, t, SHADE);
  }

  // Keyhole. Two pixels of it, and they are what says "lock" rather than "bag".
  const k = Math.max(1, Math.round(s * 0.1));
  px(ctx, cx - Math.ceil(k / 2), by + Math.round(bh * 0.28), k, k, OUTLINE);
  px(ctx, cx - 1, by + Math.round(bh * 0.28) + k, Math.max(1, Math.round(k * 0.7)), k, OUTLINE);

  return finish(key, cv);
}

/**
 * A dash pattern, one texel tall, tiling.
 *
 * Scrolled along its U to make the trajectory line appear to flow. This is
 * palette cycling in the only form the hardware ever really had it on a
 * textured surface: the pattern does not move, the window onto it does.
 */
export function dashTexture(length = 16) {
  const n = Math.max(4, Math.round(length));
  const key = `dash:${n}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(n, 1);
  ctx.clearRect(0, 0, n, 1);
  // Three lit texels, then a gap. Reads as a moving dash rather than as a line
  // that is flickering.
  for (let i = 0; i < n; i++) {
    const phase = i % 8;
    if (phase === 0) px(ctx, i, 0, 1, 1, PALETTE.fx.dash[0]);
    else if (phase === 1) px(ctx, i, 0, 1, 1, PALETTE.fx.dash[1]);
    else if (phase === 2) px(ctx, i, 0, 1, 1, PALETTE.fx.dash[2]);
  }
  return finish(key, cv, { repeat: true });
}

/**
 * The scanline sweep: a horizontal band, stepped, one texel wide.
 *
 * Stretched across the frame and slid down it once. The band is drawn in V so
 * one column of texels is the whole thing — a full-frame image would be 300 kB
 * of canvas for a shape that does not vary in X.
 */
export function scanTexture(height = 32) {
  const h = Math.max(8, Math.round(height));
  const key = `scan:${h}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(1, h);
  ctx.clearRect(0, 0, 1, h);
  for (let y = 0; y < h; y++) {
    const t = y / (h - 1);
    // A hard leading edge and a stepped tail: the sweep has a direction.
    const S = PALETTE.fx.scan;
    const band = t < 0.08 ? S[0] : t < 0.2 ? S[1] : t < 0.45 ? S[2] : t < 0.7 ? S[3] : null;
    if (band) px(ctx, 0, y, 1, 1, band);
  }
  return finish(key, cv);
}

/**
 * A glowing border, hollow in the middle.
 *
 * For the one-more's edge flash. Drawn as a texture rather than as four quads so
 * the corners are part of the same image and cannot come apart.
 *
 * ── it has to be THIN, and it has to fall off inward ────────────────────────
 * The first version was a seventh of the frame deep in a flat gold, drawn
 * additively. Over a black surround that is not a glow at the edge of the
 * picture, it is the picture turning gold — the pitch ended up in a box and the
 * HUD was unreadable through it. A band of a twentieth, brightest at the very
 * outside and stepped down to nothing over three tones, reads as light coming in
 * from off-screen, which is what the effect is.
 *
 * The size is a big multiple of the band so those three tones land on whole
 * texels rather than being rounded into one.
 */
export function frameTexture(size = 128) {
  const s = Math.max(16, Math.round(size));
  const key = `frame:${s}`;
  if (cache.has(key)) return cache.get(key);

  const { canvas: cv, ctx } = canvas(s, s);
  ctx.clearRect(0, 0, s, s);
  // Outermost first. Additive, so even the last tone is doing something.
  const tones = PALETTE.fx.frame;
  const depth = Math.max(tones.length, Math.round(s * 0.055));
  for (let y = 0; y < s; y++) {
    for (let x = 0; x < s; x++) {
      const d = Math.min(x, y, s - 1 - x, s - 1 - y);
      if (d >= depth) continue;
      const band = Math.min(tones.length - 1, Math.floor((d / depth) * tones.length));
      px(ctx, x, y, 1, 1, tones[band]);
    }
  }
  return finish(key, cv);
}

/** Drop every cached texture. For a resolution or frame-count change. */
export const clearFxTextureCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});
