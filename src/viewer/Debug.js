import GUI from 'lil-gui';
import { PS1_COLOR_LEVELS } from '../core/RetroPass.js';
import { RENDER_MODES } from '../core/Viewport.js';
import { CAP_COLOR } from './Cap.js';

/**
 * The panel. Not hidden behind a query flag the way a shipping build would want
 * it — the whole point of this prototype is judging the cap by eye while moving
 * these numbers, so it is the interface.
 *
 * TRI COUNT is a readout rather than a control, and it is the one number that
 * matters most here: the budget is 1500 and raising the tooth count or the
 * columns per tooth is the easy way to walk straight past it without noticing.
 * It shows two figures, because with the shell on there are two — what is on
 * screen right now, and what the same parameters would cost in a game mode,
 * which is the one the ceiling applies to.
 */

/** The in-game ceiling from the spec. The shell is not measured against it. */
const TRI_BUDGET = 1500;

export function bootDebug({ cap, orbit, retro, retroPass, viewport }) {
  const gui = new GUI({ title: 'BOTTLE CAP CHAOS' });

  const stats = { tris: '' };
  // Pushed rather than `.listen()`ed: listen polls on its own rAF for a value
  // that only ever changes on a rebuild, and the poll means the readout lags the
  // slider that caused it by a frame.
  const readout = gui.add(stats, 'tris').name('triangles').disable();
  const refresh = () => {
    const game = cap.gameTriangles;
    const over = game > TRI_BUDGET ? '  ⚠ OVER' : '';
    stats.tris = `${cap.triangles}  (게임 ${game}/${TRI_BUDGET})${over}`;
    readout.updateDisplay();
  };
  const rebuild = () => {
    cap.rebuild();
    refresh();
  };
  refresh();

  // ── geometry ─────────────────────────────────────────────────────────────
  const geo = gui.addFolder('CAP');
  const p = cap.params;
  geo.add(p, 'teeth', 5, 32, 1).name('돌기 개수').onChange(rebuild);
  geo.add(p, 'toothDepth', 0, 3, 0.01).name('돌기 깊이 (mm)').onChange(rebuild);
  geo.add(p, 'toothCurve', 0.4, 4, 0.05).name('돌기 세로 램프').onChange(rebuild);
  geo.add(p, 'skirtHeight', 1, 12, 0.1).name('skirt 높이 (mm)').onChange(rebuild);
  geo.add(p, 'domeRise', 0, 3, 0.01).name('상판 돔 곡률 (mm)').onChange(rebuild);
  geo.add(p, 'flare', 0, 2.5, 0.01).name('플레어 (mm)').onChange(rebuild);
  // Not in the spec's list, but the tooth count and this one together are what
  // set the triangle budget — changing one without being able to change the
  // other means the count can only ever go up.
  geo.add(p, 'radialPerTooth', 2, 8, 1).name('돌기당 세로줄').onChange(rebuild);

  // ── the inside ───────────────────────────────────────────────────────────
  const inside = gui.addFolder('하단부 (SHELL)');
  inside.add(p, 'shell').name('하단부 생성').onChange(rebuild);
  inside.add(p, 'wallThickness', 0.05, 1.2, 0.01).name('철판 두께 (mm)').onChange(rebuild);
  inside.add(p, 'linerInset', 0, 6, 0.05).name('라이너 여백 (mm)').onChange(rebuild);
  inside.add(p, 'linerThickness', 0, 2, 0.01).name('라이너 두께 (mm)').onChange(rebuild);

  // ── look ─────────────────────────────────────────────────────────────────
  const look = gui.addFolder('LOOK');
  const gloss = retro.shared.uGloss.value;
  const lookParams = { color: CAP_COLOR, gloss: true, wireframe: false };
  look.addColor(lookParams, 'color').name('뚜껑 색상').onChange((v) => cap.setColor(v));
  look
    .add(lookParams, 'gloss')
    .name('유광')
    .onChange((v) => {
      retro.shared.uGloss.value = v ? gloss : 0;
    });
  look
    .add(lookParams, 'wireframe')
    .name('와이어프레임')
    .onChange((v) => cap.setWireframe(v));
  look.add(orbit, 'autoRotateSpeed', 0, 2, 0.01).name('자동회전 속도 (rad/s)');

  // ── ps1 ──────────────────────────────────────────────────────────────────
  const ps1 = gui.addFolder('PS1');
  ps1.add(retro.shared.uSnapAmount, 'value', 0, 1, 0.01).name('버텍스 스냅');
  ps1
    .add(retro.shared.uSnapGrid, 'value', 0.1, 2, 0.01)
    .name('스냅 격자 (1 = 네이티브)');
  ps1
    .add({ mode: viewport.mode }, 'mode', Object.keys(RENDER_MODES))
    .name('내부 렌더 해상도')
    // The uniforms that depend on the render target are updated by the
    // viewport's own resize listeners in main.js, not from here.
    .onChange((v) => viewport.setMode(v));

  const toggles = { dither: true, quantise: true };
  ps1
    .add(toggles, 'dither')
    .name('디더링 (4x4 Bayer)')
    .onChange((v) => {
      retroPass.uniforms.uDitherAmount.value = v ? 1 : 0;
    });
  ps1
    .add(toggles, 'quantise')
    .name('컬러 양자화 (15bit)')
    .onChange((v) => {
      // 255 levels is 8 bits per channel — the framebuffer's own depth, so the
      // quantiser is still running but has nothing left to take away.
      retroPass.uniforms.uColorLevels.value = v ? PS1_COLOR_LEVELS : 255;
    });

  return { gui, refresh };
}
