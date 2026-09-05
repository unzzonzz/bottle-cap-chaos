import { Plane, Raycaster, Vector2, Vector3 } from 'three';
import { nextSeed } from '../physics/rng.js';
import { MATCH_STATE } from './Match.js';
import { pullToPower } from './shot.js';

/**
 * Drag and release. A bow, not a charge meter.
 *
 * Press one of your own caps, drag AWAY from where you want it to go, let go.
 * The cap travels opposite the pull, and how hard is how far you pulled.
 *
 * ── why it replaced the hold-to-charge scheme entirely ───────────────────────
 * The old input ramped power for as long as the button was held and clamped at
 * the top. That makes power a function of elapsed time, and time only runs one
 * way: once you had overshot the strength you wanted, the only way back was to
 * release a shot you did not want and lose the turn. There was no gesture for
 * "a bit less". A pull distance has no such asymmetry — the same movement that
 * adds power removes it, so the control is genuinely bidirectional, which is the
 * entire point of the change.
 *
 * There is consequently NO time term anywhere in this class. Not as a smoothing
 * factor, not as a minimum hold, not as a ramp. Holding a pull for ten seconds
 * and for a tenth of a second produce identical shots, and that is structural
 * rather than something to be tested for.
 *
 * ── one quantity ─────────────────────────────────────────────────────────────
 * PULL: cursor position relative to the cap centre. Direction is its opposite;
 * power is its length over `maxPullDistance`, clamped. That is the whole input.
 *
 * ── it no longer listens to anything ─────────────────────────────────────────
 * Every DOM event this used to handle now arrives through `PointerRouter`,
 * because a press on the board can mean two different things and only one thing
 * can decide which. What is left is the bow itself, driven imperatively:
 * `hitTest` answers whether a press would grab a cap, and `begin`/`move`/`end`
 * run the gesture. The router calls them and nothing else does.
 *
 * ── screen coordinates enter HERE and nowhere else ───────────────────────────
 * `_pick` is the only function in the shot's whole path that knows what a pixel
 * is. It casts a ray through the live camera onto the board plane and everything
 * downstream — the pull vector, the direction, the impulse, the error cone, the
 * trajectory preview — is world space from there on.
 *
 * That is what makes the aim survive a camera rotation without a line of code
 * about rotation: turn the camera and the ray turns with it, and the same drag
 * across the same pixels lands on a different part of the pitch because it IS a
 * different part of the pitch.
 */

const BOARD_PLANE = new Plane(new Vector3(0, 1, 0), 0);

/**
 * What the cards do to an aim: the twist, and the two multipliers.
 *
 * ── free function because the AI shoots without a pointer ───────────────────
 * Everything in this file below is driven by a drag, and an AI has none — it
 * arrives with a heading it computed and needs the same three things done to it
 * that a human's heading gets. Left as private getters, the AI would have had to
 * reproduce them, and the failure mode is silent and specific: 혼란 cast on the
 * AI would deviate nothing, so the card would look broken against one opponent
 * and fine against the other. 강타 would boost a human's shot and not the AI's.
 *
 * So the rule lives here once and has two callers. The getters below are now
 * thin wrappers over it, and behave exactly as they did.
 *
 * ── the twist goes on the AIM, before the charge cone ──────────────────────
 * Deliberately, and the long note on `_twisted` is the argument: everything
 * downstream reads the direction off the shot record, so twisting at the source
 * means the line, the preview, the impulse and the replay all agree without any
 * of them knowing a card exists. `aimAfterSpread` then stacks the charge cone on
 * top — two independent errors, as asked.
 *
 * ── `twist: false` is for CHOOSING, and it is not an optimisation ───────────
 * Under 혼란 the deviation is `mix(seed, angleBucket)` — a pure function of where
 * you aim, not a fresh draw — so anything that can evaluate many headings can
 * simply keep the one whose twist points where it wanted to go. `AimOverlay`'s
 * header is explicit that this is the failure the card has to be protected from:
 *
 *     Sweep the pull until the arrow points at the target and the card has been
 *     undone by reading it off the screen. So `blind` removes everything that
 *     points ANYWHERE: the arrow, the cone, the predicted path.
 *
 * A human is therefore shown nothing at all about where a confused shot will go.
 * An AI that shaped every candidate before scoring it was computing exactly the
 * thing the human is denied, forty-odd times, and picking the flattering one —
 * so 혼란 cost it nothing. Reported from play as "혼란 당해도 정확해".
 *
 * So the search shapes with `twist: false`: it plans the heading it INTENDS,
 * which is all a blinded player has, and the twist is applied once at commit.
 * The multipliers are not gated — 강타 is a card this player chose to play and
 * its effect on their own shot is not a secret.
 *
 * @param {import('./cards/CardEffects.js').CardEffects|null} cards
 * @param {number} player
 * @param {number} dirX  normalised travel direction, before the cards have a say
 * @param {number} dirZ
 * @param {{twist?: boolean}} [opts]  false to leave 혼란 out — see above
 */
