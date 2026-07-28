import { Color, PerspectiveCamera, Scene } from 'three';
import { RetroMaterials } from './core/RetroMaterial.js';
import { RetroPass } from './core/RetroPass.js';
import { DISPLAY_ASPECT, Viewport } from './core/Viewport.js';
import { Cap } from './viewer/Cap.js';
import { CapOrbit } from './viewer/CapOrbit.js';
import { bootDebug } from './viewer/Debug.js';

/**
 * Wiring only. Every decision that matters lives in the module it belongs to:
 * the cap in cap/capGeometry.js, the console in core/, the input in
 * viewer/CapOrbit.js.
 */

const canvas = document.getElementById('view');

const viewport = new Viewport({ canvas, mode: '320x240' });
const retroPass = new RetroPass({ resolution: viewport.resolution });
const retro = new RetroMaterials({ resolution: viewport.resolution });

const scene = new Scene();
scene.background = new Color('#000000');

// A long lens, held well back. The cap is 32mm across and 6mm tall, and a wide
// FOV close in magnifies the near face enough to make that 6mm skirt read as
// half again as tall as it is — the cap stops looking like a cap and starts
// looking like a lampshade. 26 degrees at this distance keeps the proportions
// honest while the object still fills the frame.
//
// Aspect is the DISPLAY box, not the render target's: 256x224 into a 4:3 frame
// means non-square pixels, exactly as the hardware did it, and the camera must
// not try to correct for that.
const camera = new PerspectiveCamera(26, DISPLAY_ASPECT, 1, 80);

const cap = new Cap({ retro });
const orbit = new CapOrbit({ canvas, camera, object: cap.root });
scene.add(orbit.pitchGroup);

bootDebug({ cap, orbit, retro, retroPass, viewport });

viewport.onResize(({ resolution }) => {
  retroPass.setResolution(resolution);
  // The vertex-snap grid has to track the render target, or the wobble stops
  // matching the pixels it is meant to be quantising onto.
  retro.setResolution(resolution);
});

let raf = 0;
let last = 0;

function frame(now) {
  raf = requestAnimationFrame(frame);

  // Clamped at both ends: a timestamp that jumps forward after a hidden tab
  // would teleport the coast, and one that goes backwards would run it in
  // reverse.
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
