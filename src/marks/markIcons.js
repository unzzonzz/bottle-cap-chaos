import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import { PALETTE } from '../core/palette.js';
import { registerTextureCache } from '../ui/fonts.js';

/**
 * The editor's icons, drawn as bitmaps.
 *
 * ── why not glyphs ──────────────────────────────────────────────────────────
 * The one icon precedent in this project is the cards' single characters —
 * `⌁ ✳ ↻ ≫` — and `cardCatalog` has the measurement that explains them: at 46px,
 * thresholded and then quantised to five bits, a FILLED glyph arrives as a lump,
 * and the four that survived were chosen by ink coverage. That works when a card
 * needs one decorative mark. It does not work here. This screen needs ten icons
 * that have to be told apart at a glance and at a fraction of that size, and the
 * font they would come from is whatever the machine happens to have — so the
 * same build would ship different pictures on different computers.
 *
 * So they are hand-set bitmaps: a grid of characters per icon, one texel per
 * cell, scaled by whole numbers only. Nothing is rasterised, nothing is
 * antialiased, and the icon on screen is the icon in this file on every machine.
 *
 * ── the two pairs that are easy to confuse ──────────────────────────────────
 * The brief asks for icons to be reported if their meaning is not clear, and two
 * pairs are genuinely at risk at this size:
 *
 *   ERASER vs CLEAR. Both remove paint. The eraser is the physical object —
 *     an angled block with a pale tip — and reads as a tool. Clear is a framed
 *     canvas with a cross through it and reads as an action on the whole
 *     surface. Different shapes, different silhouettes, not two variations on a
 *     rubber.
 *   CLEAR vs DELETE. Clear empties the drawing and keeps the slot; the bin
 *     throws the slot away. The bin is the only icon with a lid and a taper, and
 *     it is the only one that appears on a SLOT rather than in the toolbar, so
 *     position separates them as well as shape.
 *
 * ── states are the menu's, not new ones ─────────────────────────────────────
 * Plate, edge and marker come from `menuPlateTexture`'s palette so a toolbar
 * button is visibly the same family as a menu item. `active` is the one state
 * that file does not have — a tool can be SELECTED, which a menu item cannot —
 * and it borrows the hover skin's gold so "chosen" and "under the pointer" are
 * told apart by the plate rather than by the icon.
 */

