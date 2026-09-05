import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  ShaderMaterial,
} from 'three';
import { rotateY, shotSpread } from '../game/shot.js';
import { PALETTE } from '../core/palette.js';

/**
 * Everything the player needs to see while the bow is drawn.
 *
 * ── the pull and the shot point opposite ways ────────────────────────────────
 * Which is the one thing about this input that has to be unambiguous on screen,
 * because it is the one thing that is counter-intuitive the first time. So both
 * ends are drawn and they are drawn differently: the PULL is a cold line running
 * back to the cursor, the SHOT is a warm line running the other way. Drawing only
 * the aim would leave the player with no feedback on the gesture they are
 * actually making; drawing only the pull would leave them guessing where the cap
 * goes.
 *
 * ── the clamp has to be visible ──────────────────────────────────────────────
 * Past `maxPullDistance` the power stops rising but the cursor keeps moving, so
 * without a mark there is nothing to tell the player their last two centimetres
 * of drag did nothing. The pull line stops dead at the clamp point and grows a
 * crossbar there. The cursor carries on; the string does not.
 *
 * ── the ring is the deadzone ─────────────────────────────────────────────────
 * Not decoration: it is the radius inside which a release fires nothing. It is
 * the only way "I let go and nothing happened" reads as a rule rather than a
 * bug, so it is drawn dim while the pull is inside it and bright once the shot
 * is armed.
 *
 * ── the error cone is not optional, and it is an AREA ───────────────────────
 * A shot that goes somewhere other than where it was aimed, with no warning, is
 * indistinguishable from a bug. So the cone is drawn to the exact half-angle the
 * seeded draw is taken from — draw it narrower than it is and it is worse than
 * not drawing it, because now the game has lied.
 *
 * §5.2 makes it a filled region rather than an outline: "선이 아니라 면". Two
 * flanks and an arc describe the same set and read as a diagram of it; a wash
 * reads as the ground the cap might land on. The outline stays as the region's
 * EDGE at a third of the fill's presence, which is what §5.2 means by
 * "면의 경계만 암시".
 *
 * ── and it stays on when the aim assist is off ──────────────────────────────
 * §5.1: the cone is not a guide, it is a game STATE. 강타 sells "the cone opens
 * to twice the width" and 궤적 sells "the cone is gone for this turn"; with no
 * cone on screen neither card is selling anything. What the setting hides is the
 * pull line and the clamp crossbar — the gesture, not the consequence.
 *
 * ── and under chaos it is all taken away ─────────────────────────────────────
 * The one exception to the paragraph above, and it comes from the same place.
 * `AimInput` twists the heading AT THE SOURCE, so under the chaos card every
 * line here is already drawn along the deviated direction rather than the aimed
 * one — which is what stops the picture from lying, and is also exactly what
 * hands the deviation back. Sweep the pull until the arrow points at the target
 * and the card has been undone by reading it off the screen.
 *
 * So `blind` removes everything that points ANYWHERE: the arrow, the cone, the
 * predicted path. Nothing is substituted for them, because a fake aim line is a
 * lie and a true one is the leak. What stays is everything about the GESTURE —
 * the string back to the cursor, the clamp crossbar, the deadzone ring — none of
 * which says where the cap will go, and without which a drag under chaos would
 * read as broken rather than as blind.
 *
 * ── every line here is a RIBBON, because width is not a material property ────
 * `LineBasicMaterial.linewidth` is ignored by every WebGL renderer: a GL line is
 * one DRAWING-BUFFER pixel and nothing else. The buffer is at the device's own
 * ratio (see `Viewport`), so on a retina panel the whole bow was drawn a third
 * to a half of a CSS pixel wide — a hairline that the aim, which is the one
 * thing the player is looking at while they draw, could not afford.
 *
 * So each line is emitted several times, offset sideways by whole device pixels
 * about its own centre — the same "width is geometry" answer `DistanceMarks`
 * gives, done per segment instead of per mark so it holds at any heading. Two
 * consequences worth stating:
 *
 *   · the offsets are computed from `worldPerPixel`, so the ribbon is a fixed
 *     number of SCREEN pixels at every zoom. A fixed world offset would be a
 *     hairline zoomed out and a slab zoomed in, which is the failure being fixed
 *     showing up again at one end of the range.
 *   · the ribs are spaced one device pixel apart rather than spread to fill a
 *     width. Spread, a 3-pixel-wide pair of ribs is two hairlines with a gap
 *     between them, which reads as a double line, not a thick one.
 *
 * The perpendicular is taken in the board plane, so it foreshortens with the
 * camera's tilt — at the default 52° a line running across the screen comes out
 * 0.79 of the width of one running up it. Below a pixel and a half of total
 * width that difference is not visible, and the alternative is handing this file
 * a camera so it can work in screen space.
 */

