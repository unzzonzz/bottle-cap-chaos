import { CanvasTexture, ClampToEdgeWrapping, NearestFilter, RepeatWrapping } from 'three';

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
  ctx.fillStyle = '#000000';
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
  strip(20, 3, ['#101010', '#3a3a3a', '#8a8a8a', '#c4c4c4', '#d0d0d0', '#b0b0b0', '#4c4c4c', '#141414']);
  // Its companion, dimmer and further round: a window next to the lamp.
  strip(44, 2, ['#0a0a0a', '#1a1a1a', '#343434', '#4a4a4a', '#4e4e4e', '#3c3c3c', '#1c1c1c', '#080808']);
  // Round the back, catching the same light from the other side. Seen through
  // two walls of glass, so dimmer again.
  strip(92, 3, ['#080808', '#161616', '#282828', '#343434', '#343434', '#242424', '#101010', '#050505']);

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

  ctx.fillStyle = '#b8231f';
  ctx.fillRect(0, 0, w, h);

  // Two darker bands at the very top and bottom, so the label has an edge
  // against the glass instead of floating on it.
  ctx.fillStyle = '#8d1815';
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
  rule(9, -3, '#f2e6cf', 2);
  rule(h - 10, 3, '#f2e6cf', 2);

  // The logo. Three lines, because "BOTTLE CAP CHAOS" on one line at this width
  // is four texels a letter and unreadable; stacked, each word gets the full
  // panel. The middle line is the big one.
  crispText(ctx, scratch, {
    text: 'BOTTLE',
    x: w / 2,
    y: 28,
    font: 'bold 14px ui-monospace, Menlo, monospace',
    color: '#f7efe0',
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CAP',
    x: w / 2,
    y: 43,
    font: 'bold 17px ui-monospace, Menlo, monospace',
    color: '#f7efe0',
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CHAOS',
    x: w / 2,
    y: 54,
    font: 'bold 11px ui-monospace, Menlo, monospace',
    color: '#f2d7a8',
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
  const steps = [
    [0.5, 'rgba(0,0,0,0.86)'],
    [0.68, 'rgba(0,0,0,0.55)'],
    [0.86, 'rgba(0,0,0,0.26)'],
    [1.0, 'rgba(0,0,0,0.1)'],
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
  const steps = [
    [0.84, 'rgba(10,12,18,0.45)'],
    [0.66, 'rgba(15,18,27,0.8)'],
    [0.48, '#141926'],
    [0.3, '#1a2131'],
    [0.14, '#1f283c'],
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
  ctx.fillStyle = '#b8231f';
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
  ring(60, 3, '#8d1815');
  ring(52, 2, '#d8524a');

  // The two rules, inside the crop so they frame the wordmark at full cover.
  arc(37, 2, 202, 338, '#f2e6cf');
  arc(37, 2, 22, 158, '#f2e6cf');

  crispText(ctx, scratch, {
    text: 'BOTTLE',
    x: c,
    y: 54,
    font: 'bold 15px ui-monospace, Menlo, monospace',
    color: '#f7efe0',
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CAP',
    x: c,
    y: 76,
    font: 'bold 22px ui-monospace, Menlo, monospace',
    color: '#f7efe0',
    align: 'center',
    slant: 0.22,
  });
  crispText(ctx, scratch, {
    text: 'CHAOS',
    x: c,
    y: 92,
    font: 'bold 13px ui-monospace, Menlo, monospace',
    color: '#f2d7a8',
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
  ctx.fillStyle = '#d9b988';
  ctx.fillRect(0, 0, size, size);

  const tones = ['#f0dcb6', '#e2c79c', '#bd9a64', '#fbf1d8'];
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
  ctx.fillStyle = '#000000';
  ctx.fillRect(0, 0, size, size);

  const c = size / 2;
  // The rim, then the middle knocked back out of it.
  ctx.fillStyle = '#e8f0f4';
  ctx.beginPath();
  ctx.arc(c, c, 6.4, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#3a4448';
  ctx.beginPath();
  ctx.arc(c, c, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#12181a';
  ctx.beginPath();
  ctx.arc(c, c, 2.6, 0, Math.PI * 2);
  ctx.fill();
  // The glint, up and to the left, matching the scene's key.
  ctx.fillStyle = '#ffffff';
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
  spikes(32, 32, 6, 4, 26, 5, '#fff4d8', 0);
  spikes(32, 32, 6, 3, 15, 4, '#ffffff', Math.PI / 6);
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(32, 32, 7, 0, Math.PI * 2);
  ctx.fill();

  // Frame 1: the spray, wider and already breaking up.
  spikes(96, 32, 9, 10, 30, 3, '#efe0bb', 0.2);
  spikes(96, 32, 5, 6, 20, 3, '#fffaf0', 0.9);
  ctx.fillStyle = '#d8cbaa';
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

  const SKINS = {
    idle: { bg: '#141a26', edge: '#3c4759', text: '#c3ccdb', bar: '#5c6a82' },
    hover: { bg: '#26314a', edge: '#8ea4c6', text: '#ffffff', bar: '#d8b45c' },
    disabled: { bg: '#101319', edge: '#242a34', text: '#4e5665', bar: '#2b323e' },
  };
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

  crispText(ctx, scratch, {
    text: label,
    x: px(24),
    y: Math.round(height / 2 + px(9)),
    font: `bold ${px(24)}px ui-monospace, Menlo, monospace`,
    color: skin.text,
  });

  if (state === 'disabled') {
    crispText(ctx, scratch, {
      text: '준비 중',
      x: width - px(14),
      y: Math.round(height / 2 + px(8)),
      font: `${px(19)}px ui-monospace, Menlo, monospace`,
      color: '#5d6575',
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
    color: '#e6ddc9',
  });
  ctx.fillStyle = '#8d1815';
  ctx.fillRect(px(4), px(42), width - px(24), px(4));
  if (sub) {
    crispText(ctx, scratch, {
      text: sub,
      x: px(4),
      y: px(68),
      font: `${px(19)}px ui-monospace, Menlo, monospace`,
      color: '#8892a3',
    });
  }

  const tex = toTexture(canvas);
  tex.userData = { width, height };
  return tex;
}