export function shapeAim(cards, player, dirX, dirZ, { twist = true } = {}) {
  if (!cards) return { dirX, dirZ, deviation: 0, impulseMul: 1, spreadMul: 1 };
  if (!twist) {
    return {
      dirX,
      dirZ,
      deviation: 0,
      impulseMul: cards.impulseMulFor(player),
      spreadMul: cards.spreadMulFor(player),
    };
  }

  const angle = Math.atan2(dirZ, dirX);
  const deviation = cards.deviationFor(player, angle);
  let x = dirX;
  let z = dirZ;
  if (deviation !== 0) {
    const c = Math.cos(deviation);
    const s = Math.sin(deviation);
    // Same rotation `shot.rotateY` uses, inlined to keep the handedness argument
    // in one place. See the note this replaced.
    x = dirX * c + dirZ * s;
    z = -dirX * s + dirZ * c;
  }
  return {
    dirX: x,
    dirZ: z,
    deviation,
    // The boost multiplies the CHARGE CONE only, never the chaos deviation —
    // scaling that would make 강타 a partial cure for the opponent's 혼란 rather
    // than a cost of its own. `deviation` above is already applied to the raw
    // aim, so the two stack.
    impulseMul: cards.impulseMulFor(player),
    spreadMul: cards.spreadMulFor(player),
  };
}

export class AimInput {
  /**
   * @param {() => {left:number, top:number, width:number, height:number}} [boardRect]
   *   Where the 3D board is drawn, in client coordinates. Defaults to the whole
   *   canvas, which is what it was before the frame could be taller than the
   *   board — see Viewport.boardClientRect.
   */
  constructor({ canvas, camera, match, config, boardRect }) {
    this.canvas = canvas;
    this._boardRect = boardRect ?? (() => canvas.getBoundingClientRect());
    this.camera = camera;
    this.match = match;
    this.config = config;

    /** Mid-drag. */
    this.aiming = false;
    /** Which cap is being pulled. -1 when not aiming. */
    this.capIndex = -1;
    /** Board-plane pull vector from the cap centre toward the cursor. Raw. */
    this.pullX = 0;
    this.pullZ = 0;
    /** Travel direction: the pull's opposite. Held across a zero-length pull. */
    this.dirX = 0;
    this.dirZ = 1;
    /**
     * The error cone's draw, fixed when the drag STARTS rather than when it ends.
     *
     * It has to exist before the shot does, because the trajectory preview shows
     * the deviated path and a preview computed from a seed that had not been
     * chosen yet would be a different shot from the one that eventually fires.
     * Fixed at press, held for the whole drag, and handed to the caller
     * unchanged — so what the preview draws and what the cap does are the same
     * shot.
     */
    this._seed = 0;

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._hit = new Vector3();
    this._capCentre = { x: 0, z: 0 };
  }

