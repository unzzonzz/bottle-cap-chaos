import { RAPIER } from '../physics/rapier.js';
import { describeCapColliders } from '../physics/capCollider.js';
import { CapFriction } from '../physics/capFriction.js';
import { FIXED_DT } from '../physics/PhysicsWorld.js';

/**
 * The world and the bodies on it.
 *
 * Sits between the physics layer and the rules layer: it knows what a cap IS
 * (a body plus a compound of colliders plus which player owns it) and nothing
 * about whose turn it is or what makes one out.
 *
 * ── it no longer knows what the world looks like ─────────────────────────────
 * This used to build a square slab, a catch floor and two rows of caps, inline.
 * A football pitch is none of those, so the shape of the world moved out to
 * `Layout` and what is left here is the part every mode shares: creating bodies,
 * damping them, freezing them, measuring them, and interpolating them. Adding a
 * third mode should not touch this file.
 *
 * ── kinds, and why the ball had to be one ────────────────────────────────────
 * Every dynamic body carries a KIND. Only two exist — cap and ball — and the
 * distinction earns its place three times over, because every per-body operation
 * here gates a completion criterion:
 *
 *   `peaks()`          a ball still rolling has to hold the turn open, and it
 *                      has to be judged against its own threshold, because a
 *                      sphere at the caps' 0.9 cm/s is barely moving and at
 *                      their 0.6 rad/s has already stopped.
 *   `setExtraDamping`  the convergence ramp has to reach it, or the ramp is not
 *                      a convergence guarantee any more.
 *   `freezeAll`        the hard timeout has to reach it, or "the turn always
 *                      ends inside eight seconds" is not true.
 *
 * Miss any one and the ball rolls out from under the turn detector: the turn
 * ends, the next player aims at a moving world, and the snapshot that the whole
 * determinism apparatus rests on is taken of a world in motion.
 *
 * ── caps first, ball last ────────────────────────────────────────────────────
 * Cap index is the currency of every layer above this one — owners, the rules'
 * bookkeeping, the meshes, the aim input. So caps occupy 0..capCount-1 in every
 * index-aligned array here and the ball, if the layout has one, comes after
 * them.
 */

/** Body-space y of the cap's origin. Phase 1 builds the mesh hem-at-zero. */
const HEM_Y = 0;

export const BODY_KIND = { CAP: 'cap', BALL: 'ball' };

/**
 * Which caps have any part inside a sensor volume, on ANY world.
 *
 * ── free function so there is ONE definition of "out" ────────────────────────
 * `Arena.capsInside` is this with the live world; the AI's look-ahead is this
 * with a restored copy. Knockout's entire win condition is `outOfBounds()`,
 * which is this against the pit sensor, so a search that judged falling-off for
 * itself would be a second judge — and when the two disagreed, on exactly the
 * teetering-cap cases that decide games, there would be no way to tell which was
 * wrong. `CamTracker` refuses a y-threshold for the same reason and says so at
 * length in its header.
 *
 * Takes a world rather than a `PhysicsWorld` because the copy is a bare
 * `RAPIER.World`, and the only things needed are `getCollider` and
 * `intersectionPairsWith`. No cache: a fork lives for one rollout.
 *
 * @param {import('@dimforge/rapier3d-compat').World} world
 * @param {number[][]} capColliders  collider handles per cap
 * @param {number} sensorHandle
 * @returns {boolean[]} true = at least one part is in the volume
 */
export function capsInSensor(world, capColliders, sensorHandle) {
  if (sensorHandle < 0) return capColliders.map(() => false);
  const sensor = world.getCollider(sensorHandle);
  if (!sensor) return capColliders.map(() => false);
  const inside = new Set();
  world.intersectionPairsWith(sensor, (other) => {
    inside.add(other.handle);
  });
  return capColliders.map((handles) => handles.some((h) => inside.has(h)));
}

