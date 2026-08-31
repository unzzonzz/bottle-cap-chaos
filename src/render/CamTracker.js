/**
 * The camera rides the cap that was just thrown, and nothing else.
 *
 * ── it PANS, and that is the whole of what it is allowed to do ──────────────
 * "추적 중 줌·회전 자동 변경 — 팬만 한다." So every path in this file ends at
 * `GameCamera.followTo`, which writes a pan target and touches nothing else.
 * The zoom the player was on when they fired is the zoom they keep, the bearing
 * likewise, and there is deliberately no code here that could change either —
 * not a `zoomBy`, not an `azimuth`, not a `faceTo` except the one at the very
 * end that hands the view back. At 320x240 a camera that also breathed in and
 * out would be unwatchable, and that is what "멀미가 심해진다" is about.
 *
 * ── the delay is the feature ────────────────────────────────────────────────
 * The look point is a SPRING pulled toward the cap rather than the cap's own
 * position. A cap that ricochets off another one reverses direction in a single
 * step; a camera locked to it reverses with it, and at this resolution the whole
 * frame turns to mush for the two or three frames the reversal takes. The spring
 * leans after the cap instead, arrives late, and settles as the cap slows —
 * which is the same shape the eye expects from a hand-held camera.
 *
 * Stiffness and damping are on the panel because the right pair is a judgement
 * about how the game FEELS and not a number anybody can derive. Critical damping
 * is `2*sqrt(k)`; the defaults sit a shade above it, so the camera never
 * overshoots the cap and swings back, which reads as a wobble.
 *
 * The camera's own pan glide is still downstream of this and still runs — see
 * `GameCamera.update`. So there are two lags in series and the spring is the one
 * you tune; the glide is a floor under how abrupt this can ever be made.
 *
 * ── a fall is the one thing that outranks the throw ─────────────────────────
 * "서바이벌에서 가장 중요한 순간이 낙사다." The rules do not find out about a
 * fall until the turn is over — `resolveTurn` asks the pit sensor once, with
 * everything at rest — so the moment has to be watched for here, per frame,
 * with the SAME question the rules ask: `arena.outOfBounds()`. Not a y
 * threshold, not a bounding box. A second definition of "fallen" is exactly the
 * disagreement that would make a judging bug impossible to find.
 *
 * One fall per gaze, first one wins, ties broken by cap index. A cap that goes
 * over while the camera is already watching another one is not looked at at all
 * — "시선이 왔다갔다하면 안 된다" is a stronger requirement than seeing every
 * fall, and a camera that flicked between two of them would satisfy neither.
 *
 * ── nothing in here can move the simulation ─────────────────────────────────
 * It runs on WALL CLOCK, outside the fixed step, alongside the camera it drives.
 * Every call it makes into the arena is a read or a narrow-phase query, the
 * same class of call `MatchAudio` already makes for the same reason, and it
 * writes to exactly one thing: the camera's pan target. Same seed and same
 * input give the same hashes with this on, off, or halfway through a fall.
 *
 * ── it does not import from `game/` ─────────────────────────────────────────
 * The arena arrives as an argument, the way `ColliderView` is handed a physics
 * world and `DistanceMarks` a list of marks. Which modes track, and where
 * curling's line is, are facts the MODE owns — see `MODES.*.camera.track` and
 * `keepLineZ`. There is no mode name anywhere in this file.
 */

