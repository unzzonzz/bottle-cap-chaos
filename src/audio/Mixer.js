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
 * ── the room is the tone. the bit crusher used to be, and is now unity ──────
 * The original argument, and it was a good one: the screen was quantised to five
 * bits a channel and dithered on a 4x4 lattice, and the audio needed the
 * equivalent — one device applied to everything, so sixty separately-designed
 * sounds belong to one machine. It is easier to make things belong together by
 * damaging them identically than by drawing them identically.
 *
 * That screen was removed in PHASE 1. The one that replaced it is glass and
 * water and light, and ITS audio equivalent is not quantisation noise — it is a
 * short bright room. So the shared device is now the convolver below, reached
 * from every voice through a send scalar, and the crusher is left in the chain
 * at unity (`config.audio.crushBits` is 16, where the curve is `null` and the
 * node is genuinely no processing at all). Kept rather than deleted because the
 * worklet, the curve and the panel dial all still work, and the day somebody
 * wants that colour back it is a number.
 *
 * The crusher's two halves, for when that day comes:
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
 *
 * The SEND does not follow that grouping, and used to. It hangs off each voice
 * instead, because how much room a sound wants is a property of the sound: a
 * hover that fires forty times while a cursor crosses a menu and the card
 * effect it is hovering over share a bus and want opposite amounts. The
 * category table survives as the default. See `sendFor`.
 */

import { CATEGORIES } from './categories.js';