/** '.' transparent · '#' ink · 'o' shade · '+' accent */
const ART = {
  /** Draw mode, and the brush. A pencil on the diagonal. */
  pencil: [
    '................',
    '...........###..',
    '..........#####.',
    '.........###o##.',
    '........###o##..',
    '.......###o##...',
    '......###o##....',
    '.....###o##.....',
    '....###o##......',
    '...###o##.......',
    '..#####.........',
    '..####..........',
    '..###...........',
    '..#.............',
    '................',
    '................',
  ],
  /**
   * View mode. An eye.
   *
   * An ALMOND with a pupil, not concentric rings. The first attempt was rings
   * and it read as a target — the giveaway is that an eye's silhouette is wider
   * than it is tall and comes to a point at each corner, and a circle does
   * neither.
   */
  eye: [
    '................',
    '................',
    '................',
    '................',
    '.....######.....',
    '..###oooooo###..',
    '.##ooo....ooo##.',
    '##ooo......ooo##',
    '##ooo......ooo##',
    '.##ooo....ooo##.',
    '..###oooooo###..',
    '.....######.....',
    '................',
    '................',
    '................',
    '................',
  ],
  /** The eraser. A block on a slant with a pale working end. */
  eraser: [
    '................',
    '................',
    '.........#####..',
    '........##ooo##.',
    '.......##oooo##.',
    '......##oooo##..',
    '.....##oooo##...',
    '....##oooo##....',
    '...+++++++#.....',
    '..++++++++......',
    '..+++++++.......',
    '..++++++........',
    '..#####.........',
    '................',
    '................',
    '................',
  ],
  /** Clear the canvas. A framed surface struck through. */
  clear: [
    '................',
    '................',
    '..############..',
    '..#..........#..',
    '..#.##....##.#..',
    '..#..##..##..#..',
    '..#...####...#..',
    '..#....##....#..',
    '..#...####...#..',
    '..#..##..##..#..',
    '..#.##....##.#..',
    '..#..........#..',
    '..############..',
    '................',
    '................',
    '................',
  ],
  /**
   * Undo. An arrow with an ELBOW, and the elbow is the whole point.
   *
   * `back` is already a plain left arrow, so undo cannot be one — at this size
   * the two would be the same picture. The shaft turning down at its far end is
   * what separates them, and it is the shape every other program uses for this.
   * `redo` is this mirrored, generated rather than hand-set so the pair can
   * never drift apart.
   */
  undo: [
    '................',
    '................',
    '................',
    '...##...........',
    '..###...........',
    '.####...........',
    '##############..',
    '##############..',
    '.####.......###.',
    '..###.......###.',
    '...##.......###.',
    '............###.',
    '............###.',
    '................',
    '................',
    '................',
  ],
  /** Delete this slot. A bin: lid, taper, ribs. */
  trash: [
    '................',
    '.....######.....',
    '................',
    '..############..',
    '................',
    '...##########...',
    '...#.#.##.#.#...',
    '...#.#.##.#.#...',
    '...#.#.##.#.#...',
    '...#.#.##.#.#...',
    '...#.#.##.#.#...',
    '....#######.....',
    '................',
    '................',
    '................',
    '................',
  ],
  /** An empty slot. */
  plus: [
    '................',
    '................',
    '................',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '..###########...',
    '..###########...',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '.......##.......',
    '................',
    '................',
    '................',
  ],
  /** Save. A disk, with a shutter and a label. */
  save: [
    '................',
    '................',
    '..###########...',
    '..#ooooooooo##..',
    '..#o##...##o###.',
    '..#o##...##o##..',
    '..#o##...##o##..',
    '..#ooooooooo##..',
    '..#ooooooooo##..',
    '..#o#######o##..',
    '..#o#######o##..',
    '..#o#######o##..',
    '..###########...',
    '................',
    '................',
    '................',
  ],
  /** Back out of a screen. */
  back: [
    '................',
    '................',
    '.......##.......',
    '......##........',
    '.....##.........',
    '....##..........',
    '...############.',
    '..#############.',
    '...############.',
    '....##..........',
    '.....##.........',
    '......##........',
    '.......##.......',
    '................',
    '................',
    '................',
  ],
};

/** Brush sizes get a dot each, so the icon IS the size it selects. */
function brushArt(dot) {
  const rows = [];
  const half = 8;
  for (let y = 0; y < 16; y++) {
    let row = '';
    for (let x = 0; x < 16; x++) {
      const dx = x - half + 0.5;
      const dy = y - half + 0.5;
      row += Math.hypot(dx, dy) <= dot ? '#' : '.';
    }
    rows.push(row);
  }
  return rows;
}

/**
 * The four button states, built on `PALETTE.button`.
 *
 * This table used to be written out in full here, and `menuTextures` had its own
 * copy with the same four rows and slightly different values — which is how the
 * mark editor's tool buttons and the menu's plates drifted apart in the first
 * place. The four shared fields now come straight from the palette; `shade` is
 * the one this file adds, because an icon drawn as a shape needs a second tone
 * the plate does not.
 */
const SKINS = {
  idle: skin('idle', PALETTE.ui.textMuted),
  hover: skin('hover', PALETTE.accent.cyanDeep),
  active: skin('active', PALETTE.accent.cyanDeep),
  disabled: skin('disabled', PALETTE.ui.disabledText),
};

/**
 * One row, in this file's own vocabulary.
 *
 * `ink` and `accent` are what the icon drawing calls its two strong tones, and
 * the palette calls the same two `text` and `bar` because on a plain button they
 * are type and a marker stripe. Translated once here rather than renaming either
 * side: the palette's names are right for a button and these are right for an
 * icon, and the mapping is the only thing that would otherwise be implicit.
 */
function skin(state, shade) {
  const b = PALETTE.button[state];
  return { bg: b.bg, edge: b.edge, ink: b.text, accent: b.bar, shade };
}

const cache = new Map();

