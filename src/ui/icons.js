import { PALETTE, withAlpha } from '../core/palette.js';

/**
 * Every icon in the game, drawn as vector paths.
 *
 * ── why they stopped being type ─────────────────────────────────────────────
 * The cards used single Unicode glyphs, and `cardCatalog.js` records how they
 * were chosen: by rendering candidates at 46px and COUNTING INKED PIXELS, because
 * the pipeline thresholded alpha to hard 0/255 and then quantised to five bits a
 * channel, so anything with fill in it arrived as a lump. The note records the
 * measurements — a lozenge at 402 pixels blocked up, a double chevron at 228
 * passed.
 *
 * That constraint is gone once PHASE 4 removes the alpha threshold, and with it
 * the reason to accept whatever shape a font happened to provide. These are
 * drawn instead, which also means they share a stroke weight, a corner radius
 * and a visual density that six glyphs from one typeface never did.
 *
 * ── the signature is `(ctx, size, color)` ───────────────────────────────────
 * Each entry draws inside a `size` x `size` box with its origin at 0,0 and
 * leaves the context as it found it. `drawIcon` below is what callers use — it
 * handles placement and the aero gloss pass.
 *
 * ── `glyph` is now a KEY ────────────────────────────────────────────────────
 * `cardCatalog.js` still has a `glyph` field. It is no longer rendered; it is
 * looked up in `CARD_ICON` to find the drawing function. That keeps the mapping
 * out of `src/game/`, which art work does not edit, and means a card whose icon
 * has not been drawn yet falls back rather than throwing.
 */

/** Stroke weight as a fraction of the icon box. One value, every icon. */
const STROKE = 0.11;
/** How far icon geometry stays inside the box, so strokes never clip. */
const PAD = 0.16;

function setup(ctx, size, color) {
  ctx.lineWidth = size * STROKE;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
}

/** An arrowhead at (x, y) pointing along `angle`, sized off the stroke. */
function arrowHead(ctx, size, x, y, angle) {
  const a = size * 0.17;
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x - a * Math.cos(angle - 0.45), y - a * Math.sin(angle - 0.45));
  ctx.moveTo(x, y);
  ctx.lineTo(x - a * Math.cos(angle + 0.45), y - a * Math.sin(angle + 0.45));
  ctx.stroke();
}

/* ── card icons ──────────────────────────────────────────────────────────── */

/** 교체 — two arrows passing each other. */
function iconSwap(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  const yTop = size * 0.36;
  const yBot = size * 0.64;
  ctx.beginPath();
  ctx.moveTo(l, yTop);
  ctx.lineTo(r, yTop);
  ctx.stroke();
  arrowHead(ctx, size, r, yTop, 0);
  ctx.beginPath();
  ctx.moveTo(r, yBot);
  ctx.lineTo(l, yBot);
  ctx.stroke();
  arrowHead(ctx, size, l, yBot, Math.PI);
}

/** 궤적 — a launch arc with its landing point. */
function iconTrajectory(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  const base = size * 0.74;
  ctx.beginPath();
  ctx.moveTo(l, base);
  ctx.quadraticCurveTo(size * 0.5, size * 0.02, r, base);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(l, base, size * 0.085, 0, Math.PI * 2);
  ctx.fill();
  arrowHead(ctx, size, r, base, Math.PI * 0.42);
}

/** 혼돈 — an unequal six-arm burst. Deliberately not a symmetric asterisk. */
function iconChaos(ctx, size, color) {
  setup(ctx, size, color);
  const c = size / 2;
  const arms = [
    [-Math.PI / 2, 0.40],
    [-Math.PI / 6, 0.32],
    [Math.PI / 6, 0.38],
    [Math.PI / 2, 0.30],
    [(Math.PI * 5) / 6, 0.36],
    [(-Math.PI * 5) / 6, 0.29],
  ];
  for (const [a, len] of arms) {
    ctx.beginPath();
    ctx.moveTo(c, c);
    ctx.lineTo(c + Math.cos(a) * size * len, c + Math.sin(a) * size * len);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(c, c, size * 0.085, 0, Math.PI * 2);
  ctx.fill();
}

/** 한 번 더 — a circular arrow, open at the top right. */
function iconOnemore(ctx, size, color) {
  setup(ctx, size, color);
  const c = size / 2;
  const r = size * 0.30;
  const from = -Math.PI * 0.35;
  const to = Math.PI * 1.35;
  ctx.beginPath();
  ctx.arc(c, c, r, from, to);
  ctx.stroke();
  const hx = c + Math.cos(from) * r;
  const hy = c + Math.sin(from) * r;
  arrowHead(ctx, size, hx, hy, from - Math.PI / 2);
}

/** 강타 — a double chevron. The one shape that survived from the glyph set. */
function iconSmash(ctx, size, color) {
  setup(ctx, size, color);
  const mid = size * 0.5;
  const top = size * 0.24;
  const bot = size * 0.76;
  for (const x of [size * 0.3, size * 0.56]) {
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x + size * 0.2, mid);
    ctx.lineTo(x, bot);
    ctx.stroke();
  }
}

