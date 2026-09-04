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
 * 철벽 — three courses of brickwork with a stroke stopped flat against them.
 *
 * ── it has to be the opposite reading of 강타's chevrons ────────────────────
 * That icon is two open strokes thrusting right; put the two side by side and
 * this one is what they run into. So the courses are HORIZONTAL — square across
 * the thrust — and the short stroke on the left arrives and stops rather than
 * passing through. The stopping is the whole icon: courses on their own are a
 * wall, and a wall on its own does not say what it is for.
 *
 * ── it was three plain bars, and three plain bars is a LIST icon ────────────
 * The first version drew three staggered rectangles. Rendered beside the other
 * five it read as text alignment or as a bar chart, and worse, this card's own
 * background motif is horizontal bands — so the icon and the panel behind it
 * were the same shape and the icon dissolved into it. `cardTexture`'s motif note
 * is explicit that a background which makes the icon hard to read is a failure.
 *
 * Brickwork fixes both at once. The JOINTS are what a plain bar has not got:
 * they alternate course to course, which no chart or list does, and they are
 * fine detail against the motif's broad smooth bands, so the two stop competing.
 *
 * ── not a shield ───────────────────────────────────────────────────────────
 * There is no shield anywhere in this game, and a shield is CARRIED. It says "I
 * am protected wherever I go", where this card says "I do not move from here".
 * A wall is the thing that stays put.
 */
function iconResist(ctx, size, color) {
  setup(ctx, size, color);

  // The wall takes the right, leaving a lane for the stroke to arrive down.
  const left = size * 0.36;
  const right = size * (1 - PAD * 0.7);
  const top = size * 0.22;
  const courses = 3;
  const gap = size * 0.035;
  const h = (size * 0.56 - gap * (courses - 1)) / courses;
  const r = size * 0.022;
  const span = right - left;

  for (let i = 0; i < courses; i++) {
    const y = top + i * (h + gap);
    /**
     * Alternating half-brick offset, and it is the entire difference between a
     * wall and three bars: the joints have to LINE UP WRONG course to course.
     * An odd course opens with a short brick so the bond starts at the left edge
     * rather than wherever the loop happens to land.
     */
    const bond = i % 2 ? span * 0.28 : 0;
    let x = left;
    let first = true;
    while (x < right - 0.5) {
      const w = Math.min(first && bond ? bond : span * 0.56, right - x);
      ctx.beginPath();
      if (typeof ctx.roundRect === 'function') ctx.roundRect(x, y, w, h, r);
      else ctx.rect(x, y, w, h);
      ctx.fill();
      x += w + gap;
      first = false;
    }
  }

  /**
   * Arrives and stops flat against the wall.
   *
   * No arrowhead: an arrow is a thing still travelling, and the point is that it
   * is not. Butt cap rather than the file's usual round one, so the end reads as
   * blocked rather than as tapering.
   *
   * ── it has to be thinner than a course, and it has to not touch ────────────
   * Drawn at a course's own weight and run flush against the wall, it read as a
   * longer brick on the middle row — the icon lost the collision entirely and
   * went back to being masonry. Half the course height and a hairline of
   * daylight is what separates "a stroke stopped by the wall" from "part of the
   * wall": the gap is small enough to read as contact and large enough that the
   * two shapes stay two shapes.
   */
  ctx.lineCap = 'butt';
  ctx.lineWidth = h * 0.5;
  ctx.beginPath();
  ctx.moveTo(size * PAD * 0.7, size * 0.5);
  ctx.lineTo(left - gap * 1.6, size * 0.5);
  ctx.stroke();
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

/**
 * 뒤집기 — 왕관 뚜껑을 옆에서 본 모습과, 그 위를 넘어가는 화살표.
 *
 * ── 이 아이콘은 동작이면서 동시에 상태다 ────────────────────────────────────
 * 부록 J4.3: "눌린 순간 아이콘이 반 바퀴 돌아 현재 면을 반영 — 버튼이 곧 상태
 * 표시가 된다." 그래서 뚜껑을 원이 아니라 **옆모습**으로 그린다. 원은 뒤집어도
 * 같은 원이라 상태를 말할 수 없다. 옆모습은 평평한 판과 주름진 스커트가 위아래로
 * 다르므로, 180도 돌리면 눈에 보이게 다른 그림이 된다.
 *
 * 그 둘이 물리적으로 하는 일이 다르다는 것이 이 게임의 규칙이기도 하다 —
 * `capCollider.js` 의 `flippedFriction` 을 보라. 평평한 면이 아래면 미끄러지고,
 * 주름이 아래면 물린다. 아이콘이 말하는 것이 정확히 그 사실이다.
 *
 * 화살표는 뚜껑 **위쪽 반**을 돈다. 아래로 돌리면 아이콘 상자 밖으로 나가고,
 * 안쪽으로 줄이면 뚜껑과 겹쳐서 32픽셀에서는 한 덩어리가 된다.
 *
 * ── 두 상태는 같은 그림에 캔버스 변환 하나다 ────────────────────────────────
 * 위아래 뒤집힌 쪽을 좌표마다 손으로 미러링하면 호와 화살촉의 각도까지 따로
 * 뒤집어야 하고, 그건 부호 하나 틀리면 화살표만 반대로 도는 — 눈으로는 거의
 * 안 보이고 뜻은 정반대인 — 종류의 실수가 된다. `scale(1, -1)` 한 번이면 획
 * 굵기도 그대로고 두 그림이 정확히 서로의 거울이 된다.
 *
 * @param {number} dir  1 이면 판이 위(hem 이 바닥), -1 이면 뒤집힌 상태
 */
function drawFlip(ctx, size, color, dir) {
  ctx.save();
  if (dir < 0) {
    ctx.translate(0, size);
    ctx.scale(1, -1);
  }
  setup(ctx, size, color);

  // 뚜껑의 옆모습. 위가 평평한 판, 아래로 벌어지는 짧은 다리가 스커트다.
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size * 0.68);
  ctx.lineTo(size * 0.7, size * 0.68);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(size * 0.3, size * 0.68);
  ctx.lineTo(size * 0.26, size * 0.8);
  ctx.moveTo(size * 0.7, size * 0.68);
  ctx.lineTo(size * 0.74, size * 0.8);
  ctx.stroke();

  // 넘어가는 호. 뚜껑 위를 왼쪽에서 오른쪽으로 돈다.
  const c = size / 2;
  const rad = size * 0.25;
  const cy = size * 0.44;
  const to = Math.PI * 2.06;
  ctx.beginPath();
  ctx.arc(c, cy, rad, Math.PI * 0.94, to);
  ctx.stroke();
  // 끝에서 뚜껑 쪽으로 내려앉는 방향. 접선은 반지름에 수직이다.
  arrowHead(ctx, size, c + Math.cos(to) * rad, cy + Math.sin(to) * rad, to + Math.PI / 2);

  ctx.restore();
}

