import { Mesh, PlaneGeometry } from 'three';
import { FRAME } from '../core/frame.js';
import { bubbleTexture } from '../menu/menuTextures.js';
import { risePolynomial, solveAge } from '../core/fizzMath.js';

/**
 * Carbonation up the result screen. The menu's bubbles, run up a flat frame.
 *
 * ── the celebration vocabulary is bottles, water and bubbles ────────────────
 * "색종이(confetti)를 쓰지 마라 — 이 게임의 언어가 아니고, 병·물·거품이 이
 * 프로젝트의 축하 어휘다." So the thing that rises when somebody wins is the
 * same thing that rises when the menu's bottle is shaken, and it is the same
 * sprite: `bubbleTexture`, additively blended, out of `menuTextures`.
 *
 * ── it reuses the LAW, not the class ────────────────────────────────────────
 * `menu/Fizz.js` is bound to a bottle by construction and not by accident:
 * `setProfile` lays its nucleation sites out on the glass from the bottle's own
 * silhouette, `envelopeAt` puts each stream against the wall at the right
 * radius for its height, and `update` un-rotates the billboard by the bottle's
 * lean. None of that has a meaning on a result screen, and inventing a fake
 * bottle profile to satisfy it would be worse than this file.
 *
 * What DOES travel is the physics, which is the part with the reasoning behind
 * it, and it travels exactly:
 *
 *     r(a) = r0 (1 + growth a)          a rising bubble keeps taking on gas
 *     v(a) = K r(a)^2                   buoyant rise goes as the square (Stokes)
 *     y(a) = y0 + K r0^2 P(a, growth)   integrated — `risePolynomial`
 *
 * `solveAge` is the same Newton solve for how long a climb takes. So the shape
 * that makes a real glass of anything fizzy recognisable — a stream that is
 * sparse and slow at the bottom and fast and fat at the top — is here for the
 * same reason it is there, rather than being animated to look like it. The long
 * version of every clause above is in `Fizz`'s header.
 *
 * ── it is in FRAME PIXELS ───────────────────────────────────────────────────
 * The layer this draws into is an orthographic overlay over the shared frame,
 * so a radius here is a number of frame pixels rather than of world units. The
 * law does not care: it is scale-free in r and y together, and only `RISE_K`
 * has to be quoted in the new units.
 */

/**
 * The rise coefficient, in frame pixels per second per pixel squared.
 *
 * NOT the menu's 300, and it cannot be: that one is quoted against world units
 * where a bubble is a tenth of a unit across, and this one is against frame
 * pixels where the same bubble is three of them. Fitted to the one thing that
 * has to be true on this screen — the bubbles read as rising SLOWLY, under a
 * result somebody is reading — which at these radii puts a stream's crossing
 * time at about two and a quarter seconds against the 0.9 s the band holds. So
 * what is on screen is the middle of a climb rather than a launch and a burst.
 */
const RISE_K = 1.6;

/** How much a bubble grows over one climb. The menu's own number. */
const GROWTH = 2.2;

/**
 * How many distinct columns the bubbles come up.
 *
 * Fewer than the menu's 20, and the reason is what is in front of them: the
 * menu's streams are the subject of that screen and these are behind a result
 * somebody is reading. Nine columns over the frame's width is enough that they
 * read as carbonation rather than as a particle count, and sparse enough that
 * no column sits under the middle of a line of type — see the thinning in
 * `_layout`.
 */
const SITES = 9;

/** Radius at nucleation, in frame pixels. Under two and it is a lit dot. */
const R_MIN = 2.2;
const R_SPAN = 2.6;

/** Deterministic per-bubble scatter. No `Math.random` — see `Fizz`'s header. */
function hash(i, k) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

export class ResultFizz {
  /**
   * @param {import('../render/FxMaterial.js').FxMaterials} materials
   *   The layer's own additive materials, handed in rather than built: this is
   *   a handful of sprites inside somebody else's scene and it has no business
   *   owning a second material factory pointed at the same resolution.
   * @param {import('three').PlaneGeometry} [quad]  the layer's shared quad
   */
  constructor({ materials, quad = null }) {
    this._ownQuad = !quad;
    this.quad = quad ?? new PlaneGeometry(1, 1);
    this.map = bubbleTexture();
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.sprites = [];
    this._materials = materials;
    /** @type {Array<{x: number, y0: number, r0: number, phase: number, life: number, swirl: number}>} */
    this.bubbles = [];
    this._count = 0;
    this._clock = 0;
    this._top = 0;
  }

