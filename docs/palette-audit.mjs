/**
 * 팔레트 감사. `node docs/palette-audit.mjs`
 *
 * `docs/`에 있는 이유: 있어야 할 곳은 `tools/`인데 그 디렉터리는 아트 디렉션
 * 작업에서 수정 금지다. 규칙 설명은 docs/palette.md 에 있다.
 *
 * v2 지시서 §2.1의 하드 제약 5개를 검사한다.
 */
import { PALETTE } from '../src/core/palette.js';

const LUM_FLOOR = 0.06;
// 지시서는 "HSL S <= 88%"라고 쓰지만 문자 그대로 쓰면 안 된다: HSL 채도는 옅은
// 틴트에서 무너져서 크림색 #fff6e0 이 100%로 나오고 진짜 네온과 구분되지 않는다.
// 그래서 HSV 채도(회색으로부터의 거리) + 크로마(절대 색도) 두 개로 건다.
const SAT_CAP = 0.88;
const CHROMA_CAP = 0.80;
const PLAYER_LUM_GAP = 0.15;

const srgb = (c) => { const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; };
function lum(hex) { const [r, g, b] = rgb(hex); return 0.2126 * srgb(r) + 0.7152 * srgb(g) + 0.0722 * srgb(b); }
function sat(hex) { const [r, g, b] = rgb(hex); const mx = Math.max(r, g, b), mn = Math.min(r, g, b); return mx === 0 ? 0 : (mx - mn) / mx; }
function chroma(hex) { const [r, g, b] = rgb(hex); return (Math.max(r, g, b) - Math.min(r, g, b)) / 255; }
function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
/** 남색/청록 계열인가 — 파랑 채널이 빨강보다 뚜렷하게 높은가. */
function isCoolDark(hex) { const [r, g, b] = rgb(hex); return b > r + 18 && chroma(hex) > 0.08; }

