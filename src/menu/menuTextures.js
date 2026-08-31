import { CanvasTexture, ClampToEdgeWrapping, NearestFilter, RepeatWrapping, SRGBColorSpace } from 'three';
import { PALETTE, withAlpha } from '../core/palette.js';

/**
 * Every pixel the menu needs, drawn at runtime. No image files, same as
 * everywhere else in this project.
 *
 * The 128-texel page limit from `core/textures.js` holds here too. That helper
 * is square-only and two of these are not, so they build their canvases
 * directly — exactly as `render/cardTexture.js` does — but nothing below is
 * wider or taller than a page.
 *
 * ── text has to be aliased ──────────────────────────────────────────────────
 * `imageSmoothingEnabled = false` governs image SCALING; the font rasteriser
 * antialiases glyph edges regardless, and those intermediate values come out of
 * the 5-bit quantiser as coloured fringing. So type is drawn to a scratch
 * canvas and its alpha is pushed to fully on or fully off before compositing.
 * Lifted from `cardTexture.js`, which explains it at length.
 */

const ALPHA_CUT = 110;

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  return { canvas: c, ctx };
}

function toTexture(canvas, { wrapS = ClampToEdgeWrapping, wrapT = ClampToEdgeWrapping } = {}) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = NearestFilter;
  tex.minFilter = NearestFilter;
  tex.generateMipmaps = false;
  tex.wrapS = wrapS;
  tex.wrapT = wrapT;
  tex.anisotropy = 1;
  tex.needsUpdate = true;
  return tex;
}

function crispText(target, scratch, { text, x, y, font, color, align = 'left', slant = 0 }) {
  const { canvas, ctx } = scratch;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.save();
  ctx.font = font;
  ctx.textAlign = align;
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = color;
  if (slant) {
    // A shear rather than an italic face: the fonts available are whatever the
    // machine has, and asking for italic gets a different one on every OS. A
    // transform is the same lean everywhere.
    ctx.translate(x, y);
    ctx.transform(1, 0, -slant, 1, 0, 0);
    ctx.fillText(text, 0, 0);
  } else {
    ctx.fillText(text, x, y);
  }
  ctx.restore();

  const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) d[i] = d[i] >= ALPHA_CUT ? 255 : 0;
  ctx.putImageData(img, 0, 0);

  target.drawImage(canvas, 0, 0);
}

/**
 * The glass highlight, baked.
 *
 * Two vertical white strips at fixed angles and one dark band opposite them,
 * over black. Added by the glass shader, so black contributes nothing and only
 * the strips show — which is why this is a black image rather than a grey one.
 *
 * Two strips and not one: a single strip reads as a seam. Two, at different
 * widths, read as a window and a lamp.
 *
 * The u axis is the way round the bottle, so a strip is a fixed angle and stays
 * put as the bottle floats. The v axis fades them out at the very top and
 * bottom in HARD STEPS, not a ramp — a smooth falloff here is exactly the
 * gradient the brief rules out, and it would band anyway.
 */
export function glassHighlightTexture() {
  const { canvas, ctx } = makeCanvas(128, 128);
  ctx.fillStyle = PALETTE.additiveZero;
  ctx.fillRect(0, 0, 128, 128);

  /** @param {number} u0  left edge in texels @param {string[]} steps  bottom to top */
  const strip = (u0, width, steps) => {
    const band = 128 / steps.length;
    for (let i = 0; i < steps.length; i++) {
      ctx.fillStyle = steps[i];
      ctx.fillRect(u0, Math.round(128 - (i + 1) * band), width, Math.ceil(band));
    }
  };

  // ── where the strips sit, and why not in the middle ──────────────────────
  // u = 0 is +x and the camera is on +z, so the front of the bottle is u =
  // 0.25 — texel 32. A strip there runs straight down the centre of the
  // silhouette and reads as a painted stripe rather than as a reflection,
  // because a reflection you are looking at head-on is the one place a real one
  // never is. Both are set off to one side of it.
  //
  // Narrow, too. Wide is what makes it paint: at three texels the strip is
  // about two pixels of a 320-wide framebuffer, which is a glint.
  strip(20, 3, PALETTE.additive.glintKey);
  // Its companion, dimmer and further round: a window next to the lamp.
  strip(44, 2, PALETTE.additive.glintMid);
  // Round the back, catching the same light from the other side. Seen through
  // two walls of glass, so dimmer again.
  strip(92, 3, PALETTE.additive.glintFar);

  return toTexture(canvas, { wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping });
}