/**
 * Is the ball inside a sensor volume, on ANY world.
 *
 * ── `capsInSensor` for the one body that is not a cap ────────────────────────
 * Same discipline, same reason. A goal in this game is a sensor query and never
 * a coordinate comparison — `FootballRules` is emphatic about why: the netting
 * combines restitution by Min at zero, so a ball that goes in STOPS in, and the
 * line judgement belongs to the narrow phase that knows where the net box
 * actually is. An AI that judged goals by comparing `z` against `halfZ` would be
 * a second judge, and it would disagree with the live one precisely on the
 * shots that graze the line — which are the shots worth searching for.
 *
 * Takes a world and a collider handle rather than an arena, so the look-ahead
 * can ask it of a `restoreSnapshot` copy. Handles survive the snapshot — that is
 * the whole reason `PhysicsWorld` traffics in handles rather than bodies — so
 * the live arena's `ballCollider` and the layout's sensor handles address the
 * same shapes in the fork.
 *
 * @param {import('@dimforge/rapier3d-compat').World} world
 * @param {number} ballCollider  the ball's collider handle, or -1 for no ball
 * @param {number} sensorHandle
 * @returns {boolean}
 */
export function ballInSensor(world, ballCollider, sensorHandle) {
  if (sensorHandle < 0 || ballCollider < 0) return false;
  const sensor = world.getCollider(sensorHandle);
  if (!sensor) return false;
  let hit = false;
  world.intersectionPairsWith(sensor, (other) => {
    if (other.handle === ballCollider) hit = true;
  });
  return hit;
}

export class Arena {
  /**
   * @param {import('../physics/PhysicsWorld.js').PhysicsWorld} physics
   * @param {{radius: number, height: number}} capDims  world units
   * @param {typeof import('./config.js').CONFIG} config
   * @param {import('./layout/Layout.js').Layout} layout
   */
  constructor({ physics, capDims, config, layout }) {
    this.physics = physics;
    this.capDims = capDims;
    this.config = config;
    this.layout = layout;

    /** @type {number[]} rigid-body handles, index = cap index */
    this.capBodies = [];
    /** @type {number[][]} collider handles per cap */
    this.capColliders = [];
    /** @type {number[]} owning player per cap */
    this.capOwner = [];
    /** @type {string[]} placement label per cap. Decoration; no rule reads it. */
    this.capRole = [];
    /**
     * Each cap's mass with nothing armed, read back off Rapier at build time.
     *
     * Held so that releasing 철벽 is a RESTORE and never a division. `m *= k`
     * followed by `m /= k` does not come back to `m` in floating point, and a
     * cap that ends a match a few ulps heavier than it started is a cap whose
     * whole future is a different match — the hash would not show it, because
     * mass is not in the hash, and the divergence would surface a hundred turns
     * later as a preview that no longer matched its own shot.
     *
     * See `setCapMassMul`, which is the only place mass is ever written.
     */
    this._capBaseMass = [];
    /**
     * The multiplier currently ON each cap, and the world generation it was
     * observed in. See `PhysicsWorld.generation`.
     *
     * The stamp is the whole of why this is safe to cache. A snapshot carries
     * mass, so a rewind can hand back a cap that disagrees with this array —
     * comparing generations turns that from a silent staleness into a re-apply.
     */
    this._capMassMul = [];
    this._massGeneration = -1;

    /** -1 when the layout has no ball. */
    this.ballBody = -1;
    this.ballCollider = -1;
    this.ballRadius = 0;

    /** Transform order: every dynamic body, caps first. */
    this._bodies = [];

    this.desc = null;

    /**
     * Which friction each cap's colliders are carrying. Built in `build`.
     *
     * Exposed rather than private because the two OTHER worlds need it: the
     * trajectory preview and every AI rollout step a copy of this world and have
     * to apply the same rule to it, or the line drawn and the shots searched are
     * for a cap that grips when the real one skates. See `capFriction.js`.
     */
    this.capFriction = null;

    this._prev = null;
    this._curr = null;

    this.build();
  }

  get capCount() {
    return this.capBodies.length;
  }

  get playerCount() {
    return 2;
  }

  get hasBall() {
    return this.ballBody >= 0;
  }

  /** Dynamic bodies, in transform order. */
  get bodyCount() {
    return this._bodies.length;
  }

  /** Transform slot of the ball, or -1. */
  get ballSlot() {
    return this.hasBall ? this.capCount : -1;
  }

  /** Named sensors the layout built. */
  get sensors() {
    return this.layout.sensors;
  }

  // ── construction ─────────────────────────────────────────────────────────

