import {
  BufferAttribute,
  BufferGeometry,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  PlaneGeometry,
} from 'three';
import { CapSwap } from '../game/cards/CapSwap.js';
import { FxMaterials } from './FxMaterial.js';
import {
  auraTexture,
  dashTexture,
  flashTexture,
  flatTexture,
  frameTexture,
  ringTexture,
  scanTexture,
  stunSheet,
} from './fxTextures.js';
import { PALETTE } from '../core/palette.js';

/**
 * What a card LOOKS like happening.
 *
 * ── two roots, one pipeline ─────────────────────────────────────────────────
 * `world` goes into the game scene and is drawn with the perspective camera:
 * stun stars over caps, rings at the ends of a swap, the line between them.
 * `screen` goes into the CARD scene and is drawn with its orthographic camera:
 * the scanline sweep and the edge flash, which are about the frame rather than
 * about the pitch.
 *
 * Both end up in the same low-resolution render target, before the retro pass —
 * see the note in `CardLayer` — so a stun star gets the identical dither lattice
 * and the identical five bits a channel as the turf under it. There is no branch
 * anywhere that exempts an effect from the chain, and that is the point: an
 * effect that looked smoother than the game would read as a different program
 * running on top of it.
 *
 * ── it runs on the render clock and writes nothing back ─────────────────────
 * Every number in this file is derived from wall-clock seconds and from state it
 * only reads. Nothing here is in the state hash, nothing here can change a shot,
 * and the cap "shake" is a mesh offset applied after the physics transform has
 * been written — the body does not move, the drawing of it does.
 *
 * ── the period techniques, and only those ───────────────────────────────────
 * Billboarded alpha sprites, additive blending, a stepped sprite sheet, palette
 * cycling on a tint uniform, UV scrolling on a tiling dash, and one full-frame
 * band swept once. No bloom, no particle system, no gradient, no blur. All of
 * those exist and all of them would be one line, which is exactly why the rule
 * has to be written down rather than left to taste.
 */

/** Unit quad, centred. Billboards are placed by their middles. */
const QUAD = new PlaneGeometry(1, 1);

/**
 * The chaos palette, cycled through on a stepped timer.
 *
 * A CLUT rotation is what this is imitating, so the entries are few and the
 * steps between them are hard. Cool-to-warm rather than a hue sweep, because a
 * full rainbow reads as a modern shader effect no matter how few steps it has.
 */
const CHAOS_PALETTE = [
  [1.0, 1.0, 1.0],
  [0.72, 0.86, 1.0],
  [0.78, 0.62, 1.0],
  [1.0, 0.74, 0.92],
  [0.72, 0.86, 1.0],
];

/**
 * The 강타 palette. Hotter, and shorter than the chaos one.
 *
 * Four entries against chaos's five, so the two cycles never line up even when
 * both are on screen — an armed cap under 혼란 has both a star and an aura, and
 * two markers pulsing in unison would read as one effect.
 */
const SMASH_PALETTE = [
  [1.0, 0.94, 0.78],
  [1.0, 0.62, 0.26],
  [1.0, 0.36, 0.14],
  [1.0, 0.72, 0.40],
];

const ONEMORE_TINT = [1.0, 0.86, 0.42];

const SWAP_TINT = [0.72, 0.9, 1.0];
const SWAP_LINE_COLOR = PALETTE.fx.swapLine;

/** Rings drawn at both ends of every swapped pair. */
const MAX_SWAP_RINGS = 32;

function smoothstep(x) {
  const t = Math.min(1, Math.max(0, x));
  return t * t * (3 - 2 * t);
}

export class CardFx {
  /**
   * @param {typeof import('../game/config.js').CONFIG} config
   * @param {import('three').Vector2} resolution
   * @param {{width: number, height: number}} frame  the card scene's layout box
   */
  constructor({ config, resolution, frame }) {
    this.config = config;
    this.frame = frame;

    this.materials = new FxMaterials({ resolution });
    this.world = new Group();
    this.screen = new Group();

    /** Seconds of wall clock since boot. Drives every orbit and every cycle. */
    this._now = 0;
    /** A one-shot effect in progress: {cardId, player, t}. */
    this._burst = null;
    /** Set by `play` when the panel asks for an effect with no game behind it. */
    this._demo = null;

    this.arena = null;
    /**
     * Live caps per player, rebuilt every frame. See `_aliveOwnedCaps`.
     *
     * Initialised here because `capVisual` is called from `ArenaView` and there
     * is no ordering guarantee that the first `update` has run before the first
     * frame is drawn — an undefined set would throw rather than simply not mark.
     */
    this._aliveOwned = [new Set(), new Set()];
    this.chaosCaps = [];
    /** Which caps are standing on a boosted shot. Empty when nobody is. */
    this.smashCaps = [];
    /** Frames of inversion still owed. Counted DOWN in frames, not seconds. */
    this._invertLeft = 0;
    /** Whether a smash burst was running last frame. The leading edge arms it. */
    this._wasSmashing = false;
    /** Frames of darkening still owed, and the same leading-edge latch. */
    this._darkenLeft = 0;
    this._wasSealing = false;

    this._buildStun();
    this._buildSwap();
    this._buildFlash();
    this._buildSmash();
    this._buildScreen();
    this._buildSeal();
  }

