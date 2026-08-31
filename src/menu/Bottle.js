import { Group, Mesh, PlaneGeometry, Quaternion, Vector3 } from 'three';
import { buildCapGeometry, CAP_DEFAULTS, MM } from '../cap/capGeometry.js';
import { buildBottleProfile } from './bottleProfile.js';
import {
  buildFoamGeometry,
  buildGlassGeometry,
  buildLabelGeometry,
  buildLiquidGeometry,
} from './bottleGeometry.js';
import { Fizz, G_WORLD } from './Fizz.js';
import { createGlassMaterial, createSpriteMaterial } from './menuMaterials.js';
import {
  burstSheet,
  capLogoTexture,
  foamTexture,
  glassHighlightTexture,
  labelTexture,
  shadowTexture,
} from './menuTextures.js';
import { PALETTE } from '../core/palette.js';

/**
 * The bottle on the menu: five meshes, a fixed lean, and two ways of moving.
 *
 * ── the draw order is the design ────────────────────────────────────────────
 * Alpha blending has no depth sorting of its own, so this has to be arranged
 * rather than left to happen. Two mechanisms do it, and it is worth being exact
 * about which does what:
 *
 * three draws EVERY opaque object before ANY transparent one — `renderOrder`
 * only sorts within one of those passes, never across them. So:
 *
 *   opaque pass       liquid, label and cap. All write depth.
 *   transparent pass  glass BACK (renderOrder 1), then glass FRONT (2).
 *
 * and the depth buffer the opaque pass left behind does the rest:
 *
 *   · the far wall is rejected everywhere the drink is in front of it, so the
 *     drink is not seen through the back of its own bottle
 *   · the near wall is rejected everywhere the LABEL is in front of it, which
 *     is the whole reason the label can be red. A label with the bottle wall
 *     blended over it comes out brown, and that is the classic tell that
 *     someone drew the glass as one double-sided pass.
 *
 * Neither glass pass writes depth, so the two compose rather than fighting.
 *
 * ── two glass draws, not one ────────────────────────────────────────────────
 * A single double-sided pass composites the far wall over the near one wherever
 * the index buffer reaches it first, which on a lathe walked bottom-to-top is
 * most of the object. Back faces, contents, front faces — in that order, every
 * frame, with no sorting to do — is the cheap, era-appropriate fix.
 *
 * ── it does not spin ────────────────────────────────────────────────────────
 * Not at idle, not while shaking, not ever. The lean is fixed so the label
 * faces front and stays there, and the idle motion is a slow rise and fall with
 * a much smaller sideways drift — position only. A rotating hero object is the
 * default thing to build and it is explicitly not what this is.
 *
 * ── the shake runs along the bottle's OWN axis ──────────────────────────────
 * `_localUp` is the tilt quaternion applied to (0, 1, 0), so it points up
 * through the bottle rather than up through the world. The shake is a scalar
 * along that vector added to the root's position. Nothing touches the
 * quaternion, which is what keeps the lean constant while the thing is being
 * shaken — and what makes it read as someone shaking a bottle to build the
 * pressure up rather than as the bottle bouncing on a floor.
 */

/** Bottle-cap red, the same one the viewer starts its picker at. */
/**
 * The brand cap. See `PALETTE.menu.capBrand` for why this one value matters more
 * than most: `main.js` paints the whole screen with it during the handover.
 */
const CAP_COLOR = PALETTE.menu.capBrand;
const LINER_COLOR = PALETTE.metal.liner;

