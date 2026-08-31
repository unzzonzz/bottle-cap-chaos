/**
 * The device, the buses, and the one effect the whole game goes through.
 *
 * ── nothing exists until a gesture ──────────────────────────────────────────
 * The constructor builds NO `AudioContext`. Browsers refuse to start one before
 * a user gesture, and a context created at module load arrives `suspended`,
 * which is not an error but is also not a working audio system — every sound
 * scheduled into it is silently swallowed and the first thing anybody hears is
 * whatever happened to be scheduled after the eventual resume. So the graph is
 * built inside `unlock()`, which is called from a real press, and every call
 * before that is a no-op rather than a queue.
 *
 * ── the bit crusher is the tone, not a decoration ───────────────────────────
 * The screen is quantised to five bits a channel and dithered on a 4x4 lattice
 * keyed to a 320x240 framebuffer. The brief asks for the audio equivalent and is
 * right to: it is the single device that makes sixty separately-designed sounds
 * belong to one machine. Two halves, and they are different effects:
 *
 *   BIT DEPTH   a `WaveShaperNode` whose curve is a staircase. Exact, cheap,
 *               synchronous, and available on every browser that has Web Audio
 *               at all. This is the one that must always work.
 *   SAMPLE RATE sample-and-hold, which no built-in node does. It needs an
 *               `AudioWorklet`, and the worklet is loaded from a BLOB URL built
 *               out of a string in this file — so it needs no build
 *               configuration, no separate asset, and no exception to "no audio
 *               files": it is code, and it ships inside the bundle like the rest
 *               of the code.
 *
 * The worklet is optional by construction. `addModule` is asynchronous and can
 * fail (an old browser, a CSP that refuses blob workers), and when it does the
 * chain is simply bit-depth only. That is a real degradation and it is a quiet
 * one, which is the correct trade for an effect: a game that refuses to make any
 * sound because it could not reduce the sample rate would be a worse game.
 *
 * ── the limiter ────────────────────────────────────────────────────────────
 * Eight caps in a chain can put half a dozen impacts inside 50 ms even after the
 * voice cap and the priority rules have thrown most of them away. Summed at
 * unity that clips, and a clipped Web Audio graph does not sound like a loud
 * game — it sounds broken. The compressor on the end is a safety limiter and
 * nothing else: it is not there for glue, it is there so the worst case is
 * quieter rather than distorted.
 *
 * ── buses ──────────────────────────────────────────────────────────────────
 * One gain per category, because the brief asks the debug panel for per-category
 * volume and because ducking a whole class of sound is otherwise sixty separate
 * multiplications. Master sits after the sum so the settings screen's slider and
 * the panel's category trims cannot fight.
 */

import { CATEGORIES } from './categories.js';

/**
 * Is this context stopped in a way a `resume()` would fix?
 *
 * ── `'interrupted'` is not in the spec and iOS returns it anyway ─────────────
 * The Web Audio spec names three states — `suspended`, `running`, `closed` — and
 * every `state === 'suspended'` test in the wild is written against that list.
 * WebKit has a fourth. When the audio session is taken away from the page — a
 * phone call, Siri, another app claiming the route, a CarPlay connection, or the
 * app being sent to the background — the context goes to `'interrupted'`, not to
 * `'suspended'`.
 *
 * A test that only knows about `'suspended'` therefore never resumes it, and the
 * failure is total and permanent: `ready` is true (it only excludes `'closed'`),
 * every voice is scheduled without error, and nothing is ever heard again for
 * the rest of the session. On a phone that is one incoming call away, so it is
 * not an edge case — it is the normal path.
 *
 * `resume()` on an interrupted context is the correct and documented recovery,
 * and calling it on a running one is a harmless no-op, so both callers below can
 * ask this question and act on it unconditionally.
 */
function needsResume(ctx) {
  return ctx.state === 'suspended' || ctx.state === 'interrupted';
}

