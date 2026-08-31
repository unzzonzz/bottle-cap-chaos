import { BufferGeometry, Float32BufferAttribute } from 'three';
import { MM } from '../cap/capGeometry.js';

/**
 * The bottle's meshes, revolved from the profile.
 *
 * Three geometries come out of here and they are deliberately separate objects
 * rather than groups of one: the glass is alpha-blended and gets drawn twice
 * (back faces, then front), the liquid is opaque and has to be sandwiched
 * BETWEEN those two passes, and the label is opaque and drawn after all of it.
 * There is no ordering of geometry groups on a single mesh that produces that.
 *
 * ── the flutes use the cap's formula, and its convention ────────────────────
 *     r(theta) = base + amp * cos(n * theta),  base = envelope - amp
 * Written as `envelope - amp * (1 - cos)`, exactly as `capGeometry.radiusAt`
 * does. Pinning the CRESTS to the envelope and sending the troughs inward is
 * what makes a moulded flute instead of a rib glued to a tube — the same
 * argument that file makes about the crimp, and worth keeping identical so the
 * two objects cannot drift into disagreeing about what a flute is.
 *
 * `amp` is scaled per row by the profile's own `rib` weight, so the label band
 * comes out smooth without this file knowing a label exists.
 *
 * ── normals are analytic ────────────────────────────────────────────────────
 * `computeVertexNormals` cannot see the flutes' sideways curvature at all — it
 * only averages triangle normals, and at three columns per flute that averages
 * the flute away. It would also light the duplicated seam column differently
 * from its twin and draw a bright line down the bottle. So the normal is
 * T_v x T_theta, as in the cap.
 *
 * ── the vertex colour is the glass tint ─────────────────────────────────────
 * Every glass vertex carries a colour: darker toward the base, where a real
 * bottle has thick glass and a full depth of drink behind it, lightening up the
 * neck where there is nothing but air. Baked here rather than computed in the
 * shader because it is a property of the OBJECT — it does not change when the
 * bottle moves — and per-vertex is the only place the era would have put it.
 * The view-dependent half of the glass look, the rim, is per-vertex too but
 * lives in the material, since it depends on where the camera is.
 */

const TAU = Math.PI * 2;

/**
 * Revolve a profile.
 *
 * @param {{r: number, y: number, rib: number}[]} rows  bottom to top; the
 *   winding below only faces outward if the index walks UP.
 * @param {object} opts
 * @param {number} opts.cols
 * @param {number} opts.ribs
 * @param {number} opts.ribDepth   world units, half peak-to-trough
 * @param {number} opts.height     for the v coordinate
 * @param {boolean} [opts.wrap]    duplicate the seam column so u reaches 1
 * @param {boolean} [opts.flipU]
 *   Run u the other way round the bottle.
 *
 *   The ring below is built with theta increasing anticlockwise in xz, and the
 *   camera is on +z — so as theta grows, the surface point moves LEFT across
 *   the screen. u therefore runs right to left, and anything with a reading
 *   direction printed on it comes out mirrored. It did: the first label said
 *   ƎⅼTTAꓭ. Symmetric artwork like the glass highlight does not care and is left
 *   alone; the label sets this.
 * @param {(y: number) => [number, number, number]} [opts.tint]  vertex colour
 */
