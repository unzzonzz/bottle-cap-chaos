/**
 * The display voice: titles and numerals, drawn as strokes rather than typed.
 *
 * ── why this exists ─────────────────────────────────────────────────────────
 * The UI face is Gowun Dodum and it ships as ONE static weight. That is a good
 * text face and it cannot be a display face: hierarchy on a page normally comes
 * from weight, and with one weight there is none to spend. §5 of the brief asks
 * for the two voices to be far apart — an expressive display against a precise
 * utility — and a single-weight face can only supply the second.
 *
 * So the two loudest things on any screen are not set in it. The title and the
 * score are drawn here: 1990s drink-packaging lettering, round and heavy, with
 * enough character that it reads as a MARK rather than as large text.
 *
 * Three things fall out of that, and all three were problems before:
 *   - the logo no longer depends on a webfont having loaded. `ui/fonts.js` has a
 *     whole mechanism for texture caches baked before the face arrives; the
 *     title was the worst case and is now outside it entirely.
 *   - the score can be as heavy as the direction wants without a 700 weight
 *     existing, and without the browser faking one.
 *   - a title can be laid out as a picture — curved, cropped, used as a
 *     compositional element — because it is geometry rather than a text run.
 *
 * ── it is a stroke system, not an outline font ──────────────────────────────
 * Every glyph is a set of polylines in a unit box, drawn with a round cap and a
 * round join. That is the whole of the "round and heavy" — the weight is
 * `lineWidth`, so one number changes the whole voice, and a stroke system stays
 * correct at any size where an outline traced by hand would need hinting.
 *
 * ── Hangul is COMPOSED, not tabulated ──────────────────────────────────────
 * There are 11172 syllables. Drawing the six in the game's name and stopping
 * would mean the next screen title needs a code change, which is how the last
 * two directions' logos ended up hard-coded. Instead the 24 jamo are drawn once
 * and `compose()` places them by the three standard layouts. Any modern Korean
 * string works, including one nobody has typed yet.
 */

import { RULE } from '../core/tokens.js';

/* ── the stroke alphabet ──────────────────────────────────────────────────────
 * Each entry is a list of paths. A path is either an array of `[x, y]` points in
 * the unit box (a polyline) or `{ o: [cx, cy, r] }` (a circle, for ㅇ and ㅎ).
 *
 * The unit box is 0..1 on both axes with y DOWN, which is the canvas convention
 * and keeps every coordinate readable next to the drawing code.
 *
 * ── the strokes overshoot their box, deliberately ──────────────────────────
 * A round cap adds half the line weight past the endpoint. Ending a horizontal
 * bar exactly at x = 1 makes the glyph wider than its box by that half-weight,
 * and two adjacent jamo then touch. Every terminal below sits at 0.06/0.94
 * instead, which is where a heavy round terminal lands ON the box edge.
 */
const T = 0.06;
const B = 1 - T;

/** Leading and trailing consonants. Doubles are composed from these. */
const CONSONANT = {
  ㄱ: [[[T, T], [B, T], [B * 0.92, B]]],
  ㄴ: [[[T, T], [T, B], [B, B]]],
  ㄷ: [[[B, T], [T, T], [T, B], [B, B]]],
  ㄹ: [[[T, T], [B, T], [B, 0.5], [T, 0.5], [T, B], [B, B]]],
  ㅁ: [[[T, T], [B, T], [B, B], [T, B], [T, T]]],
  ㅂ: [
    [[T, T], [T, B], [B, B], [B, T]],
    [[T, 0.52], [B, 0.52]],
  ],
  ㅅ: [
    [[0.5, T], [T, B]],
    [[0.5, T], [B, B]],
  ],
  ㅇ: [{ o: [0.5, 0.5, 0.5 - T] }],
  ㅈ: [
    [[T, T], [B, T]],
    [[0.5, T], [T, B]],
    [[0.5, T], [B, B]],
  ],
  ㅊ: [
    [[0.5, T], [0.5, 0.2]],
    [[T, 0.32], [B, 0.32]],
    [[0.5, 0.32], [T, B]],
    [[0.5, 0.32], [B, B]],
  ],
  ㅋ: [
    [[T, T], [B, T], [B * 0.92, B]],
    [[T, 0.5], [B, 0.5]],
  ],
  ㅌ: [
    [[B, T], [T, T], [T, B], [B, B]],
    [[T, 0.5], [B, 0.5]],
  ],
  ㅍ: [
    [[T, 0.2], [B, 0.2]],
    [[T, B], [B, B]],
    [[0.3, 0.2], [0.3, B]],
    [[0.7, 0.2], [0.7, B]],
  ],
  ㅎ: [
    [[0.5, T], [0.5, 0.16]],
    [[0.22, 0.3], [0.78, 0.3]],
    { o: [0.5, 0.66, 0.28] },
  ],
};