/**
 * Warm: where the cap is going. Cold: where the hand is.
 *
 * Both went DARK when the fields went bright, and that is argued at length in
 * `PALETTE.aim` — briefly: the old pale amber lands within 1.2:1 of both honey
 * wood and summer turf, so the bow would have been invisible on two of the three
 * fields. The warm/cold split that tells the two apart is unchanged.
 */
const AIM_COLOR = PALETTE.aim.bow;
const PULL_COLOR = PALETTE.aim.pull;

/**
 * The 강타 pair. Hotter than both, and it replaces both.
 *
 * The card lasts until the shot, which means a player can arm it, look at the
 * board, think, and start a drag having forgotten. The widened cone says so, but
 * only once the pull is long enough for the cone to have opened — and the string
 * is on screen from the first pixel of the drag. So the aim's own colour carries
 * it too: the moment a boosted drag begins it is a different colour from an
 * ordinary one, at any power.
 */
const SMASH_AIM_COLOR = PALETTE.aim.smashBow;
const SMASH_PULL_COLOR = PALETTE.aim.smashPull;
const SMASH_CONE_COLOR = PALETTE.aim.smashCone;
const PULL_CLAMP_COLOR = PALETTE.aim.clamp;
const CONE_COLOR = PALETTE.aim.cone;
/**
 * §5.2 의 두 알파. 채움 0.10~0.14, 가장자리 0.35.
 *
 * 채움은 **각도로 나뉜다** — `CONE_FILL_ALPHA` 는 기준 반각에서의 값이고, 콘이
 * 넓어지면 그만큼 내려간다(`_writeCone`). 강타가 반각을 두 배로 벌리므로, 나누지
 * 않으면 면적이 두 배인 워시가 두 배로 진해진다.
 *
 * 기준 반각은 라디안 0.09 다. 이 게임의 보통 발사가 그 근처이고, 그때 알파가
 * 지시서가 준 범위의 위쪽(0.14)에 오도록 잡았다 — 콘은 언제나 보이는 것이므로
 * 범위의 아래쪽에서 시작하면 평소에 사실상 없다.
 */
const CONE_FILL_ALPHA = 0.14;
const CONE_FILL_REF_HALF = 0.09;
const CONE_EDGE_ALPHA = 0.35;

/**
 * 콘의 길이. 미리보기가 꺼져 있을 때 쓰는 추정치이고, 단위는 뚜껑 반지름이다.
 *
 * `CONE_MIN_RADII` 는 바닥이자 원래 있던 상수다 — 당김이 0 이어도 콘이 그려져야
 * 한다. `CONE_REACH_RADII` 는 실측 롤아웃에 맞춘 계수이고, **제곱**으로 곱해지는
 * 이유는 `update` 의 표에 있다.
 */
const CONE_MIN_RADII = 2.5;
const CONE_REACH_RADII = 20;

/**
 * ── 이 면은 품질 티어를 읽지 않는다. 그것이 결정이다 ────────────────────────
 * `core/quality.js` 를 임포트하는 것은 하늘·조명·재질·필드 뷰 넷이고 여기는
 * 아니다. 콘은 §11 의 불가침 목록에 있다 — **에러 콘은 언제나 보인다.** 티어를
 * 낮춘 기기에서 조준의 오차 범위가 사라지면 그 기기는 다른 게임을 하는 것이다.
 *
 * 픽셀 비용이 걱정되어 여기를 손대려는 사람을 위해: 프래그먼트에 텍스처 페치도
 * 루프도 없고(`smoothstep` 둘, `fract` 하나, `length` 하나), 지오메트리는 화면
 * 전체가 아니라 사거리만큼의 부채꼴이며, 조준 중이 아니면 `visible` 이 false 다.
 * 줄일 것이 있다면 알파나 하프톤 간격이지 존재 여부가 아니다.
 */
const PATH_COLOR = PALETTE.aim.path;
const RING_ARMED_COLOR = PALETTE.aim.ringArmed;
const RING_IDLE_COLOR = PALETTE.aim.ringIdle;
/** The "press here and it is a shot" ring. Drawn when nothing is being pulled. */
const HOVER_COLOR = PALETTE.aim.hover;

/** Plenty for a 1 s preview at any sample rate the panel allows — and for the
 *  trajectory card's four. */
const MAX_PATH_POINTS = 512;
/** Dash pattern along the sampled path: this many samples lit out of that many. */
const DASH_ON = 3;
const DASH_PERIOD = 5;
/** The cycled palette. Four entries, stepped — see `_writeDashes`. */
const DASH_PALETTE = PALETTE.aim.dash;
const CONE_ARC_SEGMENTS = 24;
const RING_SEGMENTS = 28;
/** Board-plane y for the flat overlays. Above the grid, below the caps. */
const DECK = 0.06;