  setResolution(resolution) {
    this.materials.setResolution(resolution);
  }

  /** A rebuild changed the cap count. Sprites are pooled to the new maximum. */
  setArena(arena) {
    this.arena = arena;
    this._ensureStun(arena?.capCount ?? 0);
    this._ensureFlash(arena?.capCount ?? 0);
    this._ensureSmash(arena?.capCount ?? 0);
  }

  // ── construction ─────────────────────────────────────────────────────────

  _buildStun() {
    this.stunGroup = new Group();
    this.world.add(this.stunGroup);
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.stun = [];
    this._stunFrames = 0;
  }

  _stunTexture() {
    const cfg = this.config.cardFx;
    return stunSheet(cfg.stunFrames, cfg.stunTexels);
  }

  _ensureStun(n) {
    while (this.stun.length < n) {
      const mat = this.materials.create(this._stunTexture());
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 20;
      this.stunGroup.add(mesh);
      this.stun.push({ mesh, mat });
    }
    for (let i = n; i < this.stun.length; i++) this.stun[i].mesh.visible = false;
  }

  _buildSwap() {
    this.swapGroup = new Group();
    this.world.add(this.swapGroup);
    this.rings = [];
    const tex = ringTexture(this.config.cardFx.ringTexels);
    for (let i = 0; i < MAX_SWAP_RINGS; i++) {
      const mat = this.materials.create(tex);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 18;
      this.swapGroup.add(mesh);
      this.rings.push({ mesh, mat });
    }

    // The path between a swapped pair. Lines, like the aim overlay's, because
    // the one thing this has to do is say WHICH cap is going WHERE and a line is
    // the cheapest unambiguous way to say it.
    const geo = new BufferGeometry();
    geo.setAttribute('position', new BufferAttribute(new Float32Array(MAX_SWAP_RINGS * 6), 3));
    this.swapLineGeo = geo;
    this.swapLineMat = new LineBasicMaterial({
      color: SWAP_LINE_COLOR,
      fog: false,
      transparent: true,
      opacity: 1,
      depthTest: false,
    });
    this.swapLines = new LineSegments(geo, this.swapLineMat);
    this.swapLines.frustumCulled = false;
    this.swapLines.renderOrder = 17;
    this.swapLines.visible = false;
    this.swapGroup.add(this.swapLines);
  }

  _buildFlash() {
    this.flashGroup = new Group();
    this.world.add(this.flashGroup);
    this.flashes = [];
  }

  _ensureFlash(n) {
    const tex = flashTexture(this.config.cardFx.ringTexels);
    while (this.flashes.length < n) {
      const mat = this.materials.create(tex);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      this.flashGroup.add(mesh);
      this.flashes.push({ mesh, mat });
    }
    for (let i = n; i < this.flashes.length; i++) this.flashes[i].mesh.visible = false;
  }

  /**
   * 강타's two per-cap sprites: the ring that closes, and the aura that stays.
   *
   * Two pools rather than one, because they are on screen at different times and
   * for different reasons — the ring is a quarter-second event, the aura holds
   * until the shot — and sharing one would mean a mesh whose meaning changed
   * halfway through its own life.
   */
  _buildSmash() {
    this.smashGroup = new Group();
    this.world.add(this.smashGroup);
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.smashRings = [];
    /** @type {Array<{mesh: Mesh, mat: object}>} */
    this.auras = [];
  }

  _ensureSmash(n) {
    const ring = ringTexture(this.config.cardFx.ringTexels);
    const aura = auraTexture(this.config.cardFx.ringTexels);
    while (this.smashRings.length < n) {
      const mat = this.materials.create(ring);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      mesh.renderOrder = 19;
      this.smashGroup.add(mesh);
      this.smashRings.push({ mesh, mat });
    }
    while (this.auras.length < n) {
      const mat = this.materials.create(aura);
      const mesh = new Mesh(QUAD, mat);
      mesh.visible = false;
      // Under the ring and under the stars: it is the quietest of the three and
      // the only one that is always there.
      mesh.renderOrder = 16;
      this.smashGroup.add(mesh);
      this.auras.push({ mesh, mat });
    }
    for (let i = n; i < this.smashRings.length; i++) this.smashRings[i].mesh.visible = false;
    for (let i = n; i < this.auras.length; i++) this.auras[i].mesh.visible = false;
  }

