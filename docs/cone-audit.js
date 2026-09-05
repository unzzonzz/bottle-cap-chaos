/**
 * 오차 콘이 화면에서 읽히는가 — 실측.
 *
 * §11 의 침해 불가 목록에 "오차 콘은 언제나 보인다" 가 있고, PHASE 4 의 감사는
 * 그것을 **팔레트 값으로만** 확인했다. 화면에 실제로 그려진 픽셀을 잰 적이 없었고,
 * 그 이유는 하나였다: 합성 `PointerEvent` 가 `PointerRouter` 까지 닿지 않는다.
 *
 * ── 그래서 포인터를 흉내 내지 않는다 ────────────────────────────────────────
 * `AimInput` 은 `begin`/`move` 라는 평범한 메서드다. 라우터는 그것을 부르는 쪽일
 * 뿐이므로, 라우터를 우회하고 입력을 직접 몰면 조준 상태가 만들어진다. 한 곳만
 * 더 필요하다 — `main.js` 의 프레임이 `router.mode !== AIM` 이면 조준을 취소하므로
 * `router.mode` 를 손으로 맞춰 준다.
 *
 * ── 그리고 한 프레임을 두 번 그린다 ─────────────────────────────────────────
 * 콘의 대비는 "콘이 있는 픽셀"과 "같은 자리의 배경"의 차이다. 배경을 따로 알아낼
 * 방법은 같은 프레임을 콘만 빼고 다시 그리는 것이고, `composer.render()` 가 그것을
 * 해 준다. 대조군으로 아무것도 바꾸지 않고 두 번 그리면 **다른 픽셀이 0개**다 —
 * 그래서 이 차이는 전부 콘이다.
 *
 * ⚠ 두 렌더 사이에 `await` 를 넣지 마라. 페이지의 rAF 루프가 그 틈에 한 프레임을
 *   돌리고, 그러면 diff 가 콘이 아니라 카메라 이징이 된다. 실제로 한 번 겪었고
 *   증상은 "콘이 화면을 어둡게 만든다" 였다.
 *
 * 사용법 — 경기 화면(`/survival` `/football` `/curling`)에서 콘솔에:
 *
 *   const { measureCone } = await import('/docs/cone-audit.js');
 *   await measureCone({ pullPx: 150 });
 *
 * `pullPx` 는 당김의 화면 픽셀 거리다. 150 이면 최대 당김, 60 이면 약한 당김.
 * `dump` 에 이름을 주면 그 프레임을 PNG 로 POST 한다(로컬 싱크가 8899 에 있을 때).
 */

const SINK = 'http://localhost:8899';