/**
 * The label.
 *
 * ── what this is not ────────────────────────────────────────────────────────
 * It carries the GAME's name. There is no Spencerian script here, no swash, no
 * ribbon or wave device of any kind, and the type is a sheared grotesque rather
 * than a connected hand. What is borrowed is the FORM LANGUAGE that a hundred
 * soda labels share and nobody owns: a red band round the middle of the bottle,
 * white type on it, and a rule above and below that curves with the glass.
 *
 * ── it is authored at the size it is DISPLAYED at ───────────────────────────
 * The band is drawn once and wrapped twice round the bottle (see
 * `buildLabelGeometry`), so this image is one panel, and one panel covers the
 * whole visible front of the bottle.
 *
 * At the 640x480 target and this framing, that front is about ninety
 * framebuffer pixels across and fifty tall — so 128x64 lands within about a
 * third of one texel per pixel. That ratio is the whole design constraint here,
 * not the page size: authored at twice what it is shown at, every texel of
 * carefully thresholded type gets averaged away on the trip to the screen and
 * the logo arrives as a red smear with a lighter streak through it. (Measured,
 * at the 320x240 target, where 128x64 was exactly twice too big.)
 *
 * Same rule the menu plates follow, and the same one `cardTexture` follows for
 * a card in the hand. Bold, three words, nothing thinner than a texel.
 */
export function labelTexture() {
  const w = 128;
  const h = 64;
  const { canvas, ctx } = makeCanvas(w, h);
  const scratch = makeCanvas(w, h);

  ctx.fillStyle = PALETTE.menu.labelRed;
  ctx.fillRect(0, 0, w, h);

  // Two darker bands at the very top and bottom, so the label has an edge
  // against the glass instead of floating on it.
  ctx.fillStyle = PALETTE.menu.labelRedDeep;
  ctx.fillRect(0, 0, w, 4);
  ctx.fillRect(0, h - 4, w, 4);

  // The curved rules. Drawn as stepped runs of 1px rectangles rather than as a
  // stroked arc, so the curve is made of hard pixels and cannot be antialiased
  // into a grey smear by the rasteriser.
  const rule = (baseY, rise, color, thick) => {
    ctx.fillStyle = color;
    for (let x = 0; x < w; x++) {
      const t = (x / (w - 1)) * 2 - 1;
      ctx.fillRect(x, Math.round(baseY + rise * (t * t)), 1, thick);
    }
  };
  rule(9, -3, PALETTE.menu.labelCreamAlt, 2);
  rule(h - 10, 3, PALETTE.menu.labelCreamAlt, 2);

  // The logo. Three lines, because "BOTTLE CAP CHAOS" on one line at this width
  // is four texels a letter and unreadable; stacked, each word gets the full
  // panel. The middle line is the big one.
  crispText(ctx, scratch, {
    text: 'BOTTLE',
    x: w / 2,
    y: 28,
    font: 'bold 14px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CAP',
    x: w / 2,
    y: 43,
    font: 'bold 17px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CHAOS',
    x: w / 2,
    y: 54,
    font: 'bold 11px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelGold,
    align: 'center',
    slant: 0.22,
  });

  return toTexture(canvas, { wrapS: RepeatWrapping, wrapT: ClampToEdgeWrapping });
}

/**
 * The shadow under the bottle: one dark ellipse, in hard steps.
 *
 * Not a rendered shadow, and not because one would be hard — a real one needs a
 * light, a caster, a receiver and a depth pass to produce a dark blob on the
 * floor. That IS the blob. The same argument `CardMaterial` makes about the
 * offset quad behind a card.
 */