  /**
   * The two full-frame effects.
   *
   * In the card scene rather than the world, because they are about the SCREEN:
   * a scanline sweep that followed the pitch as the camera turned would be a
   * thing in the world rather than a thing happening to the picture.
   */
  _buildScreen() {
    this.scanMat = this.materials.create(scanTexture(this.config.cardFx.scanTexels));
    this.scan = new Mesh(QUAD, this.scanMat);
    this.scan.visible = false;
    this.scan.renderOrder = 1000;
    this.screen.add(this.scan);

    this.frameMat = this.materials.create(frameTexture());
    this.frameQuad = new Mesh(QUAD, this.frameMat);
    this.frameQuad.scale.set(this.frame.width, this.frame.height, 1);
    this.frameQuad.visible = false;
    this.frameQuad.renderOrder = 1001;
    this.screen.add(this.frameQuad);

    // Last of all, over everything including the cards: an inversion that any
    // part of the picture escaped would look like a rendering fault rather than
    // like a flash.
    this.invertMat = this.materials.createInvert();
    this.invertQuad = new Mesh(QUAD, this.invertMat);
    this.invertQuad.scale.set(this.frame.width, this.frame.height, 1);
    this.invertQuad.visible = false;
    this.invertQuad.renderOrder = 1002;
    this.screen.add(this.invertQuad);
  }

  /**
   * 침묵's cast, which is one flash of darkness and nothing else.
   *
   * ── it used to reach, and the reach had to go ───────────────────────────────
   * There was a dark bolt that grew from the caster's hand to the victim's and
   * stamped a padlock where it landed. It read as smoke drifting across the
   * pitch — a soft, drifting thing on a board where nothing else drifts — and it
   * spent half a second saying what the padlock on the victim's own turn says
   * better and at the moment it actually matters.
   *
   * What is left is the one part that was never the problem: `dst - src` over
   * the whole frame for a frame or two. It is the mirror of 강타's inversion,
   * it is over before the eye resolves it, and it is the only thing on screen
   * that has to happen at CAST time — the seal itself is a thing the victim
   * meets on their own turn, and `CardLayer` draws it there.
   *
   * ── nothing here goes near a cap, and that is still the card ────────────────
   * 혼란 puts stars over the caps because it twists a SHOT. 침묵 does not touch a
   * shot: it seals a HAND. An effect on the caps would send the player to look
   * at the board for a change that is not there.
   */
  _buildSeal() {
    // Over everything, including the cards — a darkening that the hand escaped
    // would read as the hand being lit rather than as the frame being dimmed.
    this.sealDarkenMat = this.materials.createDarken(flatTexture());
    this.sealDarken = new Mesh(QUAD, this.sealDarkenMat);
    this.sealDarken.scale.set(this.frame.width, this.frame.height, 1);
    this.sealDarken.visible = false;
    this.sealDarken.renderOrder = 1003;
    this.screen.add(this.sealDarken);
  }

  /**
   * The cast flash: counted in FRAMES, armed on the leading edge.
   *
   * Identical bookkeeping to 강타's inversion, and identical reasoning: a window
   * measured in seconds lands on a different number of frames at a different
   * refresh rate, and at one or two frames that is the difference between a hit
   * and nothing at all. `Match.cardFx` builds a fresh object every frame, so the
   * latch is a BOOLEAN transition rather than an identity test on the burst.
   *
   * The texture is re-fetched every frame rather than on a change. It is a cache
   * hit — one map lookup — and it is the only thing that survives the panel's
   * stun sliders emptying the whole texture cache out from under a material that
   * is still pointing into it. A freed texture is not an error; it just draws
   * nothing, silently.
   */
  _updateSeal() {
    const cfg = this.config.cardFx;
    this.sealDarkenMat.uniforms.uMap.value = flatTexture();

    const sealing = this._burst?.cardId === 'silence';
    if (sealing && !this._wasSealing) {
      this._darkenLeft = Math.max(0, Math.round(cfg.sealDarkenFrames));
    }
    this._wasSealing = sealing;
    this.sealDarken.visible = this._darkenLeft > 0;
    if (this._darkenLeft > 0) {
      this.sealDarkenMat.uniforms.uOpacity.value = Math.max(0, Math.min(1, cfg.sealDarkenStrength));
      this._darkenLeft--;
    }
  }