/**
 * How wide the bow is drawn, in CSS pixels.
 *
 * Still a thin line — a hairline plus a bit, not a stroke. The request was for
 * the weight it already had, only reliably visible, so this is deliberately
 * around the width of an ordinary UI border rather than anything that would
 * start to read as a shape with an area.
 */
const GUIDE_WIDTH_CSS = 1.4;
/**
 * The fewest and most ribs a line is ever drawn with.
 *
 * The floor is 2 rather than 1 because a non-retina panel rounds `1.4` back down
 * to the single pixel this exists to get away from — on that screen one extra
 * pixel IS the whole of "a little thicker". The ceiling only bounds the buffers.
 */
const MIN_RIBS = 2;
const MAX_RIBS = 6;

function lineGeometry(maxPoints) {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(maxPoints * 3), 3));
  return g;
}

export class AimOverlay {
  constructor({ config }) {
    this.config = config;
    this.root = new Group();

    /**
     * Sideways offsets, in world units, one per rib. Rewritten by
     * `setPixelScale`; a single rib on the centreline until something tells this
     * file how big a pixel is, so a caller that never does gets the old drawing
     * rather than a wrong one.
     */
    this._ribs = [0];

    // Every buffer is sized for the worst case of MAX_RIBS copies, and every one
    // of them is now a segment LIST — a strip cannot be ribbed, because the ribs
    // of two adjacent segments do not share an endpoint.
    this.pathGeo = lineGeometry(MAX_PATH_POINTS * MAX_RIBS * 2);
    this.path = new LineSegments(
      this.pathGeo,
      new LineBasicMaterial({ color: PATH_COLOR, fog: false }),
    );
    this.path.frustumCulled = false;
    this.root.add(this.path);

    /**
     * The same path, broken into marching dashes. The trajectory card's line.
     *
     * A separate object rather than a mode on the first one. Both are segment
     * lists now that the path is ribbed, so the primitive is no longer what
     * separates them — the COLOUR is: this one's material is rewritten every
     * frame to step through `DASH_PALETTE`, and the plain path's is a constant.
     * Only one is ever visible.
     *
     * The dashes advance by whole SAMPLES, not by a distance — each sample is a
     * fixed slice of simulated time, so the pattern flows at a constant rate
     * along the path instead of racing where the cap is fast. That is the same
     * trick as scrolling a texture's UV, done on the index instead, and it steps
     * rather than sliding because stepping is what the hardware did.
     */
    this.dashGeo = lineGeometry(MAX_PATH_POINTS * MAX_RIBS * 2);
    this.dashMaterial = new LineBasicMaterial({ color: PATH_COLOR, fog: false });
    this.dash = new LineSegments(this.dashGeo, this.dashMaterial);
    this.dash.frustumCulled = false;
    this.dash.visible = false;
    this.root.add(this.dash);

    // Apex -> edge, the arc across the far end, edge -> apex: one closed outline
    // as a segment list, because a LineLoop cannot do the two straight flanks and
    // the arc without doubling back.
    this.coneGeo = lineGeometry((CONE_ARC_SEGMENTS + 4) * MAX_RIBS * 2);
    this.coneMaterial = new LineBasicMaterial({
      color: CONE_COLOR,
      fog: false,
      transparent: true,
      // §5.2: 가장자리는 면의 경계만 암시한다.
      opacity: CONE_EDGE_ALPHA,
    });
    this.cone = new LineSegments(this.coneGeo, this.coneMaterial);
    this.cone.frustumCulled = false;
    this.root.add(this.cone);

    /**
     * The cone's FILL. A fan from the apex to the far arc.
     *
     * ── the alpha is not a constant, and §5.2 says why ────────────────────
     * "넓어질 때 알파를 낮춰라. 강타로 콘이 두 배가 되는데 같은 알파면 면적이 두
     * 배라 두 배로 진해진다. 정보가 아니라 소음이 된다." So `uAlpha` is handed
     * the base alpha divided by how wide the cone has opened, and the whole
     * region gets quieter exactly as it gets bigger — the SHAPE carries the
     * warning and the wash never competes with the board.
     *
     * The other two terms are per-vertex and live in the shader: a radial fade
     * so the far end dissolves instead of being cut off (§5.2's "끝단"), and a
     * halftone so the region reads as a texture rather than as a pane of glass
     * (§5.2's "질감", and `ui/marks.halftone` is the same pattern in 2D).
     */
    this.coneFillGeo = new BufferGeometry();
    const fanVerts = CONE_ARC_SEGMENTS + 2;
    this.coneFillGeo.setAttribute(
      'position',
      new BufferAttribute(new Float32Array(fanVerts * 3), 3),
    );
    this.coneFillGeo.setAttribute('aT', new BufferAttribute(new Float32Array(fanVerts), 1));
    this.coneFillGeo.setIndex(
      Array.from({ length: CONE_ARC_SEGMENTS * 3 }, (_, k) => {
        const i = Math.floor(k / 3);
        return [0, i + 1, i + 2][k % 3];
      }),
    );
    this.coneFillMaterial = new ShaderMaterial({
      transparent: true,
      depthWrite: false,
      side: DoubleSide,
      fog: false,
      uniforms: {
        uColor: { value: new Color(CONE_COLOR) },
        uAlpha: { value: 0 },
        uDotScale: { value: 0.55 },
      },
      vertexShader: /* glsl */ `
        attribute float aT;
        varying float vT;
        varying vec3 vWorld;
        void main() {
          vT = aT;
          vec4 world = modelMatrix * vec4(position, 1.0);
          vWorld = world.xyz;
          gl_Position = projectionMatrix * viewMatrix * world;
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3  uColor;
        uniform float uAlpha;
        uniform float uDotScale;
        varying float vT;
        varying vec3  vWorld;
        void main() {
          // 끝단은 자르지 않고 사라진다. 마지막 30% 에서 0 으로.
          float fade = 1.0 - smoothstep(0.7, 1.0, vT);
          // 하프톤. 보드 평면의 월드 좌표로 찍으므로 카메라가 돌아도 점이
          // 화면에서 헤엄치지 않는다 — 면에 인쇄된 것으로 읽혀야 한다.
          vec2 g = vWorld.xz / uDotScale;
          vec2 f = abs(fract(g) - 0.5);
          float dot2 = 1.0 - smoothstep(0.18, 0.34, length(f));
          // 점만 그리면 성기고, 점 없이 그리면 유리다. 바탕 위에 점을 얹는다.
          float a = uAlpha * fade * (0.72 + 0.28 * dot2);
          if (a < 0.002) discard;
          gl_FragColor = vec4(uColor, a);
        }
      `,
    });
    this.coneFill = new Mesh(this.coneFillGeo, this.coneFillMaterial);
    this.coneFill.frustumCulled = false;
    // 아래에 깔린다. 활도 당김 선도 이 면 위에 그려져야 한다.
    this.coneFill.renderOrder = -1;
    this.root.add(this.coneFill);

    this.aimGeo = lineGeometry(4 * MAX_RIBS * 2);
    this.aimMaterial = new LineBasicMaterial({ color: AIM_COLOR, fog: false });
    this.aim = new LineSegments(this.aimGeo, this.aimMaterial);
    this.aim.frustumCulled = false;
    this.root.add(this.aim);

    this.pullGeo = lineGeometry(4 * MAX_RIBS * 2);
    this.pullMaterial = new LineBasicMaterial({ color: PULL_COLOR, fog: false });
    this.pull = new LineSegments(this.pullGeo, this.pullMaterial);
    this.pull.frustumCulled = false;
    this.root.add(this.pull);

    // No strike-height marker. It existed to show an axis the player could move;
    // the height is fixed now, so it would be a tick that is always in the same
    // place relative to the cap.
    this.ringGeo = lineGeometry(RING_SEGMENTS * MAX_RIBS * 2);
    this.ringMaterial = new LineBasicMaterial({ color: RING_IDLE_COLOR, fog: false });
    this.ring = new LineSegments(this.ringGeo, this.ringMaterial);
    this.ring.frustumCulled = false;
    this.root.add(this.ring);

    /**
     * The hover ring, and it is not decoration.
     *
     * A press on the board means one of two things — draw a shot, or move the
     * camera — and the player has to know which before committing. A cursor
     * change says it on a desktop and says nothing at all on a touch screen, so
     * the cap that would be grabbed is ringed on the board itself. Drawn only
     * when no pull is in progress, because during a pull the deadzone ring is
     * already there and two rings on one cap is noise.
     */
    this.hoverGeo = lineGeometry(RING_SEGMENTS * MAX_RIBS * 2);
    this.hoverMaterial = new LineBasicMaterial({ color: HOVER_COLOR, fog: false });
    this.hover = new LineSegments(this.hoverGeo, this.hoverMaterial);
    this.hover.frustumCulled = false;
    this.hover.visible = false;
    this.root.add(this.hover);

    this.setVisible(false);
  }