  build() {
    const { collider } = this.config;

    // Measured before the layout runs: a layout may need the cap's radius to
    // size something against it — the football pitch sizes its ball, and its
    // goal sensor's inset, off exactly this number.
    this.desc = describeCapColliders(this.capDims, collider);

    this.layout.buildStatic(this);

    for (const p of this.layout.placements()) {
      if (p.kind === BODY_KIND.BALL) this._createBall(p);
      else this._createCap(p);
    }

    /**
     * After the caps exist, and installed on the PHYSICS rather than called from
     * the turn loop.
     *
     * A cap can go over during a card animation, during a goal hold, during the
     * settle at kickoff — not only during the turn — and every one of those runs
     * its own stepping loop. The hook is what makes "every step of this world"
     * true by construction instead of true in the four places somebody
     * remembered. `rebuild` runs through here again, so a mode change reinstalls
     * it against the new caps.
     */
    this.capFriction = new CapFriction(this.capBodies, this.capColliders, this.desc);
    this.physics.beforeStep = (world) => this.capFriction.sync(world);

    this._prev = new Float32Array(this.bodyCount * 7);
    this._curr = new Float32Array(this.bodyCount * 7);
    this.syncTransforms();
    this._prev.set(this._curr);
  }

  _createCap(p) {
    const world = this.physics.world;
    const phys = this.config.physics;

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        // The layout may name a height, and almost never does — a cap's resting
        // height is a property of the cap. Curling's undealt caps start in a
        // pocket well below the lane; see `Layout.placements`.
        .setTranslation(p.x, p.y ?? HEM_Y + 0.002, p.z)
        .setLinearDamping(phys.linearDamping)
        .setAngularDamping(phys.angularDamping)
        // Without this a cap at full charge covers four units in one step and
        // walks straight through a 0.09-thick skirt box, or through the board
        // itself on the way down. Everything downstream — out judging, contact
        // counts, the preview matching reality — assumes it never happens.
        .setCcdEnabled(true),
    );

    const handles = [];
    for (const part of this.desc.parts) {
      let cd;
      if (part.kind === 'cylinder') {
        cd = RAPIER.ColliderDesc.cylinder(part.halfHeight, part.radius);
      } else if (part.kind === 'roundCuboid') {
        cd = RAPIER.ColliderDesc.roundCuboid(
          part.halfExtents.x,
          part.halfExtents.y,
          part.halfExtents.z,
          part.borderRadius,
        );
      } else {
        cd = RAPIER.ColliderDesc.cuboid(
          part.halfExtents.x,
          part.halfExtents.y,
          part.halfExtents.z,
        );
      }
      cd.setTranslation(part.translation.x, part.translation.y, part.translation.z)
        .setRotation(part.rotation)
        // setMass, not setDensity: the skirt boxes are deliberately not the
        // thickness of real crown stock, so a density would give a mass that is
        // wrong by whatever factor we fattened them up by.
        .setMass(part.mass)
        .setFriction(this.desc.friction)
        .setRestitution(this.desc.restitution);
      handles.push(world.createCollider(cd, body).handle);
    }