/** 뒤집기 — 판이 위. 지금 hem 으로 서 있는 뚜껑. */
function iconFlip(ctx, size, color) {
  drawFlip(ctx, size, color, 1);
}

/** 뒤집기 — 판이 아래. 지금 크라운으로 누워 있는 뚜껑. */
function iconFlipped(ctx, size, color) {
  drawFlip(ctx, size, color, -1);
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

/**
 * 되돌리기. 한 바퀴에서 조금 모자란 원호와, 그 끝의 화살촉.
 *
 * ── 처음 것이 부자연스러웠던 이유 두 가지 ───────────────────────────────────
 * 216도 호에 `arrowHead` 를 붙였는데, 그 각도가 손으로 고른 `PI * 1.4` 였다.
 * 호의 접선은 시작 각도에서 정해지므로 둘이 맞을 이유가 없었고, 실제로 화살촉이
 * 호가 가는 방향이 아니라 비스듬한 쪽을 가리켰다 — 화살표가 아니라 갈고리로
 * 보였다.
 *
 * 두 번째는 화살촉이 선 두 개였다는 것이다. `arrowHead` 는 획으로 그린 V 자이고,
 * 20 픽셀짜리 버튼에서 그 두 획은 호와 같은 굵기라 어디가 촉인지 읽히지 않았다.
 *
 * 그래서 접선을 **계산해서** 쓰고, 촉은 채운 삼각형이다. 작은 크기에서 방향을
 * 말하는 것은 선이 아니라 덩어리다.
 *
 * 호는 300도다. 한 바퀴에 가까워야 "되돌린다" 로 읽히고, 완전히 닫으면 화살촉이
 * 꼬리를 물어 원이 된다.
 */
function iconUndo(ctx, size, color) {
  setup(ctx, size, color);
  const cx = size / 2;
  const cy = size * 0.52;
  const r = size * 0.28;

  /**
   * 촉이 **왼쪽 위**에 앉는다. 그게 되돌리기다.
   *
   * 처음엔 촉이 오른쪽에 왔고, 그러면 시계 방향으로 읽혀 다시하기가 된다 — 바로
   * 옆에 진짜 다시하기(이것의 좌우 반전)가 있으므로 둘이 같은 말을 하게 된다.
   *
   * 캔버스 각도는 0도가 오른쪽, 90도가 아래다. -135도가 왼쪽 위이고, 거기서
   * 시계 반대 방향으로 300도 거슬러 오면 시작이 165도다.
   */
  const to = -Math.PI * 0.75;
  const from = to + Math.PI * (300 / 180);
  ctx.beginPath();
  ctx.arc(cx, cy, r, from, to, true);
  ctx.stroke();

  /**
   * 촉은 호가 **끝나는** 곳에 앉고, 방향은 그 점의 접선이다.
   *
   * 시계 반대 방향이므로 접선은 (sin a, -cos a) 다. 손으로 고른 각도가 아니라
   * 호에서 나온 값이라, 위의 `from`/`to` 를 바꿔도 촉은 저절로 따라간다.
   */
  const hx = cx + r * Math.cos(to);
  const hy = cy + r * Math.sin(to);
  const tx = Math.sin(to);
  const ty = -Math.cos(to);
  const a = size * 0.22;
  const w = size * 0.13;
  ctx.beginPath();
  ctx.moveTo(hx + tx * a * 0.5, hy + ty * a * 0.5);
  ctx.lineTo(hx - tx * a * 0.5 - ty * w, hy - ty * a * 0.5 + tx * w);
  ctx.lineTo(hx - tx * a * 0.5 + ty * w, hy - ty * a * 0.5 - tx * w);
  ctx.closePath();
  ctx.fill();
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

/* ── 메인 메뉴의 도구 ─────────────────────────────────────────────────────── */

/**
 * 설정. 톱니바퀴.
 *
 * 이 하나는 그림이 관습이라 그대로 따른다 — 다른 무엇을 그려도 "설정" 으로 읽히지
 * 않는다. 이가 여덟인 것은 스무 픽셀에서 세어지지 않으면서도 원이 아닌 최소치다:
 * 여섯이면 별로 보이고, 열둘이면 톱니가 뭉개져 원이 된다.
 */
function iconSettings(ctx, size, color) {
  setup(ctx, size, color);
  const cx = size / 2;
  const cy = size / 2;
  const teeth = 8;
  const outer = size * 0.42;
  const inner = size * 0.32;
  const half = Math.PI / teeth / 2.6;

  ctx.beginPath();
  for (let i = 0; i < teeth; i++) {
    const a = (i / teeth) * Math.PI * 2 - Math.PI / 2;
    // 이 하나: 안쪽 호를 따라오다 바깥으로 나갔다 돌아온다.
    ctx.lineTo(cx + Math.cos(a - half * 1.9) * inner, cy + Math.sin(a - half * 1.9) * inner);
    ctx.lineTo(cx + Math.cos(a - half) * outer, cy + Math.sin(a - half) * outer);
    ctx.lineTo(cx + Math.cos(a + half) * outer, cy + Math.sin(a + half) * outer);
    ctx.lineTo(cx + Math.cos(a + half * 1.9) * inner, cy + Math.sin(a + half * 1.9) * inner);
  }
  ctx.closePath();
  ctx.stroke();

  // 축. 채우지 않고 비운다 — 채우면 톱니가 붙은 원반이지 톱니바퀴가 아니다.
  ctx.beginPath();
  ctx.arc(cx, cy, size * 0.13, 0, Math.PI * 2);
  ctx.stroke();
}

/**
 * 내 마크. 겹쳐 놓인 뚜껑 둘.
 *
 * ── 두 번 틀렸고, 그 둘이 같은 실수였다 ────────────────────────────────────
 * 처음엔 뚜껑 하나 안에 위로 볼록한 호를 그렸는데, 뚜껑 테두리도 원이라 두 곡선이
 * 같은 방향으로 겹쳐 화살표(∧)가 됐다. 호를 대각선으로 바꿨더니 이번엔 원 안의
 * 사선, 즉 **금지 표시**(⊘)가 됐다. 둘 다 "원 안에 획 하나"라는 같은 구성이었고,
 * 그 구성은 이미 다른 뜻을 갖고 있다.
 *
 * 그래서 안에 무엇을 넣지 않는다. **뚜껑을 둘 겹친다** — "내 마크" 는 하나의
 * 그림이 아니라 모아 둔 것이고, 겹친 둘은 어느 크기에서도 "여럿" 으로 읽히며
 * 원 안의 획과 혼동될 구성이 아니다. 뚜껑 실루엣은 카드 뒷면(`iconCap`)과 같은
 * 것이라, 이 게임에서 마크가 얹히는 물건이 무엇인지도 함께 말한다.
 */
function iconMarks(ctx, size, color) {
  setup(ctx, size, color);
  const teeth = 21;
  const crown = (cx, cy, r) => {
    ctx.beginPath();
    for (let i = 0; i < teeth * 2; i++) {
      const a = (i / (teeth * 2)) * Math.PI * 2 - Math.PI / 2;
      const rr = i % 2 === 0 ? r : r * 0.86;
      const x = cx + Math.cos(a) * rr;
      const y = cy + Math.sin(a) * rr;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };

  // 뒤의 것. 윤곽만.
  crown(size * 0.62, size * 0.38, size * 0.3);
  ctx.stroke();

  /**
   * 앞의 것. 뒤의 것을 **지우고** 나서 그린다.
   *
   * 지우지 않으면 두 윤곽이 교차해 그물이 되고, 그러면 겹친 둘이 아니라 하나의
   * 복잡한 도형으로 보인다. 겹침이 읽히는 것은 앞의 것이 뒤의 것을 가릴 때다.
   */
  ctx.save();
  ctx.globalCompositeOperation = 'destination-out';
  crown(size * 0.38, size * 0.62, size * 0.34);
  ctx.fillStyle = '#000';
  ctx.fill();
  ctx.restore();

  crown(size * 0.38, size * 0.62, size * 0.3);
  ctx.stroke();
}

export const ICON = {
  settings: iconSettings,
  marks: iconMarks,
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
  resist: iconResist,
  silence: iconSilence,
  lock: iconSilence,
  recenter: iconRecenter,
  flip: iconFlip,
  flipped: iconFlipped,
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
  '▤': 'resist',
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

  /**
   * 광택이 없어도 **오프스크린을 거친다.**
   *
   * 예전에는 무광택이면 대상 컨텍스트에 바로 그렸다. 한 줄 짧고, 아이콘이 획과
   * 채우기만 쓰는 한 맞다.
   *
   * 맞지 않게 된 것은 겹친 뚜껑 두 개(`iconMarks`)를 그리면서다. 앞의 것이 뒤의
   * 것을 가리려면 `destination-out` 으로 지워야 하는데, 대상에 바로 그리면 그
   * 지우기가 **아이콘 아래의 판까지 뚫는다** — 실제로 버튼 한가운데에 구멍이
   * 뚫렸다.
   *
   * 오프스크린은 그 합성을 아이콘 안에 가둔다. 비용은 캔버스 하나이고, 아이콘은
   * 텍스처로 캐시되므로 한 번뿐이다.
   */
  const edge = Math.max(8, Math.ceil(size));
  const off = document.createElement('canvas');
  off.width = edge;
  off.height = edge;
  const octx = off.getContext('2d');
  fn(octx, edge, color);

  if (!gloss) {
    ctx.drawImage(off, x, y, size, size);
    return;
  }

  octx.globalCompositeOperation = 'source-atop';
  const g = octx.createLinearGradient(0, 0, 0, edge * 0.55);
  g.addColorStop(0, withAlpha(PALETTE.ui.glossHi, 0.55));
  g.addColorStop(1, withAlpha(PALETTE.ui.glossLo, 0));
  octx.fillStyle = g;
  octx.fillRect(0, 0, edge, edge);

  ctx.drawImage(off, x, y, size, size);
}