  // ── the trajectory line's flow ───────────────────────────────────────────

  /**
   * The dash texture the aim overlay's path line borrows while the card is on.
   *
   * Handed out rather than applied here so there is still exactly one path line
   * in the scene — two would be two things to keep in step.
   */
  get dashTexture() {
    return dashTexture(this.config.cardFx.dashLength);
  }

  // ── per frame ────────────────────────────────────────────────────────────

  /**
   * @param {number} dt      render seconds
   * @param {import('../game/Match.js').Match} match
   * @param {import('three').Camera} camera  for billboarding
   */
  update({ dt, match, camera }) {
    this._now += dt;

    // The match's own effect wins; the panel's demo fills in when there is none.
    const live = match?.cardFx ?? null;
    if (live) {
      this._burst = live;
      this._demo = null;
    } else if (this._demo) {
      this._demo.elapsed += dt;
      const s = Math.max(0.05, this._demo.seconds);
      this._burst = {
        cardId: this._demo.cardId,
        player: this._demo.player,
        t: Math.min(1, this._demo.elapsed / s),
      };
      if (this._demo.elapsed >= s) this._demo = null;
    } else {
      this._burst = null;
    }

    /**
     * FIRST, because everything below marks caps and every one of them has to
     * agree about which caps are still there. See `_aliveOwnedCaps`.
     *
     * It is also what `capVisual` reads, and that call comes from `ArenaView`
     * later in the same frame rather than from here — so this has to be built
     * on the frame's own state before anything can ask.
     */
    this._aliveOwned = this._aliveOwnedCaps(match);

    this.chaosCaps = this._chaosCaps(match);
    this.smashCaps = this._smashCaps(match);
    this._updateStun(camera);
    this._updateSwap(match, camera);
    this._updateFlash(match, camera);
    this._updateSmash(camera);
    this._updateScreen();
    // After `_updateScreen`, which owns the other two full-frame effects. The
    // order is only bookkeeping — they cannot be on at once — but keeping the
    // frame-counted latches next to each other is what stops the second one
    // being written as a timer by somebody reading only half the file.
    this._updateSeal();
  }

  /**
   * A cap that is still on the board.
   *
   * ── dead caps were getting the effects ──────────────────────────────────
   * Both pickers below asked only who OWNS a cap, never whether it is still in
   * play. `ArenaView` hides a cap that has fallen, so the cap itself vanished —
   * but the aura, the ring and the palette flash are drawn by this file at the
   * cap's last transform, and they carried on burning at the bottom of the
   * board over nothing. Reported against 강타; 혼란 had it too, and the note on
   * `_smashCaps` says the two must answer alike, so both are fixed here rather
   * than one of them being patched.
   *
   * `rules.alive` is the same array `ArenaView.update` is handed to decide what
   * to draw, so the effect and the cap it belongs to now agree by construction.
   */
  _isAlive(match, i) {
    const alive = match?.rules?.alive;
    return !alive || alive[i] !== false;
  }

  /**
   * The caps a player still has ON THE BOARD. One answer, asked once a frame.
   *
   * ── "is it theirs" and "is it still there" are one question, not two ────────
   * Five places in this file mark a cap because of who owns it: the stun stars,
   * 강타's standing aura, 강타's closing ring, 원모어's flash, and the two pulses
   * in `capVisual`. Every one of them wants the owner's LIVE caps, and for a
   * long time only the first two said so — the pickers were given an `_isAlive`
   * test and the burst-driven loops were left asking `capOwner` alone.
   *
   * That is not a small inconsistency, it is a reported bug and it was reported
   * twice: the aura was fixed for it once, and 강타's ring kept doing the same
   * thing on the same caps, because a second copy of the rule was never written.
   * Measured on a knockout board with two caps eliminated: `smashCaps` was `[2]`
   * and the rings were drawn on `[0, 1, 2]` — two of them burning on the bodies.
   *
   * So there is now one set, built once in `update`, and every marker reads it.
   * A sixth effect that marks a cap gets the rule by using the set, and the way
   * to get it wrong is to write a new loop over `capOwner` — which is now the
   * only thing in this file that would look out of place.
   *
   * A Set rather than an array: these are membership tests inside per-cap loops,
   * and `capVisual` is called once per cap per frame from `ArenaView`.
   *
   * @returns {Set<number>[]} indexed by player
   */
  _aliveOwnedCaps(match) {
    const arena = this.arena;
    const out = [new Set(), new Set()];
    if (!arena) return out;
    for (let i = 0; i < arena.capCount; i++) {
      if (this._isAlive(match, i)) out[arena.capOwner[i]]?.add(i);
    }
    return out;
  }