export function shadowTexture() {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.clearRect(0, 0, size, size);
  // A deep blue-grey rather than black, at the same four opacities. The alphas
  // are the falloff's shape and stay here; only the ink moved to the palette.
  const steps = [
    [0.5, withAlpha(PALETTE.menu.shadow, 0.62)],
    [0.68, withAlpha(PALETTE.menu.shadow, 0.4)],
    [0.86, withAlpha(PALETTE.menu.shadow, 0.19)],
    [1.0, withAlpha(PALETTE.menu.shadow, 0.07)],
  ];
  for (let i = steps.length - 1; i >= 0; i--) {
    ctx.fillStyle = steps[i][1];
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) * steps[i][0], 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
}

/**
 * The pool of light on the floor.
 *
 * Concentric hard rings, brightest in the middle. Four steps, because the brief
 * bans smooth gradients and because four is what a 15-bit framebuffer would
 * have given anyway once the quantiser had finished with a smooth one.
 */
export function floorPoolTexture() {
  const size = 128;
  const { canvas, ctx } = makeCanvas(size, size);
  // TRANSPARENT outside the pool, not black. Filled black it is an opaque
  // square with a circle drawn on it, and the square's corners are a visible
  // hard edge across the middle of the scene — darker than the background it is
  // sitting on, which is how you notice a floor that is not supposed to have a
  // boundary at all.
  ctx.clearRect(0, 0, size, size);
  // The outermost ring stops at 0.84 of the page and everything beyond it is
  // clear, so the pool has died out well before the quad it is drawn on ends.
  // Run out to the edge and the quad's own straight far edge is a horizontal
  // line across the back of the scene where the floor's tint stops.
  const P = PALETTE.menu.pool;
  const steps = [
    [0.84, withAlpha(P[0], 0.45)],
    [0.66, withAlpha(P[1], 0.8)],
    [0.48, P[2]],
    [0.3, P[3]],
    [0.14, P[4]],
  ];
  for (const [r, color] of steps) {
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size / 2) * r, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(canvas);
}

/**
 * The cap's top: the game's logo, on the disc that fills the screen.
 *
 * ── it replaces the placeholder, and only where it should ───────────────────
 * `cap/capTexture.js` draws a generic panel — concentric rings, eight spokes and
 * an orientation mark — and that is still exactly right for the PLAYING pieces,
 * which are a customisable slot for a player's own artwork, and for the phase-1
 * viewer, whose spoke is a debugging aid for watching the UVs spin. Neither
 * wants the game's name stamped on it. This one is for the menu's bottle and
 * for the cap that covers the screen, which do.
 *
 * ── the design is sized for ONE frame ───────────────────────────────────────
 * At the covered frame the panel's radius is the frame's half-DIAGONAL, so the
 * part you actually see is the largest 4:3 rectangle inside the disc — about
 * 102 by 77 of these 128 texels. Everything that has to be read therefore lives
 * inside that box, and everything outside it (the rim rings) exists only for
 * the other end of the scale, where this is a twelve-pixel dot on a bottle.
 *
 * Draw the logo out to the disc's edge instead and the covering frame crops the
 * first and last letters off every line.
 *
 * ── it is the label's design, made round ────────────────────────────────────
 * Same red, same sheared white grotesque, same stacked lockup, same rule above
 * and below. The rules are concentric ARCS rather than the label's parabolas,
 * because on a disc that is what "follows the curvature" means. Nothing here is
 * anyone's trademark: a red cap with white type on it is the whole of it.
 */