/**
 * One icon button, plate and all.
 *
 * @param {keyof typeof ART|'brush1'|'brush2'|'brush3'} name
 * @param {'idle'|'hover'|'active'|'disabled'} state
 * @param {{size?: number, scale?: number, plate?: boolean}} [opts]
 *   `scale` is texels per art cell and must be a whole number — the art is
 *   pixels, and a fractional scale is the one thing that would put a grey edge
 *   on it. `plate: false` draws the glyph alone, for icons that sit on top of
 *   something else (the slot's bin) rather than in a toolbar.
 */
export function iconTexture(name, state = 'idle', { size = 28, scale = 1, plate = true } = {}) {
  const key = `${name}:${state}:${size}:${scale}:${plate}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const art = name.startsWith('brush')
    ? brushArt([1.5, 2.5, 4][Number(name.slice(5)) - 1] ?? 2.5)
    : name === 'redo'
      ? ART.undo.map((row) => [...row].reverse().join(''))
      : ART[name];
  if (!art) throw new Error(`unknown icon: ${name}`);

  const skin = SKINS[state] ?? SKINS.idle;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  if (plate) {
    ctx.fillStyle = skin.bg;
    ctx.fillRect(0, 0, size, size);
    ctx.strokeStyle = skin.edge;
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, size - 1, size - 1);
  } else {
    ctx.clearRect(0, 0, size, size);
  }

  // Whole texels per cell, centred. A 16-cell grid in a 28-texel plate gives 1
  // with 6 either side; anything that does not divide is floored rather than
  // stretched, because a half-texel icon is a blurry one.
  const cell = Math.max(1, Math.floor((size * 0.72) / art.length));
  const span = cell * art.length;
  const ox = Math.round((size - span) / 2);
  const oy = Math.round((size - span) / 2);
  const colours = { '#': skin.ink, o: skin.shade, '+': skin.accent };

  for (let y = 0; y < art.length; y++) {
    const row = art[y];
    for (let x = 0; x < row.length; x++) {
      const colour = colours[row[x]];
      if (!colour) continue;
      ctx.fillStyle = colour;
      ctx.fillRect(ox + x * cell, oy + y * cell, cell, cell);
    }
  }

  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData = { width: size, height: size };
  cache.set(key, tex);
  return tex;
}

/**
 * A square tile: the frame a slot's thumbnail sits in.
 *
 * The menu's plate palette, squared off. `menuPlateTexture` is 256x52 and draws
 * a label and a left marker bar, none of which a thumbnail wants — but the four
 * colours are the same four, so a slot reads as part of the same menu rather
 * than as something bolted on.
 *
 * `accent: true` is the built-in logo's tile. The brief asks for it to be
 * "구분되게 표시" and it is the one tile with no bin and no editing, so it is
 * given the gold edge the toolbar uses for "selected" — a tile that is visibly
 * special before you touch it, without a word of text explaining why.
 */
export function tileTexture(state = 'idle', { size = 76, accent = false } = {}) {
  const key = `tile:${state}:${size}:${accent}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const skin = SKINS[state] ?? SKINS.idle;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, size, size);
  ctx.strokeStyle = accent ? SKINS.active.edge : skin.edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, size - 2, size - 2);

  return finishIcon(key, canvas, size);
}

/**
 * A player badge: `1P` / `2P`, lit when that player is wearing this mark.
 *
 * The one piece of type in this screen that is not the save button, and it is
 * type because there is no picture of "player one". Two characters, drawn the
 * same thresholded way the rest of the UI draws text.
 */