  /**
   * Tell the overlay how big a pixel is, so the ribbons can be a screen width.
   *
   * Called every frame from the render loop rather than on zoom changes: the
   * distance eases, so "the zoom changed" is true for a run of frames that no
   * single event marks the end of, and recomputing six small offsets is cheaper
   * than the bookkeeping to avoid it.
   *
   * @param {number} worldPerPixel  world units in one CSS pixel at the board plane
   * @param {number} pixelRatio     drawing-buffer pixels per CSS pixel
   */
  setPixelScale(worldPerPixel, pixelRatio = 1) {
    const ratio = Math.max(1, pixelRatio || 1);
    const px = Math.max(1e-6, worldPerPixel || 0) / ratio; // one DEVICE pixel, in world units
    const count = Math.min(
      MAX_RIBS,
      Math.max(MIN_RIBS, Math.round(GUIDE_WIDTH_CSS * ratio)),
    );
    if (this._ribs.length !== count) this._ribs = new Array(count);
    // Centred on the true line, so widening it does not also move it: the aim
    // arrow starts at the cap's centre of mass and has to keep starting there.
    for (let i = 0; i < count; i++) this._ribs[i] = (i - (count - 1) / 2) * px;
  }

  /**
   * One segment of a line, written once per rib.
   *
   * The offset is perpendicular in xz only — the y of both endpoints is carried
   * through untouched, because the predicted path is sampled at the cap's actual
   * centre of mass and a hop in it is real. Flattening the ribbon to `DECK`
   * would have quietly straightened the one line that is allowed to leave it.
   *
   * @returns {number} the new write cursor
   */
  _emit(a, w, x0, y0, z0, x1, y1, z1) {
    const dx = x1 - x0;
    const dz = z1 - z0;
    const len = Math.hypot(dx, dz);
    // A segment with no length has no perpendicular, and the sampled path is
    // full of them the moment the cap comes to rest. Dropping it costs nothing;
    // dividing by it would put NaNs in the buffer and take the whole line off
    // screen.
    if (len < 1e-6) return w;
    const nx = -dz / len;
    const nz = dx / len;
    for (let i = 0; i < this._ribs.length; i++) {
      if (w + 6 > a.length) break;
      const o = this._ribs[i];
      a[w++] = x0 + nx * o;
      a[w++] = y0;
      a[w++] = z0 + nz * o;
      a[w++] = x1 + nx * o;
      a[w++] = y1;
      a[w++] = z1 + nz * o;
    }
    return w;
  }

