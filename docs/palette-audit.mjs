/**
 * 팔레트 감사. `node docs/palette-audit.mjs`
 *
 * `docs/`에 있는 이유: 있어야 할 곳은 `tools/`인데 그 디렉터리는 아트 디렉션
 * 작업에서 수정 금지다. 규칙 설명은 docs/palette.md 에 있다.
 *
 * 지시서 v3 §4.1 의 하드 제약을 검사한다.
 *
 * ── 규칙이 v2 에서 바뀐 세 곳 ────────────────────────────────────────────────
 * 1. **크림/베이지 금지가 새로 들어왔다.** v3 §3 이 "차가운 흰색은 따뜻한
 *    아이보리가 아니다" 를 못박는다. 기계적으로 잴 수 있다 — 뉴트럴한 값의 파랑
 *    채널이 빨강 채널보다 낮으면 그것은 따뜻한 회색, 즉 베이지다.
 *
 * 2. **채도 상한에 휘도 조건이 붙었다.** HSV 채도는 어두운 값에서 무너진다:
 *    코발트 `#0d3b8c` 는 산술적으로 91% 이고 네온과는 아무 상관이 없다. 네온은
 *    **밝고** 채도가 높은 것이므로, 채도 상한은 L >= 0.20 인 값에만 건다. 절대
 *    색도(chroma) 상한은 밝기와 무관하게 전부에 건다 — 그쪽이 네온을 실제로
 *    잡는 자다.
 *
 * 3. **그림자 규칙이 "쿨"에서 "코발트"로 좁아졌다.** v2 는 남색 또는 청록을
 *    허용했다. v3 은 어두운 값이 필요하면 `cobaltInk` 라고 적었으므로, 검사도
 *    그 한 값인지를 본다.
 */
import { PALETTE } from '../src/core/palette.js';

const LUM_FLOOR = 0.05;
const SAT_CAP = 0.88;
const SAT_CAP_ABOVE_L = 0.2;
const CHROMA_CAP = 0.8;
const PLAYER_LUM_GAP = 0.15;