function revolve(
  rows,
  {
    cols,
    ribs,
    ribDepth,
    height,
    wrap = true,
    flipU = false,
    tint = null,
    vFrom = 0,
    vTo = 1,
    sweepFrom = 0,
    sweepTo = TAU,
  },
) {
  const stride = wrap ? cols + 1 : cols;
  const sweep = sweepTo - sweepFrom;
  const pos = [];
  const nor = [];
  const uv = [];
  const col = [];
  const index = [];

  const ring = [];
  for (let i = 0; i <= cols; i++) {
    const th = sweepFrom + (i / cols) * sweep;
    ring.push({
      c: Math.cos(th),
      s: Math.sin(th),
      cn: Math.cos(ribs * th),
      sn: Math.sin(ribs * th),
    });
  }

  const amps = rows.map((row) => ribDepth * row.rib);
  const radiusAt = (j, cn) => rows[j].r - amps[j] * (1 - cn);
  const span = vTo - vFrom || 1;

  for (let j = 0; j < rows.length; j++) {
    const jp = Math.max(0, j - 1);
    const jn = Math.min(rows.length - 1, j + 1);
    const yv = rows[jn].y - rows[jp].y;

    for (let i = 0; i < stride; i++) {
      const t = ring[i];
      const r = radiusAt(j, t.cn);
      // Same index span for both derivatives, so the ratio stays right where
      // the difference is one-sided at the ends of the profile.
      const rv = radiusAt(jn, t.cn) - radiusAt(jp, t.cn);
      const rth = -ribs * amps[j] * t.sn;

      let nx = yv * (rth * t.s + r * t.c);
      let ny = -r * rv;
      let nz = yv * (r * t.s - rth * t.c);
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-12) {
        nx = t.c;
        ny = 0;
        nz = t.s;
      } else {
        nx /= len;
        ny /= len;
        nz /= len;
      }

      pos.push(r * t.c, rows[j].y, r * t.s);
      nor.push(nx, ny, nz);
      uv.push(flipU ? 1 - i / cols : i / cols, (rows[j].y / height - vFrom) / span);
      if (tint) col.push(...tint(rows[j].y));
    }
  }

  /**
   * 부분 호는 마지막 컬럼을 첫 컬럼에 이어붙이면 안 된다.
   *
   * `(i + 1) % stride` 는 `wrap: false` + 한 바퀴일 때 링을 닫아주는 장치인데,
   * 라벨처럼 160도만 도는 호에서는 마지막 컬럼과 첫 컬럼 사이 200도를 가로지르는
   * 면을 하나 만들어낸다. 그 면은 텍스처 u 를 0.01 에서 1.0 까지 통째로 늘려
   * 붙이므로, 병 뒤쪽에 라벨 전체가 잡아늘여진 판이 생긴다.
   *
   * 그래서 세그먼트 수를 링이 실제로 닫히는지로 결정한다.
   */
  const closed = wrap || Math.abs(sweep - TAU) < 1e-6;
  const segments = closed ? cols : cols - 1;

  for (let j = 0; j < rows.length - 1; j++) {
    for (let i = 0; i < segments; i++) {
      const a = j * stride + i;
      const b = j * stride + ((i + 1) % stride);
      index.push(a, a + stride, b, b, a + stride, b + stride);
    }
  }

  return { pos, nor, uv, col, index, stride };
}

function assemble({ pos, nor, uv, col, index }) {
  const g = new BufferGeometry();
  g.setAttribute('position', new Float32BufferAttribute(pos, 3));
  g.setAttribute('normal', new Float32BufferAttribute(nor, 3));
  g.setAttribute('uv', new Float32BufferAttribute(uv, 2));
  if (col.length) g.setAttribute('color', new Float32BufferAttribute(col, 3));
  g.setIndex(index);
  g.userData.triangles = index.length / 3;
  return g;
}

/**
 * The glass.
 *
 * Closed at the bottom with a flat fan — the base is opaque in the sense that
 * matters, which is that there is no hole in the silhouette — and closed at the
 * top with a small disc across the bore. Nothing ever sees the bore with a cap
 * on it; the disc is there so the alpha pass does not have a rim of doubled
 * blending where an open edge would be.
 */
