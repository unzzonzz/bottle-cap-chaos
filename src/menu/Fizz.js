import {
  BufferAttribute,
  BufferGeometry,
  Float32BufferAttribute,
  Mesh,
  Quaternion,
  Vector3,
} from 'three';
import { MM } from '../cap/capGeometry.js';
import { createSpriteMaterial } from './menuMaterials.js';
import { bubbleTexture } from './menuTextures.js';

/**
 * The carbonation, from the physics rather than from a scrolling texture.
 *
 * ── what the scrolling texture got wrong ────────────────────────────────────
 * A tiled page of dots scrolled upward gives every bubble the same size, the
 * same speed, the same spacing and the same column, forever. Real carbonation
 * has none of those properties, and the eye knows it immediately: it reads as
 * wallpaper moving behind glass. Four separate facts about a bottle of cola are
 * missing from it, and all four are cheap to have.
 *
 * ── 1. bubbles do not form in the liquid, they form ON something ────────────
 * CO2 will not spontaneously nucleate in the bulk — the energy barrier is far
 * too high. It needs a NUCLEATION SITE: a scratch, a speck, a pit in the glass.
 * That is why bubbles in any real carbonated drink come up in a handful of
 * distinct STREAMS from fixed points on the wall, rather than uniformly out of
 * the middle. Each bubble here belongs to a site, fixed for the life of the
 * bottle, and returns to it.
 *
 * It is also the real reason shaking makes a bottle erupt. Not "pressure builds
 * up" — the pressure barely moves. Shaking whips gas from the headspace into
 * the liquid as thousands of tiny bubbles, and every one of them is a new
 * nucleation site. So the number of ACTIVE sites here scales with the shake,
 * and that one line is the whole mechanism the eruption rests on.
 *
 * ── 2. a rising bubble grows, and growing makes it faster ───────────────────
 * It is rising through supersaturated liquid, so CO2 keeps coming out of
 * solution into it; and the pressure above it falls as it climbs, so what is
 * already in it expands. Both make r increase with time.
 *
 * Buoyant rise goes as the square of the radius — Stokes — so a bubble that
 * grows ACCELERATES, and a stream is therefore sparse and slow at the bottom
 * and fast and fat at the top. That widening, quickening column is the single
 * most recognisable thing about a glass of anything fizzy, and no constant-
 * speed animation can produce it.
 *
 *     r(a) = r0 (1 + growth a)
 *     v(a) = K r(a)^2
 *     y(a) = y0 + K r0^2 [ a + growth a^2 + growth^2 a^3 / 3 ]
 *
 * The exponent is Stokes'; the coefficient is NOT. Stokes is the creeping-flow
 * law and holds below about Re = 1, which for a bubble in water is a radius
 * under a tenth of a millimetre. These are half a millimetre to two, squarely
 * in the intermediate regime, where the literal Stokes coefficient
 * (2 dRho g / 9 mu) over-predicts by more than an order of magnitude — it would
 * put a 1 mm bubble at two metres a second against a real quarter of that. So
 * `riseCoefficient` is fitted to the observed plateau instead. The exponent is
 * what produces the acceleration and the exponent is the part that is real.
 *
 * ── 3. the path is not straight ─────────────────────────────────────────────
 * Past about a millimetre a rising bubble sheds vortices alternately off each
 * side and its path goes helical. Reproduced as a slow spiral about the site,
 * with the amplitude growing as the bubble does, because the instability sets
 * in with size.
 *
 * ── 4. the positions are CLOSED FORM, not integrated ────────────────────────
 * Nothing here holds per-bubble state and nothing steps it. Every quantity is a
 * function of one number — the bubble's age — and the age is a function of the
 * clock. So this is a fixed mesh being posed, not a particle system being
 * simulated: no emitter, no lifetime bookkeeping, no accumulation, and the same
 * frame twice always looks the same twice. The one thing that has to be solved
 * rather than evaluated is how long a bubble takes to reach the surface, and
 * that is a cubic in the age, solved by Newton at build time — four iterations,
 * once per bubble, ever.
 */

/**
 * Gravity in this project's units.
 *
 * 1 world unit is 10 mm — see `capGeometry` — so g is 9.81 m/s^2 = 981 units/s^2.
 * It is spelled out because two of the numbers below are derived from it rather
 * than tuned, and a reader has to be able to check them.
 */
export const G_WORLD = 981;

