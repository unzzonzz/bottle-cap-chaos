import { RAPIER } from '../../physics/rapier.js';
import { Layout } from './Layout.js';
import { pitchMetrics, pitchMarkings, cornerChords } from './pitchMetrics.js';
import { resolveFormation } from './formations.js';
import { findRespawn } from './respawn.js';

/**
 * 알까기 축구's pitch: turf, a fence you can see, two goals you can hit.
 *
 * ── the arena is a CLOSED BOX ────────────────────────────────────────────────
 * "공과 병뚜껑 모두 맵 밖으로 나갈 수 없다" is a guarantee, not a tendency, so it
 * is built as one. Every horizontal direction is a solid wall — fence along the
 * touchlines, fence along the goal lines with a gap at each mouth, and a net
 * enclosure behind each gap — and the whole thing is closed at the top.
 *
 * The closing is the part worth defending, and it comes in two pieces:
 *
 *   FENCE   0 -> fenceHeight, drawn. What the game is played against.
 *   SHELL   fenceHeight -> ceilingHeight, not drawn, plus a lid across the top.
 *           The same footprint as the fence, continued upward.
 *
 * The brief asks for a LOW fence, and a low fence is exactly the thing a
 * tumbling cap gets over: a full-charge impulse is 500 g·cm/s on a 2.2 g cap,
 * and a cap that catches its rim on another converts enough of that into
 * vertical to clear anything short enough to see past — measured at 3.4 units
 * against a 2.4 fence, in one shot out of sixteen. Making the fence tall enough
 * to be a proof would make it a wall and stop it being a fence.
 *
 * So the box is closed above the fence by geometry nobody can see. It is not a
 * second, hidden wall somewhere else: the shell sits directly on top of each
 * fence and net segment, so there is no gutter behind the fence for anything to
 * be lost in, and nothing can pass the fence LINE at any height. It is not drawn
 * because in ordinary play nothing reaches it — the same reason the ceiling is
 * not drawn. Turn on the collider wireframe and the whole box is there.
 *
 * ── the net absorbs, and that is load-bearing ────────────────────────────────
 * Scoring is judged once, at turn end, with everything at rest — the same
 * discipline the knockout mode judges an out by, and for the same reason. That
 * makes it a rule that a ball which crosses the line has to STAY across it, and
 * a ball is the springiest object on the pitch: at restitution 0.62 it would
 * rattle off the back of the net and come out again, and a goal would silently
 * become a non-goal.
 *
 * So the net colliders combine restitution by MIN rather than by Rapier's
 * default average, and friction by MAX. A ball meeting them keeps none of its
 * bounce and all of the drag, which is what a real net does to a real ball, and
 * it means the turn-end query finds the ball where it went in. Nothing about
 * scoring is special-cased; the net is just made of the right stuff.
 *
 * ── the posts are not the net ────────────────────────────────────────────────
 * The frame — two posts and the crossbar — keeps the ordinary wall material, so
 * hitting the woodwork rebounds properly. Only the three surfaces BEHIND the
 * line are netting.
 */

/** Named goals: index is the player who DEFENDS it. */
const DEFENDS = [0, 1];

export class FootballPitch extends Layout {
  constructor(config) {
    super(config);
    /** @type {ReturnType<typeof pitchMetrics>} */
    this.metrics = this._metrics();
    this.groundCollider = -1;
    /** Every wall collider that takes the wall material. */
    this.wallColliders = [];
    /** Frame colliders — posts and crossbars. Wall material, drawn separately. */
    this.frameColliders = [];
    /** Net colliders. Min-restitution, max-friction. */
    this.netColliders = [];
    this.ceilingCollider = -1;
    /**
     * Every visible static shape, recorded as it is built.
     *
     * The renderer draws THIS rather than deriving its own boxes from the same
     * metrics. Deriving them twice is how a fence ends up drawn 2.4 tall with a
     * collider 3.2 tall — which is the exact failure the brief is guarding
     * against with "벽은 눈에 보여야 한다": a wall you can see is only honest if
     * what you see is where the collision is. One list, built once, by the code
     * that creates the colliders.
     *
     * The ceiling is deliberately NOT in it. It is a containment backstop rather
     * than a surface the game is played against, and drawing a lid over the
     * pitch would black out the entire view.
     */
    this.shapes = [];
  }

  get name() {
    return '축구장';
  }