export function buildGlassGeometry(profile) {
  const p = profile.params;
  /**
   * Tessellation, from `columns` — NOT from the flute count.
   *
   * It was `ribs * radialPerRib` clamped to a floor of 6, which was correct
   * while the columns existed to resolve the flutes. With `ribDepth: 0` the two
   * have nothing to do with each other, and the old form had a trap in it:
   * setting `ribs: 0` to switch the flutes off gave `max(6, 0)` — a SIX-SIDED
   * bottle. See the note on `BOTTLE_DEFAULTS.columns`.
   */
  const cols = Math.max(12, Math.round(p.columns));
  const rows = profile.rows.map((r) => ({ r: r.r * MM, y: r.y * MM, rib: r.rib }));
  const height = profile.height * MM;

  /**
   * Barely tinted, and smooth all the way up.
   *
   * It used to run from 0.52 at the heel to 1.0 at the neck in a squared ramp,
   * with the curve chosen to fake two hard stops because a 15-bit framebuffer
   * turned a long smooth gradient into visible banding. There is no 15-bit
   * framebuffer and no dither any more, so the shape can be what it should be —
   * and the floor was far too dark regardless: clear cider glass is bright at
   * the heel, not smoked.
   *
   * 0.86 -> 1.00, linear, with a faint cool cast. The remaining darkening is
   * there only because more glass is between you and the far wall down at the
   * base, and the tint is the cheapest way to say so.
   */
  const tint = (y) => {
    const t = Math.min(1, Math.max(0, y / height));
    const k = 0.86 + 0.14 * t;
    return [k * 0.97, k, k * 0.99];
  };

  const mesh = revolve(rows, {
    cols,
    ribs: Math.max(1, Math.round(p.ribs)),
    ribDepth: p.ribDepth * MM,
    height,
    tint,
  });

  const { pos, nor, uv, col, index } = mesh;

  // ── the base ─────────────────────────────────────────────────────────────
  const baseCentre = pos.length / 3;
  pos.push(0, rows[0].y, 0);
  nor.push(0, -1, 0);
  uv.push(0.5, 0);
  col.push(...tint(rows[0].y));
  const baseRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    const r = rows[0].r;
    pos.push(r * Math.cos(th), rows[0].y, r * Math.sin(th));
    nor.push(0, -1, 0);
    uv.push(0.5 + Math.cos(th) * 0.5, 0);
    col.push(...tint(rows[0].y));
  }
  for (let i = 0; i < cols; i++) {
    index.push(baseCentre, baseRim + i, baseRim + ((i + 1) % cols));
  }

  // ── across the bore ──────────────────────────────────────────────────────
  const top = rows[rows.length - 1];
  const boreCentre = pos.length / 3;
  pos.push(0, top.y, 0);
  nor.push(0, 1, 0);
  uv.push(0.5, 1);
  col.push(...tint(top.y));
  const boreRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(top.r * Math.cos(th), top.y, top.r * Math.sin(th));
    nor.push(0, 1, 0);
    uv.push(0.5 + Math.cos(th) * 0.5, 1);
    col.push(...tint(top.y));
  }
  for (let i = 0; i < cols; i++) {
    index.push(boreCentre, boreRim + ((i + 1) % cols), boreRim + i);
  }

  const g = assemble({ pos, nor, uv, col, index });
  g.userData.height = height;
  g.userData.columns = cols;
  g.userData.rows = rows.length;
  g.userData.wallTriangles = (rows.length - 1) * cols * 2;
  return g;
}

/**
 * The drink.
 *
 * A second lathe inside the first, stopping at the fill line with a visible
 * surface on top — the neck is empty, which is what makes the fill line read as
 * a fill line rather than as the glass simply being brown up to there.
 *
 * The surface ring is recorded on `userData` so the shake can push it about
 * without this file having to know what a shake is. That is one ring plus a
 * centre vertex: sixteen numbers to touch per frame, against a particle system
 * that the brief rules out and that would not look like liquid anyway.
 */