/**
 * 침묵 — a padlock.
 *
 * The glyph was a slashed circle, which is the generic "no". A padlock says the
 * specific thing this card does, and it is the SAME shape `fxTextures.lockTexture`
 * stamps on a silenced cap — so the card in the hand and the mark on the board
 * are one vocabulary rather than two.
 */
function iconSilence(ctx, size, color) {
  setup(ctx, size, color);
  const bw = size * 0.52;
  const bh = size * 0.34;
  const bx = (size - bw) / 2;
  const by = size * 0.5;
  const r = size * 0.08;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(bx, by, bw, bh, r);
  else ctx.rect(bx, by, bw, bh);
  ctx.fill();
  ctx.lineWidth = size * 0.095;
  ctx.beginPath();
  ctx.arc(size / 2, by, size * 0.17, Math.PI, 0);
  ctx.stroke();
}

/* ── UI icons ────────────────────────────────────────────────────────────── */

/** Recentre — four corner brackets around a dot. Kept from the old HUD. */
function iconRecenter(ctx, size, color) {
  setup(ctx, size, color);
  const p = size * 0.22;
  const q = size * (1 - 0.22);
  const arm = size * 0.16;
  const corners = [
    [p, p, 1, 1], [q, p, -1, 1], [p, q, 1, -1], [q, q, -1, -1],
  ];
  for (const [x, y, sx, sy] of corners) {
    ctx.beginPath();
    ctx.moveTo(x + sx * arm, y);
    ctx.lineTo(x, y);
    ctx.lineTo(x, y + sy * arm);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.075, 0, Math.PI * 2);
  ctx.fill();
}

/** Exit — a door with an arrow leaving it. */
function iconExit(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * 0.22;
  const t = size * 0.2;
  const b = size * 0.8;
  ctx.beginPath();
  ctx.moveTo(size * 0.52, t);
  ctx.lineTo(l, t);
  ctx.lineTo(l, b);
  ctx.lineTo(size * 0.52, b);
  ctx.stroke();
  const y = size / 2;
  ctx.beginPath();
  ctx.moveTo(size * 0.46, y);
  ctx.lineTo(size * 0.8, y);
  ctx.stroke();
  arrowHead(ctx, size, size * 0.8, y, 0);
}

/** Back — a single chevron, left. */
function iconBack(ctx, size, color) {
  setup(ctx, size, color);
  ctx.beginPath();
  ctx.moveTo(size * 0.62, size * 0.22);
  ctx.lineTo(size * 0.36, size * 0.5);
  ctx.lineTo(size * 0.62, size * 0.78);
  ctx.stroke();
}

/** Confirm — a tick. */
function iconCheck(ctx, size, color) {
  setup(ctx, size, color);
  ctx.beginPath();
  ctx.moveTo(size * 0.22, size * 0.53);
  ctx.lineTo(size * 0.42, size * 0.72);
  ctx.lineTo(size * 0.78, size * 0.28);
  ctx.stroke();
}

/** Dismiss — a cross. */
function iconClose(ctx, size, color) {
  setup(ctx, size, color);
  const a = size * 0.28;
  const b = size * 0.72;
  ctx.beginPath();
  ctx.moveTo(a, a);
  ctx.lineTo(b, b);
  ctx.moveTo(b, a);
  ctx.lineTo(a, b);
  ctx.stroke();
}

