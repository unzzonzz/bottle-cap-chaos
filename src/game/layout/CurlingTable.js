import { RAPIER } from '../../physics/rapier.js';
import { Layout } from './Layout.js';
import { curlingTableMetrics, curlingTableMarkings } from './curlingTableMetrics.js';

/**
 * 컬링's table: a rectangular metal slab, and nothing else at all.
 *
 * ── there is no wall anywhere, on any side ──────────────────────────────────
 * "좌우 측면, 앞뒤 끝 모두 벽 없음. 가장자리를 넘으면 떨어진다." So this builds a
 * flat top, a rim that tips away on all four sides, a catch floor a long way
 * down, and one sensor under the whole thing. That is the entire world.
 *
 * ── falling off IS the survival mode's falling off ──────────────────────────
 * "낙사 처리는 서바이벌 모드와 동일한 방식을 재사용해라. 새로 만들지 마라." Not
 * "the same idea as": the same three pieces, built the same way, judged by the
 * same call. `KnockoutBoard` makes a truncated pyramid whose slope is steeper
 * than the friction angle, drops a catch floor under it, and spans everything
 * below with a `pit` sensor; `KnockoutRules` asks `Arena.outOfBounds()`, which
 * is `capsInside(sensors.pit)`. Every one of those lines is reproduced here with
 * a rectangular footprint instead of a square one, and `CurlingRules` asks the
 * identical question. A cap is out when it has FALLEN, not when it has crossed
 * something — which is a rule you can watch rather than one you have to be told,
 * and it is the same rule in both modes.
 *
 * The rim's job is worth restating because it is the reason the target line is
 * dangerous. A slope steeper than the friction angle cannot be rested on, so a
 * cap that gets far enough over does not teeter there — it tips and goes. Park a
 * cap with its centre a hair inside the far edge and half of it is on that
 * slope, holding on by the half that is not. That is the whole tension of the
 * mode and it is geometry rather than a scoring rule.
 *
 * ── the surface is METAL, and its friction is this mode's alone ─────────────
 * "표면 마찰은 컬링 전용값으로 별도 관리한다. 다른 모드 값을 건드리지 마라." So
 * `config.curling.tableFriction` is read here and nowhere else, and
 * `config.arena.boardFriction` and `config.football.pitchFriction` are untouched
 * by anything in this file.
 *
 * It is `Min`-combined against the cap's own friction, which is shared by every
 * mode and must stay shared. Rapier's default is an average, so without this the
 * slider would move the real number by half of what it says, mixed with a value
 * belonging to the other two modes. With `Min` the slider IS the number: drag it
 * to 0.18 and the cap slides on 0.18, not on 0.26. Same device the football net
 * and the old lane used, for the same reason.
 *
 * ── every cap exists from the start, and almost none of them are here ───────
 * Rapier hands out handles in creation order and every index-aligned array above
 * this layer counts on that, so all the bodies are created in `placements` and
 * the ones not in play sit in the pocket on the catch floor, asleep. `Match`
 * moves one onto the table on the turn it is thrown and puts the round's caps
 * back at the end of it. Nothing is ever created or destroyed mid-match.
 */

/** Top of the pit. Below the slab's underside and its slope. Survival's number. */
const PIT_TOP = -6;
/** Floor of the pit. Below the catch floor, so a landed cap is wholly inside. */
const PIT_BOTTOM = -36;
/** The catch floor itself. Survival's number, for the same reason: far enough
 *  that a cap plainly falls rather than stepping down. */
const FLOOR_Y = -32;
/** How far off to the side the pocket is. Outside `extents`, so never on screen. */
const POCKET_X = 220;
/** Gap between parked caps, so two of them never rest against each other. */
const POCKET_STEP = 6;

export class CurlingTable extends Layout {
  constructor(config, capDiameter = 3.2) {
    super(config);
    /**
     * The cap's own width, which every dimension here is a multiple of.
     *
     * Handed in rather than measured off the arena, because `extents` is read
     * by the camera before `buildStatic` has ever run and `Arena.desc` does not
     * exist yet at that point. `modes.js` supplies it from the same geometry the
     * arena will measure — see `MODES.curling.createLayout`.
     */
    this.capDiameter = capDiameter;
    /** @type {ReturnType<typeof curlingTableMetrics>} */
    this.metrics = this._metrics();
    this.tableCollider = -1;
    this.floorCollider = -1;
  }

  get name() {
    return '컬링 책상';
  }

