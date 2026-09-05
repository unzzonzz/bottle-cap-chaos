import { buildCapGeometry } from '../../src/cap/capGeometry.js';

/**
 * The cap's radius and height, without a renderer.
 *
 * These two numbers are simulation inputs, not presentation: `Arena` sizes every
 * collider from them and the curling table's width is a multiple of the cap's
 * diameter. So the harness has to obtain them the same way the game does —
 * by building the real geometry and reading what it measured — rather than by
 * copying the values into a constant that would quietly stop matching the moment
 * anybody touched the cap profile.
 *
 * three.js is imported for this and only this. `BufferGeometry` is arithmetic
 * over typed arrays with no canvas, no WebGL and no document behind it, so it
 * runs anywhere JS runs. Nothing else in the replay path imports three, which is
 * what lets the runner itself be engine-portable — see `ReplayRunner`.
 */
export async function capDimsHeadless() {
  const geometry = buildCapGeometry();
  const { radius, height } = geometry.userData;
  if (!Number.isFinite(radius) || !Number.isFinite(height)) {
    throw new Error('cap geometry did not report radius/height');
  }
  geometry.dispose?.();
  return { radius, height };
}