/** The five doubles, as the pair each is made of. */
const DOUBLE = { ㄲ: 'ㄱ', ㄸ: 'ㄷ', ㅃ: 'ㅂ', ㅆ: 'ㅅ', ㅉ: 'ㅈ' };

/**
 * Vowels, in their own unit box.
 *
 * `axis` is what `compose()` needs: a vertical vowel sits to the RIGHT of the
 * lead, a horizontal one sits BELOW it, and a mixed one wraps around both. It is
 * a property of the letterform, so it lives with the letterform.
 */
const STEM = 0.62;
const VOWEL = {
  ㅏ: { axis: 'v', p: [[[STEM, T], [STEM, B]], [[STEM, 0.5], [B, 0.5]]] },
  ㅑ: { axis: 'v', p: [[[STEM, T], [STEM, B]], [[STEM, 0.34], [B, 0.34]], [[STEM, 0.66], [B, 0.66]]] },
  ㅓ: { axis: 'v', p: [[[STEM, T], [STEM, B]], [[T, 0.5], [STEM, 0.5]]] },
  ㅕ: { axis: 'v', p: [[[STEM, T], [STEM, B]], [[T, 0.34], [STEM, 0.34]], [[T, 0.66], [STEM, 0.66]]] },
  ㅣ: { axis: 'v', p: [[[STEM, T], [STEM, B]]] },
  ㅐ: { axis: 'v', p: [[[0.42, T], [0.42, B]], [[0.42, 0.5], [0.8, 0.5]], [[0.8, T], [0.8, B]]] },
  ㅒ: {
    axis: 'v',
    p: [[[0.42, T], [0.42, B]], [[0.42, 0.34], [0.8, 0.34]], [[0.42, 0.66], [0.8, 0.66]], [[0.8, T], [0.8, B]]],
  },
  ㅔ: { axis: 'v', p: [[[0.42, T], [0.42, B]], [[T, 0.5], [0.42, 0.5]], [[0.8, T], [0.8, B]]] },
  ㅖ: {
    axis: 'v',
    p: [[[0.42, T], [0.42, B]], [[T, 0.34], [0.42, 0.34]], [[T, 0.66], [0.42, 0.66]], [[0.8, T], [0.8, B]]],
  },

  ㅗ: { axis: 'h', p: [[[T, STEM], [B, STEM]], [[0.5, 0.16], [0.5, STEM]]] },
  ㅛ: { axis: 'h', p: [[[T, STEM], [B, STEM]], [[0.34, 0.16], [0.34, STEM]], [[0.66, 0.16], [0.66, STEM]]] },
  ㅜ: { axis: 'h', p: [[[T, 0.38], [B, 0.38]], [[0.5, 0.38], [0.5, 0.84]]] },
  ㅠ: { axis: 'h', p: [[[T, 0.38], [B, 0.38]], [[0.34, 0.38], [0.34, 0.84]], [[0.66, 0.38], [0.66, 0.84]]] },
  ㅡ: { axis: 'h', p: [[[T, 0.5], [B, 0.5]]] },

  ㅘ: { axis: 'm', p: [[[T, 0.62], [0.5, 0.62]], [[0.28, 0.2], [0.28, 0.62]], [[0.74, T], [0.74, B]], [[0.74, 0.4], [B, 0.4]]] },
  ㅙ: {
    axis: 'm',
    p: [[[T, 0.62], [0.44, 0.62]], [[0.26, 0.2], [0.26, 0.62]], [[0.66, T], [0.66, B]], [[0.66, 0.4], [0.86, 0.4]], [[0.86, T], [0.86, B]]],
  },
  ㅚ: { axis: 'm', p: [[[T, 0.62], [0.58, 0.62]], [[0.32, 0.2], [0.32, 0.62]], [[0.8, T], [0.8, B]]] },
  ㅝ: { axis: 'm', p: [[[T, 0.4], [0.5, 0.4]], [[0.28, 0.4], [0.28, 0.82]], [[0.74, T], [0.74, B]], [[0.56, 0.5], [0.74, 0.5]]] },
  ㅞ: {
    axis: 'm',
    p: [[[T, 0.4], [0.44, 0.4]], [[0.26, 0.4], [0.26, 0.82]], [[0.66, T], [0.66, B]], [[0.5, 0.5], [0.66, 0.5]], [[0.86, T], [0.86, B]]],
  },
  ㅟ: { axis: 'm', p: [[[T, 0.4], [0.58, 0.4]], [[0.32, 0.4], [0.32, 0.82]], [[0.8, T], [0.8, B]]] },
  ㅢ: { axis: 'm', p: [[[T, 0.5], [0.58, 0.5]], [[0.8, T], [0.8, B]]] },
};