  /** A circle on the deck, as a ribbed segment list. The two rings share it. */
  _writeCircle(geo, cx, cz, r) {
    const attr = geo.getAttribute('position');
    const a = attr.array;
    let w = 0;
    let px = cx + r;
    let pz = cz;
    for (let i = 1; i <= RING_SEGMENTS; i++) {
      const ang = (i / RING_SEGMENTS) * Math.PI * 2;
      const x = cx + Math.cos(ang) * r;
      const z = cz + Math.sin(ang) * r;
      w = this._emit(a, w, px, DECK, pz, x, DECK, z);
      px = x;
      pz = z;
    }
    attr.needsUpdate = true;
    geo.setDrawRange(0, w / 3);
  }

  /**
   * Show or hide everything that belongs to a draw in progress.
   *
   * Walks the children rather than naming them. It used to be a hand-written
   * list of five, and the sixth — the trajectory card's dashed line — was added
   * to the scene and not to the list, so releasing the aim hid every other part
   * and left the dashes on the pitch. A ghost of the last shot, drawn over the
   * next one.
   *
   * The hover ring is the one exception and it is an exception by rule, not by
   * omission: it says which cap a press would grab, which is a question about
   * the board rather than about a draw, and `setHover` owns it outright.
   */
  setVisible(on) {
    for (const child of this.root.children) {
      /**
       * 둘은 이 루프가 건드리지 않는다.
       *
       * `hover` 는 원래 그랬다 — 당김이 없을 때만 나오므로 오버레이 전체의
       * 표시와 다른 조건을 갖는다. `coneFill` 도 같다: 궤적 카드와 혼란이 콘만
       * 따로 끄고, 여기서 무조건 켜면 그 둘이 한 프레임씩 새어 나온다.
       */
      if (child === this.hover || child === this.coneFill) continue;
      child.visible = on;
    }
    if (!on) this.coneFill.visible = false;
  }

  /**
   * Ring the cap a press would grab, or hide it.
   * @param {{x: number, z: number}|null} com  centre of mass, or null
   * @param {number} radius  the cap's pick radius, in world units
   */
  setHover(com, radius) {
    if (!com) {
      this.hover.visible = false;
      return;
    }
    this._writeCircle(this.hoverGeo, com.x, com.z, radius);
    this.hover.visible = true;
  }