/** Deterministic per-bubble scatter. No `Math.random` — see the header. */
function hash(i, k) {
  const x = Math.sin(i * 12.9898 + k * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** a + g a^2 + g^2 a^3 / 3 — the rise integral, with r growing linearly. */
function risePolynomial(a, growth) {
  return a + growth * a * a + (growth * growth * a * a * a) / 3;
}

/**
 * How long until this bubble reaches the surface.
 *
 * Newton on `risePolynomial(a) = distance`, whose derivative is exactly
 * (1 + growth a)^2 — the square of the radius ratio, which is the rise speed.
 * Monotonic and smooth, so it converges in three or four steps from any start.
 */
function solveAge(distance, growth) {
  let a = distance;
  for (let n = 0; n < 6; n++) {
    const f = risePolynomial(a, growth) - distance;
    const d = (1 + growth * a) ** 2;
    a -= f / d;
    if (a < 1e-4) a = 1e-4;
  }
  return a;
}

/**
 * 최대 티어의 거품 수. 사이트 수 곱하기 사이트당 거품 수.
 *
 * 이름이 붙은 것은 품질 티어가 여기에 배율을 걸기 때문이다 — `Bottle` 이
 * `QUALITY.fizzScale` 을 곱해 `setCount` 로 넣는다. 최대에서 이 값 그대로인 것이
 * 중요하다: 품질 설정은 깎는 장치이지, 기본값에서 화면을 바꾸는 장치가 아니다.
 */
export const FIZZ_COUNT = 156;

export class Fizz {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {object} tuning  the live `MENU_CONFIG.bottle` block
   * @param {number} count   sites times bubbles per site
   */
  constructor({ retro, tuning, count = FIZZ_COUNT }) {
    this.tuning = tuning;
    this.count = count;

    this.map = bubbleTexture();
    // Added, so the sprite's black surround contributes nothing and only the
    // bubble shows. Depth-tested against the drink but not writing, so bubbles
    // never occlude each other into hard edges.
    this.material = createSpriteMaterial(retro, { map: this.map, blend: 'add' });

    this.geometry = buildQuads(count);

    this.mesh = new Mesh(this.geometry, this.material);
    // Never culled: the vertices move every frame and a bounding sphere computed
    // once from a flat buffer would put the whole field behind the camera.
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;

    /** @type {{theta: number, y0: number, r0: number, phase: number, wall: number,
     *          growth: number, life: number, swirl: number}[]} */
    this.bubbles = [];
    this._clock = 0;

    this._right = new Vector3();
    this._up = new Vector3();
    this._inv = new Quaternion();
  }

  /**
   * How many bubbles there are. The quality tier's one knob on this class.
   *
   * ── 왜 `active` 를 줄이는 것으로는 부족한가 ────────────────────────────────
   * `update` 는 이미 `intensity` 에 따라 앞쪽 몇 개만 살리고 나머지를 한 점으로
   * 접는다. 접힌 사각형은 면적이 0 이라 채우기 비용은 없지만, **CPU 루프는
   * 그대로 돈다** — 매 프레임 `this.count` 번의 나눗셈, 거듭제곱, 쿼터니언
   * 적용이다. 이 클래스에서 실제로 비싼 것이 그쪽이므로 버퍼 자체를 줄인다.
   *
   * 지오메트리를 다시 만드는 것은 티어를 바꿀 때 한 번뿐이고, 사이트 배치도
   * `setProfile` 로 다시 푼다 — 거품 하나하나가 `hash(i, …)` 로 결정되므로 수가
   * 줄면 남는 것은 앞쪽 부분집합이고, 줄기(theta)의 분포는 그대로 유지된다.
   */
  setCount(count) {
    const n = Math.max(4, Math.round(count));
    if (n === this.count) return;
    this.count = n;
    this.geometry.dispose();
    this.geometry = buildQuads(n);
    this.mesh.geometry = this.geometry;
    if (this.profile) this.setProfile(this.profile);
  }

  /**
   * Lay the nucleation sites out against a bottle, and work out how long each
   * bubble's climb takes.
   *
   * Called on every rebuild, because the sites are on the glass and the glass
   * has just changed shape.
   */
  setProfile(profile) {
    this.profile = profile;
    const t = this.tuning;
    const p = profile.params;
    const surfaceY = p.fillLevel * MM;
    const growth = t.bubbleGrowth;
    const K = t.riseCoefficient;

    this.bubbles.length = 0;
    for (let i = 0; i < this.count; i++) {
      // Sites cluster low: the deeper the liquid, the more supersaturated it is
      // and the longer a bubble has to grow on the way up. The exponent biases
      // the draw toward the bottom without pinning anything there.
      const y0 = Math.pow(hash(i, 2), 1.7) * surfaceY * 0.86;
      const r0 = t.bubbleRadius * (0.45 + hash(i, 4) * 0.9);

      // The cubic: how far it has to climb, in units of K r0^2.
      const distance = Math.max(0.05, (surfaceY - y0) / (K * r0 * r0));
      const life = solveAge(distance, growth);

      this.bubbles.push({
        // A handful of sites rather than one per bubble — that is what makes
        // them read as streams. Several bubbles share a theta and differ only
        // in phase, so they come up the same line one after another.
        theta: (Math.floor(hash(i, 1) * t.nucleationSites) / t.nucleationSites) * Math.PI * 2,
        y0,
        r0,
        phase: hash(i, 3),
        /**
         * Just PROUD of the drink's surface, as a multiple of it.
         *
         * Above 1, and that is the whole of it: the drink is opaque and writes
         * depth, so a bubble at 0.95 of its radius is behind its near wall and
         * the depth test throws it away — which is exactly what happened, and
         * the first version rendered a hundred and eight invisible bubbles.
         * They belong against the GLASS, where the nucleation pits are, and the
         * glass is outside the drink. A little scatter so the streams are not
         * all at one radius, and the whole range stays under the glass itself
         * (0.9 * 1.06 is still inside 1.0).
         */
        wall: 1.01 + hash(i, 5) * 0.05,
        growth,
        life,
        swirl: (hash(i, 6) - 0.5) * 2,
      });
    }
  }

  /**
   * @param {number} dt
   * @param {number} intensity  0..1, how much gas is entrained. Drives how many
   *   sites are live — the mechanism, not a fade.
   * @param {import('three').Camera} camera
   * @param {import('three').Quaternion} worldQuaternion  the bottle's lean
   */
  update(dt, { intensity, camera, worldQuaternion }) {
    this._clock += dt;
    const live = intensity > 0.004 && !!camera && !!this.profile;
    this.mesh.visible = live;
    if (!live) return;

    const t = this.tuning;
    const p = this.profile.params;
    const surfaceY = p.fillLevel * MM;
    const K = t.riseCoefficient;

    // Billboard axes, brought back into the bottle's own frame. The mesh hangs
    // under the lean, so the camera's right and up have to be un-rotated by it
    // or every bubble would face wherever the bottle happens to be pointing.
    this._inv.copy(worldQuaternion).invert();
    this._right.set(1, 0, 0).applyQuaternion(camera.quaternion).applyQuaternion(this._inv);
    this._up.set(0, 1, 0).applyQuaternion(camera.quaternion).applyQuaternion(this._inv);

    const pos = this.geometry.getAttribute('position');
    const active = Math.round(this.count * Math.min(1, intensity));

    for (let i = 0; i < this.count; i++) {
      const v = i * 4;

      // Sites come alive as gas is entrained. Collapsed to a point rather than
      // removed from the index, so the draw call never changes shape.
      if (i >= active) {
        for (let c = 0; c < 4; c++) pos.setXYZ(v + c, 0, surfaceY, 0);
        continue;
      }

      const b = this.bubbles[i];
      const age = ((this._clock / b.life + b.phase) % 1) * b.life;

      const radius = b.r0 * (1 + b.growth * age);
      const y = b.y0 + K * b.r0 * b.r0 * risePolynomial(age, b.growth);

      // The helix. Amplitude grows with the bubble, because the wake
      // instability that causes it sets in with size.
      const spiral = (radius / b.r0 - 1) * t.bubbleWobble;
      const theta = b.theta + b.swirl * spiral;
      const wall = this.profile.envelopeAt(y / MM) * p.liquidInset * b.wall * MM;

      const cx = wall * Math.cos(theta);
      const cz = wall * Math.sin(theta);

      // Bursting at the surface. The last tenth of the climb shrinks it away
      // rather than letting it wink out mid-frame.
      const tail = Math.min(1, (1 - age / b.life) / 0.1);
      const s = radius * tail;

      pos.setXYZ(v + 0, cx - this._right.x * s - this._up.x * s, y - this._right.y * s - this._up.y * s, cz - this._right.z * s - this._up.z * s);
      pos.setXYZ(v + 1, cx + this._right.x * s - this._up.x * s, y + this._right.y * s - this._up.y * s, cz + this._right.z * s - this._up.z * s);
      pos.setXYZ(v + 2, cx + this._right.x * s + this._up.x * s, y + this._right.y * s + this._up.y * s, cz + this._right.z * s + this._up.z * s);
      pos.setXYZ(v + 3, cx - this._right.x * s + this._up.x * s, y - this._right.y * s + this._up.y * s, cz - this._right.z * s + this._up.z * s);
    }

    pos.needsUpdate = true;
    this.material.uniforms.uOpacity.value = t.fizzStrength;
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
    this.map.dispose();
  }
}

/**
 * `count` 개의 빌보드 사각형. 위치는 매 프레임 채워지므로 여기서는 비워 둔다.
 *
 * 생성자와 `setCount` 가 같은 함수를 쓴다 — 두 곳이 같은 버퍼 모양을 각자
 * 만들면, 어긋났을 때 증상은 티어를 한 번 바꾼 뒤에만 나타나는 인덱스 오류다.
 */
function buildQuads(count) {
  const pos = new Float32Array(count * 4 * 3);
  const uv = new Float32Array(count * 4 * 2);
  const index = new Uint16Array(count * 6);
  for (let i = 0; i < count; i++) {
    const v = i * 4;
    uv.set([0, 0, 1, 0, 1, 1, 0, 1], i * 8);
    index.set([v, v + 1, v + 2, v, v + 2, v + 3], i * 6);
  }

  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(pos, 3));
  geometry.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  geometry.setIndex(new BufferAttribute(index, 1));
  return geometry;
}