/** Eased both ends. The fall snap and the hand-back share it. */
function smoothstep(t) {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

/**
 * Longest slice the spring is integrated over, in seconds.
 *
 * Semi-implicit Euler goes unstable when `k * dt^2` approaches 1, and a stiff
 * spring on a frame that took 100 ms would be well past it — the look point
 * would fly off the board instead of leaning after the cap. Sub-stepping keeps
 * the answer the same shape whatever the frame rate cost, which matters because
 * the frames this has to survive are exactly the janky ones.
 */
const MAX_SUBSTEP = 1 / 120;

/** How many samples of each trail the path view keeps. About four seconds. */
const PATH_SAMPLES = 260;

export class CamTracker {
  /**
   * @param {object} opts
   * @param {typeof import('../game/config.js').CONFIG} opts.config
   * @param {import('./GameCamera.js').GameCamera} opts.camera
   */
  constructor({ config, camera }) {
    this.config = config;
    this.camera = camera;

    /**
     * What the tracker is doing, as one of five words.
     *
     * `off` nothing, `track` the spring is on the thrown cap, `snap` the timed
     * move onto a cap that has just gone over, `hold` sitting on it until it
     * has finished falling, `yield` the player took the view by hand and it is
     * theirs for the rest of the turn.
     */
    this.phase = 'off';

    /**
     * Has this written a pan target since the turn opened?
     *
     * The whole of how a hand is told apart from a first frame. See
     * `_handTookIt`.
     */
    this._owned = false;

    /** The cap this turn's shot was taken with. -1 when idle. */
    this.capIndex = -1;
    /** The one fall this turn's gaze is spent on. -1 for none yet. */
    this.fallIndex = -1;

    /** Where the camera is looking, and how fast it is getting there. */
    this.look = { x: 0, z: 0 };
    this.vel = { x: 0, z: 0 };
    /** What the spring is pulled toward — the cap, after curling's framing. */
    this.target = { x: 0, z: 0 };

    /** The timed move onto a fallen cap, or null. */
    this.snap = null;
    /** The ease back to the default framing, or null. */
    this.returning = null;

    /**
     * Which caps were in the pit as of the last frame.
     *
     * The EDGE is what a fall is here. Seeded when a turn opens, so caps that
     * were already down there — eliminated on an earlier turn, or stowed in
     * curling's pocket, which the pit's 600-wide box also covers — are not
     * reported as falling the instant the camera starts watching.
     */
    this._wasOut = [];

    /** Last frame's position of the cap being held on, for the rest test. */
    this._holdPrev = null;

    /** Two trails for the panel's path view: where it looked, where it aimed. */
    this.lookPath = [];
    this.targetPath = [];
  }

  /** Is a throw being tracked right now? For the panel and the reset button. */
  get active() {
    return this.phase !== 'off';
  }

  /** What it is doing, in one line. For the panel's readout. */
  get label() {
    if (this.phase === 'snap') {
      return `낙사 #${this.fallIndex} 전환 ${Math.round((this.snap?.t ?? 0) * 100)}%`;
    }
    if (this.phase === 'hold') {
      return this.fallIndex === this.capIndex
        ? `낙사 #${this.fallIndex} (발사 뚜껑) 정착`
        : `낙사 #${this.fallIndex} 주시`;
    }
    if (this.phase === 'track') return `발사 뚜껑 #${this.capIndex}`;
    if (this.phase === 'yield') return '수동 조작 — 이번 턴 추적 중단';
    if (this.returning) return `기본 구도 복귀 ${Math.round(this.returning.t * 100)}%`;
    return '—';
  }

  /**
   * One frame.
   *
   * @param {object} f
   * @param {number} f.dt  seconds of WALL CLOCK, never simulation time
   * @param {boolean} f.live  is the turn being played out?
   * @param {import('../game/Arena.js').Arena} f.arena
   * @param {number} f.shooter  the cap the shot was taken with, or -1
   * @param {boolean} f.enabled  does this MODE track? football does not
   * @param {number|null} [f.keepZ]  a line to keep on screen, or null
   * @param {boolean} [f.reframed]
   *   did the turn change already put the view back? True on a local handover,
   *   where the existing turn-over reset owns the camera and this must not.
   * @param {(() => void)|null} [f.onReturn]
   *   the default-framing call, for when nothing else made it. See `_release`.
   */
  update({ dt, live, arena, shooter, enabled, keepZ = null, reframed = false, onReturn = null }) {
    const step = Math.max(0, Math.min(0.1, dt));
    const on = !!enabled && !!this.config.view.track;

    // Switched off mid-flight: let go of the camera on the spot rather than
    // leaving the pan target parked wherever the last frame put it.
    if (!on) {
      if (this.active) this._stop();
      if (this.returning) this._ease(step);
      this._trail();
      return;
    }

    if (live && shooter >= 0 && arena) {
      if (!this.active || this.capIndex !== shooter) this._begin(arena, shooter);
      // A hand on the view outranks the throw, and it has to be checked before
      // anything is written — see `_handTookIt`.
      if (this.phase !== 'yield' && this._handTookIt()) this.phase = 'yield';
      if (this.phase === 'yield') {
        this._trail();
        return;
      }
      this._watchFalls(arena);
      this._look(step, arena, keepZ);
      this._trail();
      return;
    }

    // The turn is over — or never started. Either way nothing is in flight.
    if (this.active) this._release(reframed, onReturn);
    if (this.returning) this._ease(step);
    this._trail();
  }

  /** A rebuild threw the world away; the indices this was holding are gone. */
  reset() {
    this._stop();
    this.returning = null;
    this._wasOut = [];
    this.lookPath.length = 0;
    this.targetPath.length = 0;
  }

  // ── the turn ─────────────────────────────────────────────────────────────

  /**
   * A shot has just been fired.
   *
   * The spring starts from where the camera already IS, at rest. Starting it at
   * the cap instead would put the look point somewhere the camera has to catch
   * up with, and the first thing the player would see is the board sliding — a
   * jump at the moment of firing, which is the one moment they are watching.
   */
  _begin(arena, shooter) {
    this.phase = 'track';
    this.capIndex = shooter;
    this.fallIndex = -1;
    this.snap = null;
    this.returning = null;
    this._holdPrev = null;
    this._owned = false;

    this.look.x = this.camera.pan.x;
    this.look.z = this.camera.pan.z;
    this.vel.x = 0;
    this.vel.z = 0;
    this.target.x = this.look.x;
    this.target.z = this.look.z;

    // Seeded, not assumed empty. See the note on `_wasOut`.
    this._wasOut = arena.outOfBounds();
    this.lookPath.length = 0;
    this.targetPath.length = 0;
  }

  /**
   * Has the player dragged the view off the throw?
   *
   * "수동 카메라 조작(줌·팬·회전): 허용." Zoom and rotation need nothing doing —
   * neither touches the pan, so both already work mid-throw. The PAN does not
   * work by itself: `panByPixels` calls `stopFollow` and adds to the target, and
   * a follower that rewrites that target on the very next frame puts the view
   * straight back and the drag has no effect at all. Which is the state the
   * ball follow has always been in, and is not what `panByPixels` says it does
   * — "A hand on the view outranks the ball."
   *
   * So: the follow is given up for the rest of the turn the moment the flag it
   * set comes back false. Given up rather than fought over, because a camera
   * that took the view back a second later would be worse than one that never
   * let go. The next turn opens a new throw and starts a new follow.
   *
   * `_owned` is what makes this a test for the hand rather than for the first
   * frame: before this has written anything the flag is legitimately false.
   */
  _handTookIt() {
    return this._owned && !this.camera.following;
  }

  /** Drop everything without asking for the view back. */
  _stop() {
    this.phase = 'off';
    this.capIndex = -1;
    this.fallIndex = -1;
    this.snap = null;
    this._holdPrev = null;
    this._owned = false;
    this.camera.stopFollow();
  }

  /**
   * The turn has ended. Who puts the camera back?
   *
   * ── the local handover already does, and must keep doing it ──────────────
   * `faceCurrentPlayer` resets bearing, zoom and pan the moment the turn
   * changes hands, and that is the mode's existing behaviour — "추적이 끝난
   * 위치는 다음 턴 정렬로 자연스럽게 덮인다. 별도 처리 불필요." So when it has
   * fired, this lets go and adds nothing.
   *
   * ── and when it has NOT, there is nobody else ────────────────────────────
   * A turn that ends without the seat changing gets no reset: an AI opponent,
   * an online opponent, or — the case that exists today — an extra-turn card.
   * The camera would be left parked wherever the throw finished, for a turn the
   * player then has to aim. So the same call the handover makes is made here,
   * through the callback, and the pan is eased back over `trackReturnSec`.
   *
   * `onReturn` is `faceCurrentPlayer(true)` itself rather than a copy of what it
   * does. The framing has one definition and this is not a second one — change
   * the bearing rule or the opening zoom and both paths change together.
   */
  _release(reframed, onReturn) {
    // Where the camera actually IS, not where the spring had got to. The two
    // are the same on an ordinary turn and are not after a hand has taken the
    // view, or after the clamp has been pinning the look point at its limit.
    const from = { x: this.camera.pan.x, z: this.camera.pan.z };
    this._stop();
    if (reframed) return;

    this.returning = { from, t: 0 };
    // Ahead of the ease, so the bearing and the zoom start travelling on this
    // frame rather than on the one after the pan has finished.
    onReturn?.();
  }

  /**
   * Carry the pan back to the default framing's own centre.
   *
   * Zero, and not a remembered value: `faceTo` puts the pan target at the origin
   * and that is what "기본 구도" means for this axis. A timed smoothstep rather
   * than the camera's exponential glide, for the reason `_settleAuto` gives —
   * an exponential never arrives, and this one has to, because the frame after
   * it the player is aiming.
   */
  _ease(step) {
    // The hand outranks the hand-back too, and for the same reason it outranks
    // the follow: `faceTo` has already asked for the bearing and the zoom, and
    // a player who grabs the view during the last third of a second of pan is
    // saying they would rather have it now.
    if (this._handTookIt()) {
      this.returning = null;
      this._owned = false;
      return;
    }
    const dur = Math.max(0.05, this.config.view.trackReturnSec);
    const r = this.returning;
    r.t = Math.min(1, r.t + step / dur);
    const k = 1 - smoothstep(r.t);
    this.look.x = r.from.x * k;
    this.look.z = r.from.z * k;
    this.camera.followTo(this.look);
    this._owned = true;
    if (r.t >= 1) {
      this.returning = null;
      // The pan target is already the origin, which is exactly where `faceTo`
      // put it — so letting go changes nothing and the two agree.
      this.camera.stopFollow();
    }
  }

  // ── the fall ─────────────────────────────────────────────────────────────

  /**
   * Has anything gone over since the last frame?
   *
   * The pit sensor, asked the same way `KnockoutRules` and `CurlingRules` ask
   * it. `_wasOut` is updated on EVERY frame including the ones spent gazing, so
   * a second cap that falls while the camera is already on the first is
   * consumed here and never becomes a gaze of its own.
   */
  _watchFalls(arena) {
    const out = arena.outOfBounds();
    let fresh = -1;
    for (let i = 0; i < out.length; i++) {
      // Ascending, so two caps that enter the pit on the same frame resolve to
      // the lower index every time rather than to whichever the engine happened
      // to report first.
      if (out[i] && !this._wasOut[i]) {
        fresh = i;
        break;
      }
    }
    this._wasOut = out;

    if (fresh < 0 || this.phase !== 'track') return;
    this.fallIndex = fresh;
    this.phase = 'snap';
    this.snap = { from: { x: this.look.x, z: this.look.z }, t: 0 };
    this._holdPrev = null;
  }

  // ── where to look ────────────────────────────────────────────────────────

  _look(step, arena, keepZ) {
    if (this.phase === 'snap') this._snapToFall(step, arena);
    else if (this.phase === 'hold') this._holdOnFall(step, arena);
    else this._spring(step, arena, keepZ);
    this.camera.followTo(this.look);
    this._owned = true;
  }

  /**
   * The move onto a cap that has just gone over.
   *
   * A timed tween and not the spring, because "빠르지만 보간된 전환" is a
   * duration — the number on the panel is the number the move takes, whatever
   * distance it has to cover. A stiffer spring would be neither: it would take
   * longer across the board than across the corner, and it would arrive with
   * velocity and overshoot. Smoothstep ends at rest, so the spring picks up
   * afterwards from a standstill and there is no kick at the handover.
   *
   * The destination is re-read every frame rather than latched, so the camera
   * is travelling toward where the cap IS and not toward where it was when it
   * cleared the rim.
   */
  _snapToFall(step, arena) {
    const dur = Math.max(0.02, this.config.view.trackFallSnapSec);
    const p = this._reachable(arena.capCom(this.fallIndex));
    this.target.x = p.x;
    this.target.z = p.z;

    this.snap.t = Math.min(1, this.snap.t + step / dur);
    const k = smoothstep(this.snap.t);
    this.look.x = this.snap.from.x + (p.x - this.snap.from.x) * k;
    this.look.z = this.snap.from.z + (p.z - this.snap.from.z) * k;
    this.vel.x = 0;
    this.vel.z = 0;

    if (this.snap.t >= 1) {
      this.snap = null;
      this.phase = 'hold';
      this._holdPrev = null;
    }
  }

  /**
   * Sit on it until it has finished falling, then give the throw back.
   *
   * "낙사 연출이 끝나면 다시 발사 뚜껑 추적으로 복귀한다." The end of the
   * performance is the cap coming to rest on the catch floor, which is a thing
   * the world can be asked rather than a second duration to tune — and it is
   * bounded by construction, because the turn itself cannot end until
   * everything is at rest.
   *
   * The exception is the thrown cap being the one that fell: "발사 뚜껑 자체가
   * 낙사한 경우에는 그대로 그 지점에 머문다", so the gaze never lifts. It would
   * make no difference if it did — the cap it would go back to is this one —
   * but saying so here means the phase cannot flicker on a cap that is still
   * rocking.
   */
  _holdOnFall(step, arena) {
    const raw = arena.capCom(this.fallIndex);
    const p = this._reachable(raw);
    this.target.x = p.x;
    this.target.z = p.z;
    this.look.x = p.x;
    this.look.z = p.z;
    this.vel.x = 0;
    this.vel.z = 0;

    if (this.fallIndex === this.capIndex) return;

    // Speed from the position it moved, against the mode's own rest threshold —
    // the SAME number `Arena._kindAtRest` judges the turn by, read through
    // `turnConfig` so a mode that overrides it (curling does) is judged by its
    // own. Reading the body's velocity direct would be a second opinion.
    //
    // Measured on the RAW position, not the clamped one: a cap sailing away
    // past the edge of what the camera may show is still moving, and judging it
    // by the pinned look point would call it settled the moment it left.
    const prev = this._holdPrev;
    this._holdPrev = { x: raw.x, y: raw.y, z: raw.z };
    if (!prev || step <= 0) return;
    const speed = Math.hypot(raw.x - prev.x, raw.y - prev.y, raw.z - prev.z) / step;
    if (speed < Math.max(0.05, arena.turnConfig.rest.cap.linear)) this.phase = 'track';
  }

  /**
   * Lean after the thrown cap.
   *
   * `a = k*(target - x) - c*v`, integrated semi-implicitly in slices no longer
   * than `MAX_SUBSTEP`. Semi-implicit because it is the cheap integrator that
   * stays stable for a spring; sliced because "cheap and stable" stops being
   * true at 10 fps and the frames worth surviving are the slow ones.
   */
  _spring(step, arena, keepZ) {
    const p = arena.capCom(this.capIndex);
    const t = this._reachable(this._frame(p, keepZ));
    this.target.x = t.x;
    this.target.z = t.z;

    const k = Math.max(0, this.config.view.trackStiffness);
    const c = Math.max(0, this.config.view.trackDamping);
    let left = step;
    while (left > 1e-6) {
      const h = Math.min(MAX_SUBSTEP, left);
      left -= h;
      this.vel.x += (k * (t.x - this.look.x) - c * this.vel.x) * h;
      this.vel.z += (k * (t.z - this.look.z) - c * this.vel.z) * h;
      this.look.x += this.vel.x * h;
      this.look.z += this.vel.z * h;
    }
  }

  /**
   * Nudge the look point up the lane so the target line stays in frame.
   *
   * ── the cap is the subject; the line is what it is being judged against ──
   * "발사 뚜껑만 따라가되, 목표 라인이 가능한 한 화면에 보이도록 프레이밍." So
   * this never picks the line over the cap. It shifts toward the line by the
   * least amount that would bring it inside the frame, and refuses to shift so
   * far that the cap itself is pushed out — which is what makes it "가능한 한"
   * rather than a rule that trades one for the other.
   *
   * ── the reach is measured the way the pan clamp measures it ──────────────
   * The visible ground patch is a rectangle in the CAMERA's frame and the line
   * runs along the FIELD's x axis, so what matters is the patch's extent along
   * world z: `u*|sin a| + v*|cos a|`, which is the same projection
   * `GameCamera.panLimits` uses for the same reason. It therefore stays correct
   * if the player turns the table, and it shrinks as they zoom in — so at the
   * turn's opening zoom, where the whole table is on screen, this is a no-op.
   *
   * `trackLineInset` is how far inside the frame's edge both of them are kept.
   * One number for both ends, so when they cannot both fit the cap sits exactly
   * at its own inset and the line is as close as the frame can bring it.
   */
  /**
   * Pull a point back inside what the camera is allowed to show.
   *
   * ── the spring must not chase somewhere the camera cannot go ─────────────
   * `followTo` writes a pan target and the camera clamps it — "following can
   * never show more of the outside world than dragging there by hand would" —
   * so a look point outside the clamp is not a camera position, it is wind-up.
   * A cap that goes over the rim at speed lands eighty units off the board;
   * without this the spring integrates all the way out there, the visible pan
   * sits pinned at its limit the whole time, and the hand-back at the end of
   * the turn then has to unwind eighty units of travel that never happened.
   *
   * Clamped here as well as in the camera, and not instead of it: this keeps
   * the tracker's own state honest, and the camera keeps the last word.
   *
   * The consequence is worth stating plainly, because it is what the follow
   * looks like at the opening zoom: the survival board is entirely on screen
   * there, so the limit on x is zero and the camera does not move sideways at
   * all. That is correct. There is nothing off to the side to move TOWARD, and
   * a view that slid the board about anyway would be the motion sickness this
   * whole file is arranged to avoid. Zoom in and the limits open up and the
   * follow — and the fall snap with it — has somewhere to go.
   */
  _reachable(p) {
    const lim = this.camera.panLimits();
    return {
      x: Math.max(-lim.x, Math.min(lim.x, p.x)),
      z: Math.max(-lim.z, Math.min(lim.z, p.z)),
    };
  }

  _frame(p, keepZ) {
    if (keepZ === null || keepZ === undefined) return { x: p.x, z: p.z };

    const { u, v } = this.camera.visibleHalf();
    const a = this.camera.azimuth;
    const reach = u * Math.abs(Math.sin(a)) + v * Math.abs(Math.cos(a));
    const room = Math.max(0, reach - Math.max(0, this.config.view.trackLineInset));
    if (room <= 0) return { x: p.x, z: p.z };

    const gap = keepZ - p.z;
    const need = Math.abs(gap) - room;
    if (need <= 0) return { x: p.x, z: p.z };
    const shift = Math.min(need, room) * Math.sign(gap);
    return { x: p.x, z: p.z + shift };
  }

  // ── the trail ────────────────────────────────────────────────────────────

  /**
   * Two lines: where the camera aimed, and where it actually looked.
   *
   * Both, because the gap between them IS the spring, and a single line cannot
   * show whether it is lagging by too much or too little. Sampled per frame and
   * only while the panel's switch is on — a ring buffer nobody draws is still a
   * ring buffer being written.
   */
  _trail() {
    if (!this.config.view.trackPath) {
      if (this.lookPath.length) {
        this.lookPath.length = 0;
        this.targetPath.length = 0;
      }
      return;
    }
    // Nothing is being written in `yield`, so sampling there would stack a few
    // hundred identical points on one spot and draw a dot where the line stopped.
    if (this.phase === 'yield') return;
    if (!this.active && !this.returning) return;

    this.lookPath.push(this.look.x, this.look.z);
    this.targetPath.push(this.target.x, this.target.z);
    if (this.lookPath.length > PATH_SAMPLES * 2) {
      this.lookPath.splice(0, this.lookPath.length - PATH_SAMPLES * 2);
      this.targetPath.splice(0, this.targetPath.length - PATH_SAMPLES * 2);
    }
  }
}