  /**
   * @param {object} s
   * @param {{x:number,y:number,z:number}} s.com   pulled cap's centre of mass
   * @param {number} s.dirX   travel direction (opposite the pull)
   * @param {number} s.dirZ
   * @param {number} s.power  0..1
   * @param {number} s.pullX  raw pull vector, unclamped
   * @param {number} s.pullZ
   * @param {number} s.clampedDistance
   * @param {boolean} s.atClamp
   * @param {boolean} s.armed
   * @param {number[]} s.path  flat xyz from the preview, may be short or empty
   * @param {number} s.reach   length of the last completed preview
   * @param {{radius:number}} s.geom
   * @param {boolean} [s.blind]  chaos: draw the gesture, never the outcome
   * @param {boolean} [s.smash]  강타: say so in the colour of the whole aim
   * @param {number} [s.spreadMul]  강타: how much wider the cone is
   */
  update(s) {
    this.setVisible(true);

    const blind = !!s.blind;
    const dashed = !blind && !!s.dashed;
    const smash = !!s.smash;

    // The whole aim recoloured, not a badge added to it. Every line of this
    // gesture belongs to the same shot, so they change together or the picture
    // says two different things about one drag.
    this.aimMaterial.color.set(smash ? SMASH_AIM_COLOR : AIM_COLOR);
    this.coneMaterial.color.set(smash ? SMASH_CONE_COLOR : CONE_COLOR);
    this.coneFillMaterial.uniforms.uColor.value.set(smash ? SMASH_CONE_COLOR : CONE_COLOR);

    // Both buffers are emptied when blind rather than just hidden. A geometry
    // left holding the last frame's points is a ghost waiting for something to
    // turn it visible again — which is exactly how the trajectory card's dashes
    // once survived onto the following shot.
    if (blind) {
      this._writePath(null);
      this._writeDashes(null, 0);
    } else if (dashed) this._writeDashes(s.path, s.dashPhase ?? 0);
    else this._writePath(s.path);
    this.path.visible = !blind && !dashed;
    this.dash.visible = dashed;

    /**
     * The gesture, which is drawn under chaos exactly as it is drawn without it.
     *
     * ── and which the aim-assist setting can take away ────────────────────
     * §5.3: the pull line and the clamp crossbar are what the switch hides. The
     * deadzone RING stays — it is not a guide either, it is the radius inside
     * which a release fires nothing, and "I let go and nothing happened" has to
     * read as a rule rather than as a bug however the setting is left.
     *
     * Emptied rather than hidden, for the reason the blind branch above gives:
     * a geometry holding the last frame's points is a ghost waiting for
     * something to make it visible again.
     */
    this._writeRing(s.com, s.armed);
    if (s.assist === false) this.pullGeo.setDrawRange(0, 0);
    else this._writePull(s.com, s.pullX, s.pullZ, s.clampedDistance, s.atClamp, smash);

    /**
     * How far the cone and the aim line go.
     *
     * The intent has always been "as far as the shot does" — a fixed length says
     * the same thing about a nudge as about a full draw, when the whole point is
     * that the full draw's error is enormous and the nudge's is nothing.
     *
     * ── and for the whole of the shipped game it was a fixed length ──────────
     * `s.reach` is the last completed PREVIEW's length, and the preview is off
     * by default: `config.preview.enabled` is the developer's line, and the 궤적
     * card is the only thing that turns it on. So in ordinary play this fell to
     * the floor — `radius * 2.5`, four world units — every frame, at every draw.
     * Measured against what the shot actually does on the survival board: four
     * units is the reach of a 0.24 draw. The cone was permanently drawing the
     * weakest shot in the game, about a third of a cap wide at its tip, and the
     * comment above it said otherwise.
     *
     * Found by rendering it and reading the pixels — §11 calls the cone
     * inviolable and the PHASE 4 audit could never measure it, because a
     * synthetic pointer event never reaches `PointerRouter`. Driving `AimInput`
     * by hand and diffing two renders of one frame is what finally showed it.
     *
     * ── the estimate, and what it is not ────────────────────────────────────
     * It is not physics. Nothing here may read damping or friction — those live
     * in the frozen simulation and a render-side copy of them would drift. It is
     * a curve fitted to measured rollouts, in cap radii, and its shape is the
     * point: SQUARED, so a nudge stays short.
     *
     *   draw   survival   this   football   this   curling   this
     *   0.34      8.0      7.7      —         —       —        —
     *   0.57     22.1     14.4     14.7*    10.8      —        —
     *   0.80     29.7     24.5     22.8*    26.0     49.6*   22.5
     *   1.00     36.3     36.0      ~27     36.0     94.4     36.0
     *
     *   * measured at the nearest draw that mode reached: 0.46 and 0.83 for
     *     football, 0.76 for curling.
     *
     * It errs SHORT nearly everywhere, and that is the safe direction: the cone
     * is a claim about where the cap may end up, and a claim that reaches past
     * the truth is worse than one that stops early. Curling is the outlier by a
     * factor of two and a half — its ice is the whole card, stones travel much
     * further than anything a shared constant can express — so there the cone
     * reads as the angle rather than as the distance. Turn the preview on and
     * the real number replaces all of this.
     */
    const reach = Math.max(
      s.geom.radius * CONE_MIN_RADII,
      s.reach || s.geom.radius * (CONE_MIN_RADII + CONE_REACH_RADII * s.power * s.power),
    );
    // The trajectory card takes the cone away, and that is not a decoration.
    // The cone says "it will go somewhere in here"; the card's whole claim is
    // that it will go exactly THERE, and the line already draws the exact shot.
    // Leaving both up would be the card promising precision next to a drawing of
    // the imprecision it just removed.
    //
    // Chaos takes it away for the opposite reason: the cone is symmetric about
    // the heading, so its bisector IS the deviated aim, drawn slightly less
    // legibly. Hiding the arrow and keeping the cone would leak the same number.
    if (blind || s.hideCone) {
      this.coneGeo.setDrawRange(0, 0);
      this.coneFill.visible = false;
    } else {
      this._writeCone(s.com, s.dirX, s.dirZ, s.power, reach, s.spreadMul ?? 1, s.impulseMul ?? 1);
    }

    if (blind) this.aimGeo.setDrawRange(0, 0);
    else this._writeAim(s.com, s.dirX, s.dirZ, reach);
  }