/** Jamo order in the Unicode syllable formula. `''` is "no final". */
const LEADS = 'ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ';
const VOWELS = 'ㅏㅐㅑㅒㅓㅔㅕㅖㅗㅘㅙㅚㅛㅜㅝㅞㅟㅠㅡㅢㅣ';
const FINALS = ['', ...'ㄱㄲㄳㄴㄵㄶㄷㄹㄺㄻㄼㄽㄾㄿㅀㅁㅂㅄㅅㅆㅇㅈㅊㅋㅌㅍㅎ'];

/** The eleven cluster finals, as the two consonants each is written with. */
const CLUSTER = {
  ㄳ: 'ㄱㅅ', ㄵ: 'ㄴㅈ', ㄶ: 'ㄴㅎ', ㄺ: 'ㄹㄱ', ㄻ: 'ㄹㅁ', ㄼ: 'ㄹㅂ',
  ㄽ: 'ㄹㅅ', ㄾ: 'ㄹㅌ', ㄿ: 'ㄹㅍ', ㅀ: 'ㄹㅎ', ㅄ: 'ㅂㅅ',
};

/**
 * Digits, in the same unit box.
 *
 * ── these are the score, and the score is read from across the room ────────
 * Wide, round and closed. Nothing here is a stylised numeral for its own sake:
 * `1` gets a full foot because a bare stem next to a `7` at speed is a guess,
 * and `6`/`9` close all the way round because an open bowl reads as `b`/`q` at
 * the size a corner score is drawn.
 */
const DIGIT = {
  0: [{ o: [0.5, 0.5, 0.42] }],
  1: [[[0.24, 0.24], [0.5, T]], [[0.5, T], [0.5, B]], [[0.22, B], [0.78, B]]],
  2: [[[0.12, 0.26], [0.3, T], [0.7, T], [0.88, 0.26], [0.7, 0.5], [0.14, B], [0.88, B]]],
  3: [
    [[0.14, 0.16], [0.34, T], [0.72, T], [0.86, 0.24], [0.66, 0.46], [0.4, 0.46]],
    [[0.66, 0.46], [0.88, 0.68], [0.72, B], [0.32, B], [0.12, 0.84]],
  ],
  4: [[[0.66, T], [0.12, 0.68], [0.9, 0.68]], [[0.66, 0.34], [0.66, B]]],
  5: [[[0.8, T], [0.28, T], [0.22, 0.42], [0.56, 0.36], [0.84, 0.56], [0.7, B], [0.28, B], [0.14, 0.84]]],
  6: [
    [[0.76, 0.1], [0.5, T], [0.24, 0.24], [0.16, 0.6]],
    { o: [0.5, 0.68, 0.34] },
  ],
  7: [[[0.12, T], [0.88, T], [0.42, B]]],
  8: [{ o: [0.5, 0.26, 0.24] }, { o: [0.5, 0.72, 0.3] }],
  9: [
    { o: [0.5, 0.32, 0.34] },
    [[0.84, 0.4], [0.76, 0.76], [0.5, B], [0.24, 0.9]],
  ],
};