export function capLogoTexture() {
  const size = 128;
  const c = size / 2;
  const { canvas, ctx } = makeCanvas(size, size);
  const scratch = makeCanvas(size, size);

  // The corners are never sampled — the panel is the inscribed circle — but
  // filling them costs nothing and means a rounding error at the rim cannot
  // pick up a transparent texel.
  ctx.fillStyle = PALETTE.menu.labelRed;
  ctx.fillRect(0, 0, size, size);

  const ring = (radius, thickness, color) => {
    ctx.fillStyle = color;
    const steps = 360;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      ctx.fillRect(
        Math.round(c + Math.cos(a) * radius),
        Math.round(c + Math.sin(a) * radius),
        thickness,
        thickness,
      );
    }
  };

  /** Hard-pixel arc. `ctx.arc` with a stroke would antialias the ends. */
  const arc = (radius, thickness, fromDeg, toDeg, color) => {
    ctx.fillStyle = color;
    const steps = 220;
    for (let i = 0; i <= steps; i++) {
      const a = ((fromDeg + (toDeg - fromDeg) * (i / steps)) * Math.PI) / 180;
      ctx.fillRect(
        Math.round(c + Math.cos(a) * radius),
        Math.round(c + Math.sin(a) * radius),
        thickness,
        thickness,
      );
    }
  };

  // Rim. Outside the covering frame's crop and invisible there — this is the
  // half of the design that only ever shows on the bottle.
  ring(60, 3, PALETTE.menu.labelRedDeep);
  ring(52, 2, PALETTE.menu.labelRedLight);

  // The two rules, inside the crop so they frame the wordmark at full cover.
  arc(37, 2, 202, 338, PALETTE.menu.labelCreamAlt);
  arc(37, 2, 22, 158, PALETTE.menu.labelCreamAlt);

  crispText(ctx, scratch, {
    text: 'BOTTLE',
    x: c,
    y: 54,
    font: 'bold 15px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CAP',
    x: c,
    y: 76,
    font: 'bold 22px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelCream,
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CHAOS',
    x: c,
    y: 92,
    font: 'bold 13px ui-monospace, Menlo, monospace',
    color: PALETTE.menu.labelGold,
    align: 'center',
    slant: 0.22,
  });

  return toTexture(canvas);
}

/**
 * Foam.
 *
 * Cells rather than a froth: hard-edged blobs of three tones on a pale ground,
 * packed on a jittered grid so no row lines up with the one above it. Tiles in
 * both directions, because the foam column scrolls this upward as it rises and
 * a seam crossing the bottle every half second is the one thing that would give
 * the trick away.
 *
 * Cola foam is not white. It is a dirty cream that goes tan where it is thick,
 * and painting it white is the fastest way to make a bottle of cola look like a
 * bottle of beer.
 */