/** Sound — a speaker with one arc. */
function iconSound(ctx, size, color) {
  setup(ctx, size, color);
  ctx.beginPath();
  ctx.moveTo(size * 0.2, size * 0.4);
  ctx.lineTo(size * 0.34, size * 0.4);
  ctx.lineTo(size * 0.5, size * 0.24);
  ctx.lineTo(size * 0.5, size * 0.76);
  ctx.lineTo(size * 0.34, size * 0.6);
  ctx.lineTo(size * 0.2, size * 0.6);
  ctx.closePath();
  ctx.fill();
  ctx.lineWidth = size * 0.085;
  ctx.beginPath();
  ctx.arc(size * 0.54, size * 0.5, size * 0.18, -Math.PI / 3, Math.PI / 3);
  ctx.stroke();
}

/**
 * 왕관 뚜껑. 이 게임의 물건.
 *
 * 21개의 주름이 실제 크라운 코르크의 개수다 — `src/cap/` 의 지오메트리가 같은
 * 수를 쓴다. 아이콘에서 그 수를 세는 사람은 없지만, 세었을 때 맞는 편이 낫다.
 *
 * 채우기 하나로 그린다. 선으로 그린 왕관 뚜껑은 작은 크기에서 주름이 서로 붙어
 * 그냥 톱니바퀴가 된다.
 */
function iconCap(ctx, size, color) {
  setup(ctx, size, color);
  const cx = size / 2;
  const cy = size / 2;
  const outer = size * 0.44;
  const inner = size * 0.38;
  const teeth = 21;
  ctx.beginPath();
  for (let i = 0; i < teeth * 2; i++) {
    const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
    const r = i % 2 === 0 ? outer : inner;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.fill();
}

/* ── 마크 편집기의 도구 ───────────────────────────────────────────────────── */

/**
 * 열 개의 도구 아이콘.
 *
 * ── 손으로 찍은 16x16 비트맵이었다 ─────────────────────────────────────────
 * `markIcons.js` 에 '.#o+' 네 문자로 그린 격자가 아이콘마다 하나씩 있었고, 그
 * 파일의 머리말이 왜 그래야 했는지 적어 두었다: 폰트 글리프는 기계마다 다른 그림을
 * 배포하게 되고, 알파 이진화와 5비트 양자화를 거치면 채워진 글리프가 덩어리가 된다.
 *
 * 둘 다 사실이 아니게 됐다. 이진화도 양자화도 없고, 이 파일의 아이콘은 폰트에서
 * 오는 것이 아니라 그려지는 것이라 기계마다 다르지도 않다. 남은 것은 비트맵의
 * 비용뿐이다: 정수 배율로만 확대할 수 있어서 크기가 프레임을 따라가지 못하고,
 * 선 굵기가 나머지 UI 와 다르다.
 *
 * 헷갈리기 쉬운 두 쌍은 원래 주석이 지적한 그대로 유지한다:
 *   지우개 vs 전체 지우기 — 하나는 **도구**(비스듬한 블록), 하나는 **행위**(가위표
 *     친 캔버스). 실루엣이 다르지 변형이 아니다.
 *   전체 지우기 vs 삭제 — 전자는 그림을 비우고 칸을 남기고, 후자는 칸을 버린다.
 *     휴지통만 뚜껑과 사다리꼴이 있고, 휴지통만 툴바가 아니라 칸 위에 있다.
 */

/** 그리기. 대각선 위의 연필. */
function iconPencil(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  ctx.beginPath();
  ctx.moveTo(l, r);
  ctx.lineTo(l + size * 0.1, r - size * 0.24);
  ctx.lineTo(r - size * 0.16, l + size * 0.08);
  ctx.lineTo(r, l + size * 0.24);
  ctx.lineTo(l + size * 0.26, r - size * 0.1);
  ctx.closePath();
  ctx.stroke();
  // 심. 촉 쪽 한 획으로 어느 쪽이 앞인지 말한다.
  ctx.beginPath();
  ctx.moveTo(l + size * 0.1, r - size * 0.24);
  ctx.lineTo(l + size * 0.26, r - size * 0.1);
  ctx.stroke();
}

/** 미리보기. 눈. */
function iconEye(ctx, size, color) {
  setup(ctx, size, color);
  const cx = size / 2;
  const cy = size / 2;
  const w = size * (0.5 - PAD * 0.5);
  ctx.beginPath();
  ctx.moveTo(cx - w, cy);
  ctx.quadraticCurveTo(cx, cy - size * 0.3, cx + w, cy);
  ctx.quadraticCurveTo(cx, cy + size * 0.3, cx - w, cy);
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.11, 0, Math.PI * 2);
  ctx.fill();
}

