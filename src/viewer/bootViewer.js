import { Color, PerspectiveCamera, Scene } from 'three';
import { GlossMaterials } from '../core/GlossMaterial.js';
import { buildEnvironment } from '../core/environment.js';
import { setTextureRenderer } from '../core/textures.js';
import { PALETTE } from '../core/palette.js';
import { DISPLAY_ASPECT, Viewport } from '../core/Viewport.js';
import { SceneComposer } from '../core/Composer.js';
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
  const viewport = new Viewport({ canvas });
  setTextureRenderer(viewport.renderer);
  const retro = new GlossMaterials({ resolution: viewport.resolution });

  const scene = new Scene();
  scene.background = new Color(PALETTE.bg.skyMid);

  const camera = new PerspectiveCamera(26, DISPLAY_ASPECT, 1, 80);
  const composer = new SceneComposer({ viewport, scene, camera });

  const cap = new Cap({ retro });
  const orbit = new CapOrbit({ canvas, camera, object: cap.root });
  scene.add(orbit.pitchGroup);

  bootDebug({ cap, orbit, retro, composer });

  viewport.onResize(({ resolution }) => retro.setResolution(resolution));

  /**
   * The environment every reflective surface samples.
   *
   * Built once, from the palette, and handed to the material factory rather than
   * to the scene: `scene.environment` would only reach THIS scene, and the caps
   * also appear in the victory sequence, the cap wipe and the match-found layer,
   * each of which owns its own scene. Setting it per material covers all of them
   * from one place.
   */
  retro.setEnvironment(buildEnvironment(viewport.renderer));


  let raf = 0;
  let last = 0;

  function frame(now) {
    raf = requestAnimationFrame(frame);
    const dt = Math.max(0, Math.min(0.05, (now - last) / 1000)) || 0;
    last = now;

    orbit.update(dt);

    composer.render();
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