/**
 * The few Latin marks a title actually uses.
 *
 * Not an alphabet. The mode names in §10 — SUMMER TABLE, SUMMER LAWN, SUMMER
 * PORCH — are set in the text face, because they are English words on a Korean
 * page and lettering them would make them the loudest thing on a screen whose
 * loudest thing is elsewhere. What is here is what a NUMERIC display needs.
 */
const MARK = {
  ':': [{ o: [0.5, 0.3, 0.08] }, { o: [0.5, 0.72, 0.08] }],
  '-': [[[0.14, 0.5], [0.86, 0.5]]],
  '.': [{ o: [0.5, 0.86, 0.09] }],
  '/': [[[0.82, T], [0.18, B]]],
  ' ': [],
};

/* ── metrics ─────────────────────────────────────────────────────────────── */

/**
 * How wide each class of glyph is, as a multiple of the size.
 *
 * A Hangul syllable is square by construction. A digit is narrower, because a
 * square digit in a run of four leaves the run looking gapped — the counters
 * inside `0` and `8` already carry the width.
 *
 * ── the advance is also the glyph's DRAWN width, and that was a bug ────────
 * Every glyph above is authored in a 0..1 box on both axes. Advancing a digit
 * by 0.66 while drawing it 1.0 wide is not a tighter setting, it is an overlap:
 * `0123456789` came out as a single braid of strokes. So the drawing scales x
 * by the advance — a digit is drawn in a 0.66-wide box — and `0` becomes an
 * ellipse rather than a circle, which is what a condensed numeral wants anyway.
 *
 * The stroke WEIGHT stays keyed to the em rather than to the box, or narrow
 * glyphs would come out lighter than square ones standing next to them.
 */
const ADVANCE = { hangul: 1, digit: 0.68, mark: 0.42 };

/** Stroke weight as a fraction of the size. This one number IS the voice. */
const WEIGHT = 0.135;

const isSyllable = (c) => c >= 0xac00 && c <= 0xd7a3;

function classOf(ch) {
  const c = ch.codePointAt(0);
  if (isSyllable(c)) return 'hangul';
  if (ch >= '0' && ch <= '9') return 'digit';
  return 'mark';
}

/**
 * The width of a lettered string, in the same units as `size`.
 *
 * `tracking` is per gap rather than per character, so a one-character string is
 * exactly its advance and a caller centring one digit is not off by half a gap.
 */
export function letteringWidth(text, size, tracking = 0) {
  const chars = [...String(text)];
  if (!chars.length) return 0;
  let w = 0;
  for (const ch of chars) w += ADVANCE[classOf(ch)] * size;
  return w + tracking * (chars.length - 1);
}

/* ── composition ─────────────────────────────────────────────────────────── */

/** Map a unit-box path into a rect, then emit it. */
function place(out, paths, x, y, w, h) {
  for (const p of paths) {
    if (p.o) {
      out.push({ o: [x + p.o[0] * w, y + p.o[1] * h, p.o[2] * Math.min(w, h)] });
    } else {
      out.push(p.map(([px, py]) => [x + px * w, y + py * h]));
    }
  }
}

/** A consonant's paths, doubling it into `w` if it is one of the five. */
function consonantPaths(out, jamo, x, y, w, h) {
  const single = DOUBLE[jamo];
  if (single) {
    const half = w * 0.46;
    place(out, CONSONANT[single], x, y, half, h);
    place(out, CONSONANT[single], x + w - half, y, half, h);
    return;
  }
  const paths = CONSONANT[jamo];
  if (paths) place(out, paths, x, y, w, h);
}