  _writePath(points) {
    const attr = this.pathGeo.getAttribute('position');
    if (!points || points.length < 6) {
      this.pathGeo.setDrawRange(0, 0);
      return;
    }
    const n = Math.min(MAX_PATH_POINTS, points.length / 3);
    const a = attr.array;
    let w = 0;
    for (let i = 0; i + 1 < n; i++) {
      const j = i * 3;
      const k = j + 3;
      w = this._emit(a, w, points[j], points[j + 1], points[j + 2], points[k], points[k + 1], points[k + 2]);
    }
    attr.needsUpdate = true;
    this.pathGeo.setDrawRange(0, w / 3);
  }

  /**
   * The path as marching dashes, with the colour rotating behind them.
   *
   * Three lit samples in five, offset by `phase`. Both halves of the motion are
   * whole numbers — which sample the dash starts on, and which entry of a
   * four-colour palette it is drawn in — so nothing here interpolates and the
   * line reads as an index being cycled rather than as an animation being
   * tweened.
   */
  _writeDashes(points, phase) {
    const attr = this.dashGeo.getAttribute('position');
    if (!points || points.length < 6) {
      this.dashGeo.setDrawRange(0, 0);
      return;
    }
    const n = Math.min(MAX_PATH_POINTS, points.length / 3);
    // Floored to a whole sample, and brought positive before the modulo: the
    // phase runs backwards so the dashes march AWAY from the cap, and JS's `%`
    // keeps the sign of its left operand, which would make every test fail on
    // the half of the cycle where it is negative.
    const p = ((Math.floor(phase) % DASH_PERIOD) + DASH_PERIOD) % DASH_PERIOD;
    const a = attr.array;
    let w = 0;
    for (let i = 0; i + 1 < n; i++) {
      if (((i + p) % DASH_PERIOD) >= DASH_ON) continue;
      const j = i * 3;
      const k = j + 3;
      w = this._emit(a, w, points[j], points[j + 1], points[j + 2], points[k], points[k + 1], points[k + 2]);
    }
    attr.needsUpdate = true;
    this.dashGeo.setDrawRange(0, w / 3);
    this.dashMaterial.color.set(DASH_PALETTE[p % DASH_PALETTE.length]);
  }

  _writeRing(com, armed) {
    // The deadzone, to scale. Release inside this and nothing fires.
    const r = Math.max(this.config.shot.deadzone, 0.05);
    this._writeCircle(this.ringGeo, com.x, com.z, r);
    this.ringMaterial.color.set(armed ? RING_ARMED_COLOR : RING_IDLE_COLOR);
  }

  _writePull(com, px, pz, clamped, atClamp, smash = false) {
    const attr = this.pullGeo.getAttribute('position');
    const a = attr.array;
    const len = Math.hypot(px, pz);
    if (len < 1e-4) {
      this.pullGeo.setDrawRange(0, 0);
      return;
    }
    const ux = px / len;
    const uz = pz / len;
    const ex = com.x + ux * clamped;
    const ez = com.z + uz * clamped;

    // The string.
    let w = this._emit(a, 0, com.x, DECK, com.z, ex, DECK, ez);

    // A crossbar at the far end. It marks the clamp, so it is only worth drawing
    // once the clamp is doing something.
    if (atClamp) {
      const k = this.config.shot.deadzone * 0.8;
      w = this._emit(a, w, ex - uz * k, DECK, ez + ux * k, ex + uz * k, DECK, ez - ux * k);
    }
    attr.needsUpdate = true;
    this.pullGeo.setDrawRange(0, w / 3);
    // The clamp still wins: "you have stopped gaining power" is a fact about
    // this instant of the drag, and 강타 is a fact about the whole of it.
    this.pullMaterial.color.set(
      atClamp ? PULL_CLAMP_COLOR : smash ? SMASH_PULL_COLOR : PULL_COLOR,
    );
  }