const srgb = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function lum(hex) { const [r, g, b] = rgb(hex); return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
function sat(hex) { const [r, g, b] = rgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }
function chroma(hex) { const [r, g, b] = rgb(hex); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
function hue(hex) {
  const [r, g, b] = rgb(hex).map((v) => v / 255);
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn;
  if (!d) return -1;
  const x = mx === r ? ((g - b) / d + 6) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return x * 60;
}

/**
 * 크림·베이지인가.
 *
 * ── "빨강이 파랑보다 높다" 로는 못 잰다 ────────────────────────────────────
 * 그 자를 쓰면 산호색의 옅은 틴트(`playerPale[0]` `#f7cec4`)가 걸린다. 그건
 * 베이지가 아니라 1P 색을 밝게 민 것이고, 그 값이 존재하는 이유는 그 위에 1P
 * 잉크로 글씨를 쓰기 위해서다.
 *
 * 실제 구분은 **색상**에 있다. 크림과 베이지는 노랑-주황(25~70도)에 낮은 채도로
 * 앉아 있고, 옅은 산호는 12~15도다. 측정: `#e8dcc0` 42도, `#dcb27a` 34도,
 * `#f7cec4` 12도.
 *
 * ── 색도 하한이 필요하다 ───────────────────────────────────────────────────
 * 거의 무채색인 값도 잔여 색상을 하나 갖는다. `#e7e6e0` 은 51도지만 색도가
 * 0.027 이라 아무도 그것을 따뜻하다고 보지 않는다 — 반올림 잔차다. 진짜 크림은
 * 0.10 위에 있으므로(측정: `#ece2d2` 0.10, `#e8dcc0` 0.16) 하한을 0.06 에 둔다.
 */
function isCreamOrBeige(hex) {
  const c = chroma(hex);
  const h = hue(hex);
  return c >= 0.06 && c < 0.34 && h >= 25 && h <= 70;
}

const seen = [];
(function walk(node, path) {
  if (typeof node === 'string') { if (/^#[0-9a-f]{6}$/i.test(node)) seen.push([path, node]); return; }
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
})(PALETTE, '');

// `additive`/`additiveZero` 는 가산 합성 강도 램프다. 어두운 항목은 "거의 더하지
// 않음"이지 어두운 표면이 아니다 — 휘도 하한과 뉴트럴 규칙은 면제, 색도 상한은 적용.
const isAdditive = (p) => p === 'additiveZero' || p.startsWith('additive.');

/**
 * 규칙 2 가 걸리는 자리 — **뉴트럴로 쓰이는 값만.**
 *
 * 면제 목록을 길게 쓰는 대신 적용 목록을 짧게 쓴다. 규칙이 금지하는 것은
 * "따뜻한 아이보리를 주 뉴트럴로 쓰는 것" 이지 사물이 따뜻한 색을 갖는 것이
 * 아니기 때문이다 — 나무는 나무이고 §4.1.2 도 회색으로 만들라고 하지 않았다.
 *
 * `metal.liner` 가 목록에 있는 이유는 그것이 사물의 색이면서 동시에 크림이었기
 * 때문이다: 뚜껑 안쪽 코르크 라이너가 `#e8ddc4` 였고, 그것이 이 파일에 남아 있던
 * 마지막 아이보리 중 하나였다.
 */
const NEUTRAL_SCOPE = [
  /^whiteCool$/, /^bluePale$/, /^ui\./, /^menu\.label/, /^label\./,
  /^marks\.checker/, /^metal\.liner$/, /^curling\.targetLight$/,
];
const inNeutralScope = (p) => NEUTRAL_SCOPE.some((re) => re.test(p));

const fail = [];
for (const [path, hex] of seen) {
  const L = lum(hex), S = sat(hex), C = chroma(hex);
  if (hex.toLowerCase() === '#000000' && path !== 'additiveZero') fail.push(`RULE1 PURE BLACK    ${path} = ${hex}`);
  if (L < LUM_FLOOR && !isAdditive(path)) fail.push(`RULE1 TOO DARK      ${path} = ${hex}  L=${L.toFixed(4)} (floor ${LUM_FLOOR})`);
  if (inNeutralScope(path) && isCreamOrBeige(hex)) {
    fail.push(`RULE2 CREAM/BEIGE   ${path} = ${hex}  hue=${hue(hex).toFixed(0)}deg  chroma=${C.toFixed(2)}`);
  }
  if (L >= SAT_CAP_ABOVE_L && S > SAT_CAP) fail.push(`RULE3 TOO SATURATED ${path} = ${hex}  HSV S=${(S * 100).toFixed(1)}% at L=${L.toFixed(2)}`);
  if (C > CHROMA_CAP) fail.push(`RULE3 NEON          ${path} = ${hex}  chroma=${C.toFixed(2)} (cap ${CHROMA_CAP})`);
}

// RULE 1 의 다른 반쪽 — 어두운 값은 코발트여야 한다.
for (const [path, hex] of [['ui.shadow', PALETTE.ui.shadow], ['menu.shadow', PALETTE.menu.shadow]]) {
  if (hex !== PALETTE.cobaltInk) fail.push(`RULE1 SHADOW NOT COBALT  ${path} = ${hex} (want ${PALETTE.cobaltInk})`);
}

// RULE 4 — 1P/2P 절대 휘도차.
const gap = Math.abs(lum(PALETTE.player[0]) - lum(PALETTE.player[1]));
if (gap < PLAYER_LUM_GAP) fail.push(`RULE4 PLAYER LUM GAP  ${gap.toFixed(3)} < ${PLAYER_LUM_GAP}`);

const uniq = new Set(seen.map(([, h]) => h.toLowerCase()));
console.log(`${seen.length} colour slots, ${uniq.size} distinct values`);
console.log(`player luminance gap: ${gap.toFixed(3)} (rule 4 needs >= ${PLAYER_LUM_GAP})`);
console.log(`paper is cool: whiteCool b-r = ${rgb(PALETTE.whiteCool)[2] - rgb(PALETTE.whiteCool)[0]} (rule 2 needs > 0)\n`);

const P = PALETTE;
/**
 * 대비 목표. 위쪽은 규칙 5(타입), 아래쪽은 §11 의 침해 불가 가독성 목록이다.
 *
 * §11 이 이름으로 부른 일곱 항목이 전부 여기 있어야 한다 — 뚜껑 두 개, 아웃
 * 라인, 오차 콘, 컬링 거리 마크, 카드 상태, 그리고 얇은 획의 본문.
 */
const checks = [
  ['RULE5 ui.text on ui.surface', contrast(P.ui.text, P.ui.surface), 4.5],
  ['RULE5 ui.textMuted on ui.surface', contrast(P.ui.textMuted, P.ui.surface), 4.5],
  ['RULE5 ui.text on ui.surfaceSunken', contrast(P.ui.text, P.ui.surfaceSunken), 4.5],
  ['RULE5 textOnAccent on bg.skyTop (sky type)', contrast(P.ui.textOnAccent, P.bg.skyTop), 4.5],
  ['RULE5 textOnAccent on cobalt (handover)', contrast(P.ui.textOnAccent, P.cobalt), 4.5],
  ['RULE5 ui.text on bg.skyLow', contrast(P.ui.text, P.bg.skyLow), 4.5],
  ['RULE5 playerInk[0] on ui.surface', contrast(P.playerInk[0], P.ui.surface), 4.5],
  ['RULE5 playerInk[1] on ui.surface', contrast(P.playerInk[1], P.ui.surface), 4.5],
  ['RULE5 button.hover text on surface', contrast(P.button.hover.text, P.ui.surface), 4.5],
  ['      button.disabled text on surface', contrast(P.button.disabled.text, P.ui.surface), 2.0],
  ['      ui.edgeStrong on ui.surface (the rule)', contrast(P.ui.edgeStrong, P.ui.surface), 2.0],
  ['§11   board.line on board.wood (out-line)', contrast(P.board.line, P.board.wood), 3.0],
  ['§11   pitch.line on pitch.grassA', contrast(P.pitch.line, P.pitch.grassA), 2.0],
  ['§11   curling.targetDark on curling.table', contrast(P.curling.targetDark, P.curling.table), 3.0],
  ['§11   curling.targetDark on targetLight', contrast(P.curling.targetDark, P.curling.targetLight), 4.5],
  ['§11   aim.cone edge on board.wood', contrast(P.aim.cone, P.board.wood), 1.5],
  ['§11   aim.cone edge on pitch.grassA', contrast(P.aim.cone, P.pitch.grassA), 1.5],
  ['§11   aim.cone edge on curling.table', contrast(P.aim.cone, P.curling.table), 1.5],
  ['      aim.bow on board.wood', contrast(P.aim.bow, P.board.wood), 1.5],
  ['      aim.bow on pitch.grassA', contrast(P.aim.bow, P.pitch.grassA), 1.5],
  ['      aim.bow on curling.table', contrast(P.aim.bow, P.curling.table), 1.5],
  ['      aim.bow on bg.below', contrast(P.aim.bow, P.bg.below), 1.5],
  ['      aim.pull on board.wood', contrast(P.aim.pull, P.board.wood), 2.0],
  ['      aim.path on board.wood', contrast(P.aim.path, P.board.wood), 1.5],
  ['      aim.clamp on board.wood', contrast(P.aim.clamp, P.board.wood), 2.0],
  ['§11   player[0] cap on board.wood', contrast(P.player[0], P.board.wood), 1.3],
  ['§11   player[1] cap on board.wood', contrast(P.player[1], P.board.wood), 1.3],
  ['§11   player[0] cap on pitch.grassA', contrast(P.player[0], P.pitch.grassA), 1.3],
  ['§11   player[1] cap on pitch.grassA', contrast(P.player[1], P.pitch.grassA), 1.3],
  ['§11   player[0] cap on curling.table', contrast(P.player[0], P.curling.table), 1.3],
  ['§11   player[1] cap on curling.table', contrast(P.player[1], P.curling.table), 1.3],
  ['      playerInk[0] vs playerInk[1] (marks)', contrast(P.playerInk[0], P.playerInk[1]), 1.5],
  ['      brand cap vs player[0]', contrast(P.menu.capBrand, P.player[0]), 1.6],
  ['      brand cap vs neutral cap (chroma apart)', Math.abs(chroma(P.menu.capBrand) - chroma(P.menu.capDefault)) * 10, 3.0],
];
let soft = 0;
for (const [name, got, want] of checks) {
  const ok = got >= want;
  if (!ok) soft++;
  console.log(`${ok ? '  ok ' : '  LOW'}  ${name.padEnd(46)} ${got.toFixed(2)}:1  (want >= ${want})`);
}

/**
 * 카드 일곱 장은 **색상환에서** 갈려야 한다. 대비로 재면 아무 말도 안 나온다 —
 * 전부 같은 흰 종이 위에 그려지므로 서로에 대한 대비는 의미가 없다.
 */
const cards = Object.entries(PALETTE.card);
console.log('\ncard accents — separation is by HUE, and by CHROMA where the hue repeats:');
let cardFail = 0;
for (const [id, hex] of cards) {
  const onPaper = contrast(hex, PALETTE.ui.surface);
  if (onPaper < 3.0) { cardFail++; }
  console.log(`  ${onPaper >= 3 ? 'ok ' : 'LOW'}  ${id.padEnd(11)} ${hex}  h=${hue(hex).toFixed(0).padStart(3)}deg  C=${chroma(hex).toFixed(2)}  on card face ${onPaper.toFixed(2)}:1`);
}
for (let i = 0; i < cards.length; i++) {
  for (let j = i + 1; j < cards.length; j++) {
    let dh = Math.abs(hue(cards[i][1]) - hue(cards[j][1]));
    if (dh > 180) dh = 360 - dh;
    const dc = Math.abs(chroma(cards[i][1]) - chroma(cards[j][1]));
    if (dh < 20 && dc < 0.2) {
      cardFail++;
      console.log(`  CLASH ${cards[i][0]} / ${cards[j][0]}: ${dh.toFixed(0)}deg apart, chroma ${dc.toFixed(2)} apart`);
    }
  }
}
soft += cardFail;

console.log();
if (fail.length) { console.log('HARD RULE VIOLATIONS:'); fail.forEach((f) => console.log('  ' + f)); }
else console.log('rules 1-4: no pure black, L >= 0.05, cobalt shadows, no warm neutrals, nothing neon, player gap  — PASS');
console.log(soft ? `\n${soft} contrast/separation target(s) below goal` : '\nall contrast and separation targets met');
process.exit(fail.length || soft ? 1 : 0);
