import { CanvasTexture, ClampToEdgeWrapping, LinearFilter, SRGBColorSpace } from 'three';
import { PALETTE } from '../core/palette.js';
import { RADIUS, SPACE, TYPE } from '../core/tokens.js';
import { PLAYER_COLORS } from '../render/playerColors.js';
import { applyTracking, fitText, fontSpec, gelButton, glassPanel } from '../ui/glass.js';
import { drawIcon } from '../ui/icons.js';

import { registerTextureCache } from '../ui/fonts.js';

/**
 * 마크 편집기의 그림들: 도구 버튼 · 칸 액자 · 배지 · 알림 · 저장 버튼.
 *
 * ── 손으로 찍은 비트맵이었다 ────────────────────────────────────────────────
 * 아이콘마다 16x16 문자 격자가 이 파일 안에 있었고, 그 선택의 근거는 두 가지였다:
 * 폰트 글리프는 기계마다 다른 그림을 배포하게 되고, 알파 이진화와 5비트 양자화를
 * 거치면 채워진 글리프가 덩어리가 된다는 것.
 *
 * 두 번째는 사실이 아니게 됐고(PHASE 1/4), 첫 번째는 `ui/icons.js` 가 해결한다 —
 * 거기 아이콘은 폰트에서 오는 것이 아니라 **그려지는** 것이라 기계마다 다르지 않다.
 * 그래서 이 파일은 이제 그리지 않고, 공용 벡터를 판 위에 얹는다. 카드와 HUD 와
 * 같은 선 굵기, 같은 모서리, 같은 밀도가 된다.
 *
 * 헷갈리기 쉬운 두 쌍의 구분은 `ui/icons.js` 의 도구 아이콘 머리말에 옮겨 적혀
 * 있다 — 그림이 거기 있으므로 그 이유도 거기 있어야 한다.
 *
 * ── 상태는 유리의 것이다 ────────────────────────────────────────────────────
 * 판도 스킨도 `ui/glass.js` 에서 온다. 도구 버튼과 메뉴 항목이 처음에 어긋났던
 * 이유가 각자 자기 표를 들고 있었기 때문이고, 표가 하나면 어긋날 곳이 없다.
 */

/**
 * 이 화면의 상태 이름을 `skinFor` 의 어휘로.
 *
 * 툴바는 `active` 를 "선택된 도구" 라는 뜻으로 쓰는데, 유리의 어휘에서 그것은
 * `selected` 다 — `pressed` 는 지금 손가락이 눌리고 있다는 뜻이라 다르다.
 */
const TOOL_STATE = { idle: 'idle', hover: 'hover', active: 'selected', disabled: 'disabled' };

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
 * 도구 버튼 하나. 판까지 포함해서.
 *
 * ── 비트맵에서 벡터로 (PHASE 5 승인 항목 4) ───────────────────────────────
 * 예전에는 이 파일 안에 아이콘마다 16x16 문자 격자가 있었고, `scale` 은 "아트 셀당
 * 텍셀 수, 정수여야 함" 이었다 — 소수 배율이 회색 가장자리를 만들기 때문이다.
 * 그 제약은 알파 이진화와 5비트 양자화가 있던 파이프라인의 것이고, 둘 다 없다.
 *
 * 이제 `ui/icons.js` 의 벡터를 쓴다. 카드와 HUD 가 쓰는 것과 **같은 모듈**이라
 * 선 굵기와 모서리 반경과 시각적 밀도가 화면 전체에서 하나다. 크기도 자유롭다 —
 * 프레임에 따라 도구 버튼이 커지고 작아져도 아이콘이 계단지지 않는다.
 *
 * @param {string} name  `ui/icons.js` 의 ICON 키
 * @param {'idle'|'hover'|'active'|'disabled'} state
 * @param {{size?: number, scale?: number, plate?: boolean}} [opts]
 *   `scale` 은 이제 **텍셀 배수**다. 좌표는 프레임 픽셀 그대로 두고 캔버스만 키운다.
 *   `plate: false` 는 아이콘만 그린다 — 다른 것 위에 얹히는 아이콘(칸의 휴지통)용.
 */
