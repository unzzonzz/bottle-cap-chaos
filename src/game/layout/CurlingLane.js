import { RAPIER } from '../../physics/rapier.js';
import { Layout } from './Layout.js';
import { curlingMetrics, curlingMarkings } from './curlingMetrics.js';

/**
 * 컬링's lane: a long rectangle, a fence down each side, and nothing at the ends.
 *
 * ── the ends are OPEN, and that is the whole rule ────────────────────────────
 * "하우스 뒤쪽(레인 끝)은 열려 있다. 벽 없음" — a cap that runs past the back
 * line is gone, and that penalty is the only thing stopping every shot being a
 * full-power one. So there is no wall at either end and no shell over them: the
 * ground simply carries on for `runoff` and then stops.
 *
 * The two SIDES are the opposite case. They are the mode — "반사를 이용한 전략적
 * 플레이가 이 모드의 핵심" — so they are built the way the football fence is:
 * a low, drawn fence for the game to be played against, and an undrawn shell
 * carrying the same footprint up to a lid so a tumbling cap cannot hop out. The
 * lid spans the run-off too, because a cap that cleared the fence over the
 * run-off would land outside the world.
 *
 * ── out is a VOLUME between the lines, not a line ────────────────────────────
 * `inPlay` is a sensor box spanning from the front line to the back line, wider
 * than the fence in X so only Z can ever decide it. A cap is out when NO part of
 * it overlaps that box, which is "완전히 넘어간" as a narrow-phase question
 * rather than as a coordinate comparison — and it is asked once, at rest, so a
 * cap that crossed and came back was never out.
 *
 * ── the house is one sensor, and the rings are paint ─────────────────────────
 * A single cylinder covering the whole house. The concentric rings exist only in
 * `curlingMarkings`, because the score is a COUNT — "링은 시각 요소일 뿐 물리
 * 충돌 없음 ... 개수 방식이므로" — and a ring with a collider or a score value
 * attached would be a scoring rule nobody asked for.
 *
 * ── surfaces combine by MIN, and that is what makes it curling ───────────────
 * The lane's friction and the fence's friction are both `Min`-combined against
 * the cap's, and the fence's restitution is `Max`-combined. Rapier's default is
 * an average, which would mean the two sliders the brief asks for — "벽 반발계수",
 * "표면 마찰 (컬링 전용값)" — each moved the real number by half of what they
 * said, mixed with a cap value that belongs to the other two modes and must not
 * be touched. With these rules each slider IS the number: drag the lane friction
 * to 0.06 and the cap slides on 0.06, not on 0.20.
 *
 * That is the same device the football net uses for exactly the same reason —
 * see `FootballPitch` — and it is the only way to get mode-local materials out
 * of a cap collider that is shared by every mode.
 *
 * ── caps that are not in play live in the POCKET ─────────────────────────────
 * All eight bodies are created at build time, because Rapier hands out handles
 * in creation order and every index-aligned array above this layer counts on
 * that. But only the ones that have been thrown are on the lane: the rest sit
 * far off to the side on the catch floor, asleep, exactly where a knocked-out
 * knockout cap sits. `pocketFor` is where they go and `Arena.stowCap` is what
 * puts them there.
 */

/** Catch floor, well below the lane. Anything that leaves the ground lands here. */
const FLOOR_Y = -14;
/** How far off to the side the pocket is. Outside `extents`, so never on screen. */
const POCKET_X = 220;
/** Gap between parked caps, so two of them never rest against each other. */
const POCKET_STEP = 6;

export class CurlingLane extends Layout {
  constructor(config) {
    super(config);
    /** @type {ReturnType<typeof curlingMetrics>} */
    this.metrics = this._metrics();
    this.groundCollider = -1;
    /** Every wall collider that takes the fence material. */
    this.wallColliders = [];
    /**
     * Every visible static shape, recorded as it is built.
     *
     * The renderer draws THIS rather than deriving its own boxes from the same
     * metrics — the same discipline `FootballPitch` states at length, and for
     * the same reason: "벽은 눈에 보여야 한다" is only honest if what you see is
     * where the collision is.
     */
    this.shapes = [];
    this.sensorBoxes = {};
  }

  get name() {
    return '컬링 레인';
  }