export function buildLiquidGeometry(profile) {
  const p = profile.params;
  /**
   * 유리와 같은 분할 수. 예전엔 절반이었다.
   *
   * "유리를 통해 낮은 대비로 보이니 더 촘촘하게 해도 프레임버퍼까지 살아남지
   * 않는다" 는 게 절반이었던 이유였는데, 두 전제가 다 사라졌다. 유리가 맑아져서
   * 액체가 그대로 보이고, 액면에 1 을 넘는 밝은 링을 넣었기 때문에 — 그 링이
   * 정확히 이 다각형의 윤곽을 그린다. 36 컬럼이면 한 변이 10도라 액면 테두리가
   * 눈에 띄게 각져 보였다.
   */
  const cols = Math.max(12, Math.round(p.columns));
  const fill = Math.min(profile.height - 4, p.fillLevel);

  const surfaceR = profile.envelopeAt(fill) * p.liquidInset;

  /**
   * 유리와 같은 행에서 잘라 쓴다. 균등 분할이 아니다.
   *
   * ── 균등 8행은 어깨를 통째로 건너뛴다 ────────────────────────────────────
   * 예전엔 바닥에서 액면까지 `fill * i / 7` 로 여덟 행을 균등하게 놓았다. 몸통이
   * 직선일 때는 그래도 되지만, 액면이 어깨 중간(150)에 있으면 마지막 두 행이
   * y=128.6 과 y=150 이 되고 그 사이에서 반지름이 29.8 에서 16.1 로 떨어진다.
   * 사이에 행이 하나도 없으니 어깨 곡선이 직선 원뿔대로 잘려서, 액체 윗부분이
   * 눈에 띄게 각져 보였다.
   *
   * 프로파일은 같은 구간에 132·135·139·143·147 다섯 행을 더 갖고 있다. 그걸
   * 그대로 빌려 쓰면 액체 표면이 유리 안쪽 벽을 정확히 따라간다 — 애초에 액체가
   * 해야 할 일이고, 어깨 모양을 두 번 정의하지 않아도 된다.
   */
  const rows = profile.rows
    .filter((row) => row.y < fill)
    .map((row) => ({ r: row.r * p.liquidInset * MM, y: row.y * MM, rib: 0 }));
  rows.push({ r: surfaceR * MM, y: fill * MM, rib: 0 });

  /**
   * Vertex colours, so the meniscus is brighter than the drink under it.
   *
   * ── the fill line stopped reading when the drink went clear ─────────────
   * It used to be an opaque brown, so its top surface was obvious and the slosh
   * with it. A pale cider inside pale glass is nearly the same value as its
   * container, and `Bottle._slosh` — which tilts that surface every frame — was
   * computing something nobody could see.
   *
   * 실제 음료는 액면이 가장 잘 보인다 — 표면이 빛을 받고, 유리와 만나는 테두리는
   * 더 받는다. 셰이더가 이미 곱해주는 값으로 그걸 표현한다.
   *
   * 테두리는 1 을 조금 넘긴다. 렌더 타겟이 half-float 이라 흰색을 넘는 값이
   * 블룸까지 살아남고, 액면 테두리는 이 병에서 그게 물리적으로 맞는 유일한
   * 자리다. 처음엔 1.9 였고 그건 과했다 — 액체 전체가 스스로 빛나는 것처럼
   * 보여서, 유리에 담긴 음료가 아니라 발광하는 젤이 됐다.
   *
   * It costs nothing to animate: the slosh already rewrites these vertices'
   * POSITIONS, so the bright ring tilts with the surface for free.
   */
  const WALL = [0.9, 0.95, 1.0];
  const BASE = [0.7, 0.78, 0.85];
  const SURFACE_MID = [1.0, 1.06, 1.1];
  const SURFACE_RIM = [1.18, 1.24, 1.28];

  const mesh = revolve(rows, {
    cols,
    ribs: 1,
    ribDepth: 0,
    height: profile.height * MM,
    wrap: false,
    tint: () => WALL,
  });
  const { pos, nor, uv, col, index } = mesh;

  // ── the base, so the drink is not a shell ────────────────────────────────
  const baseCentre = pos.length / 3;
  pos.push(0, 0, 0);
  nor.push(0, -1, 0);
  uv.push(0.5, 0.5);
  col.push(...BASE);
  const baseRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(rows[0].r * Math.cos(th), 0, rows[0].r * Math.sin(th));
    nor.push(0, -1, 0);
    uv.push(0.5, 0.5);
    col.push(...BASE);
  }
  for (let i = 0; i < cols; i++) index.push(baseCentre, baseRim + i, baseRim + ((i + 1) % cols));

  // ── the surface ──────────────────────────────────────────────────────────
  const surfaceCentre = pos.length / 3;
  pos.push(0, fill * MM, 0);
  nor.push(0, 1, 0);
  uv.push(0.5, 0.5);
  col.push(...SURFACE_MID);
  const surfaceRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(surfaceR * MM * Math.cos(th), fill * MM, surfaceR * MM * Math.sin(th));
    nor.push(0, 1, 0);
    uv.push(0.5, 0.5);
    col.push(...SURFACE_RIM);
  }
  for (let i = 0; i < cols; i++) {
    index.push(surfaceCentre, surfaceRim + ((i + 1) % cols), surfaceRim + i);
  }

  const g = assemble({ pos, nor, uv, col, index });
  /**
   * 액면을 쓰는 쪽이 알아야 하는 것들.
   *
   * ── 링이 **둘** 이라는 것이 요점이다 ──────────────────────────────────────
   * 액면은 부채꼴이다: 가운데 점 하나(`surfaceCentre`)와 테두리 링 하나
   * (`surfaceRim`). 그런데 옆벽의 맨 윗줄도 같은 자리에 같은 각도로 같은 반지름의
   * 링을 하나 갖고 있다 — `revolve` 가 만든 것이고, 부채꼴과는 별개의 정점들이다.
   *
   * 살짝 출렁일 때는 그 사실이 드러나지 않았다. 진폭이 작고 유리가 가려서다.
   * 기울어진 병에서 액면을 수평으로 만들면 진폭이 훨씬 커지고, 둘 중 하나만
   * 움직이면 벽 끝이 액면 위로 삐져나오거나 그 사이가 벌어진다. 그래서 두 링의
   * 위치를 함께 내보낸다.
   *
   * `wrap: false` 이므로 한 줄의 정점 수는 정확히 `cols` 다 — 이음매 중복이 없다.
   */
  g.userData.surfaceCentre = surfaceCentre;
  g.userData.surfaceRim = surfaceRim;
  g.userData.surfaceCols = cols;
  g.userData.surfaceY = fill * MM;
  /** 옆벽 맨 윗줄의 첫 정점. 부채꼴 링과 같은 각도, 같은 반지름. */
  g.userData.wallTopRim = (rows.length - 1) * cols;
  /** 그 링의 반지름, 월드 단위. 수평면 계산이 각 컬럼의 x/z 를 여기서 얻는다. */
  g.userData.surfaceRadius = surfaceR * MM;
  return g;
}