  /** Whether `index` is a live cap of `player`'s. The one test every marker uses. */
  _marks(player, index) {
    return !!this._aliveOwned?.[player]?.has(index);
  }

  /**
   * Which caps are currently under chaos. Empty when nobody is.
   *
   * Asks `chaosOn(owner)` rather than reading the record's shape. It used to
   * compare against a single `chaos.victim`, which could only ever mark one
   * player's caps — and chaos is a slot per victim now, so BOTH sides can be
   * carrying it at once and both sets of caps have to show the stars.
   */
  _chaosCaps(match) {
    const cards = match?.cards;
    const arena = this.arena;
    if (!cards || !arena) return [];
    const out = [];
    for (let i = 0; i < arena.capCount; i++) {
      if (cards.chaosOn(arena.capOwner[i]) && this._isAlive(match, i)) out.push(i);
    }
    return out;
  }

  /**
   * Which caps are standing on a boosted shot.
   *
   * ALL of the armed player's, not the one currently offered. The boost is on
   * the player's next shot and any of their caps can be the one that takes it —
   * marking a single cap would be a promise about which one, and the player
   * would find it broken the moment they pressed a different one.
   *
   * Same shape as `_chaosCaps`, deliberately: two effects that answer the same
   * kind of question should not answer it two different ways.
   */
  _smashCaps(match) {
    const smash = match?.cards?.smash;
    if (!smash) return [];
    return [...(this._aliveOwned[smash.player] ?? [])];
  }

  /**
   * The stun stars: one per afflicted cap, orbiting above it.
   *
   * The orbit angle and the sprite frame step TOGETHER and in the same number of
   * steps, so the star arrives at each of its positions in the pose it was drawn
   * for. Advancing the position smoothly and the frame in steps — which is what
   * happens if you forget — looks like the sprite is lagging the motion.
   */
  _updateStun(camera) {
    const cfg = this.config.cardFx;
    const frames = Math.max(1, Math.round(cfg.stunFrames));
    // Keyed on the texel count as well as the frame count. The panel's texture
    // slider clears the cache, and a material still pointing at the disposed
    // texture draws nothing — silently, since a freed texture is not an error.
    const key = `${frames}:${cfg.stunTexels}`;
    if (key !== this._stunKey) {
      this._stunKey = key;
      this._stunFrames = frames;
      const tex = this._stunTexture();
      for (const s of this.stun) s.mat.uniforms.uMap.value = tex;
    }

    const active = new Set(this.chaosCaps);
    for (let i = 0; i < this.stun.length; i++) {
      const s = this.stun[i];
      if (!active.has(i) || !this.arena) {
        s.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);

      // Stepped: `floor`, not the raw angle. This is the whole look.
      const turns = this._now * cfg.stunRotationsPerSecond;
      // A per-cap phase so four caps are not one rigid constellation.
      const step = Math.floor(turns * frames + i * 1.7);
      const angle = (step / frames) * Math.PI * 2;

      s.mesh.position.set(
        com.x + Math.cos(angle) * cfg.stunOrbitRadius,
        com.y + cfg.stunHeight,
        com.z + Math.sin(angle) * cfg.stunOrbitRadius,
      );
      s.mesh.scale.setScalar(cfg.stunSize);
      if (camera) s.mesh.quaternion.copy(camera.quaternion);
      FxMaterials.setFrame(s.mat, step, frames);

      // Palette cycling, on its own slower step so the colour is not simply the
      // frame number in disguise.
      const p = CHAOS_PALETTE[
        Math.floor(this._now * cfg.paletteCyclesPerSecond * CHAOS_PALETTE.length) %
          CHAOS_PALETTE.length
      ];
      s.mat.uniforms.uTint.value.set(p[0], p[1], p[2]);
      s.mat.uniforms.uOpacity.value = 1;
      s.mesh.visible = true;
    }
  }