  _metrics() {
    const c = this.config.curling;
    return curlingMetrics(c.laneLength, {
      ratio: c.laneRatio,
      runoff: c.runoff,
      wallHeight: c.wallHeight,
      wallThickness: c.wallThickness,
      houseRadius: c.houseRadius,
      houseMargin: c.houseMargin,
      houseFromBack: c.houseFromBack,
      throwFromFront: c.throwFromFront,
    });
  }

  /**
   * What the camera has to frame: the whole ground, run-off included.
   *
   * The run-off is in it deliberately. It is where an overshooting cap dies, and
   * a penalty you cannot watch happen is a penalty the player has to be told
   * about instead of one they can see.
   */
  get extents() {
    const m = this.metrics;
    return { x: m.halfX + m.wallThickness, z: m.outerHalfZ };
  }

  /**
   * Curling's own turn-end numbers.
   *
   * The lane is slippery on purpose, so a cap slides for several seconds after
   * the other two modes' caps would have stopped — and the shared 5 s damping
   * ramp plus 8 s hard timeout would then cut nearly every shot short and report
   * it as a forced stop. These are the same three defences with the clock let
   * out; `Arena.turnConfig` merges them over `config.turn` and nothing else in
   * the project sees them.
   */
  turnOverrides() {
    return this.config.curling.turn;
  }

  // ── construction ─────────────────────────────────────────────────────────