/**
 * One syllable's strokes, in a unit box.
 *
 * ── the three layouts, and the fourth thing that changes them ──────────────
 * A vertical vowel puts the lead on the left and the vowel on the right; a
 * horizontal one puts the lead on top and the vowel below; a mixed one wraps.
 * A FINAL compresses whichever of those into the top and takes the bottom
 * third — which is why every branch below is written as "the part above the
 * final", with the final's presence as one number (`top`) rather than as six
 * more branches.
 */
function syllablePaths(code) {
  const i = code - 0xac00;
  const lead = LEADS[Math.floor(i / 588)];
  const vowel = VOWELS[Math.floor((i % 588) / 28)];
  const final = FINALS[i % 28];

  const out = [];
  const v = VOWEL[vowel];
  const top = final ? 0.68 : 1;

  if (v.axis === 'v') {
    consonantPaths(out, lead, 0, 0, 0.56, top);
    place(out, v.p, 0.44, 0, 0.56, top);
  } else if (v.axis === 'h') {
    consonantPaths(out, lead, 0.2, 0, 0.6, top * 0.62);
    place(out, v.p, 0, top * 0.48, 1, top * 0.52);
  } else {
    consonantPaths(out, lead, 0.02, 0, 0.5, top * 0.6);
    place(out, v.p, 0, 0, 1, top);
  }

  if (final) {
    const pair = CLUSTER[final];
    if (pair) {
      consonantPaths(out, pair[0], 0.02, 0.66, 0.46, 0.34);
      consonantPaths(out, pair[1], 0.52, 0.66, 0.46, 0.34);
    } else {
      consonantPaths(out, final, 0.2, 0.66, 0.6, 0.34);
    }
  }
  return out;
}

/**
 * Any character's strokes, in a unit box, or `null` for one there is no glyph for.
 *
 * Returning `null` rather than an empty list matters: the caller draws a hollow
 * box for a missing glyph. Silently drawing nothing is how a typo in an authored
 * title ships — the word is simply shorter and nobody notices.
 */
function glyphPaths(ch) {
  const code = ch.codePointAt(0);
  if (isSyllable(code)) return syllablePaths(code);
  if (DIGIT[ch]) return DIGIT[ch];
  if (MARK[ch]) return MARK[ch];
  return null;
}

/* ── drawing ─────────────────────────────────────────────────────────────── */

function strokePaths(ctx, paths, x, y, w, h, weight) {
  ctx.lineWidth = weight;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const p of paths) {
    ctx.beginPath();
    if (p.o) {
      /**
       * `ellipse` rather than `arc`, because the box is not always square.
       *
       * It predates `roundRect` by years and needs no fallback. The radii are
       * the unit radius scaled per axis, so a circle in a 0.68-wide digit box
       * comes out as the oval a condensed `0` is supposed to be.
       */
      ctx.ellipse(x + p.o[0] * w, y + p.o[1] * h, p.o[2] * w, p.o[2] * h, 0, 0, Math.PI * 2);
    } else {
      p.forEach(([px, py], k) => {
        const ax = x + px * w;
        const ay = y + py * h;
        if (k === 0) ctx.moveTo(ax, ay);
        else ctx.lineTo(ax, ay);
      });
    }
    ctx.stroke();
  }
}

/**
 * Draw a lettered string.
 *
 * @param {CanvasRenderingContext2D} ctx
 * @param {string} text
 * @param {object} o
 * @param {number} o.x         left, centre or right, per `align`
 * @param {number} o.y         the TOP of the em box, per `baseline`
 * @param {number} o.size      the em box, in the caller's units
 * @param {string} o.color
 * @param {number} [o.tracking] extra space per gap, in the caller's units
 * @param {number} [o.weight]   stroke weight as a fraction of `size`
 * @param {'left'|'center'|'right'} [o.align]
 * @param {'top'|'middle'} [o.baseline]
 * @returns {{x: number, y: number, width: number, height: number}} what was drawn
 */