  _writeCone(com, dx, dz, power, reach, spreadMul = 1, impulseMul = 1) {
    // Through `shotSpread`, not `spreadRadians`, so the drawn cone is the same
    // half-angle the seeded draw is taken from — boost included. See shot.js.
    //
    // `impulseMul` has to travel with it now that the cone follows the delivered
    // impulse rather than the pull: without it the drawn cone would be the one a
    // 강타 shot would have had UNBOOSTED, which is narrower than the truth. A
    // cone that under-reports is the one failure `shotSpread`'s note calls worse
    // than having no cone at all.
    const half = shotSpread({ power, spreadMul, impulseMul }, this.config.shot);
    const attr = this.coneGeo.getAttribute('position');
    const a = attr.array;
    let w = 0;

    const seg = (x0, z0, x1, z1) => {
      w = this._emit(a, w, x0, DECK, z0, x1, DECK, z1);
    };

    if (half <= 1e-5) {
      this.coneGeo.setDrawRange(0, 0);
      this.coneFill.visible = false;
      return;
    }
    this._writeConeFill(com, dx, dz, reach, half);

    const edge = (sign) => {
      const d = rotateY(dx, dz, sign * half);
      return { x: com.x + d.x * reach, z: com.z + d.z * reach };
    };

    const e0 = edge(-1);
    const e1 = edge(1);

    seg(com.x, com.z, e0.x, e0.z);
    seg(com.x, com.z, e1.x, e1.z);

    // The far arc. Drawn on the arc rather than as a chord because a chord makes
    // the reachable set look like a triangle, and the corners of that triangle
    // are places the shot cannot actually reach.
    let prev = e0;
    for (let i = 1; i <= CONE_ARC_SEGMENTS; i++) {
      const t = -half + (i / CONE_ARC_SEGMENTS) * half * 2;
      const d = rotateY(dx, dz, t);
      const p = { x: com.x + d.x * reach, z: com.z + d.z * reach };
      seg(prev.x, prev.z, p.x, p.z);
      prev = p;
    }

    attr.needsUpdate = true;
    this.coneGeo.setDrawRange(0, w / 3);
  }

  /**
   * The filled region, as a fan from the apex.
   *
   * `aT` is 0 at the apex and 1 on the arc, which is what the shader fades over.
   * The fan is written every frame because the cone moves with the cap and
   * changes shape with the draw — there is nothing here worth caching.
   */
  _writeConeFill(com, dx, dz, reach, half) {
    const pos = this.coneFillGeo.getAttribute('position');
    const t = this.coneFillGeo.getAttribute('aT');
    const a = pos.array;

    a[0] = com.x;
    a[1] = DECK;
    a[2] = com.z;
    t.array[0] = 0;

    for (let i = 0; i <= CONE_ARC_SEGMENTS; i++) {
      const ang = -half + (i / CONE_ARC_SEGMENTS) * half * 2;
      const d = rotateY(dx, dz, ang);
      const j = (i + 1) * 3;
      a[j] = com.x + d.x * reach;
      a[j + 1] = DECK;
      a[j + 2] = com.z + d.z * reach;
      t.array[i + 1] = 1;
    }
    pos.needsUpdate = true;
    t.needsUpdate = true;

    // 넓어질수록 옅어진다. 위의 `CONE_FILL_ALPHA` 주석 참조.
    this.coneFillMaterial.uniforms.uAlpha.value =
      CONE_FILL_ALPHA * Math.min(1, CONE_FILL_REF_HALF / Math.max(1e-4, half));
    this.coneFill.visible = true;
  }

  _writeAim(com, dx, dz, reach) {
    const attr = this.aimGeo.getAttribute('position');
    const a = attr.array;
    const tipX = com.x + dx * reach;
    const tipZ = com.z + dz * reach;

    let w = this._emit(a, 0, com.x, DECK, com.z, tipX, DECK, tipZ);

    // An arrowhead, so the warm line reads as a direction rather than as a second
    // string. BOTH barbs — one alone just looks like the line frayed.
    const back = reach * 0.06;
    const side = back * 0.55;
    w = this._emit(
      a, w,
      tipX, DECK, tipZ,
      tipX - dx * back - dz * side, DECK, tipZ - dz * back + dx * side,
    );
    w = this._emit(
      a, w,
      tipX, DECK, tipZ,
      tipX - dx * back + dz * side, DECK, tipZ - dz * back - dx * side,
    );

    attr.needsUpdate = true;
    this.aimGeo.setDrawRange(0, w / 3);
  }

}