  buildStatic(arena) {
    // Re-measured on every build: the lane's length and ratio are structural and
    // this is the one place they turn into geometry.
    this.metrics = this._metrics();
    const m = this.metrics;
    const world = arena.physics.world;
    const c = this.config.curling;

    this.wallColliders = [];
    this.shapes = [];
    this.sensors = {};
    this.sensorBoxes = {};

    const t = m.wallThickness;
    const outerZ = m.outerHalfZ;

    // ── the lane ───────────────────────────────────────────────────────────
    // A plain slab, top face at y = 0, running the full length INCLUDING the
    // run-off past both lines. No sloping rim: a cap does not die by falling
    // here, it dies by crossing a line, and a slope at the line would take that
    // decision away from the sensor.
    const groundBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -c.groundThickness * 0.5, 0),
    );
    this.groundCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(m.halfX + t, c.groundThickness * 0.5, outerZ)
        .setFriction(c.laneFriction)
        .setRestitution(c.laneRestitution)
        // See the header. Without this the cap's own 0.34 would be averaged in
        // and the ice would be twice as grippy as the slider says.
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      groundBody,
    ).handle;

    // ── the fences ─────────────────────────────────────────────────────────
    // Down each side, the full length of the ground. Nothing across either end.
    for (const s of [-1, 1]) {
      this._wall(arena, s * (m.halfX + t * 0.5), 0, t * 0.5, outerZ);
    }

    // ── the lid ────────────────────────────────────────────────────────────
    // Closes the box above the fences and across the open ends. It is a
    // containment backstop rather than a surface the game is played against —
    // nothing in ordinary play reaches it — and it is not drawn, for the same
    // reason the football ceiling is not: a lid over the lane would black out
    // the view. Turn on the collider wireframe and it is there.
    const ceil = Math.max(m.wallHeight * 2, c.ceilingHeight);
    const ceilBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, ceil + 1, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(m.halfX + t * 2, 1, outerZ + t).setFriction(0.2).setRestitution(0.1),
      ceilBody,
    );

    // ── the catch floor ────────────────────────────────────────────────────
    // Wide enough to hold both the ground's overshoot and the pocket. A cap that
    // leaves the lane has to land on something, or it falls forever and the
    // settle detector waits for a body that will never be still.
    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_Y - 1, 0),
    );
    world.createCollider(
      RAPIER.ColliderDesc.cuboid(600, 1, 600).setFriction(0.9).setRestitution(0),
      floorBody,
    );

    // ── the sensors ────────────────────────────────────────────────────────
    this._buildInPlaySensor(arena);
    this._buildHouseSensor(arena);
  }

  /** One fence segment, drawn, with its undrawn continuation on top. */
  _wall(arena, cx, cz, hx, hz) {
    const world = arena.physics.world;
    const c = this.config.curling;
    const m = this.metrics;

    const push = (cy, hy, kind) => {
      const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(cx, cy, cz));
      const handle = world.createCollider(
        RAPIER.ColliderDesc.cuboid(hx, hy, hz)
          .setFriction(c.wallFriction)
          .setRestitution(c.wallRestitution)
          // See the header: each slider has to BE the number it says. Max on
          // restitution so a lively wall stays lively against a dead cap; Min on
          // friction so a slick wall stays slick — which between them are what
          // make the reflection angle readable.
          .setRestitutionCombineRule(RAPIER.CoefficientCombineRule.Max)
          .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
        body,
      ).handle;
      this.wallColliders.push(handle);
      this.shapes.push({ kind, shape: 'box', cx, cy, cz, hx, hy, hz });
    };

    push(m.wallHeight * 0.5, m.wallHeight * 0.5, 'fence');

    const ceil = Math.max(m.wallHeight * 2, c.ceilingHeight);
    if (ceil - m.wallHeight > 0.05) {
      push((m.wallHeight + ceil) * 0.5, (ceil - m.wallHeight) * 0.5, 'shell');
    }
  }

  /**
   * The volume a cap has to keep some part of itself in.
   *
   * Wider than the fence in X and taller than anything can reach in Y, so the
   * only thing that can put a cap outside it is crossing one of the two lines.
   * That is what makes `capsOutside(inPlay)` mean "완전히 라인을 넘었다" and
   * nothing else — no coordinate comparison anywhere, and no second answer to
   * "which line was it".
   *
   * Its floor is a hair below the lane, for the reason the knockout bounds
   * sensor's is: a cap resting at exactly y = 0 must not fall out of the volume
   * it is standing in over a rounding error. Its ceiling is above the lid, so a
   * cap in mid-air between the lines is still in play.
   */
  _buildInPlaySensor(arena) {
    const m = this.metrics;
    const world = arena.physics.world;
    const low = -0.4;
    const high = Math.max(m.wallHeight * 3, this.config.curling.ceilingHeight + 2);
    const hy = (high - low) * 0.5;
    const cy = (low + high) * 0.5;

    const body = world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(0, cy, 0));
    this.sensors.inPlay = world.createCollider(
      RAPIER.ColliderDesc.cuboid(m.halfX + m.wallThickness * 3, hy, m.halfZ).setSensor(true),
      body,
    ).handle;
    this.sensorBoxes.inPlay = {
      cx: 0,
      cy,
      cz: 0,
      hx: m.halfX + m.wallThickness * 3,
      hy,
      hz: m.halfZ,
    };
  }

  /**
   * The house: one cylinder, asked about a cap's CENTRE.
   *
   * A cylinder rather than a box because the house is a circle and the count has
   * to agree with the rings that are drawn — a box would score the corners.
   *
   * Short, and that is not an accident either. The question this volume answers
   * is asked of a single point (`Arena.pointInSensor`, the cap's centre of mass)
   * rather than of the cap's eleven colliders, so its height only has to cover
   * where a resting cap's centre of mass can be: on its base, on its rim, or
   * upside down. Three cap heights is all of those with room to spare, and
   * keeping it low means a cap flying OVER the house is not counted as in it.
   */
  _buildHouseSensor(arena) {
    const m = this.metrics;
    const world = arena.physics.world;
    const high = Math.max(1.5, (arena.desc?.height ?? 0.64) * 3);
    const hy = (high + 0.4) * 0.5;
    const cy = hy - 0.4;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, cy, m.houseZ),
    );
    this.sensors.house = world.createCollider(
      RAPIER.ColliderDesc.cylinder(hy, m.houseRadius).setSensor(true),
      body,
    ).handle;
    this.sensorBoxes.house = {
      cx: 0,
      cy,
      cz: m.houseZ,
      shape: 'cylinder',
      radius: m.houseRadius,
      hy,
    };
  }

  // ── placement ────────────────────────────────────────────────────────────

  /**
   * Every cap, in the pocket.
   *
   * NOT on the lane. Curling deals its pieces one at a time — "뚜껑은 발사
   * 지점에서 새로 등장한다. 미리 배치되어 있지 않다" — but the BODIES have to
   * exist from the start, because Rapier hands out handles in creation order and
   * every index-aligned array above this layer (owners, the rules' bookkeeping,
   * the meshes) counts from zero in that order. Creating one mid-match would
   * shuffle the arena under handles that are already held.
   *
   * So all eight are built here, parked, asleep, out of sight and out of reach,
   * and `Match` moves each onto the lane on the turn it is thrown. `alive` is
   * false for a cap that has not been dealt, so the renderer does not draw it.
   *
   * Player 0 takes the first `capsPerTeam` indices and player 1 the next, which
   * is what makes "this player's nth throw" a fixed index rather than a search.
   */
  placements() {
    const per = Math.max(1, Math.round(this.config.curling.capsPerTeam));
    const out = [];
    for (let player = 0; player < 2; player++) {
      for (let i = 0; i < per; i++) {
        const p = this.pocketFor(out.length);
        out.push({ kind: 'cap', owner: player, role: `throw${i + 1}`, x: p.x, y: p.y, z: p.z });
      }
    }
    return out;
  }

  /**
   * Where a cap that is not in play sits.
   *
   * A fixed slot per index, so a cap stowed twice lands in the same place twice
   * and the state hash does not depend on the order things went out. Far enough
   * apart that two parked caps never touch, and far enough from the lane that
   * nothing on it can reach them.
   *
   * `Arena.stowCap` asks the layout for this and does nothing when a layout does
   * not answer — which is every other mode, where a cap that is out of play has
   * already fallen somewhere sensible on its own.
   */
  pocketFor(index) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    return {
      x: side * POCKET_X,
      // On the catch floor, not above it: a parked cap should not spend the
      // first steps of the match falling.
      y: FLOOR_Y + 0.02,
      z: (row - 1.5) * POCKET_STEP,
    };
  }

  /**
   * Where the next cap comes in, given what is already on the lane.
   *
   * The throw spot is the same place every turn — "등장 위치는 레인 시작부 중앙.
   * 매 턴 같은 위치" — and the fallback exists only for the case the brief calls
   * out: a previous cap has been knocked back onto that spot, and dropping a new
   * one inside it would resolve as an explosion rather than as a throw.
   *
   * The search is a FIXED sequence — centre, then alternating sideways by one
   * clearance at a time — so the same board gives the same spot on every run and
   * through every replay. No randomness and no nearest-free search that could
   * depend on iteration order.
   *
   * @param {import('../Arena.js').Arena} arena
   * @param {boolean[]} onLane  which caps are actually in play; parked ones are
   *   two hundred units away and cannot block anything, but asking is cheaper
   *   than reasoning about it.
   */
  throwSpot(arena, onLane = null) {
    const m = this.metrics;
    const clear = arena.desc.radius * 2 + Math.max(0, this.config.curling.throwClearance);
    const limit = m.halfX - arena.desc.radius - m.wallThickness * 0.5;

    for (let step = 0; step * clear <= limit + 1e-6; step++) {
      for (const side of step === 0 ? [0] : [-1, 1]) {
        const x = side * step * clear;
        if (this._spotFree(arena, x, m.throwZ, clear, onLane)) return { x, z: m.throwZ };
      }
    }
    // Nothing free. The centre is still the honest answer — the solver will
    // push whatever is sitting there out of the way — and returning null would
    // mean a turn that cannot open.
    return { x: 0, z: m.throwZ };
  }

  _spotFree(arena, x, z, clear, onLane) {
    const c2 = clear * clear;
    for (let i = 0; i < arena.capCount; i++) {
      if (onLane && !onLane[i]) continue;
      const p = arena.capCom(i);
      // Height is in the test for the reason `Orbs._nearestCap` gives: a cap
      // that has been stowed shares the lane's x/z range and is fourteen units
      // below it, and a flat test would report the throw spot as blocked by a
      // cap nobody can see.
      const dx = p.x - x;
      const dz = p.z - z;
      if (Math.abs(p.y) > 4) continue;
      if (dx * dx + dz * dz < c2) return false;
    }
    return true;
  }

  retune(arena) {
    const c = this.config.curling;
    const ground = arena.physics.collider(this.groundCollider);
    ground.setFriction(c.laneFriction);
    ground.setRestitution(c.laneRestitution);
    for (const h of this.wallColliders) {
      const w = arena.physics.collider(h);
      w.setFriction(c.wallFriction);
      w.setRestitution(c.wallRestitution);
    }
  }

  describe() {
    const m = this.metrics;
    return {
      kind: 'lane',
      metrics: m,
      markings: curlingMarkings(m),
      shapes: this.shapes.slice(),
      sensorBoxes: { ...this.sensorBoxes },
    };
  }
}