  /** Rings at both ends of every pair, and the line between them. */
  _updateSwap(match, camera) {
    const burst = this._burst?.cardId === 'swap' ? this._burst : null;
    if (!burst || !this.arena) {
      for (const r of this.rings) r.mesh.visible = false;
      this.swapLines.visible = false;
      return;
    }

    const cfg = this.config.cardFx;
    const t = burst.t;
    // Out and back: bright at the ends of the exchange, gone in the middle,
    // which is when the caps themselves are away.
    const pulse = Math.max(0, 1 - Math.abs(t * 2 - 1)) ** 0.6;

    // The real exchange publishes where every cap came from and is going to.
    // The panel's replay button has no exchange behind it, so the same pairs are
    // derived from where the caps are standing right now — the effect is then
    // drawn against the real board rather than against nothing.
    const real = match?.swap?.moves ?? [];
    const moves = this._demo || !real.length ? this._pairMoves() : real;
    const attr = this.swapLineGeo.getAttribute('position');
    let ring = 0;
    let w = 0;

    for (const m of moves) {
      if (ring >= this.rings.length) break;
      const r = this.rings[ring++];
      // The ring stays at the departure point rather than travelling with the
      // cap: it marks where the cap WAS, which is the half of the exchange that
      // is otherwise invisible.
      r.mesh.position.set(m.from.x, m.from.y + cfg.ringHeight, m.from.z);
      r.mesh.scale.setScalar(cfg.ringSize * (0.4 + smoothstep(t) * 1.6));
      if (camera) r.mesh.quaternion.copy(camera.quaternion);
      r.mat.uniforms.uTint.value.set(...SWAP_TINT);
      r.mat.uniforms.uOpacity.value = pulse;
      r.mesh.visible = true;

      if (w + 6 <= attr.array.length) {
        attr.array[w++] = m.from.x;
        attr.array[w++] = m.from.y + cfg.ringHeight;
        attr.array[w++] = m.from.z;
        attr.array[w++] = m.to.x;
        attr.array[w++] = m.to.y + cfg.ringHeight;
        attr.array[w++] = m.to.z;
      }
    }
    for (let i = ring; i < this.rings.length; i++) this.rings[i].mesh.visible = false;

    attr.needsUpdate = true;
    this.swapLineGeo.setDrawRange(0, w / 3);
    this.swapLineMat.opacity = pulse;
    this.swapLines.visible = w > 0;
  }

  /** The exchange the caps on the board right now WOULD make. For the replay button. */
  _pairMoves() {
    if (!this.arena) return [];
    const out = [];
    for (const { a, b } of CapSwap.pairs(this.arena)) {
      const ca = this.arena.capCom(a);
      const cb = this.arena.capCom(b);
      out.push(
        { index: a, from: { x: ca.x, y: ca.y, z: ca.z }, to: { x: cb.x, y: cb.y, z: cb.z } },
        { index: b, from: { x: cb.x, y: cb.y, z: cb.z }, to: { x: ca.x, y: ca.y, z: ca.z } },
      );
    }
    return out;
  }

  /** One-more: a hard flash on the player's own caps. */
  _updateFlash(match, camera) {
    const burst = this._burst?.cardId === 'onemore' ? this._burst : null;
    if (!burst || !this.arena) {
      for (const f of this.flashes) f.mesh.visible = false;
      return;
    }

    const cfg = this.config.cardFx;
    // Short and hard: full at the start, gone by a third of the way through.
    // A flash that fades out over its whole duration is a glow, not a flash.
    const k = Math.max(0, 1 - burst.t * 3);
    const stepped = Math.ceil(k * 4) / 4;

    for (let i = 0; i < this.flashes.length; i++) {
      const f = this.flashes[i];
      // `_marks`, not `capOwner`: a cap that has gone off the board is still a
      // body at a position, and flashing it lights up a corpse.
      if (!this._marks(burst.player, i) || stepped <= 0) {
        f.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);
      f.mesh.position.set(com.x, com.y + cfg.ringHeight, com.z);
      f.mesh.scale.setScalar(cfg.ringSize * (1 + (1 - stepped) * 0.8));
      if (camera) f.mesh.quaternion.copy(camera.quaternion);
      f.mat.uniforms.uTint.value.set(...ONEMORE_TINT);
      f.mat.uniforms.uOpacity.value = stepped;
      f.mesh.visible = true;
    }
  }