/** 지우개. 비스듬한 블록, 밝은 작업면. */
function iconEraser(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(-0.6);
  ctx.translate(-size / 2, -size / 2);
  const w = r - l;
  const h = size * 0.34;
  const y = (size - h) / 2;
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(l, y, w, h, size * 0.07);
  else ctx.rect(l, y, w, h);
  ctx.stroke();
  // 작업면. 블록의 한쪽 끝만 채워서 어느 쪽이 종이에 닿는지 말한다.
  ctx.beginPath();
  ctx.moveTo(l + w * 0.34, y);
  ctx.lineTo(l + w * 0.34, y + h);
  ctx.stroke();
  ctx.restore();
}

/** 전체 지우기. 가위표 친 캔버스. */
function iconClear(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size * (1 - PAD);
  ctx.beginPath();
  if (typeof ctx.roundRect === 'function') ctx.roundRect(l, l, r - l, r - l, size * 0.09);
  else ctx.rect(l, l, r - l, r - l);
  ctx.stroke();
  const i = size * 0.3;
  ctx.beginPath();
  ctx.moveTo(i, i);
  ctx.lineTo(size - i, size - i);
  ctx.moveTo(size - i, i);
  ctx.lineTo(i, size - i);
  ctx.stroke();
}

/** 되돌리기. 반시계로 도는 화살표. `redo` 는 이것을 좌우로 뒤집은 것. */
function iconUndo(ctx, size, color) {
  setup(ctx, size, color);
  const cx = size * 0.54;
  const cy = size * 0.56;
  const r = size * 0.26;
  ctx.beginPath();
  ctx.arc(cx, cy, r, Math.PI * 0.9, Math.PI * 2.1);
  ctx.stroke();
  const hx = cx + r * Math.cos(Math.PI * 0.9);
  const hy = cy + r * Math.sin(Math.PI * 0.9);
  arrowHead(ctx, size, hx, hy, Math.PI * 1.4);
}

function iconRedo(ctx, size, color) {
  ctx.save();
  ctx.translate(size, 0);
  ctx.scale(-1, 1);
  iconUndo(ctx, size, color);
  ctx.restore();
}

/** 삭제. 휴지통 — 뚜껑과 사다리꼴과 살. */
function iconTrash(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * 0.24;
  const r = size - l;
  const top = size * 0.32;
  ctx.beginPath();
  ctx.moveTo(size * 0.16, top);
  ctx.lineTo(size - size * 0.16, top);
  ctx.stroke();
  // 손잡이.
  ctx.beginPath();
  ctx.moveTo(size * 0.4, top);
  ctx.lineTo(size * 0.42, size * 0.2);
  ctx.lineTo(size * 0.58, size * 0.2);
  ctx.lineTo(size * 0.6, top);
  ctx.stroke();
  // 통. 아래로 좁아진다.
  ctx.beginPath();
  ctx.moveTo(l, top + size * 0.04);
  ctx.lineTo(l + size * 0.06, size * 0.84);
  ctx.lineTo(r - size * 0.06, size * 0.84);
  ctx.lineTo(r, top + size * 0.04);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size * 0.5, top + size * 0.14);
  ctx.lineTo(size * 0.5, size * 0.74);
  ctx.stroke();
}

/** 빈 칸. 더하기. */
function iconPlus(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * (PAD + 0.06);
  const r = size - l;
  ctx.beginPath();
  ctx.moveTo(size / 2, l);
  ctx.lineTo(size / 2, r);
  ctx.moveTo(l, size / 2);
  ctx.lineTo(r, size / 2);
  ctx.stroke();
}

