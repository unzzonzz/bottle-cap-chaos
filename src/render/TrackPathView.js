import { BufferGeometry, Float32BufferAttribute, LineBasicMaterial, LineSegments } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * Where the camera aimed and where it actually looked, drawn on the board.
 *
 * A tuning instrument and nothing else — it is off unless the panel's switch is
 * on, and it draws a pair of trails `CamTracker` has already sampled. The gap
 * between the two lines is the spring: run them together and the camera is
 * locked to the cap and will be sick-making; run them a board apart and it is
 * so slack the shot is over before the view arrives. Neither is legible from
 * two sliders, and both are obvious from this.
 *
 * ── it knows nothing about tracking ─────────────────────────────────────────
 * It is handed two flat `[x, z, x, z, ...]` arrays and joins consecutive pairs.
 * Hand it empty ones and it disappears, which is what lets it sit in the world
 * scene unconditionally next to `DistanceMarks` and `ColliderView` rather than
 * being built and torn down with a mode.
 *
 * ── `depthTest: false`, unlike the distance marks ───────────────────────────
 * Those are a measurement ON the board and must not draw through the caps they
 * measure from. This is an instrument laid OVER the picture, and the moment it
 * matters most is a cap going over the rim — where the trail is below the
 * table's own surface and would otherwise be hidden by it.
 */

/** Board-plane height. Above the markings, out of the caps' way. */
const Y = 0.1;
/** Where the camera aimed. */
const TARGET_COLOR = PALETTE.debug.trackTarget;
/** Where it actually looked. Cooler, so the lag reads as a lag. */
const LOOK_COLOR = PALETTE.debug.trackLook;

export class TrackPathView {
  constructor() {
    this.targetGeo = new BufferGeometry();
    this.targetGeo.setAttribute('position', new Float32BufferAttribute([], 3));
    this.lookGeo = new BufferGeometry();
    this.lookGeo.setAttribute('position', new Float32BufferAttribute([], 3));

    const material = (color) =>
      new LineBasicMaterial({ color, fog: false, depthTest: false, transparent: true, opacity: 0.9 });
    this.targetMaterial = material(TARGET_COLOR);
    this.lookMaterial = material(LOOK_COLOR);

    this.target = new LineSegments(this.targetGeo, this.targetMaterial);
    this.look = new LineSegments(this.lookGeo, this.lookMaterial);
    for (const o of [this.target, this.look]) {
      o.renderOrder = 6;
      o.frustumCulled = false;
      o.visible = false;
    }

    // A `Group` would be the tidy answer and is one more object in the scene
    // graph for two lines that are always shown and hidden together; the caller
    // adds both. See `main.js`.
    this.objects = [this.target, this.look];
  }

  /**
   * @param {number[]} targetPath  flat [x, z, ...] the camera was pulling toward
   * @param {number[]} lookPath  flat [x, z, ...] the camera was actually at
   * @param {boolean} on  the panel's switch
   */
  update(targetPath, lookPath, on) {
    if (!on || !lookPath || lookPath.length < 4) {
      this.target.visible = false;
      this.look.visible = false;
      return;
    }
    this._write(this.targetGeo, this.target, targetPath);
    this._write(this.lookGeo, this.look, lookPath);
  }

  /**
   * Rewritten every frame, and that is affordable here where it would not be in
   * `DistanceMarks`: the trail grows by one point per frame by definition, so
   * there is no frame on which it has not changed and a key would never hit.
   */
  _write(geometry, object, path) {
    const pairs = (path.length >> 1) - 1;
    if (pairs < 1) {
      object.visible = false;
      return;
    }
    const pos = new Float32Array(pairs * 6);
    for (let i = 0; i < pairs; i++) {
      const a = i * 2;
      pos[i * 6 + 0] = path[a];
      pos[i * 6 + 1] = Y;
      pos[i * 6 + 2] = path[a + 1];
      pos[i * 6 + 3] = path[a + 2];
      pos[i * 6 + 4] = Y;
      pos[i * 6 + 5] = path[a + 3];
    }
    geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
    geometry.computeBoundingSphere();
    object.visible = true;
  }

  dispose() {
    this.targetGeo.dispose();
    this.lookGeo.dispose();
    this.targetMaterial.dispose();
    this.lookMaterial.dispose();
  }
}
