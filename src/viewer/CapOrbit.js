import { Group } from 'three';

/**
 * Drag to turn the cap, wheel to zoom, let go and it coasts.
 *
 * Not OrbitControls. Two reasons, and the first is the important one:
 *
 *  1. OrbitControls' damping eases out whatever delta is left over when you
 *     release; it does not carry a flick. This one keeps an angular velocity and
 *     decays it, so throwing the cap spins it — which is the only way to see the
 *     flutes pass through the key light quickly enough to count them.
 *  2. The OBJECT turns, not the camera. The key light lives in world space, so a
 *     camera orbit would carry the lit side around with it and the skirt would
 *     shade identically from every angle. Turning the cap under a fixed light is
 *     what makes the 21 crests flash past.
 *
 * Yaw and pitch are two nested groups rather than an Euler triple, because the
 * composition has to be "spin about the cap's own axis, then tip the whole thing
 * toward the viewer" and an Euler order is an easy thing to get subtly backwards.
 */

const DRAG_SENS = 0.008; // radians per CSS pixel — a ~790px drag is one turn
const PITCH_LIMIT = (89 * Math.PI) / 180;
/** Velocity decay, e-folds per second. Higher stops sooner. */
const DAMPING = 2.4;
/** Below this the coast is invisible and only burns battery. */
const REST_SPEED = 0.0025;
const IDLE_DELAY = 3.0;
/** How fast the idle drift fades in and out, e-folds per second. */
const IDLE_EASE = 1.2;
const ZOOM_SENS = 0.0012;

export class CapOrbit {
  constructor({ canvas, camera, object, distance = 9.5, minDist = 5.5, maxDist = 24 }) {
    this.camera = camera;
    this.canvas = canvas;

    this.pitchGroup = new Group();
    this.yawGroup = new Group();
    this.pitchGroup.add(this.yawGroup);
    this.yawGroup.add(object);

    this.yaw = 0.6;
    // Tipped forward so the panel and the skirt are both in frame from the off.
    this.pitch = 0.36;
    this.distance = distance;
    this.minDist = minDist;
    this.maxDist = maxDist;

    /** Radians per second the idle drift settles at. */
    this.autoRotateSpeed = 0.35;

    this._velYaw = 0;
    this._velPitch = 0;
    this._pendingX = 0;
    this._pendingY = 0;
    this._dragging = false;
    this._pointerId = null;
    this._idleTime = 0;
    this._auto = 0;

    this._onDown = (e) => this._down(e);
    this._onMove = (e) => this._move(e);
    this._onUp = (e) => this._up(e);
    this._onWheel = (e) => this._wheel(e);

    canvas.addEventListener('pointerdown', this._onDown);
    canvas.addEventListener('pointermove', this._onMove);
    canvas.addEventListener('pointerup', this._onUp);
    canvas.addEventListener('pointercancel', this._onUp);
    canvas.addEventListener('wheel', this._onWheel, { passive: false });

    this._apply();
  }

  _down(e) {
    // Left button only. A right-drag is the browser's, not ours.
    if (e.button !== 0 || this._dragging) return;
    this._dragging = true;
    this._pointerId = e.pointerId;
    this._pendingX = 0;
    this._pendingY = 0;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    // Grabbing the pointer is what keeps a fast drag alive after it leaves the
    // letterboxed canvas and crosses onto the black surround.
    this.canvas.setPointerCapture(e.pointerId);
    this.canvas.classList.add('is-dragging');
    this._markInput();
    // A press stops a coast dead, the way putting a finger on a spinning record
    // does. Without this the cap keeps drifting under a held pointer.
    this._velYaw = 0;
    this._velPitch = 0;
  }

  _move(e) {
    if (!this._dragging || e.pointerId !== this._pointerId) return;
    // Delta from the last client position rather than movementX/Y: the latter is
    // scaled by the OS pointer acceleration curve on some platforms, so the same
    // physical drag turns the cap by different amounts on different machines.
    this._pendingX += e.clientX - this._lastX;
    this._pendingY += e.clientY - this._lastY;
    this._lastX = e.clientX;
    this._lastY = e.clientY;
    this._markInput();
  }

  _up(e) {
    if (!this._dragging || e.pointerId !== this._pointerId) return;
    this._dragging = false;
    this._pointerId = null;
    this.canvas.releasePointerCapture?.(e.pointerId);
    this.canvas.classList.remove('is-dragging');
    this._markInput();
  }

  _wheel(e) {
    e.preventDefault();
    // deltaMode 1 is lines rather than pixels; Firefox still ships it.
    const lines = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1;
    // Exponential, so a notch is the same proportional step whether you are
    // close in or far out.
    this.distance = clamp(
      this.distance * Math.exp(e.deltaY * lines * ZOOM_SENS),
      this.minDist,
      this.maxDist,
    );
    this._markInput();
  }

  _markInput() {
    this._idleTime = 0;
    this._auto = 0;
  }

  update(dt) {
    if (dt <= 0) return;

    if (this._dragging) {
      // Applied here rather than in the event handler so a frame that received
      // three pointermoves turns them into one rotation, and so the velocity is
      // measured against the frame time the coast will be integrated with.
      const dYaw = this._pendingX * DRAG_SENS;
      const dPitch = this._pendingY * DRAG_SENS;
      this._pendingX = 0;
      this._pendingY = 0;

      this.yaw += dYaw;
      this.pitch = clamp(this.pitch + dPitch, -PITCH_LIMIT, PITCH_LIMIT);

      // Smoothed, or a single stationary frame at the end of a drag reads as a
      // dead stop and the release throws away the whole gesture.
      this._velYaw += (dYaw / dt - this._velYaw) * 0.4;
      this._velPitch += (dPitch / dt - this._velPitch) * 0.4;
    } else {
      this.yaw += this._velYaw * dt;
      const next = clamp(this.pitch + this._velPitch * dt, -PITCH_LIMIT, PITCH_LIMIT);
      // Kill the pitch coast at the clamp instead of letting it grind there.
      if (next === this.pitch) this._velPitch = 0;
      this.pitch = next;

      const decay = Math.exp(-DAMPING * dt);
      this._velYaw *= decay;
      this._velPitch *= decay;
      if (Math.abs(this._velYaw) < REST_SPEED) this._velYaw = 0;
      if (Math.abs(this._velPitch) < REST_SPEED) this._velPitch = 0;

      // ── idle drift ─────────────────────────────────────────────────────
      // Only counts once the throw has died. A flick that coasts for four
      // seconds should not have the auto-rotation join in halfway through it.
      if (this._velYaw === 0 && this._velPitch === 0) {
        this._idleTime += dt;
      }
      const want = this._idleTime > IDLE_DELAY ? this.autoRotateSpeed : 0;
      // Exponential ease, so the drift fades in rather than snapping on.
      this._auto += (want - this._auto) * (1 - Math.exp(-dt * IDLE_EASE));
      this.yaw += this._auto * dt;
    }

    this._apply();
  }

  _apply() {
    this.yawGroup.rotation.y = this.yaw;
    this.pitchGroup.rotation.x = this.pitch;
    this.camera.position.set(0, 0, this.distance);
    this.camera.lookAt(0, 0, 0);
  }

  dispose() {
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('pointermove', this._onMove);
    this.canvas.removeEventListener('pointerup', this._onUp);
    this.canvas.removeEventListener('pointercancel', this._onUp);
    this.canvas.removeEventListener('wheel', this._onWheel);
  }
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}
