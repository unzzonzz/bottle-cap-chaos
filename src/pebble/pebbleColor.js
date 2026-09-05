import { Color, SRGBColorSpace } from 'three';
import { PALETTE } from '../core/palette.js';
import { pebbleRng } from './pebbleRng.js';

/**
 * 플레이어 식별색을 입히던 실험에서 자연석 자체를 보는 실험으로 바뀌었다.
 * 팔레트의 중성 회색과 따뜻한 회갈색을 섞고 채도를 낮춰, 청회색·회색·모래색이
 * 한 판 안에 섞이게 한다. 좌우 진영이나 두 무리의 휘도 간격은 더 이상 판단하지 않는다.
 * 명도 편차 22%는 짙은 돌과 옅은 돌을 함께 보는 범위이며 색상은 시드에서 고정된다.
 *
 * 그 간격을 **누가 지는가**는 이제 정해져 있다: `render/PebbleBodies.js` 의
 * 외곽선이다. 팀은 선이 나르고 돌은 돌이면 된다 — 그래서 여기서 명도를 22%나
 * 흔들어도 1P 와 2P 가 흐려지지 않는다. 이 값을 더 넓히려는 사람은 그쪽 머리말의
 * 대비 표를 먼저 볼 것.
 */
const PEBBLE_COLOR_DEFAULTS = { brightness: 0.22, warmth: 0.5 };

/** 자연석 바탕색. 표면의 작은 광물 입자는 pebbleTexture에서 추가한다. */
export function pebbleColor(seed, spread = {}) {
  const p = { ...PEBBLE_COLOR_DEFAULTS, ...spread };
  const warm = Math.max(0, Math.min(1, p.warmth + pebbleRng(seed, 101) - 0.5));
  const color = new Color(PALETTE.neutral).lerp(new Color(PALETTE.menu.capDefault), warm);
  const hsl = color.getHSL({}, SRGBColorSpace);
  // 기존 중성색의 청색기를 45%만 남겨 젖은 회색 돌처럼 은은하게 읽히게 한다.
  const lightness = 0.49 + (pebbleRng(seed, 100) * 2 - 1) * p.brightness;
  color.setHSL(hsl.h, hsl.s * 0.45, Math.max(0.18, Math.min(0.8, lightness)), SRGBColorSpace);
  return `#${color.getHexString(SRGBColorSpace)}`;
}