/**
 * The sample-and-hold processor, as source.
 *
 * Written as a string because it has to be compiled in the audio thread's own
 * global scope, which no import can reach. A blob URL is the one way to do that
 * without a build-config entry — see the header.
 *
 * `holdFrames` is an AudioParam rather than a message port value so the panel's
 * slider lands sample-accurately and needs no plumbing. `k-rate` because a
 * sample rate that changed WITHIN a render quantum is not a thing anybody wants
 * and a-rate would cost 128 divisions a block for it.
 */
const HOLD_WORKLET_SOURCE = `
class HoldProcessor extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [{ name: 'holdFrames', defaultValue: 1, minValue: 1, maxValue: 64, automationRate: 'k-rate' }];
  }

  constructor() {
    super();
    this._held = [];
    this._phase = 0;
  }

  process(inputs, outputs, params) {
    const input = inputs[0];
    const output = outputs[0];
    if (!input || input.length === 0) return true;

    // Rounded once per block, for the reason the rate is k-rate at all.
    const hold = Math.max(1, Math.round(params.holdFrames[0]));

    // Straight through at 1, and that is worth a branch: the whole effect is
    // off at the default and the default is what most of a session runs at.
    if (hold === 1) {
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        if (src) output[c].set(src);
      }
      return true;
    }

    const frames = output[0].length;
    while (this._held.length < output.length) this._held.push(0);

    for (let i = 0; i < frames; i++) {
      // One phase for every channel, so the channels are held together and the
      // image does not smear when they drift apart.
      const take = this._phase === 0;
      for (let c = 0; c < output.length; c++) {
        const src = input[c] || input[0];
        if (take) this._held[c] = src ? src[i] : 0;
        output[c][i] = this._held[c];
      }
      this._phase = (this._phase + 1) % hold;
    }
    return true;
  }
}
registerProcessor('bcc-hold', HoldProcessor);
`;

/** How many points the bit-crush curve is sampled at. */
const CURVE_POINTS = 8192;

export class Mixer {
  /** @param {typeof import('../game/config.js').CONFIG.audio} config  live block */
  constructor(config) {
    this.config = config;

    /** @type {AudioContext|null} Built on the first gesture, never before. */
    this.ctx = null;
    /** @type {GainNode|null} */
    this.master = null;
    /** @type {Record<string, GainNode>} */
    this.buses = {};
    /** Shared white noise, built once with the context. @type {AudioBuffer|null} */
    this.noiseBuffer = null;

    this._shaper = null;
    this._hold = null;
    this._limiter = null;
    this._sum = null;
    this._curveBits = -1;
    /** Whether the worklet is in the chain. Read by the panel. */
    this.holdReady = false;
    /** Why it is not, if it is not. Read by the panel. */
    this.holdError = '';

    this._muted = false;
    this._masterVolume = 1;
    /** Last value actually ramped to. See `_applyMaster`. */
    this._masterTarget = -1;
    this._suspendedByPage = false;
    /** Latched once the output device is genuinely playing. See `playing`. */
    this._playing = false;
  }

  get ready() {
    return !!this.ctx && this.ctx.state !== 'closed';
  }

  /** What the context is doing, for the panel and the report. */
  get state() {
    return this.ctx ? this.ctx.state : 'none';
  }

