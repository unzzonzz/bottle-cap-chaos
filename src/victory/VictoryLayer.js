import { Color, Group, Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import {
  FRAME as SHARED_FRAME,
  frameCamera,
  frameScale,
  halfDiagonal,
  refitFrameCamera,
} from '../core/frame.js';
import { CAP_GROUP } from '../cap/capGeometry.js';
import { FxMaterials } from '../render/FxMaterial.js';
import { ringTexture, trailTexture } from '../render/fxTextures.js';
import { HudMaterials } from '../ui/HudMaterial.js';
import { buttonTexture, notePlateTexture, victoryPlateTexture } from '../ui/hudTextures.js';
import { VICTORY_STAGE, VictoryClock } from './VictoryClock.js';
import { PALETTE, toRgb } from '../core/palette.js';
import { SPACE } from '../core/tokens.js';

/**
 * Who won, as a thing that happens on screen.
 *
 * ── its own overlay scene, and every reason is the same one ─────────────────
 * `HudLayer` argues at length for not sharing the card layer's scene, and every
 * word of it applies here twice over. This one also holds two 3D caps that need
 * a DEPTH BUFFER to sort against each other, which the HUD's ±100 orthographic
 * range and depth-disabled plates cannot give it, and it needs its own snap dial
 * so the winner line can come down without taking the caps smooth with it.
 *
 * The arrangement is `menu/CapWipe`'s, which is the closest existing precedent
 * and is doing the same job: real cap geometry in an orthographic overlay over a
 * fixed virtual 640x480 frame, drawn INSIDE the bound low-resolution target
 * after a depth clear. So the whole sequence takes the identical 4x4 dither
 * lattice, the identical five bits a channel and the identical nearest-neighbour
 * upscale as the board it is covering. There is no branch anywhere that exempts
 * it, and that is the point — a victory screen that looked smoother than the
 * game would read as a different program having taken over.
 *
 * ── it reuses the cap, it does not model a broken one ───────────────────────
 * One `BufferGeometry`, handed in from `main.js` — the SAME object the six caps
 * on the board are drawn from. Nothing here builds a special mesh, nothing here
 * moves a vertex, and nothing here breaks a cap into pieces: it is pressed steel
 * and the answer to being hit is to go over, which is what stage 4 does.
 *
 * ── the artwork is INJECTED ─────────────────────────────────────────────────
 * `teamColors` and `teamTextures` are constructor arguments and `setTeamTexture`
 * is live, because the customiser is coming and the panel a player drew is the
 * thing this screen most obviously has to show. The default is the same
 * placeholder the board uses, so today the two agree; the day they stop agreeing
 * is a day nothing in this file changes. See `capTexture.js` for why a supplied
 * texture also takes the panel's tint to white.
 *
 * ── it is MODAL, and that is an input rule ─────────────────────────────────
 * While it is up it takes every press on the canvas — see `pointerDown`, which
 * returns true unconditionally. `PointerRouter` tests it before the cards and
 * before the HUD, so nothing underneath can be reached: the match is over, there
 * is no shot to take, and a press landing on a card fan that is only still on
 * screen because it has been dimmed would be a press with no meaning.
 */

/** The layout box, in frame pixels. The shared, live one — see core/frame.js. */
export const VICTORY_FRAME = SHARED_FRAME;

// HALF_DIAGONAL is now `halfDiagonal()` from core/frame.js — a function,
// because a frame that can get taller has a diagonal that can get longer.
// Held as a constant, the losing cap vanished while still on screen.

/**
 * How much the full-frame quads overhang the frame, in frame pixels.
 *
 * The vertex snap moves every corner by up to half a low-res pixel and it is
 * free to move one INWARD, which on the dimming quad would leave a bright line
 * down one edge of the screen and on the flash quad would leave an unlit strip.
 * `CapWipe.coverSafety` exists for exactly this and this is the flat-quad
 * version of it.
 */
const OVERHANG = 6;

/** The winner line's plate, in frame pixels. Big — see `victoryPlateTexture`. */
const PLATE = { width: 340, height: 72 };

/**
 * One line of explanation under the winner, when the mode has one.
 *
 * ── it exists because "who won" is not always the whole answer ──────────────
 * Knockout and football never need it: you won because the other side ran out
 * of caps, or because the score says 3–1, and both of those are already on
 * screen. Curling can end 2–2 and be decided on which team owns the cap nearest
 * the middle of the house, and a player who cannot see that will read the result
 * as arbitrary — so "타이브레이커가 발동했다는 걸 결과 화면에 표시해라" is a
 * requirement, not a nicety.
 *
 * The SAME plate the in-game note line uses, deliberately. It is one more thing
 * the player has already learned to read, it goes through the same thresholding
 * and the same cache, and it sizes itself to its text — so a mode that has
 * nothing to say simply does not pass one and nothing is drawn.
 */
const NOTE_HEIGHT = 24;
/** Frame pixels between the winner line and the note under it. */
const NOTE_GAP = 10;

/**
 * The buttons, in the existing UI's style and sized to their own labels.
 *
 * Not one shared width. `buttonTexture` left-aligns its label at a fixed inset,
 * exactly as the in-game buttons do, so a 재시작 padded out to the width of
 * 메뉴로 나가기 would be three glyphs adrift in a box — the plate has to be as
 * wide as what it says, which is the same conclusion `notePlateTexture` reached.
 */
const BUTTONS = [
  { id: 'restart', label: '재시작', width: 120, height: 40 },
  { id: 'exit', label: '메뉴로 나가기', width: 192, height: 40 },
];
/** Frame pixels between the two plates. */
const BUTTON_GAP = 18;

/**
 * Texels for the two sprites, fixed rather than on a slider.
 *
 * Bigger than the card effects' 32, and for the reason `fxTextures` gives in its
 * header: draw at roughly the size the sprite will occupy. A card ring is a few
 * dozen screen pixels across; the impact ring here is three hundred, and a
 * 32-texel image stretched that far stops reading as four hard bands and starts
 * reading as four hard SQUARES.
 */
const RING_TEXELS = 64;
const TRAIL_TEXELS = 48;

/**
 * When the winner line and each button come in, as fractions of stage 5.
 *
 * Overlapping rather than strictly sequential: the brief asks for them not to
 * arrive together, which is about the READING order, and three things that hard-
 * cut in turn reads as three separate events. Each starts while the one before
 * it is still arriving, so it is one movement with an order to it.
 */
const TEXT_IN = [0.0, 0.45];
const RESTART_IN = [0.3, 0.75];
const EXIT_IN = [0.55, 1.0];

/**
 * How much of stage 4 the winner spends running out of momentum.
 *
 * The rest of it is the spring. Two parts rather than one integration seeded
 * with the charge velocity, because the charge is fast — better than two
 * thousand frame pixels a second at the default — and a spring handed that lands
 * the cap somewhere off screen before it ever turns round. So the carry is a
 * scripted deceleration to a dead stop at `overshoot`, and the spring takes over
 * from rest: `springStiffness` and `springDamping` then describe the settle they
 * are named after instead of fighting an initial condition.
 */
const CARRY_FRACTION = 0.32;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

/** 0 before `from`, 1 after `to`, smoothly between. */
function window01(x, [from, to]) {
  return smoothstep((x - from) / Math.max(1e-4, to - from));
}

/**
 * One cap in the sequence: nested groups, because each turn is about a different
 * frame and an Euler triple cannot say that.
 *
 * The nesting is `CapWipe`'s reasoning applied to a different set of turns:
 *
 *   holder    where it is on the frame, and how big
 *   ground    the lean of the ground it is lying on — see `_applyTilt`
 *   axis      orients the flip's axis, in the GROUND's frame
 *   flip      end over end about that axis — this is the loser going over
 *
 * The mesh's own quarter turn is the last link and it is what puts the panel
 * face-on: the cap is built +y up through the panel and this camera looks down
 * -z. The z offset after it parks the cap's mid-height on the shared origin,
 * because that origin is what `flip` rotates about — left at the hem, which is
 * where `capGeometry` puts it, a half turn would swing the cap around a point
 * underneath itself instead of turning it over.
 *
 * ── there is no spin group any more ────────────────────────────────────────
 * A cap turning about its own normal was the first thing here and it is gone:
 * against artwork with an orientation mark it reads as the cap being spun by
 * hand rather than lying somewhere, and it fought the one rotation that has to
 * be legible — the loser going over. The float in stage 1 is what keeps the wait
 * from being static.
 *
 * ── `ground` sits ABOVE the flip, and that is the whole point ──────────────
 * The lean has to be a fact about the SCENE, not about each animation: the same
 * angle while the loser waits, while the winner crosses, while the loser goes
 * over and is pushed out, and while the winner settles. Putting it above `flip`
 * means the tumble happens IN the leaned frame — a cap going over on sloped
 * ground — instead of the lean being something the tumble carries around with it
 * and inverts halfway through.
 */
class CapActor {
  /** @param {import('three').BufferGeometry} geometry */
  constructor(geometry) {
    this.holder = new Group();
    this.ground = new Group();
    this.axis = new Group();
    this.flip = new Group();
    this.mesh = new Mesh(geometry, null);
    this.mesh.rotation.x = Math.PI / 2;
    this.mesh.position.z = -(geometry.userData.height ?? 0) * 0.5;
    this.flip.add(this.mesh);
    this.axis.add(this.flip);
    this.ground.add(this.axis);
    this.holder.add(this.ground);
    this.holder.visible = false;
  }

  reset() {
    this.holder.position.set(0, 0, 0);
    this.holder.visible = false;
    this.axis.rotation.z = 0;
    this.flip.rotation.x = 0;
  }
}

export class VictoryLayer {
  /**
   * @param {HTMLCanvasElement} canvas  for mapping pointer coordinates
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {import('three').BufferGeometry} capGeometry  the board's own cap
   * @param {import('three').Vector2} resolution  the low-res target's size
   * @param {string[]} teamColors
   * @param {import('three').Texture} panelTexture  the default panel artwork
   * @param {(import('three').Texture|null)[]} [teamTextures]  per-team override
   * @param {() => void} onRestart
   * @param {() => void} onExit
   */
  constructor({
    canvas,
    config,
    retro,
    capGeometry,
    resolution,
    teamColors,
    panelTexture,
    teamTextures = [],
    onRestart,
    outcomeFor = null,
    onExit,
  }) {
    this.canvas = canvas;
    this.config = config;
    this.teamColors = teamColors;
    this.onRestart = onRestart ?? (() => {});
    /** @type {((winner: number) => string|null)|null} */
    this.outcomeFor = outcomeFor;
    this.onExit = onExit ?? (() => {});

    this.clock = new VictoryClock({ tuning: config.victory });

    this.scene = new Scene();
    /**
     * Depth range in the thousands, and the camera pulled back off the origin.
     *
     * ±100 would be the HUD's and it is not enough: a 3.2-unit cap at the
     * default scale is thirty frame pixels deep and sits at a z of forty, which
     * fits — but the range also has to survive the scale being dragged, and the
     * cost of asking for more of a range nothing else is competing for is zero.
     * The camera is off the origin so `cameraPosition` in the shared vertex
     * shader is a real point: at the origin the view vector through a cap
     * sitting on z = 0 is degenerate and the gloss term goes to noise.
     */
    this.camera = frameCamera({ near: -3000, far: 3000, z: 1000 });

    this.uiMaterials = new HudMaterials({ resolution });
    this.fxMaterials = new FxMaterials({ resolution });

    /** One quad for everything flat. Disposed once, at the end. */
    this._quad = new PlaneGeometry(1, 1);

    // ── the darkened game, and the inversion over the top of it ─────────────
    /**
     * 어두워진 판.
     *
     * 순수한 검정이었다. 어두운 UI 위에서는 맞았지만 밝은 유리 위에서 같은 일을
     * 하면 뒤가 **없어진다** — 실측해 보니 나무판과 뚜껑 여섯 개가 전부 사라지고
     * 갈색 얼룩만 남았다. 승리 화면은 방금 무슨 일이 있었는지 보여 주는 화면이므로
     * 판이 보여야 한다.
     *
     * 팔레트의 깊은 파랑이다. `ModalLayer` 의 가림막과 같은 잉크이고 같은 이유다 —
     * 이 프로젝트에 순수한 검정은 없다(팔레트 감사 규칙 1).
     */
    this.dim = new Mesh(this._quad, this.uiMaterials.createSolid(0));
    const dimRgb = toRgb(PALETTE.accent.skyDeep).map((v) => v / 255);
    this.dim.material.uniforms.uTint.value.set(dimRgb[0], dimRgb[1], dimRgb[2]);
    this.dim.scale.set(VICTORY_FRAME.width + OVERHANG * 2, VICTORY_FRAME.height + OVERHANG * 2, 1);
    this.dim.renderOrder = -50;
    this.dim.visible = false;
    this.scene.add(this.dim);

    /**
     * 충격의 플래시. 뚜껑도 글자도 어두워진 판도 전부 덮고, 맨 마지막에.
     *
     * ── 색 반전이 아니라 흰 플래시인 이유 ──────────────────────────────────
     * 예전에는 `createInvert` 였다. 강타 카드가 쓰는 것과 **같은** 블렌드 —
     * `src * (1 - dst)`, src 는 흰색 — 라는 것이 그 선택의 근거였고, 화면이 거의
     * 검던 시절에는 옳았다.
     *
     * 지금은 틀렸다. 이 화면의 대부분은 흰 유리판과 밝은 하늘이고, 반전하면
     * **어두워진다**. 번쩍이는 것이 아니라 잠깐 정전된 것처럼 보인다. 실제로
     * 지시서가 이 플래시를 다시 설계하라고 지목한 것이 그 이유다.
     *
     * 흰 quad 는 어느 팔레트에서나 같은 방향으로 작동한다. 알파는 1 이 아니라
     * `victory.flashStrength` 인데, 완전히 흰 프레임 세 장은 이 화면에서 유일하게
     * 아픈 것이기 때문이다 — 아래가 비쳐야 무엇이 번쩍였는지 보인다.
     */
    this.flash = new Mesh(this._quad, this.uiMaterials.createSolid(0));
    this.flash.material.uniforms.uTint.value.set(1, 1, 1);
    this.flash.scale.copy(this.dim.scale);
    this.flash.renderOrder = 1000;
    this.flash.visible = false;
    this.scene.add(this.flash);

    /**
     * Everything the shake moves.
     *
     * The caps, the hit ring and the trail — and deliberately NOT the
     * dimming quad, which has to stay still or its overhang stops covering the
     * frame, nor the type, which is not on screen yet when the shake happens.
     */
    this.content = new Group();
    this.scene.add(this.content);

    // ── the two caps ────────────────────────────────────────────────────────
    this._capMaterials = this._buildCapMaterials(retro, panelTexture, teamTextures);
    this.winner = new CapActor(capGeometry);
    this.loser = new CapActor(capGeometry);
    /**
     * The winner in front, said twice on purpose.
     *
     * A real depth offset, because these are the only depth-tested things in the
     * scene and the hit is the one moment they overlap — so which is nearer has
     * to be a fact about where they are, not about paint order. AND an explicit
     * `renderOrder`, so the answer does not rest on how the transparent list
     * happens to break a tie: at equal `renderOrder` it sorts back to front by
     * projected z, which would in fact give the right answer here, and relying on
     * that is how the wrong one arrives the first time a z is nudged.
     */
    this._winnerZ = 40;
    this._loserZ = 0;
    this.loser.mesh.renderOrder = 0;
    this.winner.mesh.renderOrder = 5;
    this.content.add(this.loser.holder, this.winner.holder);

    /**
     * ── there is no glow under the winner ─────────────────────────────────
     * There was: three concentric additive bands, palette-cycled off the winning
     * team's colour. On screen it did not read as light under the cap, it read as
     * a hoop lying around it — the outermost band landed just outside the cap's
     * own silhouette, so the settled winner had a ring beside it at all times.
     * Removed rather than retuned: any additive sprite big enough to be seen
     * around a cap of this size is a ring, and a small one is a smudge.
     *
     * The expanding hit ring below stays. It is a different thing — one event,
     * under half a second, at the point of contact, and it now lies flat on the
     * leaned ground with the caps.
     */
    this.ring = new Mesh(this._quad, this.fxMaterials.create(ringTexture(RING_TEXELS)));
    this.ring.renderOrder = 10;
    this.ring.visible = false;
    this.content.add(this.ring);

    /**
     * The trail: a few stepped discs strung out behind the incoming cap.
     *
     * An AFTERIMAGE, not a blur. The brief rules out motion blur and this is
     * what the era had instead — the same sprite drawn a few times along the
     * path, additively, at falling opacity. It is a handful of hard-edged
     * discs, so there is no gradient anywhere in it.
     */
    this.trail = [];
    for (let i = 0; i < 6; i++) {
      const m = new Mesh(this._quad, this.fxMaterials.create(trailTexture(TRAIL_TEXELS)));
      m.renderOrder = -5;
      m.visible = false;
      this.trail.push(m);
      this.content.add(m);
    }

    // ── the type and the buttons ────────────────────────────────────────────
    this.plate = new Mesh(this._quad, this.uiMaterials.create(null));
    this.plate.renderOrder = 20;
    this.plate.visible = false;
    this.scene.add(this.plate);

    // The explanation under it. Same render order as the winner line — they
    // arrive together and never overlap — and hidden until a mode hands one in.
    this.note = new Mesh(this._quad, this.uiMaterials.create(null));
    this.note.renderOrder = 20;
    this.note.visible = false;
    this.scene.add(this.note);
    /** What the note says, or null. Set by `begin`; drives the plate below. */
    this._note = null;
    this._noteKey = '';

    /** @type {Array<{id: string, label: string, width: number, height: number, plate: Mesh, hit: Mesh}>} */
    this._buttons = BUTTONS.map((spec) => {
      const plate = new Mesh(this._quad, this.uiMaterials.create(null));
      plate.renderOrder = 21;
      plate.visible = false;
      this.scene.add(plate);
      // An oversized invisible quad, raycast against, exactly as `HudLayer`
      // does — the give the brief asks for belongs in the GEOMETRY so the ray
      // result is the answer rather than the start of one.
      const hit = new Mesh(this._quad, this.uiMaterials.createSolid(0.28));
      hit.renderOrder = 25;
      hit.visible = false;
      this.scene.add(hit);
      // `aw`/`ah` 는 저술 크기(640 프레임 기준), `width`/`height` 는 실제 크기다.
      // `layout()` 이 `frameScale()` 을 곱해 후자를 채운다.
      return { ...spec, aw: spec.width, ah: spec.height, plate, hit };
    });

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    /** Which control the pointer is over, or null. */
    this.hovered = null;
    this._pressed = null;
    /**
     * A transition is running off one of the buttons.
     *
     * Set by the host the moment a press is honoured, and it swallows everything
     * after it. Without it, 재시작 pressed twice inside the quarter second the
     * cap takes to cover the screen starts two rebuilds, and the second one runs
     * against a world the first has already thrown away.
     */
    this._busy = false;

    /** Frame pixels of the bottom edge the device owns. See `setSafeInsets`. */
    this._safeBottom = 0;

    /** -1 is a draw. Undefined until `begin`. */
    this.winnerIndex = -1;
    this._draw = false;
    /** Played from the panel rather than by a finished match. See `begin`. */
    this.forced = false;
    /** Frame-pixel unit vector the winner arrives ALONG. Set in `begin`. */
    this._travel = new Vector2(1, 0);
    /** Where the two caps meet, in frame pixels. */
    this._contact = new Vector2();
    /** The winner's live position and velocity, in frame pixels. */
    this._pos = new Vector2();
    this._vel = new Vector2();
    /** Where the carry ends and the spring starts. */
    this._settleFrom = new Vector2();
    /** Scratch, hoisted: this is per-frame code and none of it should allocate. */
    this._scratch = new Vector2();
    /** Seconds since the hit landed. Drives the shake and the ring. */
    this._sinceImpact = 0;
    /** Seconds since the sequence began. Drives the float. */
    this._now = 0;
    /** How far the background has darkened, 0..1 of `bgOpacity`. */
    this._dimShown = 0;
    /** Frames of inversion still owed. Counted DOWN in frames, never in seconds. */
    this._flashLeft = 0;
    /** Four hard entries derived from the winner's colour. Tints the trail. */
    this._palette = [];

    this.layout();
  }

  // ── construction ──────────────────────────────────────────────────────────

  /**
   * One material set per team, in the order `CAP_GROUP` names them.
   *
   * The array has to have an entry for every group the geometry declares. The
   * board's cap is built with the shell on, so there are three of them, and a
   * mesh handed only two silently drops the liner — which is the underside, and
   * the underside is what the loser shows the camera on its way out.
   */
  _buildCapMaterials(retro, panelTexture, teamTextures) {
    this._panelTexture = panelTexture;
    // Shared by both, and not tinted with the cap: a real liner is not painted
    // with the shell. The same value and the same reasoning as `ArenaView`.
    this._linerMaterial = this._sortable(retro.create({ color: PALETTE.metal.liner, gloss: 0.35 }));

    return this.teamColors.map((color, i) => {
      const set = [];
      set[CAP_GROUP.BODY] = this._sortable(retro.create({ color }));
      // ALWAYS created with a map, even when the team has no artwork of its own,
      // because `RetroMaterials.create` compiles the sampler in only if there is
      // one at construction — so a material built mapless could never be handed
      // a custom texture later, however the uniform was set.
      set[CAP_GROUP.PANEL] = this._sortable(retro.create({ map: panelTexture, color }));
      set[CAP_GROUP.LINER] = this._linerMaterial;
      this._applyTeamTexture(set, i, teamTextures[i] ?? null);
      return set;
    });
  }

  /**
   * Put a lit cap material into the same sorting bucket as everything else here.
   *
   * ── this is not cosmetic, and getting it wrong darkens the winner ──────────
   * `renderOrder` is NOT the whole of the sorting in a mixed scene. three.js
   * splits its render list in two and draws every OPAQUE object before every
   * transparent one, sorting by `renderOrder` only WITHIN each half. Every other
   * overlay material in this project is transparent — `HudMaterial`, `FxMaterial`
   * and `CardMaterial` all set the flag — so the rule has never had to be stated
   * before. `RetroMaterials.create` does not: it is the game's lit surface shader
   * and it writes `vec4(c, 1.0)`.
   *
   * So with the caps left opaque, the dimming veil at `renderOrder -50` would be
   * drawn AFTER them and composite 72% black over the two caps the screen exists
   * to show; the trail, which belongs behind the winner, would be drawn in
   * front of it.
   *
   * Setting the flag costs nothing at the pixel: the shader's alpha is 1, so
   * normal blending resolves to `src` exactly as an opaque draw does, and
   * `depthTest`/`depthWrite` are untouched — the two caps still sort against each
   * other in the depth buffer, which is what makes the hit read as one passing in
   * front of the other. It only moves them into the bucket where the explicit
   * `renderOrder` values below are honoured.
   *
   * These are this layer's OWN materials. `ArenaView`'s are never touched.
   */
  _sortable(material) {
    material.transparent = true;
    return material;
  }

  /**
   * Point one team's panel at its own artwork, or back at the placeholder.
   *
   * The tint goes to white with a supplied texture and back to the team colour
   * without one, and that is not a detail: the placeholder is near-greyscale
   * precisely so it can be multiplied by the cap's colour, and a player's own
   * full-colour panel multiplied by a mid red as well would come out nearly
   * black. `capTexture.js` states the contract and `CapWipe` makes the same
   * distinction for the logo it carries.
   */
  _applyTeamTexture(set, team, texture) {
    const panel = set[CAP_GROUP.PANEL];
    panel.map = texture ?? this._panelTexture;
    // Swapping a map on a standard material can change the shader program — a
    // null map compiles without `USE_MAP` — so the flag is not optional here the
    // way it was with one hand-written shader that always sampled.
    panel.needsUpdate = true;
    panel.color.set(texture ? PALETTE.untinted : this.teamColors[team]);
  }

  /** Live, for when the customiser lands. Null puts the placeholder back. */
  setTeamTexture(team, texture) {
    const set = this._capMaterials[team];
    if (!set) return;
    this._applyTeamTexture(set, team, texture ?? null);
  }

  setResolution(resolution) {
    this.uiMaterials.setResolution(resolution);
    this.fxMaterials.setResolution(resolution);
    // Same as the HUD: a frame that changed shape needs the ortho box refitted
    // and everything anchored to an edge placed again.
    if (refitFrameCamera(this.camera)) this.layout();
  }

  /**
   * Lift the button row clear of a home indicator.
   *
   * The row is the only thing in this layer near an edge — the winner plate sits
   * at y = -110, well inside — and it had 30 frame pixels of clearance, which is
   * not quite enough: a landscape iPhone's indicator strip is about 26 of them,
   * so the hit quads finished 4 pixels above a region the OS treats as its own.
   * `max` rather than `+` because the existing clearance already covers most of
   * the inset; adding would push 재시작 and 나가기 visibly up the screen on a
   * phone for no reason a player could see.
   *
   * @param {{top:number,right:number,bottom:number,left:number}} insets frame px
   */
  setSafeInsets(insets) {
    const bottom = Math.max(0, insets?.bottom ?? 0);
    if (bottom === this._safeBottom) return;
    this._safeBottom = bottom;
    this.layout();
  }

  /**
   * Place the type and the buttons against the frame.
   *
   * Called on construction and whenever the panel moves an offset — never per
   * frame, because none of it depends on time. The caps are NOT here: where they
   * are is the whole of what the sequence animates.
   */
  layout() {
    const c = this.config.victory;

    /**
     * ── 판 크기와 자리는 프레임에서 나온다 ────────────────────────────────
     * `PLATE` 는 340x72 이고 `victory.textY` 는 -110, `buttonY` 는 -178 이다. 전부
     * 640x480 기준이라 421x316 프레임에서는 승리 판과 버튼 줄이 서로 겹쳤다 —
     * 실측: 판의 아래 가장자리가 -146, 버튼 줄의 위 가장자리가 -162 인데 프레임
     * 바닥이 -158 이라 둘 다 화면 밖으로 밀려 나가며 만났다.
     *
     * `victory.textY` / `buttonY` 는 패널이 움직이는 값이므로 없애지 않고 **배수를
     * 곱한다**. 패널에서 -110 을 -90 으로 바꾸면 어느 프레임에서나 그만큼 위로
     * 간다는 관계가 유지된다.
     */
    const k = frameScale();
    this._plateSize = {
      width: Math.round(Math.min(PLATE.width * k, VICTORY_FRAME.width - SPACE.md * 2)),
      height: Math.round(PLATE.height * k),
    };
    this.plate.scale.set(this._plateSize.width, this._plateSize.height, 1);
    this.plate.position.set(0, c.textY * k, 0);

    const pad = Math.max(0, c.hitMargin);
    /**
     * The row's floor: the lowest the HIT quad may reach, not the plate.
     *
     * The quad is what the OS competes with, and it hangs `hitMargin` below the
     * plate — so the constraint is written against the quad and the plate's
     * position is derived back from it. See `setSafeInsets`.
     */
    const floor = -VICTORY_FRAME.height / 2 + (this._safeBottom ?? 0);
    /**
     * 버튼 크기도 프레임을 따라간다. 폭에는 프레임 상한이 걸린다 — 두 버튼과
     * 간격을 합치면 저술 폭에서 330 이고, 421 프레임에서 그대로 두면 79% 다.
     */
    const room = VICTORY_FRAME.width - SPACE.md * 2 - BUTTON_GAP * (this._buttons.length - 1);
    const authored = this._buttons.reduce((sum, b) => sum + b.aw, 0);
    const wFit = Math.min(k, room / Math.max(1, authored));
    for (const b of this._buttons) {
      b.width = Math.round(b.aw * wFit);
      b.height = Math.round(b.ah * k);
    }
    const tallest = this._buttons.reduce((m, b) => Math.max(m, b.height), 0);
    const buttonY = Math.max(c.buttonY * k, floor + pad + tallest / 2);

    const total =
      this._buttons.reduce((sum, b) => sum + b.width, 0) + BUTTON_GAP * (this._buttons.length - 1);
    let x = -total / 2;
    for (const b of this._buttons) {
      b.plate.scale.set(b.width, b.height, 1);
      b.plate.position.set(x + b.width / 2, buttonY, 0);
      x += b.width + BUTTON_GAP;

      b.hit.scale.set(b.width + pad * 2, b.height + pad * 2, 1);
      b.hit.position.copy(b.plate.position);
    }
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  get active() {
    return this.clock.running;
  }

  /** True once the animation is over and the buttons will answer a press. */
  get interactive() {
    return this.clock.done && !this._busy;
  }

  /**
   * Whether a transition has already been started off one of the buttons.
   *
   * Read by the host before it starts another one. The layer swallows presses on
   * its own once this is set — see `pointerDown` — but the two buttons hand out
   * work that only the host can refuse twice: a second fade would attach a second
   * veil and navigate again.
   */
  get busy() {
    return this._busy;
  }

  get stage() {
    return this.clock.stage;
  }

  /**
   * Play the sequence.
   *
   * @param {number} winner  0 or 1. Anything else — including the `undefined`
   *   `Match` leaves behind when a match ends because nobody can shoot — is a
   *   draw, and a draw has no loser to hit, so stages 1 to 4 have nothing to
   *   say. It goes straight to the screen with the result on it. The game's own
   *   judging is not touched to make this neater: `-1` really is what
   *   `KnockoutRules` reports when both sides clear, and reading `undefined` the
   *   same way is this file being defensive about a state it does not own.
   * @param {boolean} [forced]
   *   Played from the panel, over a match that has not finished. It is the ONLY
   *   difference this flag makes, and it is about who is allowed to take the
   *   screen away again: the loop puts an unforced sequence away the moment the
   *   match stops being over, which is what keeps the determinism replay button
   *   — `Match.replayLastTurn` sets the state back to AIM and leaves `winner`
   *   exactly where it was — from leaving a modal screen up over a live match.
   *   A forced one is the panel's, and only the panel takes it down.
   */
  /**
   * @param {string|null} [note]
   *   One line under the winner, from the mode's own verdict — see `NOTE_HEIGHT`
   *   and `RuleSet.resolveTurn`'s `resultNote`. Omitted by the two modes whose
   *   result needs no explaining, and their screen is byte for byte what it was.
   */
  begin(winner, { forced = false, note = null } = {}) {
    const valid = winner === 0 || winner === 1;
    this.winnerIndex = valid ? winner : -1;
    this._draw = !valid;
    this.forced = forced;
    this._note = note || null;

    this._now = 0;
    this._sinceImpact = 0;
    this._flashLeft = 0;
    this._dimShown = 0;
    this._vel.set(0, 0);
    this.hovered = null;
    this._pressed = null;
    this._busy = false;

    this.winner.reset();
    this.loser.reset();

    if (!this._draw) {
      this.winner.mesh.material = this._capMaterials[this.winnerIndex];
      this.loser.mesh.material = this._capMaterials[1 - this.winnerIndex];
      this._palette = this._buildPalette(this.teamColors[this.winnerIndex]);
    } else {
      this._palette = this._buildPalette(PALETTE.neutral);
    }

    const c = this.config.victory;
    // The bearing it comes FROM, so the hit direction is the other way.
    const a = (c.enterAngleDeg * Math.PI) / 180;
    const from = new Vector2(Math.cos(a), Math.sin(a));
    this._travel.copy(from).multiplyScalar(-1);
    /**
     * Where it stops: short of the middle by rather more than a cap radius, so
     * the two overlap when they meet.
     *
     * Derived from the cap's own drawn size rather than given a slider of its
     * own. It is not a look to be tuned — it is the geometric fact that two
     * caps in contact are one diameter apart at their centres, softened a
     * little because two caps that merely TOUCH read as a near miss.
     */
    const contactOffset = c.capScale * 1.35;
    this._contact.set(from.x * contactOffset, c.capY + from.y * contactOffset);

    this.clock.begin();
    if (this._draw) this.clock.jumpTo(VICTORY_STAGE.UI);
    this._syncToStage(0);
  }

  /** Straight to the pressable screen. Every animated value lands on its end. */
  skip() {
    if (!this.clock.skip()) return false;
    // Long enough that every envelope below is saturated, without pretending
    // real time passed: nothing integrates against `_now` except the float and
    // the palette cycle, and both are periodic.
    this._sinceImpact = Math.max(
      this.config.victory.shakeSeconds,
      this.config.victory.ringSeconds,
    ) + 1;
    this._flashLeft = 0;
    this._syncToStage(0);
    return true;
  }

  /** Off screen, and back to knowing nothing. For a restart or a mode change. */
  dismiss() {
    this.clock.reset();
    this._busy = false;
    this.forced = false;
    this.hovered = null;
    this._pressed = null;
    this.winner.reset();
    this.loser.reset();
    this.dim.visible = false;
    this.flash.visible = false;
    this.ring.visible = false;
    this.plate.visible = false;
    this.note.visible = false;
    this._note = null;
    for (const m of this.trail) m.visible = false;
    for (const b of this._buttons) {
      b.plate.visible = false;
      b.hit.visible = false;
    }
  }

  /** The host has started a transition off one of the buttons. */
  setBusy(on) {
    this._busy = !!on;
    if (on) {
      this.hovered = null;
      this._pressed = null;
    }
  }

  /**
   * Four hard entries out of one team colour. The trail's tint comes from here.
   *
   * DERIVED rather than written down, unlike `CardFx`'s chaos and 강타 palettes,
   * because the afterimage belongs to whoever won and there are two possible
   * answers. Mixing toward white rather than sweeping the hue, for the reason
   * `CHAOS_PALETTE` gives: a rainbow reads as a modern shader effect however few
   * steps it has.
   *
   * Only the first entry is read now — the glow that cycled through all four is
   * gone. Kept as a palette rather than collapsed to one colour because it is
   * four lines and the trail is the obvious place a cycle would go back.
   */
  _buildPalette(hex) {
    const base = new Color(hex);
    return [0.75, 0.35, 0.0, 0.55].map((k) => {
      const c = base.clone();
      return [c.r + (1 - c.r) * k, c.g + (1 - c.g) * k, c.b + (1 - c.b) * k];
    });
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  /** @param {number} dt  render seconds, already clamped by the caller */
  update(dt) {
    if (!this.active) return;

    const ui = this.config.ui;
    // The same dial the rest of the UI is on, so "텍스트만 강도를 낮춘다" is one
    // slider and not a second one that has to be kept in step with it.
    // And the effects are on the effects' dial, for the same reason.

    this._now += dt;

    const before = this.clock.stage;
    this.clock.update(dt);
    if (before !== VICTORY_STAGE.IMPACT && this.clock.stage === VICTORY_STAGE.IMPACT) {
      this._onImpact();
    }
    if (this.clock.atOrPast(VICTORY_STAGE.IMPACT)) this._sinceImpact += dt;

    this._syncToStage(dt);
  }

  /**
   * The leading edge of the hit.
   *
   * The inversion is armed HERE, once, and counted down in frames — never
   * derived from the stage's own progress. `CardFx` has the note on why: a
   * time-based window lands on a different number of frames depending on the
   * frame rate, and at three frames that is the difference between a flash and
   * nothing at all.
   */
  _onImpact() {
    this._sinceImpact = 0;
    this._flashLeft = Math.max(0, Math.round(this.config.victory.flashFrames));
    // Where it stops on the far side, before the spring takes it back.
    const c = this.config.victory;
    this._settleFrom.set(
      this._travel.x * c.overshoot,
      c.capY + this._travel.y * c.overshoot,
    );
  }

  /** Everything the current stage says about where things are. */
  _syncToStage(dt) {
    this._updateDim(dt);
    this._applyTilt();
    this._updateCaps(dt);
    this._updateSprites();
    this._updateShake();
    this._updateType();
    this._updateFlash();
    this._refreshTextures();
  }

  /**
   * Lean the ground the caps are lying on.
   *
   * ── one angle, everything on the ground, nothing on the glass ────────────
   * Dead-on the cap is a disc: 21 flutes in silhouette and a flat face, which is
   * the same picture whether it is the right way up or upside down. Leaning it
   * back until the near skirt shows is what makes it read as a pressed metal
   * object lying on something rather than as a sprite.
   *
   * Applied per OBJECT — each cap's own `ground` group, and the flat sprites'
   * own rotation — rather than by leaning one parent group over all of them.
   * Leaning a parent also rotates its children's POSITIONS, and the caps carry a
   * depth offset so the winner occludes the loser at the hit: at 24 degrees the
   * winner's 40 units of z would have dragged it 16 frame pixels down the screen
   * relative to the loser, so two caps meant to be meeting edge to edge would
   * have met at a visible step. Rotating each object in place keeps the layout
   * exactly as laid out and still leans everything by the same angle.
   *
   * And it is the same angle in every stage BY CONSTRUCTION rather than by four
   * call sites agreeing: it is written once, here, every frame, above the flip —
   * so the loser going over and being pushed out is a cap tumbling on sloped
   * ground, not a cap whose slope inverts halfway through the tumble.
   *
   * ── the type and the buttons are not on the ground ──────────────────────
   * They are direct children of the scene, never of `content`, and nothing here
   * touches them. A leaned readout is an unreadable one, which is the whole of
   * the rule the rest of the UI already follows — see `HudMaterial`'s note on why
   * the HUD is unlit and dead flat. The dimming veil and the inversion quad stay
   * square for a harder reason: both have to cover the frame exactly, and a
   * leaned full-frame quad does not.
   */
  _applyTilt() {
    /**
     * NEGATIVE, and the sign is the whole of whether this works.
     *
     * The mesh's own quarter turn has already sent the panel's normal to +z, at
     * the camera. A POSITIVE rotation about x then takes it to (0, -sin, cos) —
     * pointing DOWN and at the camera, which lifts the cap's far edge and shows
     * the skirt along the TOP of the silhouette. That is a cap tipped toward the
     * viewer, and on screen it reads as the cap falling over forwards.
     *
     * Negating sends it to (0, +sin, cos): up and at the camera, near edge
     * dropped, so the skirt and the hem's flare show along the BOTTOM — which is
     * what a cap lying on ground that leans away from you actually looks like.
     * `groundTiltDeg` stays a plain positive "lean back by this much" on the
     * panel; the sign lives here, once, with the reason.
     */
    const rad = -(this.config.victory.groundTiltDeg * Math.PI) / 180;
    this.winner.ground.rotation.x = rad;
    this.loser.ground.rotation.x = rad;
    // The hit ring lies ON the ground, so it leans with it and reads as a ring
    // on a slope rather than as a hoop standing up in front of the caps.
    this.ring.rotation.x = rad;
    for (const m of this.trail) m.rotation.x = rad;
  }

  _updateDim(dt) {
    const c = this.config.victory;
    const target = Math.min(1, Math.max(0, c.bgOpacity));
    if (this.clock.done && dt === 0) {
      // A skip lands on the darkened frame rather than fading from where it was.
      this._dimShown = target;
    } else {
      const rate = dt / Math.max(0.02, c.bgFadeSeconds);
      this._dimShown = Math.min(target, this._dimShown + rate * target);
    }
    this.dim.material.uniforms.uOpacity.value = this._dimShown;
    this.dim.visible = this._dimShown > 0.004;
  }

  _updateCaps(dt) {
    if (this._draw) return;
    const c = this.config.victory;
    const stage = this.clock.stage;
    const TAU = Math.PI * 2;

    this.winner.holder.scale.setScalar(c.capScale);
    this.loser.holder.scale.setScalar(c.capScale);

    // ── the loser ─────────────────────────────────────────────────────────
    if (!this.clock.atOrPast(VICTORY_STAGE.RESULT)) {
      // Stages 1 to 3: on the middle, floating, turning slowly. Not still —
      // a cap parked dead centre and motionless reads as a paused game.
      const bob = Math.sin(this._now * c.floatHz * TAU) * c.floatAmount;
      const swayed = Math.cos(this._now * c.floatHz * TAU * 0.71) * c.floatAmount * 0.35;
      // Scaled in over the front of stage 1 rather than faded: `RetroMaterial`
      // writes an opaque alpha by construction — it is the game's lit surface
      // shader and has no opacity term — so there is nothing here to fade.
      const rise = stage === VICTORY_STAGE.ENTER ? smoothstep(this.clock.t / 0.4) : 1;
      this.loser.holder.position.set(swayed, c.capY + bob, this._loserZ);
      this.loser.holder.scale.setScalar(c.capScale * (0.86 + 0.14 * rise));
      this.loser.flip.rotation.x = 0;
      this.loser.holder.visible = true;
    } else {
      // Stage 4: over and out, at the same time. Sequencing them would take
      // twice as long and read as two separate events happening to one cap.
      const t = this._sinceImpact;
      const travelled = t * Math.max(0, c.exitSpeed);
      // A half turn and no more: face down is the statement, and a cap still
      // rolling past it would be a cap that had not landed on an answer.
      const flip = Math.min(Math.PI, t * Math.max(0, c.flipSpeedTurns) * TAU);
      // The flip axis lies across the flight path, so it goes end over end
      // along it rather than cartwheeling about the direction it is travelling.
      this.loser.axis.rotation.z = Math.atan2(this._travel.y, this._travel.x) + Math.PI / 2;
      this.loser.flip.rotation.x = flip;
      this.loser.holder.position.set(
        this._contact.x + this._travel.x * travelled,
        this._contact.y + this._travel.y * travelled,
        this._loserZ,
      );
      /**
       * Gone means gone.
       *
       * Hidden once its own drawn radius has cleared the frame's far corner, so
       * "화면에 남지 않는다" is a measured fact rather than a hope about the
       * speed slider. The `atOrPast(UI)` half is the backstop for the speed
       * being dragged to nothing: by the time the buttons are coming up the
       * loser is out of the story whatever the number says.
       */
      const reach = halfDiagonal() + c.capScale * 1.7;
      const dist = Math.hypot(this.loser.holder.position.x, this.loser.holder.position.y);
      this.loser.holder.visible = dist < reach && !this.clock.atOrPast(VICTORY_STAGE.UI);
    }

    // ── the winner ────────────────────────────────────────────────────────
    if (stage === VICTORY_STAGE.ENTER) {
      this.winner.holder.visible = false;
      return;
    }

    if (stage === VICTORY_STAGE.CHARGE) {
      // Off the frame, on the far side of the bearing it comes from.
      const start = this._scratch.set(
        -this._travel.x * c.enterDistance,
        c.capY - this._travel.y * c.enterDistance,
      );
      // Accelerating, not linear: it is being thrown, and a constant speed
      // across the frame reads as a slide.
      const k = Math.pow(this.clock.t, 1.55);
      this._pos.set(
        start.x + (this._contact.x - start.x) * k,
        start.y + (this._contact.y - start.y) * k,
      );
      this.winner.holder.position.set(this._pos.x, this._pos.y, this._winnerZ);
      this.winner.holder.visible = true;
      return;
    }

    if (stage === VICTORY_STAGE.IMPACT) {
      // Held at the contact point for the two to four frames the hit lasts. The
      // shake and the inversion are what move on those frames; the cap that
      // caused them stops dead, which is what selling a hit is.
      this.winner.holder.position.set(this._contact.x, this._contact.y, this._winnerZ);
      this.winner.holder.visible = true;
      return;
    }

    // Stage 4 onward: carry, then spring, then hold.
    const carry = Math.max(0.02, c.resultSeconds * CARRY_FRACTION);
    if (this._sinceImpact < carry) {
      // Decelerating to a dead stop at the overshoot — momentum running out.
      const k = 1 - Math.pow(1 - this._sinceImpact / carry, 2);
      this._pos.set(
        this._contact.x + (this._settleFrom.x - this._contact.x) * k,
        this._contact.y + (this._settleFrom.y - this._contact.y) * k,
      );
      this._vel.set(0, 0);
    } else {
      /**
       * A real spring, integrated, so the two sliders mean what they are named.
       *
       * Semi-implicit Euler at up to 50 ms a step is stable for the range the
       * panel offers, and the step is already clamped by the caller for the same
       * reason every other clock here is. Started from rest at the overshoot, so
       * `springStiffness` sets how quickly it comes back and `springDamping` how
       * much of the return it gives back on the other side.
       */
      const k = Math.max(0, c.springStiffness);
      const damp = Math.max(0, c.springDamping);
      const dx = this._pos.x - 0;
      const dy = this._pos.y - c.capY;
      this._vel.x += (-k * dx - damp * this._vel.x) * dt;
      this._vel.y += (-k * dy - damp * this._vel.y) * dt;
      this._pos.x += this._vel.x * dt;
      this._pos.y += this._vel.y * dt;
      if (dt === 0 && this.clock.done) {
        // A skip lands it home rather than wherever the spring happened to be.
        this._pos.set(0, c.capY);
        this._vel.set(0, 0);
      }
    }
    this.winner.holder.position.set(this._pos.x, this._pos.y, this._winnerZ);
    this.winner.holder.visible = true;
  }

  _updateSprites() {
    const c = this.config.victory;

    /**
     * ── the impact ring ───────────────────────────────────────────────────
     * Expanding, because something is LEAVING the point of contact — the same
     * reading `CardFx` spells out for the swap's rings, and the reason 강타's
     * contracts instead.
     *
     * `!this._draw` is load-bearing and was missing. A draw JUMPS to stage 5, so
     * `atOrPast(IMPACT)` is true for it — the stage is past impact without ever
     * having been impact — and `_sinceImpact` starts counting the moment it is.
     * The result was a ring expanding out of a contact point on a screen with no
     * caps on it and nothing that had hit anything.
     */
    if (!this._draw && this.clock.atOrPast(VICTORY_STAGE.IMPACT)) {
      const k = this._sinceImpact / Math.max(0.02, c.ringSeconds);
      if (k >= 1) {
        this.ring.visible = false;
      } else {
        // Halfway between the two centres — where the metal actually met.
        this.ring.position.set(
          this._contact.x * 0.5,
          (this._contact.y + c.capY) * 0.5,
          this._winnerZ + 20,
        );
        this.ring.scale.setScalar(c.ringStart + (c.ringEnd - c.ringStart) * smoothstep(k));
        this.ring.material.uniforms.uTint.value.set(1, 1, 1);
        // Stepped to five levels. A smooth fade on an additive sprite is a
        // gradient by another name, and the quantiser downstream would band it
        // anyway — so the bands are chosen rather than inherited.
        this.ring.material.uniforms.uOpacity.value = Math.ceil((1 - k) * 5) / 5;
        this.ring.visible = true;
      }
    } else {
      this.ring.visible = false;
    }

    // ── the trail ─────────────────────────────────────────────────────────
    const charging = this.clock.stage === VICTORY_STAGE.CHARGE && !this._draw;
    const n = charging ? Math.min(this.trail.length, Math.max(0, Math.round(c.trailCount))) : 0;
    const tint = this._palette[0] ?? [1, 1, 1];
    for (let i = 0; i < this.trail.length; i++) {
      const m = this.trail[i];
      if (i >= n) {
        m.visible = false;
        continue;
      }
      const back = c.trailSpacing * (i + 1);
      m.position.set(
        this._pos.x - this._travel.x * back,
        this._pos.y - this._travel.y * back,
        this._winnerZ - 10,
      );
      m.scale.setScalar(Math.max(1, c.trailSize) * (1 - (i + 1) / (n + 1.5)));
      m.material.uniforms.uTint.value.set(tint[0], tint[1], tint[2]);
      // Also stepped, and it fades in over the charge so the streak grows
      // behind the cap rather than being there from the first frame.
      const grow = smoothstep(this.clock.t / 0.35);
      m.material.uniforms.uOpacity.value =
        (Math.ceil((1 - (i + 1) / (n + 1.5)) * 4) / 4) * 0.7 * grow;
      m.visible = true;
    }
  }

  /**
   * One shake, decaying, quantised to whole frame pixels.
   *
   * ── it moves the CONTENT, not the camera ──────────────────────────────────
   * Moving the camera would move the dimming quad with everything else and open
   * a bright gap at the frame's edge — and shaking the GAME's camera instead is
   * not on the table: it carries the player's own pan, zoom and rotation
   * inertia, the brief rules out touching the game's systems, and a shake left
   * in that state after the sequence ends is a camera the next match inherits.
   *
   * Whole pixels because the console had no sub-pixel raster and everything else
   * on screen is being snapped to that grid anyway. A shake interpolated between
   * pixels would be the one smooth motion in the frame.
   */
  _updateShake() {
    const c = this.config.victory;
    const dur = Math.max(0.01, c.shakeSeconds);
    // `!_draw` for the same reason the ring needs it: a draw is past impact
    // without ever having been impact, and nothing hit anything to shake.
    const k =
      !this._draw && this.clock.atOrPast(VICTORY_STAGE.IMPACT)
        ? Math.max(0, 1 - this._sinceImpact / dur)
        : 0;
    if (k <= 0) {
      this.content.position.set(0, 0, 0);
      return;
    }
    // Squared, so it is violent at the front and gone rather than trailing off.
    const a = Math.max(0, c.shakeStrength) * k * k;
    const w = this._sinceImpact * Math.max(0, c.shakeHz) * Math.PI * 2;
    this.content.position.set(
      Math.round(Math.sin(w) * a),
      // A second frequency that does not divide into the first, so it reads as
      // a jolt rather than as a diagonal slide.
      Math.round(Math.cos(w * 1.31) * a * 0.7),
      0,
    );
  }

  _updateType() {
    const c = this.config.victory;
    const inUi = this.clock.atOrPast(VICTORY_STAGE.UI);
    const t = this.clock.done ? 1 : inUi ? this.clock.t : 0;

    const textK = inUi ? window01(t, TEXT_IN) : 0;
    this.plate.material.uniforms.uOpacity.value = textK;
    this.plate.visible = textK > 0.004;
    // One beat on arrival, up and back down over the life of the envelope, so it
    // reads as an entrance rather than as a size that then relaxes. The same
    // shape — and the same slider range — as the score's own change pulse.
    const bump = Math.sin(Math.PI * textK) * Math.max(0, c.textPulseScale);
    /**
     * 박동은 `layout()` 이 푼 크기에 곱한다. 저술 크기가 아니라.
     *
     * `PLATE.width` 를 그대로 쓰면 프레임에 맞춰 줄여 놓은 값이 매 프레임 340 으로
     * 되돌아간다 — `HudLayer._updateScore` 에 있던 것과 같은 결함이고, 같은 이유로
     * 화면에서는 축소가 아예 없던 것처럼 보인다.
     */
    const box = this._plateSize ?? PLATE;
    this.plate.scale.set(box.width * (1 + bump), box.height * (1 + bump), 1);

    // The explanation rides the same envelope and takes NO bump. The beat is the
    // winner line arriving; a second thing pulsing beside it reads as two
    // separate events, which is the same argument the button windows make.
    this.note.material.uniforms.uOpacity.value = textK;
    this.note.visible = !!this._note && textK > 0.004;

    const windows = { restart: RESTART_IN, exit: EXIT_IN };
    for (const b of this._buttons) {
      const k = inUi ? window01(t, windows[b.id] ?? TEXT_IN) : 0;
      // Full weight once it is up. There is no dimming here: the in-game buttons
      // drop to `ui.dimOpacity` so they stop competing with the board, and on
      // this screen there is nothing left for them to compete with.
      b.plate.material.uniforms.uOpacity.value = k;
      b.plate.visible = k > 0.004;
      b.hit.visible = c.showHitAreas && this.interactive;
    }
  }

  _updateFlash() {
    /**
     * 프레임 단위로 세어 내린다. 시간이 아니라 프레임인 이유는 `_onImpact` 에
     * 적혀 있다: 세 프레임짜리 창은 프레임 레이트에 따라 아예 안 보일 수 있다.
     *
     * 남은 프레임 수에 비례해 옅어진다. 세 장 모두 같은 세기면 플래시가 툭 끊기는데,
     * 옅어지면 짧은 잔상이 되어 링이 열리는 동작으로 이어진다.
     */
    const owed = this._flashLeft;
    this.flash.visible = owed > 0;
    if (owed > 0) {
      const total = Math.max(1, Math.round(this.config.victory.flashFrames));
      const k = owed / total;
      this.flash.material.uniforms.uOpacity.value =
        Math.max(0, Math.min(1, this.config.victory.flashStrength)) * k;
      this._flashLeft--;
    }
  }

  /**
   * Re-ask for every plate and sprite, every frame.
   *
   * Deliberately unconditional. Both caches this layer draws out of can be
   * emptied from under it — `HudLayer` calls `clearHudTextureCache` when the UI
   * texture slider moves and the card panel calls `clearFxTextureCache` when the
   * stun texel slider does — and a material still pointing at a disposed texture
   * draws NOTHING, silently, because a freed texture is not an error. Every call
   * here is a keyed cache hit and therefore free; the one frame after a clear it
   * regenerates, which is exactly when it needs to.
   */
  _refreshTextures() {
    const scale = this.config.ui.textureScale;
    const draw = this._draw;
    const color = draw ? PALETTE.neutral : this.teamColors[this.winnerIndex];
    /**
     * "2P 승리" is the right line for two people at one board and the wrong one
     * everywhere else.
     *
     * Against the computer, or online, there is one person at this screen — and
     * telling them their opponent won, in the third person, by seat number, is a
     * scoreboard rather than a result. `outcomeFor` is handed in by `main.js`,
     * which is the only layer that knows which seat the person watching
     * occupies; absent, this is character for character what it always was.
     *
     * The colour is deliberately still the WINNER's. The line arrives with the
     * winning cap and is part of that arrival, so recolouring it would detach
     * the two — a 패배 in your own colour would read as your cap having done
     * something.
     */
    const text = draw ? '무승부' : (this.outcomeFor?.(this.winnerIndex) ?? `${this.winnerIndex + 1}P 승리`);

    // 크기는 `layout()` 이 프레임에서 푼 값이다. `PLATE` 는 저술 크기일 뿐이다.
    this.plate.material.uniforms.uMap.value = victoryPlateTexture(text, color, {
      ...(this._plateSize ?? PLATE),
      scale,
    });

    /**
     * The note, sized to its own text and hung under the winner line.
     *
     * Re-asked every frame like everything else here — see the header — but the
     * SCALE and POSITION are only recomputed when the text changes, because they
     * come out of the texture's `userData` and writing them every frame would be
     * three assignments to prove a string had not changed. `layout()` cannot do
     * it: the width is not known until the text is.
     */
    if (this._note) {
      // `textY` is in the key because the note hangs off it and the panel can
      // drag it: without it, moving the winner line would leave the note behind.
      const noteH = Math.round(NOTE_HEIGHT * frameScale());
      const key = `${this._note}|${scale}|${this.config.victory.textY}|${noteH}`;
      const tex = notePlateTexture(this._note, 'normal', {
        height: noteH,
        scale,
        // Nearly the frame, so a tiebreaker sentence is never truncated. The
        // in-game note's tighter ceiling is about not covering the board; there
        // is no board left to cover here.
        maxWidth: VICTORY_FRAME.width - 48,
      });
      this.note.material.uniforms.uMap.value = tex;
      if (key !== this._noteKey) {
        this._noteKey = key;
        const w = tex.userData?.width ?? 200;
        this.note.scale.set(w, noteH, 1);
        /**
         * ABOVE the winner line, and that is a measurement rather than a taste.
         *
         * Under it is where a footnote belongs and there is no room: at the
         * defaults the winner plate's bottom edge is at −146 and the buttons'
         * top edge is at −158, which is twelve pixels for a twenty-four pixel
         * plate. Above it there are fifty-three, between the plate's top at −74
         * and the settled caps' lower edge at about −21.
         *
         * It reads at least as well there. "동점 2:2 · 타이브레이커" and then
         * "1P 승리" is the reason and then the result, which is the order the
         * player wants them in — the note is not a footnote, it is why.
         */
        const k = frameScale();
        const plateH = this._plateSize?.height ?? PLATE.height;
        this.note.position.set(
          0,
          this.config.victory.textY * k + plateH / 2 + NOTE_GAP * k + noteH / 2,
          0,
        );
      }
    }

    for (const b of this._buttons) {
      b.plate.material.uniforms.uMap.value = buttonTexture(
        b.label,
        this.hovered === b.id ? 'hover' : 'idle',
        { width: b.width, height: b.height, scale },
      );
    }

    this.ring.material.uniforms.uMap.value = ringTexture(RING_TEXELS);
    const trailTex = trailTexture(TRAIL_TEXELS);
    for (const m of this.trail) m.material.uniforms.uMap.value = trailTex;
  }

  // ── drawing ───────────────────────────────────────────────────────────────

  /**
   * Draw it over whatever is already in the bound target.
   *
   * The depth clear is not optional and it is not the caller's: the two caps are
   * depth-tested against each other and must not be sorted against the board
   * behind them — they are in front by definition, not by being nearer.
   * `autoClear` goes off around it so what is underneath survives, and back on
   * afterwards because the next frame's first render expects to be clearing.
   * `CapWipe.render` is the same three lines for the same three reasons.
   *
   * @param {import('three').WebGLRenderer} renderer
   */
  render(renderer) {
    if (!this.active) return;
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /** Which control is under a point, or null. Tested against the hit quads. */
  hitAt(clientX, clientY) {
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;

    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    this.scene.updateMatrixWorld(true);

    const quads = this._buttons.map((b) => b.hit);
    const hits = this._ray.intersectObjects(quads, false);
    if (!hits.length) return null;
    return this._buttons.find((b) => b.hit === hits[0].object)?.id ?? null;
  }

  /**
   * @returns {boolean} true if the screen took the press.
   *
   * Unconditionally true while it is up. That is the modality: the match is
   * over, and a press must not reach a card fan or a 나가기 button that is only
   * still under the pointer because this screen dimmed it rather than removing
   * it. See the header.
   */
  pointerDown(clientX, clientY) {
    if (!this.active) return false;
    if (this._busy) return true;
    // A press during the animation is the skip, and it is ONLY the skip — it
    // does not also arm the button it happened to land on. Pressing through a
    // flourish is asking to see the screen, not to have chosen from it.
    if (!this.clock.done) {
      this.skip();
      return true;
    }
    const id = this.hitAt(clientX, clientY);
    this._pressed = id;
    this.hovered = id;
    return true;
  }

  pointerMove(clientX, clientY) {
    if (!this.active) return false;
    if (this._busy || !this.clock.done) return true;
    const id = this.hitAt(clientX, clientY);
    // While a press is held the hover follows whether it is still ON the control
    // it started on — that is what makes sliding off a cancel.
    this.hovered = this._pressed ? (id === this._pressed ? id : null) : id;
    return true;
  }

  /**
   * Fires on RELEASE over the same control, not on press.
   *
   * The same semantics `HudLayer` gives its own 나가기, and for the same reason:
   * both of these throw the match away and releasing off the button is the way
   * back from a misplaced tap.
   */
  pointerUp(cancelled = false) {
    const id = this._pressed;
    this._pressed = null;
    if (!this.active || this._busy) return false;
    if (!id || cancelled) return false;
    if (this.hovered !== id) return false;
    if (id === 'restart') this.onRestart();
    else if (id === 'exit') this.onExit();
    return true;
  }

  clearHover() {
    this.hovered = null;
  }

  get hovering() {
    return this.hovered !== null;
  }

  /** Whether a press is being held on one of the buttons. For the router's cleanup. */
  get pressing() {
    return this._pressed !== null;
  }

  dispose() {
    this._quad.dispose();
    this.uiMaterials.dispose();
    this.fxMaterials.dispose();
    for (const set of this._capMaterials) for (const m of set) m.dispose();
    this.scene.clear();
  }
}