/**
 * The head of foam, and the bubbles under it.
 *
 * ── the foam is rewritten every frame, not rebuilt ──────────────────────────
 * It has to grow from the fill line up through the shoulder and into the neck,
 * and it has to hug the inside of the glass the whole way — so it cannot be a
 * cylinder that gets scaled, and it certainly cannot be a new geometry per
 * frame. It is a fixed lathe of `FOAM_ROWS` rings whose vertex POSITIONS get
 * rewritten from a single height parameter, which is six rings by twenty
 * columns: a hundred and twenty vertices, once a frame, on the CPU. That is the
 * same trick the liquid's surface uses for its slosh, with one more dimension.
 *
 * `userData` carries what the rewrite needs. Normals are set once and left:
 * they are radial on the wall and up on the head, which for a short column of
 * something with no specular is indistinguishable from doing it properly and
 * saves recomputing a cross product per vertex per frame.
 *
 * ── it is opaque, and that is deliberate ────────────────────────────────────
 * Foam is not translucent — a head thick enough to see through is not a head.
 * Being opaque also puts it in the depth pass, which is what stops the far wall
 * of the glass drawing through it and what lets the near wall tint it. It gets
 * the glass over the top of it for free, exactly like the drink does.
 */
const FOAM_ROWS = 6;