  /**
   * @param {number} [capRadius]
   *   The cap the ball is sized from. Defaulted rather than required because the
   *   constructor measures the pitch before any arena exists; `buildStatic` has
   *   the real one and re-measures with it, which is the measurement that ends up
   *   as geometry. Only the net's depth floor reads it — see `netDepth`.
   */
  _metrics(capRadius = 1.6) {
    const f = this.config.football;
    return pitchMetrics(f.pitchLength, {
      fenceHeight: f.fenceHeight,
      fenceThickness: f.fenceThickness,
      cornerRadius: f.cornerRadius,
      runoffWidth: f.runoffWidth,
      goalScale: f.goalScale,
      ballDiameter: this.ballRadius(capRadius) * 2,
    });
  }

  get extents() {
    const m = this.metrics;
    // Out to the wall, which is now past the run-off rather than on the lines.
    // The goals stand inside it, on the goal line, with run-off behind them.
    return {
      x: m.outerHalfX + m.fenceThickness,
      z: m.outerHalfZ + m.fenceThickness,
    };
  }

  /** Ball radius in world units. Derived from the cap, never set directly. */
  ballRadius(capRadius) {
    return capRadius * Math.max(0.15, this.config.ball.diameterScale);
  }

  // ── construction ─────────────────────────────────────────────────────────