/**
 * Is this context stopped in a way a `resume()` would fix?
 *
 * ── `'interrupted'` is not in the spec and WebKit returns it anyway ──────────
 * The Web Audio spec names three states — `suspended`, `running`, `closed` — and
 * every `state === 'suspended'` test in the wild is written against that list.
 * WebKit has a fourth, and macOS Safari is WebKit: when the audio session is
 * taken away from the page the context goes to `'interrupted'`, not to
 * `'suspended'`. On a desktop that happens when the output device changes under
 * the page — headphones unplugged, a Bluetooth speaker connecting, an interface
 * switched in the sound panel — and across a sleep/wake.
 *
 * A test that only knows about `'suspended'` therefore never resumes it, and the
 * failure is total and permanent: `ready` is true (it only excludes `'closed'`),
 * every voice is scheduled without error, and nothing is ever heard again for
 * the rest of the session. The bug does not reproduce on Chrome, does not throw,
 * and nobody reports it — they close the tab.
 *
 * `resume()` on an interrupted context is the correct and documented recovery,
 * and calling it on a running one is a harmless no-op, so both callers below can
 * ask this question and act on it unconditionally. The mobile build is gone; the
 * fourth state is not, because it was never a mobile fact.
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
    /** The one convolver. Built with the context; see `_build`. */
    this._space = null;
    this._spaceIn = null;
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
     * `'interrupted'`, so `AudioSystem.play` kept scheduling voices into a
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

    /**
     * 공간. 이 게임의 예순 개 소리를 한 곳에 있게 만드는 장치.
     *
     * ── 비트 크러셔가 하던 일을 물려받는다 ─────────────────────────────────
     * 이 파일의 머리말이 크러셔의 근거를 이렇게 적었다: "화면이 채널당 5비트로
     * 양자화되고 320x240 프레임버퍼에 맞춘 4x4 격자로 디더된다. 지시서는 그것의
     * 오디오 등가물을 요구하고, 그건 옳다 — 따로 설계된 예순 개의 소리를 한 기계의
     * 것으로 만드는 유일한 장치다."
     *
     * 그 화면이 없다. 지금 화면은 유리와 물과 빛이고, 그것들의 오디오 등가물은
     * 양자화 잡음이 아니라 **공간**이다 — 짧고 밝은 잔향. 유리잔 안에서 나는 소리는
     * 어디서 나든 같은 방에서 난다.
     *
     * 보내기는 **소리마다** 다르다. UI 클릭에 잔향을 먹이면 화면이 헐거워지고,
     * 충돌음에 안 먹이면 판이 진공에 있는 것으로 들린다. 카테고리는 그 표의
     * 기본값일 뿐이고, 실제 결정은 소리 단위에서 난다 — `sendFor` 참조.
     */
    this._space = ctx.createConvolver();
    this._space.normalize = true;
    this._space.buffer = this._makeImpulse(ctx);
    this._spaceIn = ctx.createGain();
    this._spaceIn.gain.value = 1;
    this._spaceIn.connect(this._space);

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
    /**
     * 잔향은 크러셔를 거치지 않고 마스터로 바로 간다.
     *
     * 크러셔가 유니티일 때는 차이가 없지만, 패널에서 다시 켰을 때 잔향까지 부수면
     * 꼬리가 지저분해진다 — 꼬리는 이미 잔향이 만든 것이라 거기에 양자화를 얹으면
     * 두 효과가 서로를 갉아먹는다.
     */
    this._space.connect(this.master);
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
  /**
   * 잔향의 임펄스 응답. 절차적으로 만든다 — 이 프로젝트에 오디오 파일은 없다.
   *
   * ── 지수 감쇠 잡음이지만, 그냥 잡음은 아니다 ────────────────────────────
   * 기본형은 지수적으로 잦아드는 백색 잡음이다. 그것만으로도 방은 되지만 **유리
   * 방**은 안 된다 — 유리와 물의 잔향은 저역이 빨리 죽고 고역이 오래 남는다.
   * 벽이 딱딱해서 고역을 덜 먹기 때문이다. 그래서 대역별로 감쇠율을 다르게 준다:
   * 저역은 `decay` 의 두 배 속도로, 고역은 절반 속도로 사라진다.
   *
   * 초기 반사도 없다. 방의 크기를 말하는 것은 꼬리가 아니라 첫 몇 밀리초의 성긴
   * 반사이므로, 앞쪽 8% 에 몇 개의 뾰족한 점을 심는다. 그게 없으면 잔향이 방이
   * 아니라 그냥 번짐으로 들린다.
   *
   * 좌우가 다른 잡음인 것은 넓이 때문이다. 같은 잡음을 양쪽에 넣으면 잔향이
   * 가운데 한 점에서 나고, 그건 방이 아니라 스피커다.
   */
  _makeImpulse(ctx) {
    const c = this.config.space ?? {};
    const seconds = Math.max(0.05, Math.min(2, c.seconds ?? 0.42));
    const len = Math.max(1, Math.floor(ctx.sampleRate * seconds));
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    // 로컬 생성기. 공유 스트림을 여기서 수만 번 돌리면 그 뒤의 모든 피치 흔들림이
    // 기기의 샘플레이트에 의존하게 된다 — `_makeNoise` 가 같은 이유로 그렇게 한다.
    let seed = 0x9e3779b9;
    const rand = () => {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      return (seed / 0xffffffff) * 2 - 1;
    };

    const decay = Math.max(0.5, c.decay ?? 3.2);
    const early = Math.floor(len * 0.08);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      // 대역별 감쇠를 한 번의 통과로: 저역은 1극 저역통과의 출력, 고역은 그 나머지.
      let lp = 0;
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const n = rand();
        lp += (n - lp) * 0.22;
        const lowPart = lp * Math.pow(1 - t, decay * 2);
        const highPart = (n - lp) * Math.pow(1 - t, decay * 0.5);
        d[i] = (lowPart + highPart) * 0.7;
      }
      // 초기 반사. 앞쪽에 성긴 점 몇 개.
      for (let k = 0; k < 5; k++) {
        const at = Math.floor((0.12 + k * 0.19 + ch * 0.05) * early);
        if (at < len) d[at] += (1 - k * 0.16) * (ch === 0 ? 0.5 : 0.44);
      }
    }
    return buf;
  }

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

    // 보내기는 여기서 밀지 않는다. 보이스마다 붙고, `sendFor` 가 트리거 시점에
    // 읽으므로 패널에서 슬라이더를 움직이면 다음 소리부터 반영된다.

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

  /**
   * How much of this sound goes to the room.
   *
   * ── 소리 단위인 이유 ────────────────────────────────────────────────────
   * 카테고리 하나로는 표현할 수 없는 결정들이 실재한다. `card_hover` 와
   * `card_fx_smash` 는 같은 버스에 있지만 전자는 커서가 메뉴를 가로지르는 동안
   * 마흔 번 울리고 후자는 한 판에 몇 번 울린다 — 같은 잔향을 주면 호버가 방을
   * 계속 두드려서 화면이 젖은 채로 남는다. 그래서 카테고리 표는 **기본값**이고
   * 소리의 `send` 가 그것을 덮는다.
   *
   * ── 루프는 무조건 0 이고, 그것은 표가 아니라 구조다 ────────────────────
   * 지속음은 방에 끊임없이 에너지를 넣는다. 꼬리가 자기 위에 쌓여서 몇 초 뒤에는
   * 베드가 아니라 웅웅거림이 된다. 표에 0 을 적어 두는 것으로는 부족한 이유는
   * 다음에 추가될 루프가 그것을 적지 않을 것이기 때문이다.
   *
   * @param {object} def   a definition from `soundBank`
   * @param {boolean} [loop]
   * @returns {number} linear send gain, 0 for none
   */
  sendFor(def, loop = false) {
    if (loop || !def) return 0;
    const space = this.config.space ?? {};
    const mix = Math.max(0, space.mix ?? 0);
    if (mix <= 0) return 0;
    const own = def.send;
    const amount = own != null ? own : (space.category?.[def.category] ?? 0);
    return mix * Math.max(0, amount);
  }

  /** The room's input. Voices tap themselves into it. @type {AudioNode|null} */
  get spaceIn() {
    return this._spaceIn ?? null;
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
    this._space = null;
    this._spaceIn = null;
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