    const index = this.capBodies.length;
    this.capBodies.push(body.handle);
    // AFTER the colliders, which are where the mass comes from: Rapier sums
    // their contributions when the last one is attached, so asking before this
    // point reads a massless body.
    this._capBaseMass.push(body.mass());
    this._capMassMul.push(1);
    this.capColliders.push(handles);
    this.capOwner.push(p.owner ?? 0);
    this.capRole.push(p.role ?? '');
    this._bodies.push({ handle: body.handle, kind: BODY_KIND.CAP, index });
  }

  /**
   * The ball.
   *
   * A single sphere, and CCD is not optional on it. It is the smallest thing on
   * the pitch and the fastest: a 0.8 g ball struck by a 2.2 g cap at full charge
   * leaves at over three world units per step against a radius of about 0.7, so
   * it covers more than two of its own diameters between one step and the next.
   * Without continuous collision it would pass through the fence — not
   * occasionally, but as the ordinary outcome of a hard shot.
   */
  _createBall(p) {
    const world = this.physics.world;
    const b = this.config.ball;

    this.ballRadius = Math.max(0.05, this.desc.radius * Math.max(0.15, b.diameterScale));

    const body = world.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(p.x, this.ballRadius + 0.002, p.z)
        // Its own damping, not the caps'. A sliding cap is stopped by friction;
        // a rolling sphere is not stopped by anything, because rolling contact
        // does almost no work. Left on the caps' 0.18 / 1.3 a hard shot takes
        // about nine seconds of simulated time to come below the rest threshold,
        // which is to say every turn with a struck ball in it would end on the
        // eight-second timeout. This is that mode's rolling resistance.
        .setLinearDamping(b.linearDamping)
        .setAngularDamping(b.angularDamping)
        .setCcdEnabled(true),
    );

    /**
     * Heavy gravity, and NOT a locked vertical.
     *
     * The problem is real: a cap is 0.62 units tall, so it strikes anything with
     * a radius above that BELOW its equator and the contact normal tilts upward.
     * Measured across a strike matrix, a 0.40 ball peaks at 0.84 — it rolls —
     * and a 0.60 ball peaks at 3.12, which is a shot on target sailing over the
     * bar. Something has to hold a big ball down.
     *
     * ── locking the Y axis was the wrong something ──────────────────────────
     * It worked, and it broke the rolling: with no vertical degree of freedom
     * the ground contact has nothing to resolve, so there is no normal impulse,
     * so there is no friction, so there is no torque. The ball SLID — travelling
     * without turning, which is what "가끔 무회전으로 굴러가는" was. A ball that
     * does not roll is not a ball.
     *
     * `gravityScale` leaves the contact intact and simply makes the ball much
     * harder to lift. Everything that made it a ball — the normal force, the
     * friction that spins it, the rolling resistance that stops it — is still
     * being solved; there is just a lot more weight pushing it into the turf.
     */
    body.setGravityScale(Math.max(1, b.gravityScale ?? 1), true);

    this.ballCollider = world.createCollider(
      RAPIER.ColliderDesc.ball(this.ballRadius)
        .setMass(Math.max(1e-3, b.massGrams))
        .setFriction(b.friction)
        .setRestitution(b.restitution),
      body,
    ).handle;

    this.ballBody = body.handle;
    this._bodies.push({ handle: body.handle, kind: BODY_KIND.BALL, index: 0 });
  }

  /** Throw the world away and build it again. For structural parameter changes. */
  rebuild() {
    this.capBodies = [];
    this.capColliders = [];
    this.capOwner = [];
    this.capRole = [];
    this._capBaseMass = [];
    this._capMassMul = [];
    this._massGeneration = -1;
    this.ballBody = -1;
    this.ballCollider = -1;
    this._bodies = [];
    this.physics.reset();
    this.build();
  }

  /** Swap in a different mode's world shape. Structural: caller must rebuild. */
  setLayout(layout) {
    this.layout = layout;
  }

  // ── moving a body by hand ────────────────────────────────────────────────
  //
  // Two calls, and they are the whole of it. Both are for a mode that deals its
  // pieces out over the match rather than opening with all of them on the field,
  // and both are driven by `Match` off a REQUEST the rules made — the rules
  // still never touch the world. See `RuleSet.needsDeploy`.

  /**
   * Put a cap down at a spot, upright and stationary.
   *
   * A teleport, and the reservations `Match.start` records about teleporting do
   * not apply: those are about reproducing an OPENING POSITION, where the
   * previous match's contact manifolds would make "the same placement" a
   * slightly different world each time. This runs immediately before the turn's
   * snapshot is taken and the snapshot is what everything downstream — the
   * preview, the shot, every replay — starts from, so there is still exactly one
   * state for them to agree about.
   *
   * The rotation is reset with it. A cap dealt onto the lane lying on its side
   * because that is how it happened to be parked would be a different piece.
   */
  placeCap(index, x, z) {
    const body = this.physics.body(this.capBodies[index]);
    if (!body) return;
    const zero = { x: 0, y: 0, z: 0 };
    body.setTranslation({ x, y: HEM_Y + 0.002, z }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel(zero, false);
    body.setAngvel(zero, false);
    body.wakeUp();
  }

  /**
   * Send a cap to wherever this layout keeps things that are out of play.
   *
   * A NO-OP unless the layout answers `pocketFor`, which is every mode but
   * curling — a knockout cap that is out has already fallen into the pit and
   * football never takes anything off the pitch. Nothing about the other two
   * modes changes by this existing.
   */
  stowCap(index) {
    const spot = this.layout.pocketFor?.(index);
    if (!spot) return;
    const body = this.physics.body(this.capBodies[index]);
    if (!body) return;
    const zero = { x: 0, y: 0, z: 0 };
    body.setTranslation({ x: spot.x, y: spot.y, z: spot.z }, true);
    body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    body.setLinvel(zero, false);
    body.setAngvel(zero, false);
    body.sleep();
  }

  // ── mass ─────────────────────────────────────────────────────────────────

  /**
   * Make a cap `mul` times as heavy as it was built. The only writer of mass.
   *
   * ── 철벽 is a mass card, and the alternatives were all worse ────────────────
   * "Pushed back less, by a ratio" has exactly one clean expression in a
   * rigid-body solver, and mass is it: a collision hands the struck body
   * `m1(1+e)v1 / (m1+m2)`, so making `m2` larger scales the shove down and
   * scales nothing else. What multiplier buys what ratio is `CardEffects.
   * massMulFor`'s business, and it is not the obvious one — see there.
   *
   * Extra linear damping is a function of TIME, not a ratio — a hard hit still
   * launches and then slows. Lower restitution makes a cap bounce less, which is
   * not the same as being pushed less. A post-collision velocity clamp cannot
   * tell a cap that was struck from a cap that was FIRED, so it would quietly
   * weaken the braced player's own shots. And hooking the solver's contact
   * impulses puts new JS in the middle of the physics step, which is a new risk
   * for both determinism and the snapshot. Mass is the one that is simply true.
   *
   * ── additional mass, not a density, and never a division ───────────────────
   * `setAdditionalMass` REPLACES whatever was previously added, so passing zero
   * restores the collider-derived total exactly — measured bit-identical to the
   * value read at build time, which is the property "해제는 곱셈의 역이 아니라
   * 원래 값 복원" asks for. `_capBaseMass` is what the extra is computed from,
   * so the arithmetic never chains: two multipliers in a row both derive from
   * the same untouched base rather than from each other.
   *
   * `recomputeMassPropertiesFromColliders` is required — without it the change
   * lands on the body but not on `mass()` until the next step, which would make
   * the snapshot taken immediately afterwards a snapshot of the OLD mass. It
   * scales the angular inertia by the same factor and leaves the centre of mass
   * exactly where it was, both measured; a braced cap therefore resists spin as
   * much as it resists being shoved, and still pitches over the same way.
   *
   * That last part is what keeps the rest of the collider's measurements true.
   * `capCollider`'s whole argument is that the centre of mass sits at 62% of the
   * cap's height and that this is why a cap pitches over instead of skating —
   * a multiplier that moved it would have quietly rewritten that.
   *
   * ── called at state transitions, never per step ────────────────────────────
   * A call per physics step would be a floating-point accumulation path for no
   * gain. The guard below is what keeps it to one call per change, and the
   * generation stamp is what keeps the guard honest across a rewind — see
   * `PhysicsWorld.generation`.
   *
   * @param {number} index
   * @param {number} mul  1 = as built. Below 1 is refused; nothing makes a cap
   *   lighter, and a card that did would be a different card.
   * @returns {boolean} whether anything was written
   */
  setCapMassMul(index, mul) {
    const want = Math.max(1, mul);

    // The world was replaced. Every entry now describes a world that no longer
    // exists, so the whole array goes to UNKNOWN — not to 1, which would be a
    // guess, and a snapshot may well have carried a brace back with it.
    if (this._massGeneration !== this.physics.generation) {
      this._massGeneration = this.physics.generation;
      this._capMassMul.fill(Number.NaN);
    }
    if (this._capMassMul[index] === want) return false;

    const body = this.physics.body(this.capBodies[index]);
    const base = this._capBaseMass[index];
    if (!body || !(base > 0)) return false;

    /**
     * Unknown is not the same as different. ASK the body before writing.
     *
     * Writing on a mere cache miss is the obvious thing and it is wrong, because
     * `setAdditionalMass` takes a wake-up flag and a cap that is asleep is meant
     * to stay that way. Waking every cap at the top of every turn puts them all
     * back in the solver's active set, where gravity and the ground contact are
     * integrated afresh — measured, that alone moved the knockout and football
     * determinism digests on a run where nobody was holding the card at all.
     * Curling stayed put only because `mode.cards === false` short-circuits
     * before any of this, which made the fault read as a card problem when it
     * was a wake-up.
     *
     * A ratio of two f32 masses is approximate, so this is a tolerance rather
     * than an equality — but the two answers it has to tell apart are 1 and at
     * least 1.2, and the ratio's own error is around 1e-7.
     */
    if (!Number.isFinite(this._capMassMul[index]) && Math.abs(body.mass() / base - want) < 1e-4) {
      this._capMassMul[index] = want;
      return false;
    }

    // Woken, because the mass genuinely just changed and a sleeping cap would
    // otherwise carry the old inertia into the next contact it is dragged into.
    // Reached only on a real transition — at most twice per card played.
    body.setAdditionalMass(base * (want - 1), true);
    body.recomputeMassPropertiesFromColliders();
    this._capMassMul[index] = want;
    return true;
  }

  /**
   * What `index` is currently multiplied by, ASKED OF THE WORLD.
   *
   * Not read out of the write cache above. The cache exists to avoid redundant
   * writes and is deliberately invalidated by a rewind; a reader that trusted it
   * would answer 1 for a cap that came back from a snapshot heavy. The AI's
   * threat model reads this to divide its push distance per cap, and a threat
   * model that disagrees with the world it is modelling is worse than none.
   *
   * A ratio of two f32 masses, so it is approximate by construction — which is
   * fine, because nothing physical is computed from it. `setCapMassMul` is what
   * the solver sees, and it never divides.
   */
  capMassMul(index) {
    const base = this._capBaseMass[index];
    if (!(base > 0)) return 1;
    const body = this.physics.body(this.capBodies[index]);
    if (!body) return 1;
    return Math.max(1, body.mass() / base);
  }

  // ── live tuning ──────────────────────────────────────────────────────────

  /**
   * Push friction, restitution and base damping onto the existing bodies.
   *
   * Separate from `rebuild` because these are the numbers you want to move WHILE
   * a cap is sliding, to feel the difference. Shape and mass are not, and are
   * not here — the ball's size and mass rebuild, its surface does not.
   */
  applyMaterialTuning() {
    const { collider, physics: phys } = this.config;
    for (let i = 0; i < this.capCount; i++) {
      const b = this.physics.body(this.capBodies[i]);
      b.setLinearDamping(phys.linearDamping);
      b.setAngularDamping(phys.angularDamping);
      for (const h of this.capColliders[i]) {
        this.physics.collider(h).setRestitution(collider.restitution);
      }
    }

    /**
     * Friction is NOT written here, and that is the one difference.
     *
     * Which coefficient a cap is on depends on which way up it is, and
     * `CapFriction` is the single thing that decides that — a second writer
     * would win until the next time a cap turned over and then silently lose.
     * So the panel's numbers go onto the description it reads, its cache is
     * dropped so every cap counts as changed, and the next step writes them.
     */
    this.desc.friction = collider.friction;
    this.desc.flippedFriction = Math.max(0, collider.flippedFriction);
    this.capFriction?.invalidate();

    if (this.hasBall) {
      const cfg = this.config.ball;
      const body = this.physics.body(this.ballBody);
      body.setLinearDamping(cfg.linearDamping);
      body.setAngularDamping(cfg.angularDamping);
      const c = this.physics.collider(this.ballCollider);
      c.setFriction(cfg.friction);
      c.setRestitution(cfg.restitution);
    }

    this.layout.retune(this);
  }

  /** Base damping of one dynamic body, before the turn's ramp is added. */
  _baseDamping(kind) {
    return kind === BODY_KIND.BALL
      ? { lin: this.config.ball.linearDamping, ang: this.config.ball.angularDamping }
      : { lin: this.config.physics.linearDamping, ang: this.config.physics.angularDamping };
  }

  /**
   * The turn's convergence ramp: extra damping on top of the base values.
   *
   * Every dynamic body, ball included. A ramp that reached only the caps would
   * converge the caps and leave the ball rolling, which is the same as not
   * having a ramp.
   *
   * @param {number} extra
   */
  setExtraDamping(extra) {
    for (const rec of this._bodies) {
      const base = this._baseDamping(rec.kind);
      const b = this.physics.body(rec.handle);
      b.setLinearDamping(base.lin + extra);
      b.setAngularDamping(base.ang + extra);
    }
  }

  /** The hard timeout's blunt instrument. */
  freezeAll() {
    const zero = { x: 0, y: 0, z: 0 };
    for (const rec of this._bodies) {
      const b = this.physics.body(rec.handle);
      b.setLinvel(zero, false);
      b.setAngvel(zero, false);
      b.sleep();
    }
  }

  // ── queries ──────────────────────────────────────────────────────────────

  /**
   * Fastest body of each kind. The slowest is not interesting; the fastest is
   * what gates the turn.
   *
   * Returned per kind rather than as one number because the two are judged
   * against different thresholds — see `TurnSettle`. A kind with no bodies comes
   * back at zero, so a mode without a ball needs no special case anywhere.
   *
   * @returns {{cap: {lin: number, ang: number}, ball: {lin: number, ang: number}}}
   */
  peaks() {
    const out = {
      [BODY_KIND.CAP]: { lin: 0, ang: 0 },
      [BODY_KIND.BALL]: { lin: 0, ang: 0 },
    };
    for (const rec of this._bodies) {
      const b = this.physics.body(rec.handle);
      const v = b.linvel();
      const w = b.angvel();
      const slot = out[rec.kind];
      slot.lin = Math.max(slot.lin, Math.hypot(v.x, v.y, v.z));
      slot.ang = Math.max(slot.ang, Math.hypot(w.x, w.y, w.z));
    }
    return out;
  }

  /** Collider handles currently intersecting a sensor. */
  intersecting(sensorHandle) {
    const inside = new Set();
    if (sensorHandle < 0) return inside;
    const sensor = this.physics.collider(sensorHandle);
    if (!sensor) return inside;
    this.physics.world.intersectionPairsWith(sensor, (other) => {
      inside.add(other.handle);
    });
    return inside;
  }

  /**
   * Which caps are NOT inside this sensor volume.
   *
   * Asks the narrow phase which colliders currently intersect it. A cap counts
   * as in if ANY of its eleven parts does, so a cap teetering on the lip with
   * one skirt box still over the board is in — which is the call a human
   * watching would make.
   *
   * @returns {boolean[]} true = outside
   */
  capsOutside(sensorHandle) {
    const inside = this.intersecting(sensorHandle);
    return this.capColliders.map((handles) => !handles.some((h) => inside.has(h)));
  }

  /**
   * Which caps have ANY part inside this sensor volume.
   *
   * The complement of `capsOutside`, and worth having as its own call rather
   * than as a negation at the call site: the two read as opposite questions and
   * the answer for a cap that overlaps NOTHING is `false` in both, which is easy
   * to get backwards when the negation is written by hand.
   *
   * @returns {boolean[]} true = at least one part is in the volume
   */
  capsInside(sensorHandle) {
    // Delegated to the free function so the AI's look-ahead — which runs the
    // same query against a restored copy of this world — cannot end up with a
    // second definition of what "inside the pit" means. See `capsInSensor`.
    return capsInSensor(this.physics.world, this.capColliders, sensorHandle);
  }

  /** Knockout's out judging, by name: a cap that has fallen off the board. */
  outOfBounds() {
    return this.capsInside(this.sensors.pit ?? -1);
  }

  /** Is the ball inside this sensor volume? */
  ballInside(sensorHandle) {
    if (!this.hasBall) return false;
    // Delegated to the free function for the reason `capsInside` is: the AI's
    // look-ahead asks the same question of a restored copy of this world, and
    // one definition of "in the goal" is the only way the two can agree about a
    // ball on the line. See `ballInSensor`.
    return ballInSensor(this.physics.world, this.ballCollider, sensorHandle);
  }

  /**
   * Is this POINT inside that sensor volume?
   *
   * The other question, and it needed asking. `capsInside` answers "does any
   * part of the cap overlap", which is the right test for a pit you fall into
   * and the wrong one for a circle you have to be standing in: a cap is eleven
   * colliders wide, so one skirt box clipping the edge of a curling house would
   * count a cap that is visibly outside it.
   *
   * Still the narrow phase, not a coordinate comparison — `intersectionsWithPoint`
   * asks the same shapes the same engine, it just asks about a point. Filtered
   * to sensors, so a point resting on the lane cannot be answered by the lane.
   *
   * @param {{x: number, y: number, z: number}} point
   */
  pointInSensor(sensorHandle, point) {
    if (sensorHandle < 0 || !point) return false;
    let hit = false;
    this.physics.world.intersectionsWithPoint(
      point,
      (collider) => {
        if (collider.handle !== sensorHandle) return true; // keep looking
        hit = true;
        return false; // found it; stop
      },
      RAPIER.QueryFilterFlags.EXCLUDE_SOLIDS,
    );
    return hit;
  }

  /** World-space centre of mass. The anchor for aim, impulse height and preview. */
  capCom(index) {
    return this.physics.body(this.capBodies[index]).worldCom();
  }

  ballCom() {
    return this.hasBall ? this.physics.body(this.ballBody).worldCom() : null;
  }

  // ── interpolation source ─────────────────────────────────────────────────

  /**
   * Latch the current transforms, keeping the previous set.
   *
   * Called once per physics step, so a render frame that lands between two steps
   * has both ends of the segment it needs to interpolate across. Without this
   * the bodies move in 120 Hz jumps sampled at 60 Hz and every other step is
   * dropped — which reads as a stutter that looks exactly like a physics bug.
   */
  syncTransforms() {
    this._prev.set(this._curr);
    for (let i = 0; i < this._bodies.length; i++) {
      const b = this.physics.body(this._bodies[i].handle);
      const t = b.translation();
      const r = b.rotation();
      const o = i * 7;
      this._curr[o] = t.x;
      this._curr[o + 1] = t.y;
      this._curr[o + 2] = t.z;
      this._curr[o + 3] = r.x;
      this._curr[o + 4] = r.y;
      this._curr[o + 5] = r.z;
      this._curr[o + 6] = r.w;
    }
  }

  /** Force both ends of the interpolation to the current state. After a rewind. */
  resetTransforms() {
    this.syncTransforms();
    this._prev.set(this._curr);
  }

  get prevTransforms() {
    return this._prev;
  }

  get currTransforms() {
    return this._curr;
  }

  /**
   * Step until nothing is moving, or give up.
   *
   * Used once at match start, and again after a goal, to let a fresh placement
   * bed down before the next snapshot is taken. Deterministic: a fixed step
   * budget and fixed thresholds, so the world the first shot is fired into is
   * always the same one.
   */
  settle(maxSteps = 240) {
    let quiet = 0;
    for (let i = 0; i < maxSteps; i++) {
      this.physics.step();
      this.syncTransforms();
      quiet = this.atRest() ? quiet + 1 : 0;
      if (quiet >= 12) break;
    }
    this.freezeAll();
    this.resetTransforms();
  }

  /**
   * Every kind under its own thresholds. Shared by `settle` and `TurnSettle`.
   *
   * @param {ReturnType<Arena['peaks']>} [peaks]
   *   A reading already taken this step. `TurnSettle.postStep` keeps one for the
   *   panel and would otherwise pay for a second identical one here — see the
   *   note at that call. Omitted, this takes its own, which is what `settle`
   *   below and every other caller wants.
   */
  atRest(peaks = this.peaks()) {
    for (const kind of Object.keys(peaks)) {
      if (!this._kindAtRest(kind, peaks)) return false;
    }
    return true;
  }

  /**
   * One kind under its own thresholds.
   *
   * Split out because the goal hold's `ballStop` timing needs to know that the
   * BALL has stopped while the caps are still rolling — which is a question
   * `atRest` cannot answer, since it is the conjunction over every kind.
   *
   * @param {string} kind  a `BODY_KIND`
   */
  kindAtRest(kind) {
    return this._kindAtRest(kind, this.peaks());
  }

  _kindAtRest(kind, peaks) {
    const p = peaks[kind];
    if (!p) return true;
    const rest = this.turnConfig.rest;
    const t = rest[kind] ?? rest[BODY_KIND.CAP];
    return p.lin < t.linear && p.ang < t.angular;
  }

  /**
   * The turn-end numbers in force, mode overrides applied.
   *
   * `config.turn` is the shared set; a layout may replace some of them — see
   * `Layout.turnOverrides` for why a slippery surface needs its own clock. Read
   * through here by both readers, `TurnSettle` and `_kindAtRest`, so the ramp,
   * the timeout and the rest thresholds can never end up on two different
   * clocks for the same turn.
   *
   * Rebuilt on each read rather than cached: the values behind it are sliders,
   * a turn is at most a couple of thousand steps, and a cache would be one more
   * thing to invalidate when a mode switch swapped the layout underneath.
   */
  get turnConfig() {
    const base = this.config.turn;
    const over = this.layout.turnOverrides?.();
    if (!over) return base;
    return { ...base, ...over, rest: { ...base.rest, ...(over.rest ?? {}) } };
  }
}

/** Seconds of simulated time -> whole physics steps. */
export function secondsToSteps(seconds) {
  return Math.max(1, Math.round(seconds / FIXED_DT));
}