  _metrics() {
    const c = this.config.curling;
    return curlingTableMetrics(this.capDiameter, {
      widthCaps: c.widthCaps,
      ratio: c.ratio,
      thickness: c.tableThickness,
      slopeRun: c.slopeRun,
      edgeRadius: c.edgeRadius,
      throwFromEdge: c.throwFromEdge,
    });
  }

  /**
   * What the camera has to frame: the table's real OUTER edge, drop included.
   *
   * The drop is in it for the reason the survival board's is. A cap dies by
   * going over an edge, so the edge it goes over is the single most important
   * thing on screen and it has to be ON screen — and with `minZoom` at 1 the
   * whole of this rectangle is the whole of the view at the widest setting,
   * which is "최소 줌에서 책상 전체가 보인다" by construction rather than by a
   * chosen number that would need rechecking every time the table was resized.
   */
  get extents() {
    const m = this.metrics;
    return { x: m.outerHalfX, z: m.outerHalfZ };
  }

  /**
   * Curling's own turn-end numbers.
   *
   * A metal table is slipperier than a mat, so a cap slides for longer than the
   * shared clock expects and the shared damping ramp would be braking a cap that
   * is still travelling to its target. These are the same three defences with
   * the clock let out; `Arena.turnConfig` merges them over `config.turn` and
   * nothing else in the project sees them.
   */
  turnOverrides() {
    return this.config.curling.turn;
  }

  // ── construction ─────────────────────────────────────────────────────────

