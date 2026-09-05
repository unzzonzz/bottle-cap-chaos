import { PALETTE } from '../core/palette.js';

/**
 * Every number the menu can be tuned by, in one object.
 *
 * The same arrangement `game/config.js` uses: the panel edits THIS, nothing
 * else, so turning the panel off changes nothing about how the menu behaves —
 * the values are the same values, there is just nothing on screen to drag them
 * with.
 *
 * Split into blocks by what owns them rather than by what they do, so a module
 * takes one block and never reaches across into another's.
 */
export const MENU_CONFIG = {
  camera: {
    fov: 30,
    distance: 62,
    /** Above the bottle's middle, so the floor opens out. See `placeCamera`. */
    height: 5.2,
    lookAtY: 0.6,
  },

  /**
   * The cap wipe. §7.2 — the object that carries the screen across.
   */
  wipe: {
    /**
     * Extra scale over the exact fit, at the covered frame.
     *
     * The exact fit is computed from the cap's own panel radius and the frame's
     * half-diagonal, so 1.0 would already cover it. The margin was originally
     * against the vertex snap, which moved every corner by up to half a low-res
     * pixel and was free to move one INWARD; that snap went with the retro pass.
     * What it covers now is the geometry's own faceting — the panel is a
     * polygon, not a circle, so its true silhouette dips inside the radius
     * `measurePanelRadius` reports between vertices.
     */
    coverSafety: 1.1,
    /**
     * Turns a second while it flies.
     *
     * §7.2 asks the spin to follow §21's material motion — the inertia of a
     * metal disc. A disc flicked off a bottle carries a lot of angular momentum
     * and sheds almost none of it in half a second, so this is a CONSTANT rate
     * rather than an eased one, and the settle at the end (`_advance`) is what
     * brings it to rest rather than a decay curve.
     */
    spinSpeed: 1.35,
    /** How far the spin axis leans off the flight direction, in degrees. */
    axisTilt: 15,
    /** How much bigger it still gets on the way past, over the cover scale. */
    exitGrowth: 1.22,
    /** How far it travels on the way out, in frame pixels. */
    exitTravel: 1180,
    /** Where it starts, as a fraction of the cover scale. */
    startScale: 0.05,
  },

  /**
   * The transition, stage by stage.
   *
   * Summed default is 0.39s — 0.34 closing, three frames covered. It was 0.77
   * with a 0.38-second shake in front of it and no ceiling at all, because the
   * press-and-hold made the total variable upward. §6.1 removes that stage, so
   * the run is a fixed length for the first time, and well inside the brief's
   * "1초 이내".
   */
  transition: {
    /**
     * Stage 1: how long the frame takes to close.
     *
     * This is the stage's own length. `popSeconds` below is a shorter event
     * inside it, so raising this gives the bars a slower close without turning
     * the cap's hop into a slow-motion one.
     */
    barSeconds: 0.34,
    /**
     * The cap's hop off the mouth, inside stage 2.
     *
     * ── it used to fly at the camera and take the screen ──────────────────
     * `launchSeconds` was 0.28 and it was the whole of the cover: the cap grew
     * until it filled the frame. The letterbox does the covering now, so all
     * that is left of this is the part that was about the BOTTLE — the cap
     * comes off the mouth, the eruption goes off behind it, and it is gone
     * behind the closing bars a sixth of a second later. It never crosses the
     * frame.
     *
     * Shorter than `barSeconds` on purpose. A hop that was still rising when
     * the frame went opaque would read as an animation cut off rather than one
     * finished.
     */
    popSeconds: 0.15,
    /**
     * How long the covered frame holds. Three frames at 60 Hz.
     *
     * ── it is a SEAM again, and that is what the number is for ─────────────
     * This is what it was originally, because the brief asked for "완전 차폐
     * (2~3프레임)" and all a covered frame had to do was hide a scene swap.
     * Three frames is the shortest window a swap can hide behind and still be
     * certain to be SEEN by the compositor, which is the whole requirement.
     *
     * It went to 0.35 for a while — seven times the minimum — because the frame
     * had the game's wordmark on it and 50 ms is nowhere near long enough to
     * READ three words. The wordmark is gone on instruction, and with nothing
     * on the frame there is nothing to hold it for: a held frame with nothing
     * on it is not a beat, it is a pause. So the number goes back to the job.
     *
     * It does not gate a NAVIGATION. On that path the bars stay shut while the
     * next document loads (`uncover: false` in `bootMenu`), so this only decides
     * how long a same-document scene swap sits behind the colour before the bars
     * part again.
     */
    coverSeconds: 0.05,
    /**
     * How long the cap takes to leave on the FAR side of the document swap.
     *
     * It is not part of `totalSeconds` and must not be: this is spent by the
     * game document, after the menu has gone away, and the two clocks never run
     * at the same time. §7.3's contract is that the covered frame is the seam —
     * everything before it belongs to one document and everything after to the
     * other.
     *
     * Longer than the close. Coming in, the cap is hiding a document swap and
     * the player is waiting for the game; going out, it IS the game arriving and
     * there is something behind it worth uncovering slowly.
     */
    exitSeconds: 0.42,
  },

  /**
   * 내 마크 — the drawing screen's numbers.
   *
   * Same arrangement as every other block here: the panel edits THIS, so turning
   * the panel off changes nothing about how the editor behaves.
   */
  marks: {
    /**
     * Canvas edge in texels.
     *
     * 128 is where the brief starts it, and it is a page — the same ceiling
     * `core/textures.js` puts on every other texture in this project. Only the
     * inscribed circle is reachable and only `boundary` of that, so the drawable
     * area is smaller again: at these two defaults it is about 92 texels across.
     */
    canvasSize: 128,
    /**
     * The drawable circle, as a fraction of the canvas half-width.
     *
     * The ring between this and the panel's own rim is the part of the cap that
     * stays team-coloured, and the brief calls that ring the team marker. Raising
     * this toward 1 eats it.
     */
    // A fraction of the cap's PANEL, not of the cap. See `MARK_BOUNDARY_DEFAULT`.
    boundary: 0.84,
    /**
     * Strokes the editor remembers. The brief asks for at least twenty.
     *
     * Whole canvases, not diffs — see `MarkEditor` — so the cost is this times
     * `canvasSize` squared times four bytes. At the defaults that is about
     * 1.5 MB, and the panel can push it in either direction to find out where
     * that stops being a good trade.
     */
    historyLimit: 24,
    /** The cap the editor draws on. Neutral: a mark belongs to neither side. */
    capColor: PALETTE.menu.capDefault,
    /** View mode: radians of roll per pixel of vertical drag. */
    rotateRadiansPerPixel: 0.012,
    /** What a release keeps of the drag's speed. */
    flingScale: 0.9,
    /** Per 1/60 s. Below 1, so a thrown cap comes to rest. */
    spinDamping: 0.94,
  },

  items: {
    /**
     * One FRAMEBUFFER pixel per texel, which is why the type survives. So these
     * are in target pixels — at the 640x480 default the column below spans
     * x 4..260 of the 320 available to the right of centre.
     *
     * They are absolute rather than fractions of the frame on purpose: the
     * whole point is that a texel lands on a pixel, and a fraction would put
     * the plate on a half-pixel boundary at some resolutions.
     */
    plateWidth: 256,
    plateHeight: 52,
    /** Pixels between plate centres. */
    pitch: 64,
    /** Pixel position of the column's centre. */
    columnX: 132,
    columnY: -24,
    /** A few degrees, so they read as panels in the room. More warps the type. */
    yaw: -7,
    /** How far a hovered plate steps toward the camera and to the right. */
    hoverShift: 0.45,
  },

  view: {
    /**
     * The same bloom the game runs, so the two sides of the letterbox match.
     *
     * The menu is the one screen that is nothing BUT glossy surfaces — glass,
     * liquid, bubbles, a metal cap — so it is where the threshold gets judged.
     * If it looks right here and hazy in a match, the match's lighting is too
     * hot rather than the bloom being wrong.
     *
     * The bars themselves are OUTSIDE this — `Cinematic` draws after the chain,
     * like every other overlay. A bright pass over a hard edge blooms the edge,
     * and a letterbox with a halo is not a letterbox.
     */
    /**
     * 메뉴에서는 **꺼져 있다.** 취향이 아니라 실측이다.
     *
     * ── 무엇이 블룸을 받는가: 아무것도 ─────────────────────────────────────
     * 물의 마루는 선형 휘도 0.502 로 브라이트패스 임계 0.72 아래다. 병은 재 보니
     * 제목을 숨긴 채 블룸을 껐다 켰을 때 병 영역의 평균이 127.3 대 126.8 —
     * 255 중 0.5 만 움직이고 포화 픽셀은 0.01%p 다. 유리의 하이라이트 스트립은
     * emissiveIntensity 0.12 라 애초에 임계 근처에 가지 않는다.
     *
     * ── 무엇이 블룸을 받는가: 제목, 그리고 그것은 파괴다 ────────────────────
     * 잉크가 순백이 되면서 선형 휘도가 1.0 이 됐다. 임계 0.72 를 한참 넘어서
     * 제목 영역의 포화 픽셀이 25.92% 에서 53.99% 로 뛰고 글자 모양이 사라진다 —
     * 왼쪽 절반이 흰 얼룩이 된다.
     *
     * 한동안 제목을 UI 레이어로 피신시켜 두었는데, 병이 돌아오면서 그 수가
     * 막혔다: UI 패스는 월드가 다 그려진 뒤에 올라가므로 제목이 병 **앞**에
     * 오고, 그러면 병이 글자에 인쇄된 것이 된다. 병을 같이 UI 로 올려도
     * 투과 유리가 제 패스를 잃어 납작해진다.
     *
     * 그래서 제목은 월드에 두고(병이 제대로 가린다) 블룸을 끈다. 잃는 것이
     * 0.5/255 이고 얻는 것이 읽히는 제목이다.
     *
     * 값은 남겨 둔다 — 켜 보는 것이 한 줄이어야 한다.
     */
    bloom: {
      enabled: false,
      threshold: 0.72,
      strength: 0.45,
      radius: 0.6,
    },
  },
};