export function drawLettering(ctx, text, o) {
  const {
    x, y, size, color, tracking = 0, weight = WEIGHT,
    align = 'left', baseline = 'top',
  } = o;
  const chars = [...String(text)];
  const width = letteringWidth(text, size, tracking);

  let left = x;
  if (align === 'center') left = x - width / 2;
  else if (align === 'right') left = x - width;
  const top = baseline === 'middle' ? y - size / 2 : y;

  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;

  let cursor = left;
  for (const ch of chars) {
    const advance = ADVANCE[classOf(ch)] * size;
    const paths = glyphPaths(ch);
    if (paths === null) {
      /**
       * 없는 글자는 **빈 상자로 그린다.** 아무것도 안 그리면 안 된다.
       *
       * 이 함수가 그리는 것은 전부 저술된 문자열이다 — 게임 이름, 화면 제목,
       * 점수. 없는 글자를 조용히 건너뛰면 단어가 한 글자 짧아질 뿐이고, 짧아진
       * 단어는 검토에서 통과한다. 상자는 통과하지 않는다.
       */
      ctx.lineWidth = size * weight * 0.5;
      ctx.strokeRect(cursor + size * 0.1, top + size * 0.1, advance - size * 0.2, size * 0.8);
    } else {
      strokePaths(ctx, paths, cursor, top, advance, size, size * weight);
    }
    cursor += advance + tracking;
  }

  ctx.restore();
  return { x: left, y: top, width, height: size };
}

/**
 * The game's name, as one call.
 *
 * ── the space is not a space ───────────────────────────────────────────────
 * 「한여름 알까기」 is two words and the gap between them is set WIDER than a
 * space would be, because at display size a normal word space reads as a
 * letter gap and the name comes out as one six-syllable word. The two-word
 * reading is the joke — a midsummer thing and a children's game — so it has to
 * survive being large.
 *
 * @returns {{x: number, y: number, width: number, height: number}}
 */
export function drawTitle(ctx, o) {
  const { x, y, size, color, align = 'center', baseline = 'top' } = o;
  const tracking = size * 0.06;
  const gap = size * 0.34;

  const a = '한여름';
  const b = '알까기';
  const wa = letteringWidth(a, size, tracking);
  const wb = letteringWidth(b, size, tracking);
  const width = wa + gap + wb;

  let left = x;
  if (align === 'center') left = x - width / 2;
  else if (align === 'right') left = x - width;
  const top = baseline === 'middle' ? y - size / 2 : y;

  drawLettering(ctx, a, { x: left, y: top, size, color, tracking });
  drawLettering(ctx, b, { x: left + wa + gap, y: top, size, color, tracking });
  return { x: left, y: top, width, height: size };
}

/**
 * A number, as the display voice.
 *
 * Separate from `drawLettering` only to hold the tracking: digits are set
 * TIGHT because a score is read as one quantity, and a normal gap makes "12"
 * read as a one and a two. This is the same argument the old `TYPE.display`
 * made with a negative letter-spacing, and it survives the face being replaced
 * because it was never about the face.
 *
 * The number is small and positive rather than negative, because the advance is
 * already 0.68 of the em — the digits are condensed before any tracking is
 * applied, and pulling them further closes the gap entirely.
 */
export function drawNumber(ctx, value, o) {
  return drawLettering(ctx, String(value), { ...o, tracking: o.size * 0.02 });
}

/**
 * The weight and the hairline, exported so a caller can align to them.
 *
 * `RULE.mark` is the interface's heaviest line and lettering is heavier than
 * that by design — it is not part of the interface's line system, it is a
 * picture. Exported so a layout that wants a rule to line up with a letter's
 * stem can ask rather than guess.
 */
export const LETTERING_WEIGHT = WEIGHT;
export const LETTERING_MIN_RULE = RULE.mark;