  /**
   * The heading the shot will actually take, chaos included.
   *
   * ── the deviation is applied HERE, and only here ────────────────────────────
   * Which is the whole design of the card. Everything downstream — the aim line,
   * the trajectory preview, the shot record, the replay — reads the direction
   * off this class, so twisting it at the source means all four agree without
   * any of them knowing that a card exists. Applying it in `resolveImpulse`
   * instead would have been the obvious place and is the wrong one: the preview
   * and the overlay would have shown the true aim while the cap went somewhere
   * else, which is the exact bug the card is meant to be an honest version of.
   *
   * It also means the shot RECORD carries the deviated heading, so a replay
   * reproduces it without the card state having to be consulted a second time.
   * The charge cone is still drawn on top of this by `aimAfterSpread` — two
   * independent errors, stacked, as asked.
   */
  get _twisted() {
    const s = shapeAim(this.match.cards, this.match.rules.currentPlayer, this.dirX, this.dirZ);
    return { x: s.dirX, z: s.dirZ, deviation: s.deviation };
  }

  /**
   * The boost this shot carries, as two numbers. Both 1 when 강타 is not armed.
   *
   * Read here and nowhere else, for the same reason the twist above is applied
   * here and nowhere else: everything downstream reads the shot off this class,
   * so one reading is one answer. The two values then travel ON the shot record
   * — see the note in `shot.js` — which is what makes a replayed 강타 shot the
   * same shot rather than a re-lookup that may since have changed.
   *
   * It multiplies the CHARGE CONE only. Not the chaos deviation: that is a
   * separate error with its own source, and scaling it here would make 강타 a
   * partial cure for the opponent's 혼란 rather than a cost of its own. The two
   * stack — see `_twisted`, which runs first, on the raw aim.
   */
  get _mul() {
    const s = shapeAim(this.match.cards, this.match.rules.currentPlayer, this.dirX, this.dirZ);
    return { impulse: s.impulseMul, spread: s.spreadMul };
  }

  // ── derived quantities ───────────────────────────────────────────────────

  /** How far the string is drawn, in world units. Unclamped. */
  get pullDistance() {
    return Math.hypot(this.pullX, this.pullZ);
  }

  /** The same, stopped at `maxPullDistance`. What the pull line is drawn to. */
  get clampedDistance() {
    return Math.min(this.pullDistance, this.config.shot.maxPullDistance);
  }

  /** 0..1. Reaches 1 at the clamp and stays there however much further you drag. */
  get power() {
    return pullToPower(this.pullDistance, this.config.shot);
  }

  /** Below the deadzone a release is a cancel, not a shot. */
  get armed() {
    return this.pullDistance >= this.config.shot.deadzone;
  }

  get atClamp() {
    return this.pullDistance > this.config.shot.maxPullDistance;
  }

  // ── picking ──────────────────────────────────────────────────────────────

