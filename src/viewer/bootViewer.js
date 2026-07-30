import { Color, PerspectiveCamera, Scene } from 'three';
import { RetroMaterials } from '../core/RetroMaterial.js';
import { RetroPass } from '../core/RetroPass.js';
import { DISPLAY_ASPECT, Viewport } from '../core/Viewport.js';
import { Cap } from './Cap.js';
import { CapOrbit } from './CapOrbit.js';
import { bootDebug } from './Debug.js';

/**
 * Phase 1's cap viewer, unchanged and still reachable at `?view=cap`.
 *
 * Lifted out of `main.js` when the physics prototype took over the entry point.
 * It is kept because the customiser is still going to need it and because it is
 * the only place the cap's interior — the liner, the seal ring, the flutes on
 * the inner wall — is ever visible; the game modes build with `shell: false`.
 */

export function bootViewer(canvas) {
  const viewport = new Viewport({ canvas, mode: '320x240' });
  const retroPass = new RetroPass({ resolution: viewport.resolution });
  const retro = new RetroMaterials({ resolution: viewport.resolution });

  const scene = new Scene();
  scene.background = new Color('#000000');

  const camera = new PerspectiveCamera(26, DISPLAY_ASPECT, 1, 80);

  const cap = new Cap({ retro });
  const orbit = new CapOrbit({ canvas, camera, object: cap.root });
  scene.add(orbit.pitchGroup);

  bootDebug({ cap, orbit, retro, retroPass, viewport });

  viewport.onResize(({ resolution }) => {
    retroPass.setResolution(resolution);
    retro.setResolution(resolution);
  });

  let raf = 0;
  let last = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) || 0;
    last = now;

    orbit.update(dt);

    viewport.bind();
    viewport.renderer.render(scene, camera);
    viewport.unbind();
    retroPass.render(viewport.renderer, viewport.renderTarget.texture);
  }

  function start() {
    if (raf) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      cancelAnimationFrame(raf);
      raf = 0;
      return;
    }
    start();
  });

  start();
}
