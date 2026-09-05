import { Mixer } from './Mixer.js';
import { Synth } from './Synth.js';
import { VoicePool } from './VoicePool.js';
import { SOUNDS } from './soundBank.js';

/**
 * The one object the rest of the game talks to.
 *
 * ── the whole public surface is "something happened" ────────────────────────
 * `audio.play('cap_cap', { intensity })`. Not an oscillator, not a frequency,
 * not an `AudioContext` — an EVENT NAME and how hard it was. That is the line
 * the brief draws and it is the only line that matters here: everything about
 * what a collision sounds like lives in `soundBank`, everything about how it is
 * synthesised lives in `Synth`, and everything about whether it is allowed to be
 * heard at all lives in `VoicePool`. The game says what happened and stops.
 *
 * ── loops are DESCRIBED, not started and stopped ───────────────────────────
 * `setLoop(id, { on, gain, rate })`, called every frame with the state it should
 * be in, rather than `start()` / `stop()` pairs the caller has to balance. The
 * continuous sounds all hang off conditions that can end without warning — a
 * turn that times out freezes every body in one step, a card expires, a tab
 * hides mid-stroke — and every version of this written as a pair eventually
 * leaks a voice that plays forever. An idempotent description cannot.
 *
 * ── nothing is queued before the device exists ─────────────────────────────
 * Before the first gesture `play` returns null and `setLoop` does nothing. It is
 * NOT buffered: a queue would empty itself the instant audio unlocked and the
 * player would hear every hover and click they made during the page load, all at
 * once, describing a screen they have already left.
 *
 * ── it is a passenger, and it must never be load-bearing ───────────────────
 * `tick()` is exposed on `window.__cap` and driven by hand to verify
 * determinism. Every method here tolerates being called with no device, with
 * dt 0, and out of band with rAF, and none of them touches the simulation, the
 * game's RNG, or anything the state hash covers.
 */

/**
 * How long a held first sound may wait for the output device, in ms.
 *
 * Long enough to cover a cold sink — the reported case was one to two seconds —
 * and short enough that what eventually plays is still about the press that
 * asked for it. Past this the click is stale and is dropped.
 */
const PENDING_MAX_WAIT = 1600;

export class AudioSystem {
  /**
   * @param {typeof import('../game/config.js').CONFIG.audio} config
   * @param {import('./AudioSettings.js').AudioSettingsBook} settings
   * @param {Record<string, object>} [sounds]
   */
  constructor({ config, settings, sounds = SOUNDS }) {
    this.config = config;
    this.settings = settings;
    this.sounds = sounds;

    this.mixer = new Mixer(config);
    /** @type {import('./SoundPlayer.js').SoundPlayer} */
    this.player = new Synth(this.mixer, config);
    this.pool = new VoicePool(config);

    /** @type {Map<string, {voice: object, rec: object}>} */
    this._loops = new Map();
    /** The one-shot held back while the output device opens. See `play`. */
    this._pending = null;
    /** Ids asked for that do not exist. Warned once each, never thrown. */
    this._unknown = new Set();
    /** For the panel: what was last played, and how many times this session. */
    this.lastId = '';
    this.played = 0;

    this._offSettings = settings.onChange(() => this._pushSettings());
    this._installed = false;
    this._onGesture = () => this.unlock();
    this._onVisibility = () => {
      if (document.hidden) this.suspend();
      else this.resume();
    };
  }

  get ready() {
    return this.player.ready;
  }

  /** Whether anything would be heard. Mute short-circuits the whole path. */
  get enabled() {
    return this.ready && !this.settings.muted && this.settings.volume > 0;
  }

  // ── lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Listen for the first gesture, and for the tab going away.
   *
   * ── the listeners are ours, and additive ───────────────────────────────
   * Not hooked into `PointerRouter` or `bootMenu.onDown`. Both of those return
   * early in states where audio still needs unlocking (a press during a
   * transition, a press while the cap covers the screen), and on the game page
   * the router does not exist until the Rapier WASM has resolved — so a press
   * during loading would be missed entirely. Three cheap listeners on the
   * document, in the capture phase so nothing can stop them, are the honest
   * version of "the first gesture".
   *
   * `keydown` is in the list because it is a gesture as far as the autoplay
   * policy is concerned and because Escape is a real control in this game.
   */
  install() {
    if (this._installed) return this;
    this._installed = true;
    const opts = { capture: true, passive: true };
    document.addEventListener('pointerdown', this._onGesture, opts);
    document.addEventListener('keydown', this._onGesture, opts);
    document.addEventListener('touchstart', this._onGesture, opts);
    document.addEventListener('visibilitychange', this._onVisibility);

    /**
     * And try once immediately, before any gesture at all.
     *
     * ── the gap this closes is a whole page ────────────────────────────────
     * Menu to match is a real NAVIGATION, so the match page is a fresh document
     * with no user activation of its own — the press that chose the mode belongs
     * to a document that no longer exists. Nothing can make a sound there until
     * the player touches something, and then the output device still has to
     * open, which is where the reported seconds of silence came from.
     *
     * This does not defeat the autoplay policy and is not trying to. What it
     * buys is the case where the browser DOES allow it — a return visit, a
     * profile with engagement on this origin — in which the context starts here
     * and the device opens during load, so the first press is already audible.
     * Where it is not allowed the context is created suspended, the gesture
     * listeners above resume it exactly as before, and the only cost is one
     * console warning from the browser saying so.
     */
    this.unlock();
    return this;
  }