/** 저장. 디스크 — 셔터와 라벨. */
function iconSave(ctx, size, color) {
  setup(ctx, size, color);
  const l = size * PAD;
  const r = size - l;
  ctx.beginPath();
  ctx.moveTo(l, l);
  ctx.lineTo(r - size * 0.12, l);
  ctx.lineTo(r, l + size * 0.12);
  ctx.lineTo(r, r);
  ctx.lineTo(l, r);
  ctx.closePath();
  ctx.stroke();
  // 셔터. 위쪽.
  ctx.beginPath();
  ctx.rect(l + size * 0.14, l, size * 0.4, size * 0.2);
  ctx.stroke();
  // 라벨. 아래쪽.
  ctx.beginPath();
  ctx.rect(l + size * 0.1, r - size * 0.26, r - l - size * 0.2, size * 0.26);
  ctx.stroke();
}

/**
 * 붓 굵기. 점 하나, `weight` 만큼.
 *
 * 16셀 격자에 지름 1.5 / 2.5 / 4 짜리 원을 찍던 것을 그대로 옮겼다 — 세 개가
 * 나란히 놓이므로 절대 크기가 아니라 서로의 비율이 읽히는 값이다.
 */
function brushDot(weight) {
  return (ctx, size, color) => {
    setup(ctx, size, color);
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, (size * weight) / 16, 0, Math.PI * 2);
    ctx.fill();
  };
}

export const ICON = {
  cap: iconCap,
  pencil: iconPencil,
  eye: iconEye,
  eraser: iconEraser,
  clear: iconClear,
  undo: iconUndo,
  redo: iconRedo,
  trash: iconTrash,
  plus: iconPlus,
  save: iconSave,
  brush1: brushDot(1.5),
  brush2: brushDot(2.5),
  brush3: brushDot(4),
  swap: iconSwap,
  trajectory: iconTrajectory,
  chaos: iconChaos,
  onemore: iconOnemore,
  smash: iconSmash,
  silence: iconSilence,
  lock: iconSilence,
  recenter: iconRecenter,
  exit: iconExit,
  back: iconBack,
  check: iconCheck,
  close: iconClose,
  sound: iconSound,
};

/**
 * `cardCatalog` glyph -> icon name.
 *
 * Keyed on the glyph rather than the card id because the glyph is the field the
 * brief allows to change and the id is the field it does not. A card whose glyph
 * is not in here falls through to the id, and then to nothing drawn — never to a
 * throw, because a missing icon must not take the hand down mid-match.
 */
export const CARD_ICON = {
  '⇄': 'swap',
  '⌁': 'trajectory',
  '✳': 'chaos',
  '↻': 'onemore',
  '≫': 'smash',
  '⊘': 'silence',
};

/** Which icon a catalog card should draw. */
export function iconForCard(card) {
  return CARD_ICON[card?.glyph] ?? (ICON[card?.id] ? card.id : null);
}

/**
 * Draw an icon, with the aero gloss pass.
 *
 * ── the gloss goes through an offscreen canvas, and it has to ───────────────
 * The highlight is "white over the top 45% of the icon's own pixels", which is
 * `globalCompositeOperation = 'source-atop'`. Run against the destination canvas
 * that would composite onto everything already drawn there — the plate, its
 * gradient, its border. So the icon is rendered to its own surface, glossed
 * there where it is the only content, and blitted.
 */
export function drawIcon(ctx, name, { x, y, size, color, gloss = true }) {
  const fn = ICON[name];
  if (!fn) return;

  if (!gloss) {
    ctx.save();
    ctx.translate(x, y);
    fn(ctx, size, color);
    ctx.restore();
    return;
  }

  // Rounded up so a fractional frame-pixel size still gets whole texels, and
  // floored at 8 because the gloss gradient needs somewhere to land.
  const edge = Math.max(8, Math.ceil(size));
  const off = document.createElement('canvas');
  off.width = edge;
  off.height = edge;
  const octx = off.getContext('2d');
  fn(octx, edge, color);

  octx.globalCompositeOperation = 'source-atop';
  const g = octx.createLinearGradient(0, 0, 0, edge * 0.55);
  g.addColorStop(0, withAlpha(PALETTE.ui.glossHi, 0.55));
  g.addColorStop(1, withAlpha(PALETTE.ui.glossLo, 0));
  octx.fillStyle = g;
  octx.fillRect(0, 0, edge, edge);

  ctx.drawImage(off, x, y, size, size);
}