  /**
   * 강타: a ring that closes onto the cap, and an aura that stays behind it.
   *
   * ── it contracts, and that is the whole idea ────────────────────────────────
   * Every other ring in this file expands. An expanding ring is something
   * LEAVING the cap — the swap uses one to say "this piece departed from here" —
   * and the same sprite run the other way says the opposite: force arriving,
   * gathering, being held. Reversing the direction is the difference between
   * "released" and "loaded", and it is free.
   *
   * Quantised to `smashRingSteps` so it arrives in a handful of jumps. A smooth
   * contraction is a tween; a stepped one is a mechanism winding up.
   */
  _updateSmash(camera) {
    const cfg = this.config.cardFx;
    const burst = this._burst?.cardId === 'smash' ? this._burst : null;

    // ── the aura: on for exactly as long as the card is armed ──
    // Driven off `smashCaps` rather than off the burst, so it survives the
    // effect ending and holds until the shot expires the card. It is the only
    // thing on screen that says "you are still holding this".
    const armed = new Set(this.smashCaps);
    const tint = SMASH_PALETTE[
      Math.floor(this._now * cfg.smashPaletteCyclesPerSecond * SMASH_PALETTE.length) %
        SMASH_PALETTE.length
    ];
    for (let i = 0; i < this.auras.length; i++) {
      const a = this.auras[i];
      if (!armed.has(i) || !this.arena) {
        a.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);
      a.mesh.position.set(com.x, com.y + cfg.smashAuraHeight, com.z);
      a.mesh.scale.setScalar(cfg.smashAuraSize);
      if (camera) a.mesh.quaternion.copy(camera.quaternion);
      a.mat.uniforms.uTint.value.set(tint[0], tint[1], tint[2]);
      a.mat.uniforms.uOpacity.value = Math.max(0, cfg.smashAuraStrength);
      a.mesh.visible = true;
    }

    // ── the ring: only while the card is landing ──
    if (!burst || !this.arena) {
      for (const r of this.smashRings) r.mesh.visible = false;
      return;
    }

    // Closed well before the effect ends, so the cap's answering pulse — which
    // `capVisual` puts on the back half — lands after the ring rather than with
    // it. Two beats, in order: gather, then hit.
    const close = Math.max(0.05, Math.min(1, cfg.smashRingFraction));
    const k = Math.min(1, burst.t / close);
    const steps = Math.max(1, Math.round(cfg.smashRingSteps));
    const stepped = Math.ceil((1 - k) * steps) / steps;
    const size = cfg.ringSize * (stepped * Math.max(0, cfg.smashRingStart - 1) + 1) * stepped;

    for (let i = 0; i < this.smashRings.length; i++) {
      const r = this.smashRings[i];
      // The reported bug, and the reason `_marks` exists: the aura above was
      // given the alive test and this loop was not, so an eliminated cap kept
      // its closing ring while the aura beside it had already stopped.
      if (!this._marks(burst.player, i) || stepped <= 0) {
        r.mesh.visible = false;
        continue;
      }
      const com = this.arena.capCom(i);
      r.mesh.position.set(com.x, com.y + cfg.ringHeight, com.z);
      r.mesh.scale.setScalar(size);
      if (camera) r.mesh.quaternion.copy(camera.quaternion);
      r.mat.uniforms.uTint.value.set(tint[0], tint[1], tint[2]);
      // Brighter as it closes: the energy is going INTO the cap, so the last
      // frame before it vanishes is the strongest one.
      r.mat.uniforms.uOpacity.value = 0.35 + (1 - stepped) * 0.65;
      r.mesh.visible = true;
    }
  }

  /** The frame-wide pair: the sweep, and the edge. */
  _updateScreen() {
    const cfg = this.config.cardFx;
    const burst = this._burst;

    // ── the trajectory sweep: one pass, top to bottom ──
    if (burst?.cardId === 'trajectory') {
      const h = Math.max(4, cfg.scanHeight);
      const span = this.frame.height + h;
      const y = this.frame.height / 2 + h / 2 - burst.t * span;
      this.scan.position.set(0, y, 0);
      this.scan.scale.set(this.frame.width, h, 1);
      this.scanMat.uniforms.uTint.value.set(1, 1, 1);
      this.scanMat.uniforms.uOpacity.value = 1;
      this.scan.visible = true;
    } else {
      this.scan.visible = false;
    }

    // ── the one-more edge ──
    if (burst?.cardId === 'onemore') {
      // Two hard beats rather than one fade. The era's own screen flashes were
      // whole frames of a colour, and a stepped double-blink is the closest
      // thing to that which does not make the pitch unreadable.
      const beats = Math.max(1, Math.round(cfg.edgeBeats));
      const phase = Math.floor(burst.t * beats * 2);
      const on = phase % 2 === 0 && burst.t < 1;
      this.frameMat.uniforms.uTint.value.set(...ONEMORE_TINT);
      this.frameMat.uniforms.uOpacity.value = on ? 1 - burst.t * 0.5 : 0;
      this.frameQuad.visible = on;
    } else {
      this.frameQuad.visible = false;
    }

    // ── the 강타 inversion ──
    // Counted in FRAMES, and armed once per burst rather than driven off `t`.
    // A time-based window would land on a different number of frames depending
    // on the frame rate, and at 1-2 frames that is the difference between a hit
    // and nothing at all. Armed on the leading edge; the counter does the rest.
    //
    // The edge is a BOOLEAN transition, not an identity check on the burst.
    // `Match.cardFx` builds a fresh object every frame, so `burst !== lastBurst`
    // is true on every one of them — which re-armed the counter each frame and
    // left the screen inverted for the whole effect instead of for two frames.
    const smashing = burst?.cardId === 'smash';
    if (smashing && !this._wasSmashing) {
      this._invertLeft = Math.max(0, Math.round(cfg.smashInvertFrames));
    }
    this._wasSmashing = smashing;
    this.invertQuad.visible = this._invertLeft > 0;
    if (this._invertLeft > 0) this._invertLeft--;
  }