export function iconTexture(name, state = 'idle', { size = 28, scale = 1, plate = true } = {}) {
  const key = `${name}:${state}:${size}:${scale}:${plate}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const skin = SKINS[state] ?? SKINS.idle;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(size * scale);
  canvas.height = Math.round(size * scale);
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.scale(scale, scale);

  if (plate) {
    gelButton(ctx, {
      x: 0,
      y: 0,
      w: size,
      h: size,
      radius: RADIUS.chip,
      state: TOOL_STATE[state] ?? 'idle',
      accent: PALETTE.accent.cyan,
    });
  }

  const inner = size * 0.62;
  drawIcon(ctx, name, {
    x: (size - inner) / 2,
    y: (size - inner) / 2,
    size: inner,
    color: skin.ink,
    // 판 위의 아이콘에는 광택을 얹지 않는다. 판이 이미 젤이라 광택이 두 겹이 되고,
    // 두 겹이면 아이콘의 형태가 아니라 반사가 먼저 읽힌다.
    gloss: !plate,
  });

  return finishIcon(key, canvas, size);
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

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  /**
   * 눌린 유리 홈이다. 젤 버튼이 아니라.
   *
   * 그림이 **들어가는** 자리이므로 튀어나와 보이면 안 된다. `pressed` 스킨은
   * 그라디언트가 반대로 흘러 표면이 눌린 것으로 읽히고, 그게 액자가 하는 일이다.
   * 기본 로고 칸만 `selected` 로 강조색 테두리를 받는다 — 지시서가 "구분되게
   * 표시" 를 요구했고, 이 칸만 휴지통도 편집도 없기 때문이다.
   */
  gelButton(ctx, {
    x: 0,
    y: 0,
    w: size,
    h: size,
    radius: RADIUS.chip,
    state: accent ? 'selected' : (TOOL_STATE[state] ?? 'idle'),
    accent: accent ? PALETTE.accent.yellow : PALETTE.accent.cyan,
  });

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

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  /**
   * 켜졌을 때는 **그 플레이어의 색**을 강조색으로 쓴다.
   *
   * 예전에는 켜짐/꺼짐 모두 툴바와 같은 청록이었고, 어느 플레이어의 배지인지는
   * 글자 "1P" / "2P" 만 말했다. 배지가 말하려는 것이 "이 마크를 누가 쓰고 있나"
   * 이므로, 그 답이 색으로 먼저 와야 한다.
   */
  gelButton(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.pill,
    state: on ? 'selected' : 'idle',
    accent: on ? PLAYER_COLORS[player] : PALETTE.ui.edgeStrong,
  });

  applyTracking(ctx, TYPE.caption.tracking);
  ctx.save();
  ctx.font = fontSpec({ ...TYPE.caption, weight: 700 });
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = on ? PALETTE.ui.text : PALETTE.ui.textMuted;
  ctx.fillText(`${player + 1}P`, width / 2, height / 2);
  ctx.restore();
  applyTracking(ctx, 0);

  return finishIcon(key, canvas, width, height);
}

/**
 * A line of type on a plate. The confirm dialog's question, and nothing else.
 *
 * The brief allows text in exactly two places — this and the save button — so
 * this helper is deliberately not general: one line, centred, no wrapping. A
 * question that does not fit is a question that should be shorter.
 */
export function messageTexture(text, { width = 300, height = 44, tone = 'idle', plate = true } = {}) {
  const key = `msg:${text}:${width}x${height}:${tone}:${plate}`;
  const hit = cache.get(key);
  if (hit) return hit;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;

  /**
   * 판은 선택이다. `menuTextures.titleTexture` 의 같은 옵션과 같은 이유다 —
   * 부록 B 의 패널 **안**에 들어가는 문장에 떠 보이는 둥근 판을 두르면, 누를
   * 수 없는 것이 누를 수 있다고 말하게 된다.
   */
  if (plate) {
    glassPanel(ctx, {
      x: 0,
      y: 0,
      w: width,
      h: height,
      radius: RADIUS.panel,
      accent: tone === 'disabled' ? PALETTE.ui.danger : PALETTE.accent.cyan,
      alpha: 1,
    });
  }

  const probe = document.createElement('canvas').getContext('2d');
  const fitted = fitText(probe, text, TYPE.label, width - SPACE.lg * 2);
  applyTracking(ctx, TYPE.label.tracking);
  ctx.save();
  ctx.font = fitted.font;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = PALETTE.ui.text;
  ctx.fillText(fitted.text, width / 2, height / 2);
  ctx.restore();
  applyTracking(ctx, 0);

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

  gelButton(ctx, {
    x: 0,
    y: 0,
    w: width,
    h: height,
    radius: RADIUS.pill,
    state: TOOL_STATE[state] ?? 'idle',
    accent: PALETTE.accent.green,
  });

  /**
   * 툴바가 보여 줄 것과 같은 디스크. 판 없이, 이 캔버스에 직접.
   *
   * 아이콘과 낱말이 한 장의 그림이어야 화면에서 어긋나지 않는다. 광택은 얹지
   * 않는다 — 판이 이미 젤이다.
   */
  const disk = height * 0.5;
  drawIcon(ctx, 'save', {
    x: height * 0.32,
    y: (height - disk) / 2,
    size: disk,
    color: skin.ink,
    gloss: false,
  });

  applyTracking(ctx, TYPE.label.tracking);
  ctx.save();
  ctx.font = fontSpec(TYPE.label);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = skin.ink;
  ctx.fillText('저장', height * 0.32 + disk + SPACE.xs, height / 2);
  ctx.restore();
  applyTracking(ctx, 0);

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

/**
 * 이 화면이 쓰는 아이콘 이름. 패널의 미리보기 시트가 읽는다.
 *
 * 예전에는 `Object.keys(ART)` 였다 — 이 파일이 아트를 들고 있었으므로. 이제
 * `ui/icons.js` 가 들고 있고 거기에는 카드와 HUD 의 것도 섞여 있으므로, 이 화면의
 * 도구를 손으로 나열한다. 목록이 곧 툴바의 내용이다.
 */
export const ICON_NAMES = [
  'pencil',
  'eye',
  'eraser',
  'clear',
  'undo',
  'redo',
  'trash',
  'plus',
  'save',
  'back',
  'brush1',
  'brush2',
  'brush3',
];

export const clearIconCache = registerTextureCache(() => {
  for (const t of cache.values()) t.dispose();
  cache.clear();});