const lin = (v) => {
  v /= 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
const lum = (r, g, b) => 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
/** WCAG 대비비. 콘도 배경도 화면에 나온 sRGB 바이트에서 나온다. */
const ratio = (a, b) => (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);

/** 월드 좌표 → 클라이언트 좌표. `rect` 는 **매번** 다시 읽는다 (창이 바뀐다). */
function projector(cam, rect) {
  return (v) => {
    cam.updateMatrixWorld();
    const m = cam.projectionMatrix.elements;
    const iv = cam.matrixWorldInverse.elements;
    const mul = (M, p) => [
      M[0] * p[0] + M[4] * p[1] + M[8] * p[2] + M[12] * p[3],
      M[1] * p[0] + M[5] * p[1] + M[9] * p[2] + M[13] * p[3],
      M[2] * p[0] + M[6] * p[1] + M[10] * p[2] + M[14] * p[3],
      M[3] * p[0] + M[7] * p[1] + M[11] * p[2] + M[15] * p[3],
    ];
    const q = mul(m, mul(iv, [v.x, v.y, v.z, 1]));
    return {
      x: rect.left + ((q[0] / q[3] + 1) / 2) * rect.width,
      y: rect.top + ((1 - q[1] / q[3]) / 2) * rect.height,
      ny: q[1] / q[3],
    };
  };
}

export async function measureCone({ pullPx = 150, dump = null } = {}) {
  const c = window.__cap;
  if (!c) return { error: '경기 화면이 아니다 — window.__cap 이 없다' };
  const gl = c.viewport.renderer.getContext();
  const cv = c.viewport.canvas;
  const W = cv.width;
  const H = cv.height;
  const toScreen = projector(c.gameCamera.camera, cv.getBoundingClientRect());

  c.input.cancel();
  c.router.mode = 'aim';
  const rules = c.match.rules;
  let idx = -1;
  for (let i = 0; i < c.match.arena.capCount; i++) {
    if (rules.canSelect(i, rules.currentPlayer)) {
      idx = i;
      break;
    }
  }
  if (idx < 0) return { error: '고를 수 있는 뚜껑이 없다', state: c.match.state };

  const s = toScreen(c.match.arena.capCom(idx));
  if (!c.input.begin(s.x, s.y, idx)) return { error: 'begin 이 거절했다' };
  // 판 바깥쪽으로 당긴다 — 그래야 샷이 판 안쪽을 향하고 콘이 필드 위에 앉는다.
  c.input.move(s.x, s.y + (s.ny < 0 ? 1 : -1) * pullPx);
  // 몇 프레임 돌려 카메라 이징을 재운다. 이징 중에 재면 두 렌더가 달라진다.
  for (let k = 0; k < 8; k++) c.tick(1 / 60);

  const o = c.overlay;
  if (!o.coneFill.visible) return { error: '틱 뒤에도 콘이 숨어 있다', mode: c.router.mode };

  // ── 여기서부터 `await` 금지 ──
  const A = new Uint8Array(W * H * 4);
  const B = new Uint8Array(W * H * 4);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, A);
  const png = dump ? cv.toDataURL('image/png') : null;
  o.cone.visible = false;
  o.coneFill.visible = false;
  c.composer.render();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, B);
  // ── 여기까지 ──

  const uAlpha = o.coneFillMaterial.uniforms.uAlpha.value;
  const power = c.input.preview.power;

  /**
   * 채움과 가장자리를 나누는 값이 20 인 이유.
   *
   * §5.2 의 알파가 채움 0.10~0.14, 가장자리 0.35 다. 8비트로 옮기면 채움이 배경을
   * 스무 단계쯤 밀고 가장자리는 그보다 훨씬 크게 민다. 히스토그램이 그 자리에서
   * 갈라지므로 경계를 20 에 둔다 — 두 알파가 바뀌면 이 값도 다시 봐야 한다.
   */
  const fill = [];
  const edge = [];
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    const d = Math.max(
      Math.abs(A[j] - B[j]),
      Math.abs(A[j + 1] - B[j + 1]),
      Math.abs(A[j + 2] - B[j + 2]),
    );
    if (d < 2) continue;
    n++;
    const rec = { w: lum(A[j], A[j + 1], A[j + 2]), f: lum(B[j], B[j + 1], B[j + 2]) };
    (d <= 20 ? fill : edge).push(rec);
  }
  const stat = (arr) => {
    if (!arr.length) return null;
    const w = arr.reduce((a, x) => a + x.w, 0) / arr.length;
    const f = arr.reduce((a, x) => a + x.f, 0) / arr.length;
    return {
      pixels: arr.length,
      cone: +w.toFixed(4),
      field: +f.toFixed(4),
      ratio: +ratio(w, f).toFixed(3),
      deltaPct: +(((w - f) / f) * 100).toFixed(1),
    };
  };

  const out = {
    path: c.match.mode?.path,
    power: +power.toFixed(2),
    uAlpha: +uAlpha.toFixed(4),
    pixels: n,
    sharePct: +((n / (W * H)) * 100).toFixed(2),
    fill: stat(fill),
    edge: stat(edge),
  };
  if (png) await fetch(`${SINK}/${dump}`, { method: 'POST', body: png });
  return out;
}

/**
 * 대조군. 아무것도 바꾸지 않고 같은 프레임을 두 번 그린다.
 *
 * 0 이 아니면 위의 측정은 전부 무효다 — 콘이 아니라 다른 것이 움직이고 있다.
 */
export function controlDiff() {
  const c = window.__cap;
  const gl = c.viewport.renderer.getContext();
  const cv = c.viewport.canvas;
  const W = cv.width;
  const H = cv.height;
  const A = new Uint8Array(W * H * 4);
  const B = new Uint8Array(W * H * 4);
  c.composer.render();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, A);
  c.composer.render();
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, B);
  let n = 0;
  for (let i = 0; i < W * H; i++) {
    const j = i * 4;
    if (Math.max(Math.abs(A[j] - B[j]), Math.abs(A[j + 1] - B[j + 1]), Math.abs(A[j + 2] - B[j + 2])) >= 2) n++;
  }
  return { changedPixels: n, total: W * H };
}