  buildStatic(arena) {
    // Re-measured on every build, because the pitch length slider is structural
    // and this is the one place that turns it into geometry. With the arena's own
    // cap radius, so the net's depth floor is against the ball this match will
    // actually use rather than against the default one.
    this.metrics = this._metrics(arena.desc?.radius ?? 1.6);
    const m = this.metrics;
    const world = arena.physics.world;
    const f = this.config.football;

    this.wallColliders = [];
    this.frameColliders = [];
    this.netColliders = [];
    this.shapes = [];
    this.sensors = {};
    this.sensorBoxes = {};

    const t = m.fenceThickness;
    const fh = m.fenceHeight;
    // The pitch stands up — X across, Z goal to goal — and the wall stands at
    // the outer edge of the run-off rather than on the lines.
    const outerX = m.outerHalfX + t;
    const outerZ = m.outerHalfZ + t;

    // ── turf ───────────────────────────────────────────────────────────────
    // A plain slab, top face at y = 0. No sloping rim and no fall-off: this
    // mode has walls, so the edge of the surface is never reachable and the
    // whole apparatus the knockout board needs at its edge has nothing to do.
    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -f.groundThickness * 0.5, 0),
    );
    this.groundCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(outerX + t, f.groundThickness * 0.5, outerZ + t)
        .setFriction(f.pitchFriction)
        .setRestitution(f.pitchRestitution),
      groundBody,
    ).handle;

    // ── fence ──────────────────────────────────────────────────────────────
    // A closed rounded rectangle at the outer edge of the run-off. Inner faces
    // exactly on `outerHalf*`, so the ground the ball can reach is the pitch
    // plus the run-off and nothing more.
    //
    // No gap for the goals any more, and that is the simplification the run-off
    // bought: the goals are free-standing objects ON the goal line now, with
    // run-off behind them, so the wall has nothing to make way for.
    const wall = (cx, cy, cz, hx, hy, hz, rotY = 0) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed()
          .setTranslation(cx, cy, cz)
          .setRotation({ x: 0, y: Math.sin(rotY * 0.5), z: 0, w: Math.cos(rotY * 0.5) }),
      );
      const h = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setFriction(f.wallFriction)
          .setRestitution(f.wallRestitution),
        body,
      ).handle;
      this.wallColliders.push(h);
      this.shapes.push({ kind: 'fence', shape: 'box', cx, cy, cz, hx, hy, hz, rotY });
      // The invisible half of the same wall. See the header: same footprint,
      // carried from the top of the fence to the lid, so the fence LINE is
      // impassable at every height and there is no pocket behind it.
      this._shell(arena, cx, cz, hx, hz, rotY);
      return h;
    };

    // ── straights ──────────────────────────────────────────────────────────
    // Both stop at the fillet's tangent point and the fans below carry on from
    // there. With `cornerRadius` at 0 they are the full-length walls they always
    // were, meeting at the square corner.
    //
    // They are then carried ONE THICKNESS past the tangent point. Past it the
    // arc has already curved inside the straight's plane, so the overrun adds
    // wall only in the sliver between the two — behind the surface the ball
    // actually touches — and it fills the wedge that two boxes meeting at a
    // single point would otherwise leave open behind them.
    const R = m.cornerRadius;
    const over = R > 0.01 ? t : 0;

    // Down each side, along Z.
    for (const s of [-1, 1]) {
      wall(s * (m.outerHalfX + t * 0.5), fh * 0.5, 0, t * 0.5, fh * 0.5, m.outerHalfZ - R + over);
    }
    // Across each end, along X. Unbroken — see the note above.
    for (const s of [-1, 1]) {
      wall(0, fh * 0.5, s * (m.outerHalfZ + t * 0.5), m.outerHalfX - R + over, fh * 0.5, t * 0.5);
    }

    // ── corner fans ────────────────────────────────────────────────────────
    // One box per chord of the fillet, taken from `cornerChords` — the same
    // list the painted touchline is drawn from, so the barrier and the line
    // cannot end up in different places on a curve.
    //
    // The box's thin axis points radially outward and its long axis lies along
    // the chord, which is what `angle` and the rotation about Y below arrange:
    // a turn of (pi/2 - angle) about +Y sends local +z onto the outward normal.
    for (const c of cornerChords(m)) {
      wall(
        c.x + Math.cos(c.angle) * t * 0.5,
        fh * 0.5,
        c.z + Math.sin(c.angle) * t * 0.5,
        c.halfLen,
        fh * 0.5,
        t * 0.5,
        Math.PI * 0.5 - c.angle,
      );
    }

    // ── goals ──────────────────────────────────────────────────────────────
    for (const defender of DEFENDS) {
      this._buildGoal(arena, defender);
    }

    // ── ceiling ────────────────────────────────────────────────────────────
    // The lid the shell walls reach up to. Its underside sits exactly at
    // `ceilingHeight`, flush with their tops, so the box has no seam.
    const ceilBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, m.ceilingHeight + 1, 0),
    );
    this.ceilingCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(outerX + t, 1, outerZ + t)
        .setFriction(0.2)
        .setRestitution(0.1),
      ceilBody,
    ).handle;
  }

  /**
   * One undrawn wall segment, from the top of the fence to the lid.
   *
   * Takes the same footprint as the visible thing it stands on. Recorded in
   * `shapes` like everything else — the list is a complete account of what was
   * built — and skipped by the renderer, which is where the decision not to draw
   * it is made and visible.
   */
  _shell(arena, cx, cz, hx, hz, rotY = 0) {
    const m = this.metrics;
    const low = m.fenceHeight;
    const high = m.ceilingHeight;
    if (high - low < 0.05) return;

    const world = arena.physics.world;
    const cy = (low + high) * 0.5;
    const hy = (high - low) * 0.5;
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed()
        .setTranslation(cx, cy, cz)
        .setRotation({ x: 0, y: Math.sin(rotY * 0.5), z: 0, w: Math.cos(rotY * 0.5) }),
    );
    const h = world.createCollider(
      RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(this.config.football.wallFriction)
        .setRestitution(this.config.football.wallRestitution),
      body,
    ).handle;
    this.wallColliders.push(h);
    this.shapes.push({ kind: 'shell', shape: 'box', cx, cy, cz, hx, hy, hz, rotY });
  }

  /** @param {number} defender  the player whose goal this is */
  _buildGoal(arena, defender) {
    const m = this.metrics;
    const world = arena.physics.world;
    const f = this.config.football;

    // −1 for the goal at −Z (player 0's, at the bottom of the screen), +1 for
    // the other. `out` points away from the pitch, so every offset below reads
    // as "this far behind the line".
    const out = defender === 0 ? -1 : 1;
    const line = out * m.halfZ;
    const t = m.fenceThickness;

    /**
     * How tall the goal is: the mouth plus the crossbar sitting on top of it.
     *
     * Every part of the goal is measured against THIS and not against the fence.
     * They were all built to `fenceHeight` back when the goal was a hole in the
     * boundary; the goal has been a free-standing frame in the run-off for a
     * while and that was simply left behind. It went unnoticed until the goal was
     * scaled up past the fence, at which point the crossbar was clamped under it
     * and squashed flat.
     */
    const barHalf = m.postRadius;
    const goalTop = m.goalHeight + barHalf * 2;

    // ── frame ──────────────────────────────────────────────────────────────
    // Posts centred on the corner of the goal line and the goal width, exactly
    // as a real post straddles the line it is measured to. They get the wall
    // material, not the net's — hitting the woodwork has to rebound.
    const frame = (desc, cx, cy, cz, shape) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz),
      );
      this.frameColliders.push(
        world.createCollider(
          desc.setFriction(f.wallFriction).setRestitution(f.wallRestitution),
          body,
        ).handle,
      );
      // `defender` rides along so the renderer can colour the goal for whoever
      // has to keep the ball out of it. There are two goals at opposite ends of
      // a symmetrical pitch and a camera that turns freely, so which one is
      // yours is otherwise a thing you have to remember rather than see.
      this.shapes.push({ kind: 'frame', defender, cx, cy, cz, ...shape });
    };

    // The mouth is measured across the pitch, so the posts are spaced in X, and
    // they stand to the top of the crossbar they carry.
    for (const sx of [-1, 1]) {
      frame(
        RAPIER.ColliderDesc.cylinder(goalTop * 0.5, m.postRadius),
        sx * m.goalHalfWidth,
        goalTop * 0.5,
        line,
        { shape: 'cylinder', radius: m.postRadius, halfHeight: goalTop * 0.5 },
      );
    }

    // The crossbar: underside at `goalHeight`, as thick as the posts are round.
    frame(
      RAPIER.ColliderDesc.cuboid(m.goalHalfWidth, barHalf, m.postRadius),
      0,
      m.goalHeight + barHalf,
      line,
      {
        shape: 'box',
        hx: m.goalHalfWidth,
        hy: barHalf,
        hz: m.postRadius,
      },
    );
    // No shell above the bar. The goal used to be a hole in the boundary and
    // needed the boundary's undrawn continuation carried across it; it is a
    // free-standing frame in the middle of the run-off now, and a shell here
    // would be an invisible wall standing in open play.

    // ── net ────────────────────────────────────────────────────────────────
    const net = (cx, cy, cz, hx, hy, hz) => {
      const body = world.createRigidBody(
        RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz),
      );
      const desc = RAPIER.ColliderDesc.cuboid(hx, hy, hz)
        .setFriction(f.netFriction)
        .setRestitution(0)
        // See the header. Average would leave the ball with half its bounce and
        // a goal could rattle back out into play before the turn-end query.
        .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Min)
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Max);
      this.netColliders.push(world.createCollider(desc, body).handle);
      this.shapes.push({ kind: 'net', defender, shape: 'box', cx, cy, cz, hx, hy, hz });
      // No shell. Same reason as the crossbar: the net is inside the arena now,
      // and anything that cleared it would land on the run-off behind the goal,
      // which is still inside the wall.
    };

    // Back of the net, as tall as the frame it hangs from.
    net(
      0,
      goalTop * 0.5,
      line + out * (m.netDepth + t * 0.5),
      m.goalHalfWidth + t,
      goalTop * 0.5,
      t * 0.5,
    );
    // Sides, inner faces flush with the mouth.
    for (const sx of [-1, 1]) {
      net(
        sx * (m.goalHalfWidth + t * 0.5),
        goalTop * 0.5,
        line + out * (m.netDepth + t) * 0.5,
        t * 0.5,
        goalTop * 0.5,
        (m.netDepth + t) * 0.5,
      );
    }

    /**
     * ── the sensor ───────────────────────────────────────────────────────────
     * A goal is "the ball has passed over the goal line", and the near face is
     * set back by one ball RADIUS so that a sphere of that radius overlaps this
     * slab exactly when its CENTRE has crossed the line — which is, character for
     * character, the predicate `ballIsOut` uses to decide the ball has left play
     * (`Math.abs(b.z) > m.halfZ`). The two tests are the same test, and that is
     * the whole point of the number.
     *
     * ── it was one DIAMETER, and that made goals into corners ────────────────
     * The old inset asked for the whole ball to be across, which reads like the
     * stricter and more correct rule and was neither, because nothing else in
     * this file agreed with it. Measured at the defaults: `ballIsOut` turns true
     * at a centre of 32.01 and the sensor did not answer until 32.29, so a ball
     * resting anywhere in that 0.28-unit band was out of play, between the posts,
     * and NOT a goal — `_judgeOut` then sent it to a corner. That is exactly the
     * reported "골 넣었는데 코너로 간다".
     *
     * Worse than the band suggests, because the net is shallower than the ball is
     * wide. The clamp DID bite at the defaults — one diameter is 1.92 against a
     * `netDepth * 0.85` of 1.24, so the near face sat 1.24 behind the line — while
     * a ball pressed against the inside of the netting can only get its centre
     * 0.50 past it. The window in which a resting ball actually scored was the
     * 0.22 units between those two numbers: you had to jam it into the net. Every
     * softer goal was a corner. (The comment here used to claim the clamp "does
     * not bite at any sane setting"; it bites at the shipped one.)
     *
     * The far face is the inside of the net, which is as far as a ball can get,
     * so the volume stays thin — and it no longer matters, because the near face
     * is now reachable by every ball that is over the line at all.
     */
    const r = this.ballRadius(arena.desc?.radius ?? 1.6);
    const inset = Math.min(r, m.netDepth * 0.85);
    const near = m.halfZ + inset;
    const far = m.halfZ + m.netDepth;
    const hz = (far - near) * 0.5;
    const cz = out * (near + hz);

    // Floor a hair below the turf, for the same reason the knockout bounds
    // sensor is: a ball resting at exactly y = 0 must not fall out of the volume
    // it is sitting in over a rounding error.
    const low = -0.2;
    const high = Math.max(m.goalHeight, r * 2.5);

    const sensorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, (low + high) * 0.5, cz),
    );
    const handle = world.createCollider(
      RAPIER.ColliderDesc.cuboid(m.goalHalfWidth, (high - low) * 0.5, hz).setSensor(true),
      sensorBody,
    ).handle;

    this.sensors[`goal${defender}`] = handle;
    this.sensorBoxes[`goal${defender}`] = {
      cx: 0,
      cy: (low + high) * 0.5,
      cz,
      hx: m.goalHalfWidth,
      hy: (high - low) * 0.5,
      hz,
    };
  }

  // ── placement ────────────────────────────────────────────────────────────

  placements() {
    const m = this.metrics;
    const { caps, ball } = resolveFormation(this.config.football.formation, m);

    // Caps first, ball last. Every index-aligned array upstream — owners,
    // transforms, the rules' own bookkeeping — counts caps from zero, so the
    // ball has to come after all of them or every one of those indices shifts.
    const out = caps.map((c) => ({ kind: 'cap', owner: c.owner, role: c.role, x: c.x, z: c.z }));
    out.push({ kind: 'ball', x: ball.x, z: ball.z });
    return out;
  }

  retune(arena) {
    const f = this.config.football;
    const ground = arena.physics.collider(this.groundCollider);
    ground.setFriction(f.pitchFriction);
    ground.setRestitution(f.pitchRestitution);

    for (const h of this.wallColliders.concat(this.frameColliders)) {
      const c = arena.physics.collider(h);
      c.setFriction(f.wallFriction);
      c.setRestitution(f.wallRestitution);
    }
    // The net's restitution stays at zero — it is what makes a goal stay a goal
    // — so only its drag is tunable.
    for (const h of this.netColliders) {
      arena.physics.collider(h).setFriction(f.netFriction);
    }
  }

  /** Which goal belongs to which player. The rules read this, not coordinates. */
  goalSensorOf(player) {
    return this.sensors[`goal${player}`] ?? -1;
  }

  /**
   * Is the ball's centre outside the lines?
   *
   * A coordinate test, and deliberately — unlike the goal, which is a sensor
   * because a cap is a compound of eleven parts at an arbitrary angle and there
   * is no single point on it to compare. The ball is a sphere with one centre,
   * the lines are a rectangle, and "공의 중심이 경계선 밖" is the rule as
   * written. A sensor here would be machinery in place of a subtraction.
   */
  ballIsOut(arena) {
    const b = arena.ballCom();
    if (!b) return false;
    const m = this.metrics;
    return Math.abs(b.x) > m.halfX || Math.abs(b.z) > m.halfZ;
  }

  /**
   * Where a ball travelling from `inside` to `outside` left the lines.
   *
   * ── the point of exit is not the point of rest ──────────────────────────────
   * Which is the whole reason this exists. Behind the goal line there is a
   * run-off and then a fence, and a ball that goes out at pace crosses, runs on,
   * hits the fence and rolls — measured, a ball that crossed 4.4 units right of
   * centre came to rest 5.9 units LEFT of it. Reading the corner off where it
   * stopped therefore gave the corner on the wrong side, and a ball that ran far
   * enough along the run-off to get back between the goal lines stopped being a
   * corner at all and came back as a throw-in from behind the goal.
   *
   * Football has never cared where the ball ended up. The restart is taken from
   * where it crossed, so that is what is measured.
   *
   * ── it is the segment, not the sample ───────────────────────────────────────
   * At 1/120 a ball doing 400 units/s covers 3.3 units per step, so the first
   * sample taken outside is already a long way past the line and its x is not
   * the x it crossed at. Both axes are solved for the fraction of the step at
   * which they would reach their line and the smaller wins, which is exactly
   * "which line did it reach first" — and lands the answer ON the line rather
   * than beyond it.
   *
   * Pure: two points in, one point out, no clock and no world state. The caller
   * keeps whatever it needs across steps.
   *
   * @param {{x: number, z: number}} inside   last sample with the centre inside
   * @param {{x: number, z: number}} outside  first sample with the centre outside
   * @returns {{x: number, z: number, overGoalLine: boolean}}
   */
  crossing(inside, outside) {
    const m = this.metrics;
    const tX = crossParam(inside.x, outside.x, m.halfX);
    const tZ = crossParam(inside.z, outside.z, m.halfZ);

    // Ties go to the goal line, matching `findRespawn`: a ball that leaves
    // diagonally over the corner flag went out at the corner, and that is a
    // corner however the touchline feels about it.
    const overGoalLine = tZ <= tX;
    const t = Math.min(tZ, tX);

    // Neither axis solved — the sample was already outside when tracking began,
    // or the two points coincide. Report the outside sample and classify it the
    // way a resting ball would be, which is the old behaviour exactly.
    if (!Number.isFinite(t)) {
      return { x: outside.x, z: outside.z, overGoalLine: Math.abs(outside.z) > m.halfZ };
    }

    return {
      x: inside.x + (outside.x - inside.x) * t,
      z: inside.z + (outside.z - inside.z) * t,
      overGoalLine,
    };
  }

  /**
   * Where to put it back, and by which of football's two names.
   *
   * The search is in `respawn.js`; this hands it the world. `lastSearch` keeps
   * the candidates it walked through so the panel can draw them — the only
   * reason this is stored rather than discarded.
   *
   * @param {object} arena
   * @param {{x: number, z: number, overGoalLine: boolean}|null} [exit]
   *   where the ball crossed the line, from `crossing`. The restart is taken
   *   from there. Null falls back to where the ball came to rest, which is the
   *   only thing available if the crossing was never seen.
   */
  respawnFor(arena, exit = null) {
    const b = arena.ballCom();
    const from = exit ?? { x: b.x, z: b.z };
    const caps = [];
    for (let i = 0; i < arena.capCount; i++) {
      const c = arena.capCom(i);
      caps.push({ x: c.x, z: c.z });
    }
    const found = findRespawn({
      ball: { x: from.x, z: from.z },
      // The crossing lands exactly ON the line it crossed, where a `> halfZ`
      // test reads false — so which line it was has to be carried rather than
      // recovered from the point.
      over: exit ? exit.overGoalLine : null,
      caps,
      metrics: this.metrics,
      ballRadius: arena.ballRadius,
      capRadius: arena.desc.radius,
      cfg: this.config.respawn,
    });
    this.lastSearch = found.tried;
    return { x: found.x, z: found.z, kind: found.kind };
  }

  describe() {
    const m = this.metrics;
    return {
      kind: 'pitch',
      metrics: m,
      markings: pitchMarkings(m),
      // The run-off is drawn as its own slab so the touchline is an exact edge
      // between two surfaces rather than a boundary rounded to the nearest quad.
      runoff: { halfX: m.outerHalfX, halfZ: m.outerHalfZ },
      // The colliders themselves, as drawable shapes. See the note on `shapes`.
      shapes: this.shapes.slice(),
      sensorBoxes: { ...this.sensorBoxes },
      goals: DEFENDS.map((defender) => {
        const out = defender === 0 ? -1 : 1;
        return { defender, out, line: out * m.halfZ };
      }),
    };
  }
}

/**
 * Fraction of the segment `a → b` at which |value| first reaches `lim`.
 *
 * `Infinity` when this axis does not cross: it never leaves its band, or it was
 * already outside when the segment began. That makes `Math.min` of the two axes
 * "whichever line was reached first, if either was".
 */
function crossParam(a, b, lim) {
  if (b > lim && a <= lim) return (lim - a) / (b - a);
  if (b < -lim && a >= -lim) return (-lim - a) / (b - a);
  return Infinity;
}