  buildStatic(arena) {
    // Re-measured on every build: the width and the ratio are structural and
    // this is the one place they turn into geometry.
    this.metrics = this._metrics();
    const m = this.metrics;
    const world = arena.physics.world;
    const c = this.config.curling;

    // ── the table ──────────────────────────────────────────────────────────
    // A truncated pyramid with a rectangular footprint: flat on top out to the
    // edges, then sloping down and outward to the underside. See the header for
    // why it is not a slab, and `KnockoutBoard` for the measurements behind it.
    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, -m.thickness * 0.5, 0),
    );

    const r = m.edgeRadius;
    const topX = m.halfX - r;
    const topZ = m.halfZ - r;
    const botX = m.outerHalfX - r;
    const botZ = m.outerHalfZ - r;
    const hull = [];
    for (const [sx, sz] of [
      [-1, -1],
      [1, -1],
      [1, 1],
      [-1, 1],
    ]) {
      hull.push(sx * topX, m.thickness * 0.5 - r, sz * topZ);
      hull.push(sx * botX, -(m.thickness * 0.5) + r, sz * botZ);
    }
    const desc =
      RAPIER.ColliderDesc.roundConvexHull(new Float32Array(hull), r) ??
      RAPIER.ColliderDesc.roundCuboid(topX, m.thickness * 0.5 - r, topZ, r);

    this.tableCollider = world.createCollider(
      desc
        .setFriction(c.tableFriction)
        .setRestitution(c.tableRestitution)
        // See the header. Without this the cap's own friction — which belongs to
        // the other two modes and must not be touched — is averaged in and the
        // table is grippier than the slider says.
        .setFrictionCombineRule(RAPIER.CoefficientCombineRule.Min),
      body,
    ).handle;

    // ── the catch floor ────────────────────────────────────────────────────
    // A cap that leaves the table has to land on something, or it falls forever
    // and the settle detector waits for a body that will never be still. Wide
    // enough to hold both the fall and the pocket.
    const floorBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, FLOOR_Y, 0),
    );
    this.floorCollider = world.createCollider(
      RAPIER.ColliderDesc.cuboid(600, 1, 600).setFriction(0.9).setRestitution(0),
      floorBody,
    ).handle;

    // ── the pit ────────────────────────────────────────────────────────────
    // Everything below the table. Its top is clear of the slope's underside so a
    // cap still clinging to the rim cannot dip into it, and its bottom is below
    // the catch floor so a cap that has landed is wholly inside. Named `pit`
    // because `Arena.outOfBounds` asks for it by that name — this mode and
    // survival are answering the same question with the same sensor.
    const half = (PIT_TOP - PIT_BOTTOM) * 0.5;
    const pitBody = world.createRigidBody(
      RAPIER.RigidBodyDesc.fixed().setTranslation(0, PIT_BOTTOM + half, 0),
    );
    this.sensors = {
      pit: world.createCollider(
        RAPIER.ColliderDesc.cuboid(600, half, 600).setSensor(true),
        pitBody,
      ).handle,
    };
    this.pitBox = { cx: 0, cy: PIT_BOTTOM + half, cz: 0, hx: 600, hy: half, hz: 600 };
  }

  // ── placement ────────────────────────────────────────────────────────────

  /**
   * Every cap, in the pocket. NOT on the table.
   *
   * "매 라운드 시작 시 필드가 비어 있다" and "뚜껑은 발사 지점에서 새로 등장한다"
   * are the same requirement seen from two ends, and this is where the second
   * one starts: the table is empty at the first frame of the match and stays
   * empty until a turn opens.
   *
   * The BODIES still all exist, because Rapier hands out handles in creation
   * order and every index-aligned array above this layer counts from zero in
   * that order — creating one mid-match would shuffle the arena under handles
   * that are already held. So they are built here, parked, asleep, out of sight
   * and out of reach, and `Match` deals one at a time.
   *
   * Player 0 takes the first `rounds` indices and player 1 the next, so "this
   * player's cap for round n" is arithmetic rather than a search and cannot
   * drift from what was built.
   */
  placements() {
    const rounds = Math.max(1, Math.round(this.config.curling.rounds));
    const out = [];
    for (let player = 0; player < 2; player++) {
      for (let i = 0; i < rounds; i++) {
        const p = this.pocketFor(out.length);
        out.push({ kind: 'cap', owner: player, role: `R${i + 1}`, x: p.x, y: p.y, z: p.z });
      }
    }
    return out;
  }

  /**
   * Where a cap that is not in play sits.
   *
   * A fixed slot per index, so a cap stowed twice lands in the same place twice
   * and the state hash does not depend on the order things went out. Far enough
   * apart that two parked caps never touch, and ON the catch floor rather than
   * above it — a parked cap must be genuinely at rest, because `Arena.peaks`
   * counts every body with no idea which are in play, and one drifting cap in
   * the pocket would hold every turn of the match open until the hard timeout.
   */
  pocketFor(index) {
    const side = index % 2 === 0 ? -1 : 1;
    const row = Math.floor(index / 2);
    return { x: side * POCKET_X, y: FLOOR_Y + 1.02, z: (row - 1.5) * POCKET_STEP };
  }

  /**
   * Where the next cap comes in, given what is already on the table.
   *
   * The same place every turn — "등장 위치는 책상 시작부 중앙. 매 투구 동일" — and
   * the fallback exists for the one case that can actually happen in this mode:
   * the round's first cap barely moved, or was knocked back, and is sitting on
   * the spot. Dropping a new one inside it resolves as an explosion rather than
   * as a throw.
   *
   * The search is a FIXED sequence — centre, then alternating sideways by one
   * clearance at a time — so the same board gives the same spot on every run and
   * through every replay. No randomness, and no nearest-free search whose answer
   * could depend on iteration order.
   *
   * @param {import('../Arena.js').Arena} arena
   * @param {boolean[]|null} onTable  which caps are actually in play
   */
  throwSpot(arena, onTable = null) {
    const m = this.metrics;
    const clear = arena.desc.radius * 2 + Math.max(0, this.config.curling.throwClearance);
    // Kept a cap's radius clear of the side edges, or the fallback would deal a
    // cap half over a slope it is about to slide down.
    const limit = m.halfX - arena.desc.radius;

    for (let step = 0; step * clear <= limit + 1e-6; step++) {
      for (const side of step === 0 ? [0] : [-1, 1]) {
        const x = side * step * clear;
        if (this._spotFree(arena, x, m.throwZ, clear, onTable)) return { x, z: m.throwZ };
      }
    }
    // Nothing free. The centre is still the honest answer — the solver will push
    // whatever is sitting there out of the way, which on a table with no walls
    // is itself a legitimate opening — and returning null would mean a turn that
    // cannot open at all.
    return { x: 0, z: m.throwZ };
  }

  _spotFree(arena, x, z, clear, onTable) {
    const c2 = clear * clear;
    for (let i = 0; i < arena.capCount; i++) {
      if (onTable && !onTable[i]) continue;
      const p = arena.capCom(i);
      // Height is in the test because a parked or fallen cap shares the table's
      // x/z range thirty units below it, and a flat test would report the throw
      // spot as blocked by a cap nobody can see.
      if (Math.abs(p.y) > 4) continue;
      const dx = p.x - x;
      const dz = p.z - z;
      if (dx * dx + dz * dz < c2) return false;
    }
    return true;
  }

  retune(arena) {
    const c = this.config.curling;
    const table = arena.physics.collider(this.tableCollider);
    if (!table) return;
    table.setFriction(c.tableFriction);
    table.setRestitution(c.tableRestitution);
  }

  describe() {
    const m = this.metrics;
    return {
      kind: 'table',
      metrics: m,
      markings: curlingTableMarkings(m),
      pitBox: this.pitBox ? { ...this.pitBox } : null,
    };
  }
}