  /** Start the device. Safe on every gesture; only the first does work. */
  unlock() {
    const started = this.mixer.unlock();
    if (started) this._pushSettings();
    return started;
  }

  suspend() {
    // The loops go first. A held voice suspended mid-note resumes exactly where
    // it was, which after a minute in another tab is a sound describing a game
    // state that is long gone.
    this.stopLoops(0.02);
    this.mixer.suspend();
  }

  resume() {
    this.mixer.resume();
  }

  /**
   * The page is about to be replaced.
   *
   * Scheduled on the AUDIO clock rather than driven from the render loop,
   * because a navigating page is often about to stop being served frames — see
   * the same reasoning in `pageFade`, which keeps a `setTimeout` backstop for
   * exactly this. 180 ms is `FADE_MS`, so the sound and the veil land together.
   */
  fadeOutForNavigation(seconds = 0.18) {
    this.stopLoops(seconds * 0.5);
    this.mixer.fadeOut(seconds);
  }

  _pushSettings() {
    this.mixer.setMasterVolume(this.settings.volume);
    this.mixer.setMuted(this.settings.muted);
    if (this.settings.muted) this.stopAll(0.05);
  }

  /**
   * Re-push every config number onto the live graph.
   *
   * On the panel's 전체 리셋 list, because `resetConfig` restores numbers and
   * nothing else — a `WaveShaper` curve built from the old bit depth would
   * survive the reset otherwise, which is the exact failure the HUD and the
   * victory screen already have entries on that list for.
   */
  applyConfig() {
    this.mixer.applyConfig();
  }

  // ── playing ───────────────────────────────────────────────────────────────

  /**
   * @param {string} id
   * @param {import('./SoundPlayer.js').PlayOptions} [opts]
   * @returns {object|null} the voice, or null if it was refused
   */
  play(id, opts) {
    if (!this.enabled) return null;
    const def = this.sounds[id];
    if (!def) {
      // Warned, not thrown. `iconTexture` throws on an unknown name because a
      // missing icon is a blank screen; a missing sound is silence, and taking
      // the render loop down over it would be a far worse outcome than the
      // thing it is reporting.
      if (!this._unknown.has(id)) {
        this._unknown.add(id);
        console.warn(`[audio] unknown sound "${id}"`);
      }
      return null;
    }

    /**
     * The output device may not be open yet.
     *
     * Anything scheduled before the sink starts is rendered into a void and
     * silently lost, and the window is the worst one possible: the gesture that
     * unlocks audio is the gesture that should click. So the most recent
     * one-shot is HELD and fired the moment the device is genuinely playing.
     *
     * Depth one, and a deadline. This is not a queue — replaying a page-load's
     * worth of presses the instant audio comes up would be its own bug — and a
     * click that arrives more than `PENDING_MAX_WAIT` late is no longer feedback
     * for anything, so it is dropped rather than played into a screen that has
     * moved on.
     */
    if (!this.mixer.playing) {
      this._pending = { id, opts, at: performance.now() };
      return null;
    }

    return this._start(id, def, opts);
  }

  _start(id, def, opts) {
    const now = this.player.now;
    this.pool.prune(now);
    const req = this.pool.request(def, now);
    if (!req.ok) return null;

    /**
     * The voice is built BEFORE the steal is committed.
     *
     * `Synth.play` can decline — a level under the audible floor, a definition
     * with no layers left after an edit on the panel — and a steal taken first
     * would then have killed a live voice to start nothing at all. The one that
     * bites in practice is a collision whose gain was tuned to zero: it stops
     * the sliding bed and puts nothing in its place.
     */
    const voice = this.player.play(def, {
      ...opts,
      gain: (opts?.gain ?? 1) * req.gain,
    });
    if (!voice) return null;

    if (req.steal) this._evict(req.steal);

    this.pool.add(def, voice, now);
    this.lastId = id;
    this.played++;
    return voice;
  }