export function buildFoamGeometry(profile) {
  const p = profile.params;
  // 액체 바로 위에 앉으므로 같은 분할 수를 쓴다. 다르면 두 실루엣의 다각형
  // 꼭짓점이 어긋나 경계에 톱니가 생긴다.
  const cols = Math.max(12, Math.round(p.columns));

  const pos = [];
  const nor = [];
  const uv = [];
  const index = [];

  // Placeholder ring positions; `Bottle` writes the real ones before the first
  // draw. Only the topology and the UVs are decided here.
  for (let j = 0; j < FOAM_ROWS; j++) {
    for (let i = 0; i <= cols; i++) {
      const th = (i / cols) * TAU;
      pos.push(Math.cos(th), j, Math.sin(th));
      nor.push(Math.cos(th), 0, Math.sin(th));
      // v repeats up the column so the scroll has something to move. u wraps
      // twice round, which at twenty columns keeps the cells roughly square.
      uv.push((i / cols) * 2, (j / (FOAM_ROWS - 1)) * 2);
    }
  }
  const stride = cols + 1;
  for (let j = 0; j < FOAM_ROWS - 1; j++) {
    for (let i = 0; i < cols; i++) {
      const a = j * stride + i;
      index.push(a, a + stride, a + 1, a + 1, a + stride, a + stride + 1);
    }
  }

  // The head: a disc across the top of the column, so the foam has a surface
  // rather than an open pipe.
  const headCentre = pos.length / 3;
  pos.push(0, FOAM_ROWS - 1, 0);
  nor.push(0, 1, 0);
  uv.push(1, 1);
  const headRim = pos.length / 3;
  for (let i = 0; i < cols; i++) {
    const th = (i / cols) * TAU;
    pos.push(Math.cos(th), FOAM_ROWS - 1, Math.sin(th));
    nor.push(0, 1, 0);
    uv.push(0.5 + Math.cos(th), 0.5 + Math.sin(th));
  }
  for (let i = 0; i < cols; i++) {
    index.push(headCentre, headRim + ((i + 1) % cols), headRim + i);
  }

  const g = assemble({ pos, nor, uv, col: [], index });
  g.userData.foamRows = FOAM_ROWS;
  g.userData.foamCols = cols;
  g.userData.foamStride = stride;
  g.userData.headCentre = headCentre;
  g.userData.headRim = headRim;
  return g;
}

/**
 * The label: a slice of the bottle's own profile, pushed out by a fraction of a
 * millimetre.
 *
 * Following the profile rather than being a straight cylinder is what gives the
 * decal's edges their slight curve, for free and correctly, instead of faking
 * it in the texture.
 *
 * ── a front decal on a PARTIAL arc, not a band ─────────────────────────────
 * It used to wrap the whole bottle twice — `labelPanels: 2` — because at 128
 * texels across the full circumference the logo landed on about twenty texels
 * and two panels was the difference between a word and a smudge.
 *
 * A cider bottle carries one oval label on the front. Building the mesh for
 * only the front arc means the texture is spent entirely on the oval instead of
 * three quarters of it being transparent margin: the same texel density for
 * about a fifth of the pixels.
 *
 * ── the arc is 10..170 degrees, and 0..160 is the bug ──────────────────────
 * `revolve` starts its ring at theta = 0, which is +x. The camera sits on +z.
 * So the front of the bottle — the part facing the viewer — is theta = 90
 * degrees, NOT 0. An arc of `labelSweep` laid down from 0 puts the label round
 * the right-hand side of the bottle, visibly rotated away. It is centred on 90
 * instead.
 *
 * `wrap` is false because a partial arc has no seam to duplicate, and `flipU`
 * stays true for the reason the header gives: the ring winds anticlockwise and
 * the camera is on +z, so without it the artwork is mirrored. The first band
 * ever built read ƎⅼTTAꓭ.
 */
export function buildLabelGeometry(profile) {
  const p = profile.params;
  const cols = Math.max(12, Math.round(p.columns));
  const steps = 4;
  const rows = [];
  for (let i = 0; i <= steps; i++) {
    const y = p.labelFrom + ((p.labelTo - p.labelFrom) * i) / steps;
    rows.push({ r: (profile.envelopeAt(y) + p.labelOffset) * MM, y: y * MM, rib: 0 });
  }

  // Centred on the camera-facing side. See the note above on why this is not
  // simply 0 .. sweep.
  const sweep = (Math.max(1, Math.min(360, p.labelSweep)) * Math.PI) / 180;
  const sweepFrom = Math.PI / 2 - sweep / 2;

  const mesh = revolve(rows, {
    cols,
    ribs: 1,
    ribDepth: 0,
    height: profile.height * MM,
    wrap: false,
    flipU: true,
    sweepFrom,
    sweepTo: sweepFrom + sweep,
    // v spans the band exactly, so the artwork is not cropped by where the band
    // happens to sit up the bottle.
    vFrom: (p.labelFrom * MM) / (profile.height * MM),
    vTo: (p.labelTo * MM) / (profile.height * MM),
  });

  const g = assemble({ ...mesh, col: [] });
  g.userData.panels = Math.max(1, Math.round(p.labelPanels));
  return g;
}