  /**
   * Board-plane point under a client coordinate, or null if the ray misses.
   *
   * From the BOARD's rect rather than the WINDOW: the canvas is letterboxed
   * inside a window of any shape, and using the window would put the aim off by
   * the bars.
   *
   * The board's rect is the canvas's exactly — see `Viewport.boardRect`, which
   * has always returned the whole buffer and now cannot return anything else.
   * It is still asked for by name so that the day the board becomes a
   * sub-rectangle again, this call site is already correct.
   */
  pick(clientX, clientY) {
    const r = this._boardRect();
    if (r.width < 1 || r.height < 1) return null;
    this._ndc.set(
      ((clientX - r.left) / r.width) * 2 - 1,
      -((clientY - r.top) / r.height) * 2 + 1,
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    return this._ray.ray.intersectPlane(BOARD_PLANE, this._hit);
  }

  /**
   * Would a press here grab a cap, and which?
   *
   * The whole of the aim-or-camera decision, in one call, so that the router has
   * nothing to decide for itself and the answer cannot drift between the press
   * and the highlight that promised it. Returns -1 for "this press is the
   * camera's" — which covers empty pitch, the ball, a wall, an opponent's cap,
   * and any press at all while the previous turn is still settling.
   */
  hitTest(clientX, clientY) {
    if (this.match.state !== MATCH_STATE.AIM) return -1;
    const p = this.pick(clientX, clientY);
    if (!p) return -1;

    const arena = this.match.arena;
    const rules = this.match.rules;
    // Generous on purpose, and adjustable: this radius is the border between
    // firing and moving the camera, and a finger is wider than a cap.
    const reach = arena.desc.radius * Math.max(1, this.config.view.grabRadius);
    let best = -1;
    let bestD = Infinity;
    for (let i = 0; i < arena.capCount; i++) {
      if (!rules.canSelect(i, rules.currentPlayer)) continue;
      const c = arena.capCom(i);
      const d = Math.hypot(p.x - c.x, p.z - c.z);
      // Nearest wins, so two caps whose generous radii overlap still resolve to
      // the one actually under the finger.
      if (d <= reach && d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  // ── the gesture ──────────────────────────────────────────────────────────

  /**
   * Start pulling `capIndex`. The router has already decided this is an aim.
   * @returns {boolean} false if the state moved under us
   */
  begin(clientX, clientY, capIndex) {
    if (this.aiming || capIndex < 0) return false;
    if (this.match.state !== MATCH_STATE.AIM) return false;
    const p = this.pick(clientX, clientY);
    if (!p) return false;

    this.match.rules.select(capIndex);
    this.capIndex = capIndex;
    this.aiming = true;

    const c = this.match.arena.capCom(capIndex);
    this._capCentre = { x: c.x, z: c.z };
    this._seed = this.config.shot.lockSeed
      ? this.config.shot.lockedSeed >>> 0
      : nextSeed();

    this._setPullFrom(p);
    return true;
  }

  move(clientX, clientY) {
    if (!this.aiming) return;
    const p = this.pick(clientX, clientY);
    if (!p) return;
    this._setPullFrom(p);
  }

  _setPullFrom(p) {
    // The pull vector ends exactly at the cursor. Nothing diverts pointer
    // movement, so this is an identity rather than an invariant that has to be
    // maintained.
    this.pullX = p.x - this._capCentre.x;
    this.pullZ = p.z - this._capCentre.z;

    const len = Math.hypot(this.pullX, this.pullZ);
    // Below this the direction is whatever pixel the cursor landed on and the
    // aim line spins wildly under the hand. Keep the previous heading.
    if (len < 1e-3) return;
    // Opposite the pull: drag back, shoot forward.
    this.dirX = -this.pullX / len;
    this.dirZ = -this.pullZ / len;
  }

  /**
   * Let go.
   * @returns {import('./shot.js').Shot|null} the shot to fire, or null
   */
  end() {
    if (!this.aiming) return null;

    // Read everything the shot needs BEFORE the reset, including the seed — the
    // seed the preview has been drawing with all along, not a fresh one.
    const capIndex = this.capIndex;
    const armed = this.armed;
    const power = this.power;
    const seed = this._seed;
    // The twisted heading, not the aimed one — the same one the preview drew.
    const { x: dirX, z: dirZ } = this._twisted;
    // Before the reset, like everything else here, and baked into the record so
    // the replay does not have to ask a card whether it was played.
    const mul = this._mul;
    this._reset();

    if (!armed || capIndex < 0) return null;
    return { capIndex, dirX, dirZ, power, seed, impulseMul: mul.impulse, spreadMul: mul.spread };
  }

  /** Back out without firing. Escape, right-click, or a lost pointer. */
  cancel() {
    this._reset();
  }

  _reset() {
    this.aiming = false;
    this.capIndex = -1;
    this.pullX = 0;
    this.pullZ = 0;
  }

  /** What the overlay, the HUD and the trajectory preview all read. */
  get preview() {
    if (!this.aiming || this.match.state !== MATCH_STATE.AIM) return null;
    if (this.capIndex < 0) return null;
    const t = this._twisted;
    const mul = this._mul;
    return {
      capIndex: this.capIndex,
      dirX: t.x,
      dirZ: t.z,
      /** How far chaos has thrown this heading off the one being aimed. */
      chaos: t.deviation,
      power: this.power,
      seed: this._seed,
      // The same two numbers `end` will bake into the record, so the cone that
      // is drawn and the line that is predicted are the shot that will fire.
      impulseMul: mul.impulse,
      spreadMul: mul.spread,
      /** For the overlay: whether to say so in the colour of the aim. */
      smash: mul.impulse !== 1 || mul.spread !== 1,
      pullX: this.pullX,
      pullZ: this.pullZ,
      clampedDistance: this.clampedDistance,
      atClamp: this.atClamp,
      armed: this.armed,
    };
  }
}