  get now() {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /**
   * Is the output device ACTUALLY playing yet?
   *
   * ── `state === 'running'` is not the same question ──────────────────────
   * A context created inside a gesture reports `running` immediately and its
   * `currentTime` starts advancing straight away — but the hardware sink may
   * take anything from a few milliseconds to a couple of SECONDS to open, and
   * everything rendered before it does is discarded. Cold output, an exclusive-
   * mode driver or a Bluetooth device are all routinely at the slow end.
   *
   * The symptom is precise and was reported exactly: the very first sound is
   * missing, and everything from a second or two later is fine. It is the worst
   * possible sound to lose, because the first gesture and the first sound are
   * the SAME event — the press that unlocks audio is the press that should
   * click.
   *
   * `getOutputTimestamp().contextTime` is the only honest signal available: it
   * reports the time of the frame currently leaving the device, so it stays at
   * zero for exactly as long as nothing is being heard. `currentTime` cannot
   * answer this — it advances throughout the discarded window, which is what
   * makes the failure invisible from inside.
   *
   * Latched, because it only ever goes one way and the query is not free.
   */
  get playing() {
    if (!this.ctx) return false;
    /**
     * The latch falls when the context stops running, and that check comes
     * FIRST — before the latch is consulted.
     *
     * It used to be second, which made the latch one-way for the lifetime of the
     * page: once true, `playing` answered true through a suspend and through an
     * iOS `'interrupted'`, so `AudioSystem.play` kept scheduling voices into a
     * context with no open sink and the `_pending` hold that exists to protect
     * the first sound after a stall never engaged. The sink really does close on
     * an interruption and really does have to reopen, so the honest answer while
     * it is shut is no.
     */
    if (this.ctx.state !== 'running') {
      this._playing = false;
      return false;
    }
    if (this._playing) return true;
    const stamp = this.ctx.getOutputTimestamp?.();
    if (!stamp || !Number.isFinite(stamp.contextTime)) {
      // No way to ask. Assume the device is up rather than holding sound back
      // forever on a browser that simply does not implement the probe.
      this._playing = true;
      return true;
    }
    if (stamp.contextTime > 0) this._playing = true;
    return this._playing;
  }

  /**
   * Start the device. Safe to call on every gesture; only the first does work.
   *
   * ── it also RESUMES ────────────────────────────────────────────────────────
   * A context can be created in the `suspended` state even from inside a
   * gesture — Safari does this — and it can be suspended again by the browser
   * later for reasons nothing here is told about. So the resume is unconditional
   * rather than part of the construction branch, and every gesture gets one.
   * `resume()` on a running context is a no-op that returns a resolved promise.
   */
  unlock() {
    if (!this.ctx) {
      const Ctor = window.AudioContext || window.webkitAudioContext;
      if (!Ctor) return false;
      try {
        this.ctx = new Ctor({ latencyHint: 'interactive' });
      } catch {
        // No device, or too many contexts. There is nothing useful to do about
        // it and a game that cannot make a sound must still be playable.
        this.ctx = null;
        return false;
      }
      this._build();
      this._loadHoldWorklet();
    }
    if (needsResume(this.ctx) && !this._suspendedByPage) {
      this.ctx.resume().catch(() => {});
      // The sink has to reopen after an interruption, and the latch says it is
      // already open. Dropping it puts `playing` back on the real probe, which
      // is the whole reason that probe exists — see the note on `playing`.
      this._playing = false;
    }
    return true;
  }

  _build() {
    const ctx = this.ctx;

    this.master = ctx.createGain();
    this._limiter = ctx.createDynamicsCompressor();
    // A limiter, not a compressor: it must do nothing at all until the sum is
    // genuinely too loud, and then hold it rather than shape it.
    this._limiter.threshold.value = -6;
    this._limiter.knee.value = 0;
    this._limiter.ratio.value = 20;
    this._limiter.attack.value = 0.003;
    this._limiter.release.value = 0.12;

    this._shaper = ctx.createWaveShaper();
    // No oversampling. Oversampling exists to keep a waveshaper from aliasing,
    // and the aliasing IS the effect here — a clean bit crusher is a contradiction.
    this._shaper.oversample = 'none';

    this._sum = ctx.createGain();
    this._sum.gain.value = 1;

    for (const name of CATEGORIES) {
      const g = ctx.createGain();
      g.gain.value = 1;
      g.connect(this._sum);
      this.buses[name] = g;
    }

    // The chain, with the worklet's slot left empty until it loads. Reconnected
    // in `_insertHold` rather than built twice.
    this._sum.connect(this._shaper);
    this._shaper.connect(this.master);
    this.master.connect(this._limiter);
    this._limiter.connect(ctx.destination);

    this.noiseBuffer = this._makeNoise(ctx);
    this.applyConfig();
    this._applyMaster();
  }

  /**
   * Two seconds of white noise, shared by every voice that wants any.
   *
   * One buffer rather than one per trigger: a `BufferSource` is cheap and
   * disposable but FILLING a buffer is not, and a chain of eight collisions
   * would otherwise allocate and fill eight of them inside one frame. Every
   * noise voice reads the same buffer from a random offset, which is
   * indistinguishable from fresh noise and costs nothing.
   *
   * Seeded from the audio stream, so it is not `Math.random` and it is not the
   * game's — see `audioRng`.
   */
  _makeNoise(ctx) {
    const seconds = 2;
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    // Local generator rather than the shared one: filling 96000 samples through
    // the shared stream would advance it by 96000 draws and make every pitch
    // jitter afterwards depend on the device's sample rate.
    let a = 0x1a2b3c4d;
    for (let i = 0; i < len; i++) {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      data[i] = (((t ^ (t >>> 14)) >>> 0) / 2147483648) - 1;
    }
    return buf;
  }

  async _loadHoldWorklet() {
    const ctx = this.ctx;
    if (!ctx?.audioWorklet) {
      this.holdError = 'AudioWorklet 미지원';
      return;
    }
    let url = null;
    try {
      const blob = new Blob([HOLD_WORKLET_SOURCE], { type: 'application/javascript' });
      url = URL.createObjectURL(blob);
      await ctx.audioWorklet.addModule(url);
      // The context may have been torn down while we waited.
      if (!this.ctx || this.ctx !== ctx) return;
      this._insertHold(new AudioWorkletNode(ctx, 'bcc-hold'));
    } catch (err) {
      this.holdError = String(err?.message ?? err);
    } finally {
      if (url) URL.revokeObjectURL(url);
    }
  }

  /** Splice the worklet in between the shaper and the master. */
  _insertHold(node) {
    this._hold = node;
    this._shaper.disconnect();
    this._shaper.connect(this._hold);
    this._hold.connect(this.master);
    this.holdReady = true;
    this.applyConfig();
  }

  /**
   * Push every live number from the config onto the graph.
   *
   * Called on construction, on every config change the panel makes, and from the
   * panel's 전체 리셋 — `resetConfig` restores numbers and nothing else, so a
   * graph holding a copied value keeps the pre-reset one forever without this.
   * That failure is documented for the HUD and the victory screen in
   * `PhysicsDebug`'s reset handler; this is the audio entry on the same list.
   */
  applyConfig() {
    if (!this.ctx) return;
    const c = this.config;

    for (const name of CATEGORIES) {
      const bus = this.buses[name];
      if (bus) bus.gain.value = Math.max(0, c.category?.[name] ?? 1);
    }

    const bits = Math.max(1, Math.min(16, Math.round(c.crushBits ?? 16)));
    if (bits !== this._curveBits) {
      this._curveBits = bits;
      this._shaper.curve = bits >= 16 ? null : makeCrushCurve(bits);
    }

    if (this._hold) {
      const target = Math.max(1000, Math.min(this.ctx.sampleRate, c.crushRateHz ?? 48000));
      const frames = Math.max(1, Math.min(64, Math.round(this.ctx.sampleRate / target)));
      this._hold.parameters.get('holdFrames').value = frames;
    }

    this._applyMaster();
  }

  /** @param {number} v 0..1 */
  setMasterVolume(v) {
    this._masterVolume = Math.max(0, Math.min(1, v));
    this._applyMaster();
  }

  setMuted(on) {
    this._muted = !!on;
    this._applyMaster();
  }

  get muted() {
    return this._muted;
  }

  get masterVolume() {
    return this._masterVolume;
  }

  _applyMaster() {
    if (!this.master) return;
    const target = this._muted ? 0 : this._masterVolume * Math.max(0, this.config.masterTrim ?? 1);
    // Guarded, because `applyConfig` runs every render frame: an unguarded ramp
    // would cancel and re-schedule itself sixty times a second and therefore
    // never actually arrive — the gain would sit a frame short of its target
    // forever, which is quieter than asked for and impossible to see.
    if (Math.abs(target - this._masterTarget) < 1e-4) return;
    this._masterTarget = target;
    // Ramped rather than assigned: a master gain written straight to zero in the
    // middle of a ringing voice is a step discontinuity, which is a click — the
    // one artefact that reads as a bug rather than as a style.
    const now = this.now;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(target, now + 0.02);
  }

  /** @param {string} category @returns {AudioNode|null} */
  busFor(category) {
    return this.buses[category] ?? this.buses.ui ?? null;
  }

  /**
   * The tab went away.
   *
   * Flagged as well as suspended, because `unlock()` resumes on every gesture
   * and a gesture can be delivered to a hidden document — a keypress reaches a
   * background tab in some browsers. Without the flag, the tab that was
   * deliberately silenced would start making noise again off an event nobody
   * could see the result of.
   */
  suspend() {
    this._suspendedByPage = true;
    if (this.ctx && this.ctx.state === 'running') this.ctx.suspend().catch(() => {});
  }

  resume() {
    this._suspendedByPage = false;
    if (this.ctx && needsResume(this.ctx)) {
      this.ctx.resume().catch(() => {});
      this._playing = false;
    }
  }

  /**
   * Ramp the master down over `seconds` and then stop.
   *
   * For a page navigation: the document is thrown away 180 ms after the fade
   * starts, and a context torn down mid-voice clicks. The ramp is scheduled on
   * the AUDIO clock, so it completes whether or not any more render frames
   * arrive — which they may not, since a fading page is often a hidden one.
   */
  fadeOut(seconds = 0.18) {
    if (!this.master) return;
    const now = this.now;
    const g = this.master.gain;
    g.cancelScheduledValues(now);
    g.setValueAtTime(g.value, now);
    g.linearRampToValueAtTime(0.0001, now + Math.max(0.02, seconds));
    /**
     * And forget what the master was last ramped TO.
     *
     * `_applyMaster` skips when the target has not changed, and this write went
     * behind its back — so without invalidating the latch, the guard would
     * refuse to ramp back up to the very value it still believes is in force.
     * The page usually dies immediately after this call, which is precisely why
     * it is easy to miss: the one path where it does not is the browser's Back
     * button, where the document returns from the cache with its JS state intact
     * and a master gain pinned at zero.
     */
    this._masterTarget = -1;
  }

  dispose() {
    if (!this.ctx) return;
    try {
      this.ctx.close();
    } catch {
      /* already closed, or closing; nothing depends on it succeeding */
    }
    this.ctx = null;
    this.master = null;
    this.buses = {};
    this._hold = null;
    this.holdReady = false;
    this._playing = false;
    this._masterTarget = -1;
  }
}

/**
 * A staircase from -1 to 1 with `2^bits` treads.
 *
 * Rounded rather than floored so the curve is symmetric about zero: a floored
 * quantiser puts a DC step at silence, which every voice then clicks through on
 * its way in and out.
 */
export function makeCrushCurve(bits) {
  const levels = Math.pow(2, Math.max(1, Math.min(16, bits)));
  const curve = new Float32Array(CURVE_POINTS);
  for (let i = 0; i < CURVE_POINTS; i++) {
    const x = (i / (CURVE_POINTS - 1)) * 2 - 1;
    curve[i] = Math.round(x * levels) / levels;
  }
  return curve;
}