  /**
   * Stop a voice the pool has chosen to give up, and forget it everywhere.
   *
   * ── the loop bookkeeping is the whole reason this is a method ───────────
   * Every held bed is in `CATEGORY.AMBIENT`, which is the bottom of the ladder
   * by construction — so whenever the pool is full, the voice it picks to steal
   * is ALWAYS a loop if one is running. Stopping it without dropping the
   * `_loops` entry leaves the system believing that bed is still playing: the
   * per-frame `setLoop` finds a record, writes into a stopped voice, and the
   * sound never comes back until its condition goes false and true again.
   *
   * Measured against the sliding bed, that is the whole of a pile-up — the one
   * moment it exists for.
   */
  _evict(rec) {
    rec.voice.stop(0.02);
    this.pool.remove(rec);
    for (const [loopId, held] of this._loops) {
      if (held.rec === rec) {
        this._loops.delete(loopId);
        break;
      }
    }
  }

  /**
   * Describe what a continuous sound should be doing this frame.
   *
   * @param {string} id
   * @param {{on: boolean, gain?: number, rate?: number, fade?: number}} state
   */
  setLoop(id, { on, gain = 1, rate = 1, fade = 0.08 } = { on: false }) {
    const held = this._loops.get(id);

    if (!on || !this.enabled) {
      if (held) {
        held.voice.stop(fade);
        this.pool.remove(held.rec);
        this._loops.delete(id);
      }
      return;
    }

    if (held) {
      held.voice.set({ gain, rate });
      return;
    }

    const def = this.sounds[id];
    if (!def) {
      if (!this._unknown.has(id)) {
        this._unknown.add(id);
        console.warn(`[audio] unknown loop "${id}"`);
      }
      return;
    }

    const now = this.player.now;
    this.pool.prune(now);
    // A loop goes through the same gate as anything else — it is exactly as
    // capable of filling the pool — but it never carries a cooldown taper,
    // because a bed that started quiet because it restarted recently would
    // never come back up.
    const req = this.pool.request(def, now);
    if (!req.ok) return;

    // Built first, stolen from second — see `_start`.
    const voice = this.player.play(def, { loop: true, gain, rate });
    if (!voice) return;
    if (req.steal) this._evict(req.steal);
    const rec = this.pool.add(def, voice, now);
    this._loops.set(id, { voice, rec });
  }

  /** Whether a loop is currently held. For the panel. */
  looping(id) {
    return this._loops.has(id);
  }

  stopLoops(fade = 0.06) {
    for (const [, held] of this._loops) {
      held.voice.stop(fade);
      this.pool.remove(held.rec);
    }
    this._loops.clear();
  }

  /** Everything, at once. For a mute, a scene change or a teardown. */
  stopAll(fade = 0.05) {
    this.stopLoops(fade);
    for (const rec of this.pool.takeAll()) rec.voice.stop(fade);
  }

  // ── per frame ─────────────────────────────────────────────────────────────

  /**
   * One render frame.
   *
   * Takes dt only so callers read like every other layer in the project; the
   * envelopes are all scheduled on the audio clock and none of them consults it.
   * That is deliberate — dt is clamped to 50 ms and a returning background tab
   * reports one short frame rather than the real gap, so anything driven from
   * accumulated dt would drift against what is actually being heard.
   */
  update(_dt) {
    if (!this.ready) return;
    this._flushPending();
    this.pool.prune(this.player.now);
    // Every frame, so a slider dragged on the panel is audible on the next
    // sound rather than on the next page load. Cheap by construction: the only
    // expensive thing behind it, the crush curve, is rebuilt solely when the bit
    // depth actually changes.
    this.mixer.applyConfig();
  }

  /**
   * Fire the sound the device was not ready for.
   *
   * Only loops self-heal without this: a held bed started into the discarded
   * window is still holding when the sink opens, so it simply becomes audible.
   * A one-shot is over by then and has to be played again.
   */
  _flushPending() {
    const held = this._pending;
    if (!held) return;
    if (!this.mixer.playing) {
      // Give up rather than firing a click into a screen that has moved on.
      if (performance.now() - held.at > PENDING_MAX_WAIT) this._pending = null;
      return;
    }
    this._pending = null;
    if (performance.now() - held.at > PENDING_MAX_WAIT) return;
    const def = this.sounds[held.id];
    if (def) this._start(held.id, def, held.opts);
  }

  get stats() {
    return {
      ready: this.ready,
      playing: this.mixer.playing,
      pending: this._pending?.id ?? '',
      voices: this.pool.count,
      loops: this._loops.size,
      dropped: this.pool.dropped,
      stolen: this.pool.stolen,
      played: this.played,
      lastId: this.lastId,
      holdReady: this.mixer.holdReady,
      holdError: this.mixer.holdError,
      state: this.mixer.ctx?.state ?? 'closed',
      sampleRate: this.mixer.ctx?.sampleRate ?? 0,
    };
  }

  dispose() {
    this._offSettings?.();
    if (this._installed) {
      const opts = { capture: true };
      document.removeEventListener('pointerdown', this._onGesture, opts);
      document.removeEventListener('keydown', this._onGesture, opts);
      document.removeEventListener('touchstart', this._onGesture, opts);
      document.removeEventListener('visibilitychange', this._onVisibility);
      this._installed = false;
    }
    this.stopAll(0.01);
    this.mixer.dispose();
  }
}