export function badgeTexture(player, on, { width = 30, height = 20 } = {}) {
  const key = `badge:${player}:${on}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const skin = on ? SKINS.active : SKINS.idle;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

  // Thresholded, for the reason every other label in this project is: the font
  // rasteriser antialiases regardless of `imageSmoothingEnabled`, and those
  // intermediate values come out of the 5-bit quantiser as coloured fringing.
  // 대상에 바로 그린다. 스크래치 캔버스에 그려 알파를 110 에서 자르고
  // blit 하던 것을 없앴다 — 그 임계 처리가 막으려던 디더와 5비트 양자화가
  // 파이프라인에 없다.
  ctx.save();
  ctx.font = `bold 12px ui-monospace, Menlo, monospace`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = on ? skin.ink : skin.shade;
  ctx.fillText(`${player + 1}P`, width / 2, height - 6);
  ctx.restore();

  return finishIcon(key, canvas, width, height);
}

/**
 * A line of type on a plate. The confirm dialog's question, and nothing else.
 *
 * The brief allows text in exactly two places — this and the save button — so
 * this helper is deliberately not general: one line, centred, no wrapping. A
 * question that does not fit is a question that should be shorter.
 */
export function messageTexture(text, { width = 300, height = 44, tone = 'idle' } = {}) {
  const key = `msg:${text}:${width}x${height}:${tone}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const skin = SKINS[tone] ?? SKINS.idle;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // 대상에 바로 그린다. 스크래치 캔버스에 그려 알파를 110 에서 자르고
  // blit 하던 것을 없앴다 — 그 임계 처리가 막으려던 디더와 5비트 양자화가
  // 파이프라인에 없다.
  ctx.save();
  ctx.font = 'bold 15px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = skin.ink;
  ctx.fillText(text, width / 2, height / 2 + 6);
  ctx.restore();

  return finishIcon(key, canvas, width, height);
}

/**
 * The save button: an icon AND the word, which is the brief's one exception.
 *
 * "저장 버튼만 예외로 텍스트가 있다" — every other control on the screen is a
 * picture, and this one is the commit. It is the action a player must not have
 * to guess at, and it is the only one whose consequence cannot be undone by
 * looking at the screen and pressing something else.
 */
export function saveButtonTexture(state = 'idle', { width = 108, height = 34 } = {}) {
  const key = `savebtn:${state}:${width}x${height}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const skin = SKINS[state] ?? SKINS.idle;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  ctx.fillStyle = skin.bg;
  ctx.fillRect(0, 0, width, height);
  ctx.strokeStyle = skin.edge;
  ctx.lineWidth = 2;
  ctx.strokeRect(1, 1, width - 2, height - 2);

  // The same disk the toolbar would show, drawn plateless and inline so the
  // icon and the word are one image and cannot drift apart on screen.
  const disk = iconTexture('save', state, { size: height - 10, plate: false });
  ctx.drawImage(disk.image, 6, 5);

  // 대상에 바로 그린다. 스크래치 캔버스에 그려 알파를 110 에서 자르고
  // blit 하던 것을 없앴다 — 그 임계 처리가 막으려던 디더와 5비트 양자화가
  // 파이프라인에 없다.
  ctx.save();
  ctx.font = 'bold 15px ui-monospace, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillStyle = skin.ink;
  ctx.fillText('저장', height - 2, height / 2 + 6);
  ctx.restore();

  return finishIcon(key, canvas, width, height);
}

/**
 * One opaque white texel. For quads that want a flat colour.
 *
 * `createSpriteMaterial`'s shader is `t.rgb * uTint` with `t.a * uOpacity`, and
 * it DISCARDS below an alpha of 0.004 — so a sprite handed `map: null` samples
 * three's default texture and vanishes rather than showing its tint. Anything
 * that wants to be a solid rectangle needs a real texel to multiply, and this
 * is it.
 */
export function solidTexture() {
  const key = 'solid';
  const hit = cache.get(key);
  if (hit) return hit;
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = PALETTE.fx.white;
  ctx.fillRect(0, 0, 1, 1);
  return finishIcon(key, canvas, 1, 1);
}

/** Shared tail: the project's texture settings, cached. */
function finishIcon(key, canvas, width, height = width) {
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.magFilter = LinearFilter;
  tex.minFilter = LinearFilter;
  tex.generateMipmaps = false;
  tex.anisotropy = 1;
  tex.wrapS = ClampToEdgeWrapping;
  tex.wrapT = ClampToEdgeWrapping;
  tex.needsUpdate = true;
  tex.userData = { width, height };
  cache.set(key, tex);
  return tex;
}

/** Every icon name, for the panel's preview sheet. */
export const ICON_NAMES = [...Object.keys(ART), 'redo', 'brush1', 'brush2', 'brush3'];

export const clearIconCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});