  /**
   * Lay the streams out across the bottom of the frame.
   *
   * Called whenever the count or the frame shape changes, which is a rebuild
   * rather than a per-frame cost — the same division `Fizz.setProfile` makes,
   * and for the same reason: the cubic solve is done once per bubble, ever.
   *
   * @param {number} count  how many bubbles in total
   * @param {import('three').Group|import('three').Scene} parent
   */
  build(count, parent) {
    const n = Math.max(0, Math.round(count));
    while (this.sprites.length < n) {
      const mat = this._materials.create(this.map);
      const mesh = new Mesh(this.quad, mat);
      mesh.visible = false;
      // Under the type and over the dimming veil: they are behind what is being
      // read, which is where a background motif belongs.
      mesh.renderOrder = 5;
      parent.add(mesh);
      this.sprites.push({ mesh, mat });
    }
    for (let i = n; i < this.sprites.length; i++) this.sprites[i].mesh.visible = false;
    this._count = n;
    this._layout();
  }

  /** Re-solve the climbs for the frame's current height. */
  _layout() {
    const half = FRAME.height / 2;
    this._top = half;
    this.bubbles.length = 0;

    for (let i = 0; i < this._count; i++) {
      /**
       * A handful of x positions rather than one per bubble.
       *
       * That is what makes them read as STREAMS — `Fizz`'s point 1, which is
       * that CO2 does not nucleate in the bulk, it nucleates on a site, so a
       * real drink comes up in a few distinct columns. Several bubbles share an
       * x and differ only in phase, so they come up the same line one after
       * another.
       *
       * The exponent leans them outward. Evenly spaced, a third of the columns
       * run up the middle third of the frame, which is where the winner's name
       * and the number are — and the plates are translucent glass, so a stream
       * behind one shows through it as two pale discs beside the score. Under 1
       * it pushes each site away from the centre without emptying it, because a
       * carbonated drink with a hole down the middle is not one.
       */
      const site = Math.floor(hash(i, 1) * SITES) / (SITES - 1);
      const u = (site - 0.5) * 2;
      const x = Math.sign(u) * Math.pow(Math.abs(u), 0.7) * FRAME.width * 0.46;

      // Starting below the bottom edge, so a stream is already running when the
      // bars close rather than beginning at the frame's own boundary.
      const y0 = -half - hash(i, 2) * half * 0.5;
      const r0 = R_MIN + hash(i, 4) * R_SPAN;

      const distance = Math.max(0.05, (this._top - y0) / (RISE_K * r0 * r0));
      this.bubbles.push({
        x,
        y0,
        r0,
        phase: hash(i, 3),
        life: solveAge(distance, GROWTH),
        swirl: (hash(i, 6) - 0.5) * 2,
      });
    }
  }

  /** The frame changed shape. Cheap enough to call on every resize. */
  layout() {
    this._layout();
  }

  /**
   * @param {number} dt
   * @param {number} strength  0..1 — the whole field's brightness. 0 hides it.
   */
  update(dt, strength) {
    this._clock += Math.max(0, dt);
    const live = strength > 0.004;

    for (let i = 0; i < this.sprites.length; i++) {
      const s = this.sprites[i];
      const b = this.bubbles[i];
      if (!live || !b || i >= this._count) {
        s.mesh.visible = false;
        continue;
      }

      const age = ((this._clock / b.life + b.phase) % 1) * b.life;
      const radius = b.r0 * (1 + GROWTH * age);
      const y = b.y0 + RISE_K * b.r0 * b.r0 * risePolynomial(age, GROWTH);

      // The helical path instability, whose amplitude grows with the bubble
      // because the wake instability that causes it sets in with size.
      const wobble = (radius / b.r0 - 1) * 6 * b.swirl;
      const x = b.x + Math.sin(this._clock * 1.4 + b.phase * 6.28) * wobble;

      // Bursting at the surface: the last tenth of the climb shrinks it away
      // rather than letting it wink out mid-frame.
      const tail = Math.min(1, (1 - age / b.life) / 0.1);
      const size = radius * 2 * tail;
      if (size <= 0.5) {
        s.mesh.visible = false;
        continue;
      }

      s.mesh.position.set(x, y, 0);
      s.mesh.scale.set(size, size, 1);
      s.mat.uniforms.uOpacity.value = strength;
      s.mesh.visible = true;
    }
  }

  /** Every sprite off, and the clock back to the start of a climb. */
  reset() {
    this._clock = 0;
    for (const s of this.sprites) s.mesh.visible = false;
  }

  dispose() {
    for (const s of this.sprites) s.mat.dispose();
    this.sprites.length = 0;
    this.map.dispose();
    if (this._ownQuad) this.quad.dispose();
  }
}