  // ── what the caps do about it ────────────────────────────────────────────

  /**
   * The visual offset for one cap, or null.
   *
   * Read by `ArenaView` AFTER it has written the interpolated physics transform,
   * so this is strictly a drawing offset — the body is where the solver put it
   * and this moves the picture of it. That distinction is the whole reason the
   * shake cannot affect a shot.
   *
   * @returns {{dx: number, dy: number, dz: number, scale: number}|null}
   */
  capVisual(index) {
    const cfg = this.config.cardFx;
    let dx = 0;
    let dz = 0;
    let scale = 1;
    let touched = false;

    // Chaos: a small, fast, per-cap wobble. Two frequencies that do not divide
    // into each other, so four caps never fall into step and start to look like
    // one rigid object being shaken.
    if (this.chaosCaps.includes(index)) {
      const phase = index * 2.399;
      dx += Math.sin(this._now * cfg.shakeHz * Math.PI * 2 + phase) * cfg.shakeAmount;
      dz += Math.sin(this._now * cfg.shakeHz * Math.PI * 2 * 1.37 + phase * 1.7) * cfg.shakeAmount * 0.6;
      touched = true;
    }

    // 강타: a fast, small tremble, held for as long as the card is. Faster and
    // tighter than the chaos wobble on purpose — that one is a cap that has been
    // confused, this one is a cap straining against something. Two frequencies
    // again, and both prime-ish against chaos's, so a cap carrying both cards
    // does not fall into a single beat.
    if (this.smashCaps.includes(index)) {
      const cfg2 = this.config.cardFx;
      const phase = index * 1.117;
      const w = cfg2.smashJitterHz * Math.PI * 2;
      dx += Math.sin(this._now * w + phase) * cfg2.smashJitterAmount;
      dz += Math.cos(this._now * w * 1.23 + phase * 2.1) * cfg2.smashJitterAmount * 0.8;
      touched = true;
    }

    const burst = this._burst;
    if (burst?.cardId === 'swap' && this.arena) {
      // Shrink out, stay gone, grow back. From a near-top-down camera a vertical
      // squash is almost invisible — the cap is a disc either way — so the
      // disappearance is a uniform scale instead.
      const t = burst.t;
      const edge = Math.max(0.05, cfg.swapVanishFraction);
      const k = t < edge ? 1 - t / edge : t > 1 - edge ? (t - (1 - edge)) / edge : 0;
      scale *= Math.max(0.02, k);
      touched = true;
    }

    // The answering pulse, on the BACK half of the effect — after the ring has
    // finished closing. The order is the whole statement: the force gathers,
    // then it lands. Stepped, like the one-more pulse, for the same reason.
    if (burst?.cardId === 'smash' && this._marks(burst.player, index)) {
      const cfg2 = this.config.cardFx;
      const close = Math.max(0.05, Math.min(1, cfg2.smashRingFraction));
      const after = (burst.t - close) / Math.max(0.05, 1 - close);
      if (after > 0) {
        const k = Math.max(0, 1 - after * 1.8);
        scale *= 1 + (Math.ceil(k * 3) / 3) * cfg2.smashPulseAmount;
        touched = true;
      }
    }

    if (burst?.cardId === 'onemore' && this._marks(burst.player, index)) {
      // One pulse, stepped. Not a sine: a smooth breath reads as an idle
      // animation rather than as a thing that just happened.
      const k = Math.max(0, 1 - burst.t * 2.5);
      scale *= 1 + Math.ceil(k * 3) / 3 * cfg.pulseAmount;
      touched = true;
    }

    return touched ? { dx, dy: 0, dz, scale } : null;
  }

  // ── the panel's replay button ────────────────────────────────────────────

  /** Play an effect with no game effect behind it. */
  play(cardId, player = 0, seconds = 0.6) {
    this._demo = { cardId, player, seconds, elapsed: 0 };
  }

  dispose() {
    this.materials.dispose();
    this.swapLineGeo.dispose();
    this.swapLineMat.dispose();
  }
}
