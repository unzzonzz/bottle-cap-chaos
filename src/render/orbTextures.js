import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * The two pages an orb is made of. Drawn at runtime, like everything else.
 *
 * Both are well inside the project's 128-texel page limit, and both are point
 * sampled with no mipmaps — an orb is a few dozen pixels across on screen and
 * anything filtered would be the one smooth thing in the frame.
 */

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  return { canvas: c, ctx };
}

function toTexture(canvas, wrapS = ClampToEdgeWrapping) {
  const t = new CanvasTexture(canvas);
  t.colorSpace = SRGBColorSpace;
  t.magFilter = LinearFilter;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  t.wrapS = wrapS;
  t.wrapT = ClampToEdgeWrapping;
  t.anisotropy = 1;
  t.needsUpdate = true;
  return t;
}

/**
 * The shell's baked surface.
 *
 * ── the highlight is painted on, and that is the whole trick ───────────────
 * A real specular on a 42-triangle sphere lands inside one facet and pops from
 * one to the next as it turns, which reads as a fault rather than as gloss. So
 * the highlight lives in the texture: two vertical bands of light, wrapped
 * round the shell, that sweep past as the shell spins. It cannot be physically
 * correct and it does not need to be — it needs to move with the surface, which
 * a texture does for free.
 *
 * The ground between the bands is a mid tone of the shell's own hue rather than
 * a dark one. It used to be a near-black navy, on the argument that the shader
 * adds a per-vertex rim on top and a dark ground was what let the rim read. On a
 * bright board that inverts: a dark sphere sitting on honey wood reads as a hole
 * in the board rather than as a floating piece of glass, which is the one thing
 * a pickup must not look like.
 *
 * Wraps in u, because u goes round.
 */
export function orbShellTexture() {
  const w = 64;
  const h = 32;
  const { canvas, ctx } = makeCanvas(w, h);

  ctx.fillStyle = PALETTE.orb.shell;
  ctx.fillRect(0, 0, w, h);

  /** A band of light down the shell, in hard vertical steps. */
  const band = (x0, width, tones) => {
    const step = h / tones.length;
    for (let i = 0; i < tones.length; i++) {
      ctx.fillStyle = tones[i];
      ctx.fillRect(x0, Math.round(i * step), width, Math.ceil(step));
    }
  };

  // The key: narrow and bright, a window reflected in the glass.
  band(9, 4, PALETTE.orb.keyBand);
  // Its companion, wider and dimmer, most of the way round.
  band(37, 6, PALETTE.orb.fillBand);

  // A faint equator so the spin is legible even where neither band is showing.
  ctx.fillStyle = PALETTE.orb.equator;
  ctx.fillRect(0, Math.round(h / 2) - 1, w, 2);

  return toTexture(canvas, RepeatWrapping);
}

/**
 * The "?" that floats inside.
 *
 * Drawn as blocks rather than as type. At the size this is seen — a dozen
 * pixels — a font's "?" is a grey smudge with a dot under it whatever you do to
 * the rasteriser, and the glyph has to survive being blown up during the pickup
 * burst as well. Hand-placed rectangles are legible at both ends.
 *
 * Transparent ground, because it is drawn additively inside a transparent
 * sphere: anything but zero alpha here would fog the glass.
 */
export function orbMarkTexture() {
  const size = 32;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);

  const px = (x, y, w, h, c) => {
    ctx.fillStyle = c;
    ctx.fillRect(x, y, w, h);
  };

  const core = PALETTE.orb.markCore;
  const glow = PALETTE.orb.markGlow;

  // A soft halo first, so the mark reads against a bright shell too.
  px(9, 4, 14, 3, glow);
  px(19, 6, 4, 6, glow);
  px(13, 12, 7, 4, glow);
  px(13, 17, 4, 4, glow);
  px(13, 24, 4, 4, glow);

  // The mark itself, one texel in from the halo on every side.
  px(10, 5, 12, 2, core);
  px(20, 6, 2, 5, core);
  px(14, 11, 6, 2, core);
  px(14, 13, 2, 6, core);
  px(14, 24, 2, 3, core);

  return toTexture(canvas);
}