export function foamTexture() {
  const size = 64;
  const { canvas, ctx } = makeCanvas(size, size);
  // Light enough to survive being seen through a wall of brown glass at 60%
  // opacity, which is the only place it is ever seen.
  ctx.fillStyle = PALETTE.menu.foam;
  ctx.fillRect(0, 0, size, size);

  const tones = PALETTE.menu.foamTones;
  // A fixed pattern rather than a random one: this is drawn once at boot and
  // has to look the same every run, and `Math.random` in a texture is how you
  // get a bug that only reproduces one time in twenty.
  const cells = [
    [6, 5, 7], [22, 3, 5], [38, 7, 8], [54, 4, 6], [13, 14, 6], [30, 16, 9],
    [47, 13, 5], [59, 17, 7], [3, 24, 8], [19, 27, 6], [36, 29, 7], [51, 25, 5],
    [10, 37, 6], [26, 39, 8], [43, 36, 6], [58, 40, 7], [5, 49, 7], [21, 52, 5],
    [34, 48, 8], [49, 54, 6], [61, 50, 5], [14, 60, 6], [30, 61, 7], [45, 62, 5],
  ];
  cells.forEach(([x, y, r], i) => {
    ctx.fillStyle = tones[i % tones.length];
    // Drawn four times, wrapped, so a blob crossing an edge comes back on the
    // other side and the page tiles seamlessly.
    for (const dx of [-size, 0, size]) {
      for (const dy of [-size, 0, size]) {
        ctx.beginPath();
        ctx.arc(x + dx, y + dy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  });

  return toTexture(canvas, { wrapS: RepeatWrapping, wrapT: RepeatWrapping });
}

/**
 * One bubble, as a sprite.
 *
 * A bubble in a dark drink is not a white dot. It is a lens: the light that
 * reaches your eye comes round the EDGE of it, so what you see is a bright ring
 * with a dimmer middle, plus one hard glint where the key light reflects off
 * the top of the sphere. Painting it as a filled disc is what makes CG fizz
 * look like grains of rice.
 *
 * Sixteen texels, because the thing is two to seven pixels across on screen and
 * anything more detailed than this is a decision the framebuffer will not
 * record. Added, so the black surround contributes nothing.
 */
export function bubbleTexture() {
  const size = 16;
  const { canvas, ctx } = makeCanvas(size, size);
  ctx.fillStyle = PALETTE.additiveZero;
  ctx.fillRect(0, 0, size, size);

  const c = size / 2;
  // The rim, then the middle knocked back out of it.
  ctx.fillStyle = PALETTE.additive.bubble.rim;
  ctx.beginPath();
  ctx.arc(c, c, 6.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.additive.bubble.mid;
  ctx.beginPath();
  ctx.arc(c, c, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = PALETTE.additive.bubble.core;
  ctx.beginPath();
  ctx.arc(c, c, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // The glint, up and to the left, matching the scene's key.
  ctx.fillStyle = PALETTE.additive.bubble.glint;
  ctx.fillRect(c - 3, c - 4, 2, 2);

  return toTexture(canvas);
}

/**
 * The burst at the mouth. Two frames side by side in one 128x64 page.
 *
 * Two frames is the whole animation: a tight star, then a wider ragged ring.
 * The brief allows "저해상도 스프라이트 1~2프레임" and rules out a particle
 * system, and there is nothing a hundred quads would say here that these two do
 * not — the fizz is over in a tenth of a second.
 */
export function burstSheet() {
  const { canvas, ctx } = makeCanvas(128, 64);
  ctx.clearRect(0, 0, 128, 64);

  /** Radial spikes, hard-edged, drawn as triangles. */
  const spikes = (cx, cy, count, r0, r1, width, color, phase) => {
    ctx.fillStyle = color;
    for (let i = 0; i < count; i++) {
      const a = phase + (i / count) * Math.PI * 2;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(a);
      ctx.beginPath();
      ctx.moveTo(r0, -width);
      ctx.lineTo(r1, 0);
      ctx.lineTo(r0, width);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
  };

  // Frame 0: the pop.
  spikes(32, 32, 6, 4, 26, 5, PALETTE.additive.burst.popWide, 0);
  spikes(32, 32, 6, 3, 15, 4, PALETTE.additive.burst.popTight, Math.PI / 6);
  ctx.fillStyle = PALETTE.additive.burst.popCore;
  ctx.beginPath();
  ctx.arc(32, 32, 7, 0, Math.PI * 2);
  ctx.fill();

  // Frame 1: the spray, wider and already breaking up.
  spikes(96, 32, 9, 10, 30, 3, PALETTE.additive.burst.sprayWide, 0.2);
  spikes(96, 32, 5, 6, 20, 3, PALETTE.additive.burst.sprayTight, 0.9);
  ctx.fillStyle = PALETTE.additive.burst.sprayCore;
  ctx.beginPath();
  ctx.arc(96, 32, 4, 0, Math.PI * 2);
  ctx.fill();

  return toTexture(canvas);
}

/**
 * A menu item's plate.
 *
 * Drawn at one texel per frame pixel and used at that size, which is the whole
 * reason the text on it is legible at 320x240: any other scale resamples type
 * that has just been thresholded specifically so it would not be resampled.
 *
 * @param {string} label
 * @param {'idle'|'hover'|'disabled'} state
 */
export function menuPlateTexture(label, state, { width = 256, height = 52 } = {}) {
  const { canvas, ctx } = makeCanvas(width, height);
  const scratch = makeCanvas(width, height);
  /** Everything below is authored against a 256-wide plate and scaled. */
  const u = width / 256;

  /**
   * `dimmed` is `disabled` without the verdict.
   *
   * ── two different sentences wore one skin ──────────────────────────────
   * `disabled` stamps "준비 중" on the right, which says a FEATURE is not built
   * yet — correct for a mode with no AI, and false for a row that is merely
   * unavailable at this moment. The online screen greys 방 만들기 / 코드로 참가
   * / 랜덤 매칭 while you are already in a queue, and all three announced
   * themselves as unfinished features.
   *
   * Same colours, no stamp. The caller picks the sentence.
   */
  const SKINS = PALETTE.button;
  const skin = SKINS[state] ?? SKINS.idle;
  const px = (n) => Math.max(1, Math.round(n * u));

  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = px(2);
  ctx.strokeRect(px(1), px(1), width - px(2), height - px(2));

  // The marker down the left edge. It is what the hover state brightens, and it
  // reads at a glance from further away than the type does.
  ctx.fillStyle = skin.bar;
  ctx.fillRect(px(6), px(6), px(6), height - px(12));

  /**
   * Sized to FIT, exactly as `titleTexture` below already is.
   *
   * ── the same bug, in the sibling function ─────────────────────────────
   * That one's comment records "BOTTLE CAP CHAOS" arriving on screen as
   * "BOTTLE CAP CHA". This one was never given the same treatment and had the
   * same defect waiting: at a fixed 24px a label simply ran off the right edge,
   * silently, with no ellipsis and nothing to indicate anything was missing.
   *
   * It surfaced on the matchmaking screen, where the status row says
   * "상대를 찾는 중  0:12" — and the elapsed time, the one part of that line
   * that changes, was entirely off the plate. Reported as "시간이 다 짤려서
   * 하나도 안보여".
   *
   * The floor is 14px rather than the title's 12: this is body-weight type on a
   * shorter plate, and below 14 the alpha threshold starts eating 받침 strokes.
   * A label that cannot fit even at 14 is too long for a plate and wants
   * shortening at the call site — but it will now be small rather than absent.
   */
  const room = width - px(24) - px(10);
  let size = px(24);
  while (size > px(14)) {
    ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`;
    if (ctx.measureText(label).width <= room) break;
    size -= 1;
  }

  crispText(ctx, scratch, {
    text: label,
    x: px(24),
    y: Math.round(height / 2 + px(9)),
    font: `bold ${size}px ui-monospace, Menlo, monospace`,
    color: skin.text,
  });

  if (state === 'disabled') {
    crispText(ctx, scratch, {
      text: '준비 중',
      x: width - px(14),
      y: Math.round(height / 2 + px(8)),
      font: `${px(19)}px ui-monospace, Menlo, monospace`,
      color: PALETTE.ui.disabledText,
      align: 'right',
    });
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  return tex;
}

/** The title plate above the menu column, and the settings scene's heading. */
export function titleTexture(text, sub, { width = 256, height = 80 } = {}) {
  const { canvas, ctx } = makeCanvas(width, height);
  const scratch = makeCanvas(width, height);
  const u = width / 256;
  const px = (n) => Math.max(1, Math.round(n * u));

  ctx.clearRect(0, 0, width, height);

  // Sized to FIT rather than set at a fixed size and hoped for. The heading is
  // whatever the caller passes; picked by hand, "BOTTLE CAP CHAOS" overran the
  // plate and arrived on screen as "BOTTLE CAP CHA".
  let size = px(29);
  while (size > px(12)) {
    ctx.font = `bold ${size}px ui-monospace, Menlo, monospace`;
    if (ctx.measureText(text).width <= width - px(12)) break;
    size -= 1;
  }

  crispText(ctx, scratch, {
    text,
    x: px(4),
    y: px(32),
    font: `bold ${size}px ui-monospace, Menlo, monospace`,
    color: PALETTE.ui.textOnAccent,
  });
  ctx.fillStyle = PALETTE.menu.labelRed;
  ctx.fillRect(px(4), px(42), width - px(24), px(4));
  if (sub) {
    crispText(ctx, scratch, {
      text: sub,
      x: px(4),
      y: px(68),
      font: `${px(19)}px ui-monospace, Menlo, monospace`,
      /**
       * White, like the heading above it, because this plate is TRANSPARENT —
       * `clearRect` at the top of this function — so both lines are type on the
       * backdrop rather than type on a plate. See the note on `PALETTE.ui.text`
       * for why that changes which ink is legal. Size carries the hierarchy.
       *
       * PHASE 6 gives this heading a glass panel, at which point both lines go
       * back to `ui.text`.
       */
      color: PALETTE.ui.textOnAccent,
    });
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  return tex;
}