export class Bottle {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.bottle` block
   */
  constructor({ retro, tuning }) {
    this.retro = retro;
    this.tuning = tuning;
    this.params = {};

    /** Moved by the float and the shake. Never rotated. */
    this.root = new Group();
    /** Carries the lean, and nothing else ever writes to it. */
    this.lean = new Group();
    this.root.add(this.lean);

    this.highlightMap = glassHighlightTexture();
    this.labelMap = labelTexture();
    this.capTopMap = capLogoTexture();
    this.shadowMap = shadowTexture();
    this.burstMap = burstSheet();
    this.foamMap = foamTexture();

    this.glassBackMaterial = createGlassMaterial(retro, { map: this.highlightMap, face: 'back' });
    this.glassFrontMaterial = createGlassMaterial(retro, { map: this.highlightMap, face: 'front' });
    // Opaque and lit, so the drink picks up the same key and fill as the glass
    // around it. `gloss: 0` — a liquid seen through brown glass with a specular
    // highlight on it looks like a solid.
    // `vertexColors` is what makes the meniscus ring visible — see the note in
    // `buildLiquidGeometry`. A faint gloss so the surface catches the sun.
    this.liquidMaterial = retro.create({
      color: PALETTE.liquid.core,
      gloss: 0.55,
      vertexColors: true,
    });
    /**
     * The oval decal. `alphaTest`, never `transparent`.
     *
     * The texture is an oval in a rectangular page, so the margin has to vanish.
     * Blending it would make the label a fourth participant in a sort that
     * already has the back wall, the liquid and the front wall in it, and at
     * some angles it lost and disappeared behind the glass it is printed on.
     * A cut alpha is opaque: it writes depth, needs no sorting, and — because
     * the decal stands 0.3 mm proud of the envelope — correctly occludes the
     * front wall behind it, which is where a real label sits.
     *
     * `alphaToCoverage` is what keeps the cut edge clean now that PHASE 1 turned
     * MSAA on.
     */
    this.labelMaterial = retro.create({
      map: this.labelMap,
      uvScale: [1, 1],
      alphaTest: 0.5,
      alphaToCoverage: true,
      preset: 'plastic',
      /**
       * 다른 무엇보다 어둡게, 그리고 그 값은 재서 정했다.
       *
       * 라벨은 흰 종이고 카메라와 태양을 동시에 마주 본다. 환경 강도를 그대로 주면
       * 타원 전체가 블룸 임계값을 넘어 하얗게 날아가서, 병에 구멍이 뚫린 것처럼 보인다.
       * 브라우저에서 세 번 재봤다 — 0.75 는 날아가고, 0.35 는 흰 종이가 회색으로
       * 보이고, 0.5 가 흰색으로 읽히면서 임계값 아래에 머문다.
       */
      envIntensity: 0.5,
    });

    this.capBodyMaterial = retro.create({ color: CAP_COLOR });
    // WHITE, not the cap colour. The panel map used to be a greyscale
    // placeholder that got its red by being multiplied by this; the logo brings
    // its own, and multiplying red by red would come out nearly black.
    this.capPanelMaterial = retro.create({ map: this.capTopMap, color: PALETTE.untinted });
    this.capLinerMaterial = retro.create({ color: LINER_COLOR, gloss: 0.35 });

    // Foam is OPAQUE and lit — a head you can see through is not a head, and
    // being in the depth pass is what stops the far wall of the glass drawing
    // through it and what lets the near wall tint it. Barely glossy: wet foam
    // catches a little light, shiny foam is plastic.
    this.foamMaterial = retro.create({ map: this.foamMap, gloss: 0.18 });

    // The carbonation is a field of billboards posed from a closed-form rise
    // model, not a scrolling page and not a particle system. See `Fizz`.
    this.fizz = new Fizz({ retro, tuning });

    this.glassBack = new Mesh(undefined, this.glassBackMaterial);
    this.glassFront = new Mesh(undefined, this.glassFrontMaterial);
    this.liquid = new Mesh(undefined, this.liquidMaterial);
    this.foam = new Mesh(undefined, this.foamMaterial);
    this.label = new Mesh(undefined, this.labelMaterial);
    this.cap = new Mesh(undefined, [
      this.capBodyMaterial,
      this.capPanelMaterial,
      this.capLinerMaterial,
    ]);

    // Only the transparent entries here actually order anything — see the
    // header. The opaque ones are numbered to match so the intent reads.
    this.liquid.renderOrder = 0;
    this.foam.renderOrder = 0;
    this.glassBack.renderOrder = 1;
    // Bubbles are inside the glass, so the near wall is drawn over them and
    // tints them — which is what puts them behind the glass rather than on it.
    this.fizz.mesh.renderOrder = 2;
    this.glassFront.renderOrder = 3;
    this.label.renderOrder = 4;
    this.foam.visible = false;

    this.lean.add(
      this.liquid,
      this.foam,
      this.fizz.mesh,
      this.glassBack,
      this.glassFront,
      this.label,
      this.cap,
    );

    // ── the shadow ───────────────────────────────────────────────────────────
    // In the SCENE, not under the lean: a shadow lies on the floor whatever the
    // thing above it is doing, and parenting it to the bottle would tip it over
    // with the bottle and slide it about with the shake.
    this.shadow = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: this.shadowMap, opacity: 0.85 }),
    );
    this.shadow.rotation.x = -Math.PI / 2;
    this.shadow.renderOrder = -1;

    // ── the burst ────────────────────────────────────────────────────────────
    // One billboard at the mouth, two frames, off unless the launch is running.
    // Half the sheet wide: one frame. `_updateBurst` slides the window.
    this.burstMaterial = createSpriteMaterial(retro, {
      map: this.burstMap,
      blend: 'add',
      opacity: 1,
      uvScale: [0.5, 1],
    });
    // A sibling of `root`, not a child: it is placed by a world position every
    // frame, and a child would have the root's own float added to that twice.
    this.burst = new Mesh(new PlaneGeometry(1, 1), this.burstMaterial);
    this.burst.visible = false;
    this.burst.renderOrder = 6;
    this._burstTime = 0;

    /** Where the cap sits, in the LEAN's space. Recomputed on every rebuild. */
    this._mouthLocal = new Vector3();
    /** The opposite end, for putting the shadow under it. */
    this._baseLocal = new Vector3();
    this._scratch = new Vector3();
    this._centreOffset = 0;
    this._localUp = new Vector3(0, 1, 0);
    this._q = new Quaternion();

    this._clock = 0;
    this._shake = 0;
    /** Baseline y of the liquid's surface ring, kept for the slosh to work off. */
    this._surfaceBase = null;
    /** Whether the surface ring currently holds anything but its rest shape. */
    this._sloshed = false;
    /** The head's front, in world units up the bottle. Integrated by continuity. */
    this._foamTop = 0;
    /** The same, normalised over its travel, for everything that wants 0..1. */
    this._foam = 0;
    /** The eruption impulse, decaying. Set by `popBurst`. */
    this._pop = 0;
    this._foamScroll = 0;
    /** Slosh state: displacement and its rate. A real oscillator has both. */
    this._sloshX = 0;
    this._sloshV = 0;
    /** How far round toward the camera the bottle has turned, 0..1. */
    this._aim = 0;

    this.rebuild();
    this.applyLean();
  }

  // ── construction ───────────────────────────────────────────────────────────

  /** Throw the meshes away and build them again from `tuning.profile`. */
  rebuild() {
    const profile = buildBottleProfile(this.tuning.profile);
    this.profile = profile;

    const glass = buildGlassGeometry(profile);
    const liquid = buildLiquidGeometry(profile);
    const label = buildLabelGeometry(profile);

    // One geometry, two meshes. The back pass is the same triangles seen from
    // the other side, so sharing it is not an optimisation — it is the only way
    // the two walls cannot disagree. Disposed once, by hand, for the same
    // reason: `_swap` would either miss it or free it twice.
    const oldGlass = this.glassBack.geometry;
    this.glassBack.geometry = glass;
    this.glassFront.geometry = glass;
    if (oldGlass && oldGlass !== glass) oldGlass.dispose();

    this._swap(this.liquid, liquid);
    this._swap(this.label, label);
    this._swap(this.foam, buildFoamGeometry(profile));
    this.fizz.setProfile(profile);
    this._foamTop = profile.params.fillLevel * MM;

    // The label material owns a CLONE of the label texture — see
    // `GlossMaterials.create` on why a per-material UV transform needs one —
    // so setting the repeat here cannot pan anybody else's copy.
    this.labelMaterial.map?.repeat.set(label.userData.panels, 1);

    if (!this.capGeometry) {
      // The game's own cap, straight out of the shared module. `shell: false`
      // because the inside of this one is under a bottle finish and is never
      // seen from any angle the menu camera can reach.
      this.capGeometry = buildCapGeometry({ ...CAP_DEFAULTS, shell: false });
      this.cap.geometry = this.capGeometry;
    }

    // Park the bottle so its middle is on the origin — that is what the lean
    // turns about, and building it base-at-zero would swing it round a point
    // below itself.
    this._centreOffset = -(profile.height * MM) / 2;
    for (const m of [
      this.glassBack,
      this.glassFront,
      this.liquid,
      this.foam,
      this.fizz.mesh,
      this.label,
    ]) {
      m.position.y = this._centreOffset;
    }

    /**
     * Seat the cap by its PANEL, not by its hem.
     *
     * The cap's local space has y = 0 at the hem, so the naive seating is a
     * depth to drop the hem to — and it is wrong the moment any cap parameter
     * moves, because a taller skirt then pushes the panel up off the bottle.
     * Measuring back from the cap's own height means the panel sits a fixed
     * fraction of a millimetre proud of the lip whatever the cap is shaped
     * like, which is the thing that actually has to be true.
     *
     * Written with `set` rather than `+=`: this runs again on every rebuild,
     * and `+=` would walk the cap a further half-bottle down on each one.
     */
    const capHeight = this.capGeometry.userData.height;
    this.cap.position.set(
      0,
      profile.height * MM - capHeight + this.tuning.capLift * MM + this._centreOffset,
      0,
    );

    this._mouthLocal.set(0, profile.height * MM + this._centreOffset, 0);
    this._baseLocal.set(0, this._centreOffset, 0);

    const surface = liquid.userData;
    const pos = liquid.getAttribute('position');
    this._surfaceBase = { attr: pos, ...surface };

    // A CIRCLE on the floor, not an ellipse. The ellipse the brief asks for is
    // what perspective makes of a circle seen from a camera a little above it —
    // squashing it here as well would squash it twice.
    const r = profile.params.bodyRadius * MM * this.tuning.shadowScale;
    this.shadow.scale.set(r, r, 1);

    this.triangles = {
      glass: glass.userData.triangles,
      liquid: liquid.userData.triangles,
      label: label.userData.triangles,
      cap: this.capGeometry.userData.triangles,
    };
  }

  _swap(mesh, geometry) {
    const old = mesh.geometry;
    mesh.geometry = geometry;
    if (old && old !== geometry) old.dispose();
  }

  /**
   * Re-read the lean from `tuning`, and refresh the axis the shake runs along.
   *
   * Built by multiplying axis quaternions rather than from an `Euler`, because
   * the ORDER is the whole point and a three-letter order string is a poor way
   * to state it: the yaw has to happen in the bottle's own frame — it is what
   * turns the label to the front — and the leans have to happen after it, in
   * the world's, or changing the yaw would tip the bottle over sideways as well
   * as turning it.
   *
   * ── the aim ───────────────────────────────────────────────────────────────
   * `aim` runs 0 at rest to 1 as the pressure builds, and swings the bottle
   * round to point its mouth at the camera.
   *
   * This is a deliberate exception to the brief's "회전 없음", asked for after
   * the fact and for a good reason: with the bottle locked at its resting lean
   * the cap left pointing up and to the left, and then had to bend through most
   * of a right angle to arrive at the camera. It looked like the cap changed
   * its mind. Turning the whole bottle to aim first means the cap leaves along
   * the axis it was already on, which is the only way the launch reads as one
   * continuous movement.
   *
   * It is still not a spin. It happens once, over the third of a second the
   * carbonation takes to climb, it is driven by that same envelope, and it
   * unwinds when the bottle settles. At rest the bottle does not rotate at all,
   * and the SHAKE adds no rotation either — that is still pure axial travel.
   */
  applyLean(aim = this._aim) {
    const t = this.tuning;
    const deg = (d) => (d * Math.PI) / 180;
    // Eased at both ends so the turn starts and stops rather than snapping into
    // and out of the aimed pose.
    const a = aim * aim * (3 - 2 * aim);
    const leanZ = t.leanZ + (t.aimLeanZ - t.leanZ) * a;
    const leanX = t.leanX + (t.aimPitch - t.leanX) * a;

    const qz = new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), deg(leanZ));
    const qx = new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), deg(leanX));
    const qy = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), deg(t.faceYaw));
    this.lean.quaternion.copy(qz).multiply(qx).multiply(qy);
    this._q.copy(this.lean.quaternion);
    this._localUp.set(0, 1, 0).applyQuaternion(this._q);
  }

  // ── per frame ──────────────────────────────────────────────────────────────

  /**
   * @param {number} dt
   * @param {object} state
   * @param {number} state.shake  0 at rest, 1 at the peak of stage 1
   * @param {number} state.aim    1 while a run is playing out, 0 otherwise
   * @param {import('three').Camera} state.camera  for billboarding the fizz
   */
  update(dt, { shake = 0, aim = 0, camera } = {}) {
    this._clock += dt;
    const t = this.tuning;

    // ── the turn toward the camera ─────────────────────────────────────────
    // Rises faster than it falls: the bottle has to be aimed before the cap
    // goes, and it has all the time in the world to unwind afterwards.
    const rate = dt / Math.max(0.02, aim > this._aim ? t.aimRiseSeconds : t.aimFallSeconds);
    this._aim += Math.max(-rate, Math.min(rate, aim - this._aim));
    this.applyLean(this._aim);

    // ── the float ────────────────────────────────────────────────────────────
    // Position only. The sideways term is a different, slower frequency so the
    // two never line up into a diagonal bob.
    const rise = Math.sin(this._clock * t.floatSpeed) * t.floatAmplitude;
    const drift = Math.sin(this._clock * t.floatSpeed * 0.61) * t.floatAmplitude * 0.28;

    // ── the shake ────────────────────────────────────────────────────────────
    // Along `_localUp`, which is the bottle's own axis. See the header.
    const wobble =
      shake > 0
        ? Math.sin(this._clock * Math.PI * 2 * t.shakeFrequency) * t.shakeAmplitude * shake
        : 0;
    this._shake = wobble;

    this.root.position.set(
      t.originX + drift + this._localUp.x * wobble,
      t.originY + rise + this._localUp.y * wobble,
      this._localUp.z * wobble,
    );

    /**
     * Under the BASE of the bottle, not under its middle.
     *
     * The lean turns the bottle about its own centre, so a bottle leaning
     * nineteen degrees has its base a third of its half-height off to one side
     * — three whole units here. A shadow parked under the centre therefore sits
     * beside the bottle rather than under it, which is exactly what the first
     * version looked like. Asking the lean where the base actually ended up
     * costs one vector rotation and cannot drift out of agreement with it.
     *
     * It tracks the horizontal drift and not the rise, because it is on the
     * floor. It does shrink a little as the bottle goes up, which is the whole
     * of the height cue and costs one multiply.
     */
    this._scratch.copy(this._baseLocal).applyQuaternion(this.lean.quaternion);
    this.shadow.position.set(this.root.position.x + this._scratch.x, t.floorY + 0.02, this._scratch.z);
    const lift = 1 - (rise + wobble * this._localUp.y) * t.shadowLift;
    const r = this.profile.params.bodyRadius * MM * t.shadowScale * lift;
    this.shadow.scale.set(r, r, 1);

    this._slosh(dt, shake);
    this._carbonate(dt, shake);
    this.fizz.update(dt, {
      intensity: Math.max(shake, this._foam),
      camera,
      worldQuaternion: this.lean.quaternion,
    });
    this._updateBurst(dt);
  }

  /**
   * The drink going off.
   *
   * ── the head is a VOLUME being poured into a shape ─────────────────────
   * See the note on the front below: its height is integrated from a production
   * rate divided by the bottle's own cross-section, so the bottle's geometry
   * decides how fast the foam climbs at every height. Nothing here is eased by
   * hand and nothing tracks the shake directly — a head that rose and fell with
   * each individual wobble would read as a level meter, and shaking a bottle
   * does not do that. It makes foam, and foam does not go back in.
   *
   * ── the geometry is rewritten, not rebuilt ─────────────────────────────
   * Six rings of twenty, positions only, once a frame. Each ring is placed up
   * the bottle by the foam's current height and given the radius the GLASS has
   * at that height, so the column hugs the inside all the way — narrowing
   * through the shoulder and into the neck without anything here knowing what a
   * shoulder is. Normals are left alone: they are radial, and a radial normal
   * on a near-vertical column of matte foam is right at every height.
   *
   * The bubbles under it are their own thing entirely — see `Fizz`.
   */
  _carbonate(dt, shake) {
    const t = this.tuning;
    const g = this.foam.geometry;
    const data = g.userData;

    const fillY = this.profile.params.fillLevel * MM;
    const ceilY = t.foamCeiling * MM;
    const inset = this.profile.params.liquidInset;

    /**
     * ── the front rises by CONTINUITY, not by a lerp ────────────────────────
     * Foam is being made at some volume per second down at the surface, and it
     * has nowhere to go but up. So the speed of the front is not a constant and
     * not an eased curve — it is
     *
     *     dy/dt = Q / A(y)
     *
     * the production rate over the cross-section it is currently passing
     * through. Which means the foam crawls up the wide body and then, as the
     * shoulder closes in and the neck takes over, ACCELERATES HARD through the
     * last stretch. Between the body and the neck the area falls by a factor of
     * six, so the front moves six times faster up there, out of one division.
     *
     * That single line is most of what makes a shaken bottle look like a shaken
     * bottle, and no hand-authored curve was going to find it by accident.
     *
     * Production tracks entrained gas; drainage is constant, so when the
     * shaking stops the net goes negative and the head sinks back down — fast
     * in the neck and slowly in the body, for the same reason and by the same
     * arithmetic.
     */
    const r = Math.max(0.05, this.profile.envelopeAt(this._foamTop / MM) * inset * MM);
    const area = Math.PI * r * r;
    const production = shake * t.foamProduction + this._pop * t.foamPopSurge;
    this._pop = Math.max(0, this._pop - dt / Math.max(0.01, t.foamPopSeconds));
    const net = production - t.foamDrain;

    this._foamTop = Math.max(fillY, Math.min(ceilY, this._foamTop + (net * dt) / area));
    // 0..1 across the head's travel, for everything that wants "how worked up
    // is this bottle" rather than a height.
    this._foam = (this._foamTop - fillY) / Math.max(1e-4, ceilY - fillY);

    const active = this._foam > 0.002;
    this.foam.visible = active;
    if (!active) return;

    // Churn. Faster while it is actually being shaken.
    this._foamScroll -= dt * t.foamScrollSpeed * (0.5 + shake);
    if (this.foamMaterial.map) this.foamMaterial.map.offset.y = this._foamScroll;

    const topY = this._foamTop;
    const pos = g.getAttribute('position');
    const rows = data.foamRows;
    const cols = data.foamCols;
    const stride = data.foamStride;

    for (let j = 0; j < rows; j++) {
      const y = fillY + ((topY - fillY) * j) / (rows - 1);
      const r = this.profile.envelopeAt(y / MM) * inset * MM;
      for (let i = 0; i <= cols; i++) {
        const th = (i / cols) * Math.PI * 2;
        const v = j * stride + i;
        pos.setXYZ(v, r * Math.cos(th), y, r * Math.sin(th));
      }
    }

    const headR = this.profile.envelopeAt(topY / MM) * inset * MM;
    pos.setXYZ(data.headCentre, 0, topY, 0);
    for (let i = 0; i < cols; i++) {
      const th = (i / cols) * Math.PI * 2;
      pos.setXYZ(data.headRim + i, headR * Math.cos(th), topY, headR * Math.sin(th));
    }
    pos.needsUpdate = true;
  }

  /**
   * The fill line, sloshing at its OWN frequency.
   *
   * ── the liquid is an oscillator, not a follower ─────────────────────────
   * The first version drove the surface directly off the shake, at the shake's
   * frequency. That is wrong in a way you can feel: a liquid in a container has
   * a natural sloshing frequency of its own, it responds to being driven rather
   * than copying the drive, and it keeps going after the driving stops. Copying
   * the drive makes the surface look welded to the bottle.
   *
   * The fundamental (m = 1) mode in a cylinder is
   *
   *     omega^2 = g (eps/R) tanh(eps h / R),     eps = 1.8412
   *
   * — eps being the first zero of J1', the derivative of the first-order Bessel
   * function. For this bottle, R about 2.8 units and h about 14, that lands at
   * roughly 4 Hz, against a shake at seventeen. So the surface moves at a
   * quarter of the rate the bottle does, which is exactly the lag you see when
   * someone shakes a bottle in front of you, and it could not possibly have
   * come out of driving it at the shake frequency.
   *
   * It is integrated as a damped driven oscillator, sub-stepped so a slow frame
   * cannot make it explode — omega * dt already reaches 1.3 at the loop's 50 ms
   * clamp, which is past where semi-implicit Euler stays well behaved.
   *
   * ── the mode is a TILT, not a two-lobed wave ────────────────────────────
   * m = 1 is the surface tipping like a saucer: high on one side, low on the
   * other, still in the middle. The earlier `sin(2 theta)` was the m = 2 mode,
   * which is a real mode but not the one that dominates, and it read as the
   * drink rippling rather than swaying.
   *
   * ── and the drive comes from the LEAN ───────────────────────────────────
   * A perfectly vertical shake excites no tilt at all — it is symmetric about
   * the axis. This bottle is leaning, so shaking it along its own axis has a
   * horizontal component of sin(lean), and THAT is what tips the drink. The
   * coupling falls out of the geometry rather than being asserted, and it means
   * standing the bottle upright would correctly calm the surface down.
   */
  _slosh(dt, shake) {
    const base = this._surfaceBase;
    if (!base || !base.surfaceCols) return;

    const t = this.tuning;
    const p = this.profile.params;
    const R = Math.max(0.2, this.profile.envelopeAt(p.fillLevel) * p.liquidInset * MM);
    const h = Math.max(0.2, p.fillLevel * MM);
    const k = 1.8412 / R;
    const omega = Math.sqrt(G_WORLD * k * Math.tanh(k * h));

    /**
     * ── the drive is the STROKE, not the rattle ────────────────────────────
     * Driving this at the shake's own 17 Hz produced almost nothing, and that
     * is not a bug — it is the answer. 17 Hz is nearly seven times the drink's
     * natural 4 Hz, and a linear oscillator driven far above resonance responds
     * as F/omega_d^2, which here is a fiftieth of what it would give at
     * resonance. A high-frequency rattle genuinely does not slosh a bottle.
     *
     * What sloshes a bottle is the arm. Shaking one is a stroke of a few hertz
     * with the rattle riding on top, and a few hertz is right on top of the
     * drink's own mode — which is precisely WHY shaking works, and why you
     * instinctively shake at that rate rather than faster. So the drive is at
     * `strokeFrequency`, the resonance does the amplifying, and the shake's own
     * frequency stays what it always was: the bottle's motion, not the drink's.
     *
     * Horizontal share from the current lean: `_localUp` is the bottle's axis
     * in world space, so its horizontal length IS sin(lean). Stand the bottle
     * upright and the drive correctly goes to zero — an axial shake of an
     * upright cylinder is symmetric and cannot excite a tilt.
     */
    const tipping = Math.hypot(this._localUp.x, this._localUp.z);
    const drive =
      shake * t.sloshDrive * tipping * Math.sin(this._clock * Math.PI * 2 * t.strokeFrequency);

    const steps = Math.max(1, Math.ceil(dt * 240));
    const step = dt / steps;
    for (let n = 0; n < steps; n++) {
      const accel = -omega * omega * this._sloshX - 2 * t.sloshDamping * omega * this._sloshV + drive;
      this._sloshV += accel * step;
      this._sloshX += this._sloshV * step;
    }

    const amp = Math.max(-t.sloshLimit, Math.min(t.sloshLimit, this._sloshX));
    // Nothing to write and nothing to undo: skip, so a still bottle costs
    // nothing at all here.
    if (Math.abs(amp) < 1e-4 && !this._sloshed) return;
    this._sloshed = Math.abs(amp) >= 1e-4;

    const attr = base.attr;
    for (let i = 0; i < base.surfaceCols; i++) {
      const th = (i / base.surfaceCols) * Math.PI * 2;
      // Tipping about the same axis the bottle leans on, so the drink runs to
      // the low side of a leaning bottle rather than to some unrelated one.
      attr.setY(base.surfaceRim + i, base.surfaceY + Math.cos(th) * amp);
    }
    // The centre is the pivot of a tilt and does not move. That is what makes
    // it a tilt rather than the whole surface bobbing.
    attr.setY(base.surfaceCentre, base.surfaceY);
    attr.needsUpdate = true;
  }

  // ── the burst at the mouth ─────────────────────────────────────────────────

  /**
   * Fire the two-frame spray. Called once, when the cap leaves.
   *
   * It also slams the pressure to full, so the head is at the top of the neck
   * on the frame the cap goes rather than wherever the shake happened to have
   * pushed it. Whatever the player skipped, the bottle erupts.
   */
  popBurst() {
    this._burstTime = 0;
    this.burst.visible = true;
    // An impulse into the production rate rather than a jump in the height:
    // the pressure release makes foam violently for a moment, and how fast that
    // foam then travels is still the bottle's cross-section's business. Which
    // means the surge is slow through the shoulder and explosive in the neck,
    // for free, out of the same division.
    this._pop = 1;
  }

  _updateBurst(dt) {
    if (!this.burst.visible) return;
    this._burstTime += dt;
    const life = this.tuning.burstSeconds;
    if (this._burstTime >= life) {
      this.burst.visible = false;
      return;
    }
    // Two frames, stepped. No cross-fade — a sprite sheet on this hardware
    // changed frames, it did not blend them. Through the material's own uv
    // uniforms and not `texture.offset`, which a ShaderMaterial ignores; see
    // the note on the sprite vertex stage.
    const frame = this._burstTime < life * 0.4 ? 0 : 1;
    if (this.burstMaterial.map) this.burstMaterial.map.offset.x = frame * 0.5;

    const grow = 1 + (this._burstTime / life) * 1.6;
    const size = this.tuning.burstSize * grow;
    this.burst.scale.set(size, size, 1);
    this.burst.position.copy(this.mouthWorld());
  }

  /** Where the cap leaves from, in world space. The wipe launches from here. */
  mouthWorld(out = new Vector3()) {
    return out.copy(this._mouthLocal).applyQuaternion(this.lean.quaternion).add(this.root.position);
  }

  /** Which way the mouth points, in world space. The wipe flies along this. */
  mouthDirection(out = new Vector3()) {
    return out.copy(this._localUp);
  }

  /** Hide the cap at the moment it becomes the wipe's cap. */
  setCapVisible(on) {
    this.cap.visible = on;
  }

  setWireframe(on) {
    for (const m of [
      this.glassBackMaterial,
      this.glassFrontMaterial,
      this.liquidMaterial,
      this.foamMaterial,
      this.labelMaterial,
      this.capBodyMaterial,
      this.capPanelMaterial,
      this.capLinerMaterial,
    ]) {
      m.wireframe = on;
    }
  }

  dispose() {
    for (const m of [this.glassBack, this.liquid, this.foam, this.label, this.shadow, this.burst]) {
      m.geometry?.dispose();
    }
    this.capGeometry?.dispose();
    this.fizz.dispose();
    for (const t of [
      this.highlightMap,
      this.labelMap,
      this.capTopMap,
      this.shadowMap,
      this.burstMap,
      this.foamMap,
    ]) {
      t.dispose();
    }
    this.glassBackMaterial.dispose();
    this.glassFrontMaterial.dispose();
    this.burstMaterial.dispose();
    this.shadow.material.dispose();
    this.root.clear();
    this.lean.clear();
  }
}

/**
 * Which way the cap flies, in frame axes, once the bottle has aimed.
 *
 * The menu projects the real thing through its own camera. This is for the
 * GAME page, which has to pick stage 4 up after a document swap with no bottle
 * to ask — and a cap that covered the screen travelling up and left, then left
 * it travelling somewhere else, would give the whole trick away.
 *
 * Rz(leanZ) applied to Rx(pitch) applied to the bottle's up vector; the frame's
 * x and y are the world's, so the horizontal part drops straight out.
 */
export function aimedLaunchDirection(tuning) {
  const z = (tuning.aimLeanZ * Math.PI) / 180;
  const x = (tuning.aimPitch * Math.PI) / 180;
  const horizontal = Math.cos(x);
  return { x: -horizontal * Math.sin(z), y: horizontal * Math.cos(z) };
}

export { CAP_COLOR };