const seen = [];
(function walk(node, path) {
  if (typeof node === 'string') { if (/^#[0-9a-f]{6}$/i.test(node)) seen.push([path, node]); return; }
  if (Array.isArray(node)) return node.forEach((v, i) => walk(v, `${path}[${i}]`));
  if (node && typeof node === 'object') return Object.entries(node).forEach(([k, v]) => walk(v, path ? `${path}.${k}` : k));
})(PALETTE, '');

// `additive`/`additiveZero` 는 가산 합성 강도 램프다. 어두운 항목은 "거의 더하지
// 않음"이지 어두운 표면이 아니다 — 휘도 하한은 면제, 채도 상한은 그대로 적용.
const isAdditive = (p) => p === 'additiveZero' || p.startsWith('additive.');

const fail = [];
for (const [path, hex] of seen) {
  if (hex.toLowerCase() === '#000000' && path !== 'additiveZero') fail.push(`RULE1 PURE BLACK   ${path} = ${hex}`);
  const L = lum(hex), S = sat(hex), C = chroma(hex);
  if (L < LUM_FLOOR && !isAdditive(path)) fail.push(`RULE1 TOO DARK     ${path} = ${hex}  L=${L.toFixed(4)} (floor ${LUM_FLOOR})`);
  if (S > SAT_CAP) fail.push(`RULE3 TOO SATURATED ${path} = ${hex}  HSV S=${(S * 100).toFixed(1)}% (cap ${SAT_CAP * 100}%)`);
  if (C > CHROMA_CAP) fail.push(`RULE3 NEON         ${path} = ${hex}  chroma=${C.toFixed(2)} (cap ${CHROMA_CAP})`);
}

// RULE 2 — 그림자는 검정이 아니라 남색/청록.
for (const [path, hex] of [['ui.shadow', PALETTE.ui.shadow], ['menu.shadow', PALETTE.menu.shadow]]) {
  if (!isCoolDark(hex)) fail.push(`RULE2 SHADOW NOT COOL  ${path} = ${hex}`);
}

// RULE 4 — 1P/2P 절대 휘도차.
const gap = Math.abs(lum(PALETTE.player[0]) - lum(PALETTE.player[1]));
if (gap < PLAYER_LUM_GAP) fail.push(`RULE4 PLAYER LUM GAP  ${gap.toFixed(3)} < ${PLAYER_LUM_GAP}`);

const uniq = new Set(seen.map(([, h]) => h.toLowerCase()));
console.log(`${seen.length} colour slots, ${uniq.size} distinct values`);
console.log(`player luminance gap: ${gap.toFixed(3)} (rule 4 needs >= ${PLAYER_LUM_GAP})\n`);

const P = PALETTE;
// RULE 5 는 아래 표의 텍스트 항목들이 담당한다. 나머지는 §0.4 게임플레이 가독성.
const checks = [
  ['RULE5 ui.text on ui.surface', contrast(P.ui.text, P.ui.surface), 4.5],
  ['RULE5 ui.textMuted on ui.surface', contrast(P.ui.textMuted, P.ui.surface), 4.5],
  ['RULE5 ui.text on ui.glassBottom', contrast(P.ui.text, P.ui.glassBottom), 4.5],
  ['RULE5 textOnAccent on bg.skyTop (sky type)', contrast(P.ui.textOnAccent, P.bg.skyTop), 4.5],
  ['RULE5 ui.text on bg.skyLow (glass over sky)', contrast(P.ui.text, P.bg.skyLow), 4.5],
  ['RULE5 textOnAccent on accent.cyan', contrast(P.ui.textOnAccent, P.accent.cyan), 2.5],
  ['RULE5 playerInk[0] on ui.surface', contrast(P.playerInk[0], P.ui.surface), 4.5],
  ['RULE5 playerInk[1] on ui.surface', contrast(P.playerInk[1], P.ui.surface), 4.5],
  ['RULE5 button.hover text on bg', contrast(P.button.hover.text, P.button.hover.bg), 4.5],
  ['      button.disabled text on bg', contrast(P.button.disabled.text, P.button.disabled.bg), 2.0],
  ['0.4   board.line on board.wood (out-line)', contrast(P.board.line, P.board.wood), 3.0],
  ['0.4   pitch.line on pitch.grassA', contrast(P.pitch.line, P.pitch.grassA), 2.0],
  ['0.4   curling.targetLine on curling.table', contrast(P.curling.targetLine, P.curling.table), 3.0],
  ['0.4   aim.bow on board.wood', contrast(P.aim.bow, P.board.wood), 1.5],
  ['0.4   aim.bow on pitch.grassA', contrast(P.aim.bow, P.pitch.grassA), 1.5],
  ['0.4   aim.bow on curling.table', contrast(P.aim.bow, P.curling.table), 1.5],
  ['0.4   aim.bow on bg.skyLow', contrast(P.aim.bow, P.bg.skyLow), 1.5],
  ['0.4   aim.pull on board.wood', contrast(P.aim.pull, P.board.wood), 2.0],
  ['0.4   aim.path on board.wood', contrast(P.aim.path, P.board.wood), 1.5],
  ['0.4   aim.clamp on board.wood', contrast(P.aim.clamp, P.board.wood), 2.0],
  ['0.4   player[0] cap on board.wood', contrast(P.player[0], P.board.wood), 1.3],
  ['0.4   player[1] cap on board.wood', contrast(P.player[1], P.board.wood), 1.3],
  ['0.4   player[0] cap on pitch.grassA', contrast(P.player[0], P.pitch.grassA), 1.3],
  ['0.4   player[1] cap on pitch.grassA', contrast(P.player[1], P.pitch.grassA), 1.3],
  ['0.4   player[0] cap on curling.table', contrast(P.player[0], P.curling.table), 1.3],
  ['0.4   player[1] cap on curling.table', contrast(P.player[1], P.curling.table), 1.3],
  ['0.4   playerInk[0] vs playerInk[1] (marks)', contrast(P.playerInk[0], P.playerInk[1]), 1.5],
  ['A5.3  brand cap vs player[0]', contrast(P.menu.capBrand, P.player[0]), 1.6],
  ['A5.3  brand cap vs player[1]', contrast(P.menu.capBrand, P.player[1]), 1.6],
  ['A5.3  brand cap vs neutral cap (chroma apart)', Math.abs(chroma(P.menu.capBrand) - chroma(P.menu.capDefault)) * 10, 3.0],
];
let soft = 0;
for (const [name, got, want] of checks) {
  const ok = got >= want;
  if (!ok) soft++;
  console.log(`${ok ? '  ok ' : '  LOW'}  ${name.padEnd(44)} ${got.toFixed(2)}:1  (want >= ${want})`);
}
console.log();
if (fail.length) { console.log('HARD RULE VIOLATIONS:'); fail.forEach((f) => console.log('  ' + f)); }
else console.log('rules 1-4: no pure black, L >= 0.06, cool shadows, HSV S <= 88%, player gap  — PASS');
console.log(soft ? `\n${soft} contrast target(s) below goal` : '\nall contrast targets met');
process.exit(fail.length || soft ? 1 : 0);
