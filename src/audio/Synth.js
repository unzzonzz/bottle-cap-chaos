import { SoundPlayer, Voice } from './SoundPlayer.js';
import { audioFloat, jitter } from './audioRng.js';

/**
 * The procedural player: a sound definition in, a running voice graph out.
 *
 * ── the whole palette is three things ──────────────────────────────────────
 * An oscillator, a second optional oscillator, and filtered white noise. That is
 * the entire vocabulary, and keeping it that small is what the brief means by a
 * common palette: sixty sounds built out of the same three parts cannot drift
 * into sounding like sixty different games. The variety comes from the numbers —
 * waveform, frequency, glide, envelope, filter sweep, and a step count that
 * turns one oscillator into an arpeggio — never from a new kind of node.
 *
 * There is deliberately no reverb, no delay, no chorus and no wavetable. The
 * brief rules the first three out for being the wrong era; the fourth is ruled
 * out by the same argument that keeps the render pipeline to five bits a
 * channel — a sound that could not have come out of a 1994 console does not
 * belong in a game that looks like one.
 *
 * ── one oscillator, N steps ────────────────────────────────────────────────
 * `steps` retriggers the SAME oscillator at a multiplying frequency rather than
 * allocating one per note. Two reasons, and the second is the real one: N
 * oscillators is N times the node churn on a card play, and — more importantly —
 * a stepped single oscillator is monophonic by construction, so an arpeggio can
 * never accidentally stack into a chord when the step gap is dragged shorter
 * than the decay on the panel.
 *
 * ── shared noise, random offset ────────────────────────────────────────────
 * Every noise layer reads the one buffer `Mixer` built, from a random start
 * position. Indistinguishable from fresh noise, and it means a chain of eight
 * collisions allocates eight cheap `BufferSource`s rather than filling eight
 * two-second buffers inside a single frame.
 *
 * ── nothing here knows what a cap is ───────────────────────────────────────
 * This file takes definitions and modifiers. It has never heard of a collision,
 * a card or a turn — those live in the observers, which decide WHAT to play and
 * hand the intensity down. That is the line the brief draws and it is drawn here.
 */

/** Ramps cannot reach zero exponentially. This is the floor every decay lands on. */
const SILENCE = 0.0001;

/** Below this a layer is not built at all. */
const MIN_GAIN = 0.0005;

export class SynthVoice extends Voice {
  constructor(synth, def, endsAt) {
    super();
    this.synth = synth;
    this.def = def;
    this._endsAt = endsAt;
    this._stopped = false;
    /** @type {AudioScheduledSourceNode[]} */
    this.sources = [];
    /** Everything that must be disconnected when this voice retires. */
    this.nodes = [];
    /** The per-voice gain the caller writes through `set`. */
    this.out = null;
    /** Layer records, so `set({rate})` can move every frequency together. */
    this.layers = [];
    this.loop = false;
  }

  get endsAt() {
    return this._endsAt;
  }

  get playing() {
    return !this._stopped && this.synth.now < this._endsAt;
  }

  /**
   * Move a running voice. For the continuous sounds, once per render frame.
   *
   * `setTargetAtTime` rather than an assignment: this is called at the display's
   * rate against a graph running at the device's, so a written value is a step
   * every frame — which is a buzz at frame rate, laid over whatever the sound
   * actually is. The time constant is short enough to track a pull and long
   * enough to smooth the steps.
   */
  set({ gain, rate } = {}) {
    if (this._stopped || !this.synth.ready) return;
    const now = this.synth.now;
    const tau = Math.max(0.001, this.synth.config.smoothingSeconds ?? 0.02);

    if (gain !== undefined && this.out) {
      // Through the definition's own level, exactly as `play` applied it, so a
      // caller writing `set({ gain: 1 })` gets the sound at the level the bank
      // says it is — not at full scale.
      const level = Math.max(0, gain) * Math.max(0, this.def?.gain ?? 1);
      this.out.gain.setTargetAtTime(level, now, tau);
    }

    if (rate !== undefined) {
      const r = Math.max(0.05, rate);
      for (const layer of this.layers) {
        if (layer.osc) {
          layer.osc.frequency.setTargetAtTime(layer.baseFreq * r, now, tau);
        }
        if (layer.source) {
          layer.source.playbackRate.setTargetAtTime(layer.baseRate * r, now, tau);
        }
        if (layer.filter) {
          layer.filter.frequency.setTargetAtTime(
            clampFreq(layer.baseFilterFreq * r, this.synth.nyquist),
            now,
            tau,
          );
        }
      }
    }
  }

  /**
   * Let go.
   *
   * Always ramped, never cut. A source stopped while its gain is non-zero is a
   * step discontinuity and therefore a click, and a click is the one artefact
   * that reads as a fault rather than as a texture — which matters more here
   * than anywhere, because the loops are the sounds most likely to be stopped
   * while still audible (a turn ending under a sliding cap, a card expiring
   * under the stun hum).
   */
  stop(fade = 0.04) {
    if (this._stopped) return;
    this._stopped = true;

    /**
     * ── the sources are stopped even when the device is not ready ──────────
     * This used to return here if the synth reported not-ready, marking the
     * voice stopped without stopping anything. For a one-shot that is harmless
     * — it has a scheduled `stop` already. For a LOOP it is a voice that plays
     * forever: a looping `BufferSource` with no stop time never fires `onended`,
     * so `release` never runs, nothing is disconnected, and the only thing that
     * knew about it has just forgotten it.
     *
     * So the ramp is skipped when there is no clock to schedule it on, and the
     * stop is not.
     */
    const ready = this.synth.ready;
    if (!ready) {
      for (const s of this.sources) {
        try {
          s.stop();
        } catch {
          /* never started, or already stopped */
        }
      }
      return;
    }

    const now = this.synth.now;
    const end = now + Math.max(0.005, fade);
    if (this.out) {
      const g = this.out.gain;
      g.cancelScheduledValues(now);
      g.setValueAtTime(Math.max(SILENCE, g.value), now);
      g.exponentialRampToValueAtTime(SILENCE, end);
    }
    for (const s of this.sources) {
      try {
        s.stop(end);
      } catch {
        /* already stopped, or never started */
      }
    }
    this._endsAt = end;
  }

  /** Called from the last source's `onended`. Nothing may reach it after this. */
  release() {
    this._stopped = true;
    for (const n of this.nodes) {
      try {
        n.disconnect();
      } catch {
        /* already detached */
      }
    }
    this.nodes.length = 0;
    this.sources.length = 0;
    this.layers.length = 0;
    this.out = null;
  }
}

export class Synth extends SoundPlayer {
  /**
   * @param {import('./Mixer.js').Mixer} mixer
   * @param {typeof import('../game/config.js').CONFIG.audio} config
   */
  constructor(mixer, config) {
    super();
    this.mixer = mixer;
    this.config = config;
  }

  get ready() {
    return this.mixer.ready;
  }

  get now() {
    return this.mixer.now;
  }

  get nyquist() {
    return this.mixer.ctx ? this.mixer.ctx.sampleRate / 2 : 22050;
  }

  /**
   * Build and start one voice.
   *
   * @param {object} def   a definition from `soundBank`
   * @param {import('./SoundPlayer.js').PlayOptions} [opts]
   * @returns {SynthVoice|null}
   */
  play(def, opts = {}) {
    if (!this.ready || !def) return null;
    const ctx = this.mixer.ctx;
    const bus = this.mixer.busFor(def.category);
    if (!bus) return null;

    const loop = !!opts.loop;
    const intensity = clamp01(opts.intensity ?? 1);

    // ── the physical mapping, in one place ─────────────────────────────────
    // "충돌음은 충돌 세기에 따라 볼륨과 피치가 변한다. 고정음 쓰지 마라." Every
    // sound carries how much of each it wants, so a UI click can opt out
    // entirely (all three at 0) while a collision opts all the way in — without
    // either of them being a special case anywhere else.
    const velGain = clamp01(def.velGain ?? 0);
    const velPitch = clamp01(def.velPitch ?? 0);
    const velLength = clamp01(def.velLength ?? 0);

    // Perceptual rather than linear: loudness is roughly the 0.6 power of
    // amplitude, so a linear map makes every collision below about half
    // strength sound like the same very quiet thing.
    const shaped = Math.pow(intensity, 0.6);
    const velGainMul = 1 - velGain + velGain * shaped;
    const velPitchMul = 1 + velPitch * (shaped - 0.5);
    const lengthMul = 1 - velLength + velLength * (0.45 + 0.55 * shaped);

    const spread = Math.max(0, (this.config.pitchJitter ?? 0) * (def.jitter ?? 1));
    const rate = Math.max(0.05, (opts.rate ?? 1) * velPitchMul * jitter(spread));

    const gain =
      Math.max(0, def.gain ?? 1) * Math.max(0, opts.gain ?? 1) * velGainMul;
    if (gain < MIN_GAIN) return null;

    const t0 = this.now + Math.max(0, opts.when ?? 0);

    const voice = new SynthVoice(this, def, t0);
    voice.loop = loop;

    const out = ctx.createGain();
    // The caller's level is applied here and nowhere else, so `set({gain})` on a
    // loop moves exactly the same number the trigger set.
    out.gain.value = gain;
    out.connect(bus);
    voice.out = out;
    voice.nodes.push(out);

    let end = t0;
    for (const key of ['tone', 'tone2']) {
      const layer = def[key];
      if (!layer) continue;
      end = Math.max(end, this._buildTone(ctx, voice, layer, { t0, rate, loop, lengthMul }));
    }
    if (def.noise) {
      end = Math.max(end, this._buildNoise(ctx, voice, def.noise, { t0, rate, loop, lengthMul }));
    }

    if (!voice.sources.length) {
      out.disconnect();
      return null;
    }

    voice._endsAt = loop ? Infinity : end;

    // One source owns the teardown. `onended` fires once per source, and hanging
    // the disconnect off every one of them would tear the graph down when the
    // SHORTEST layer finished — cutting the tail off any sound whose noise burst
    // is briefer than its tone, which is most of them.
    const last = voice.sources.reduce((a, b) => (nodeEnd(a) >= nodeEnd(b) ? a : b));
    last.onended = () => voice.release();

    return voice;
  }

  /**
   * One oscillator layer, optionally stepped into an arpeggio.
   *
   * @returns {number} the audio time this layer finishes at
   */
  _buildTone(ctx, voice, layer, { t0, rate, loop, lengthMul }) {
    const g = Math.max(0, layer.gain ?? 1);
    if (g < MIN_GAIN) return t0;

    const osc = ctx.createOscillator();
    osc.type = layer.wave ?? 'square';

    const amp = ctx.createGain();
    amp.gain.value = 0;

    /** @type {BiquadFilterNode|null} */
    let filter = null;
    if (layer.filter) filter = this._buildFilter(ctx, layer.filter, { t0, rate, loop });

    if (filter) {
      osc.connect(filter);
      filter.connect(amp);
      voice.nodes.push(filter);
    } else {
      osc.connect(amp);
    }
    amp.connect(voice.out);
    voice.nodes.push(amp);

    const steps = loop ? 1 : Math.max(1, Math.round(layer.steps ?? 1));
    const gap = Math.max(0.001, layer.stepGap ?? 0.06);
    const stepRatio = layer.stepRatio ?? 1;
    const stepGain = layer.stepGain ?? 1;

    const baseFreq = clampFreq((layer.freq ?? 220) * rate, this.nyquist);
    const endFreq = clampFreq((layer.freqEnd ?? layer.freq ?? 220) * rate, this.nyquist);

    const attack = Math.max(0.0005, layer.attack ?? 0.002);
    const hold = Math.max(0, layer.hold ?? 0) * lengthMul;
    const decay = Math.max(0.005, layer.decay ?? 0.1) * lengthMul;

    /**
     * ── a step must FIT between itself and the next one ────────────────────
     * Every step writes its own attack/hold/decay onto one shared AudioParam
     * timeline. If a step's envelope is longer than the gap to the next, the
     * next step's opening `setValueAtTime(SILENCE)` lands in the middle of the
     * previous decay — which does not shorten it, it CUTS it: the earlier note
     * holds at full level and then steps to zero, which is a click, and every
     * note after it decays over whatever was left of the gap instead of over
     * the time the table asks for.
     *
     * `cap_flip` is the case that made this audible — three steps 32 ms apart
     * carrying a 50 ms decay — and it fires on every cap that turns over.
     *
     * So a step that would overrun is scaled to fit, shape intact. Scaling
     * rather than truncating keeps the attack proportional: a note squeezed
     * into a third of the room should not spend all of it attacking.
     */
    const span = attack + hold + decay;
    const room = steps > 1 ? Math.min(span, gap * 0.94) : span;
    const k = span > 0 ? room / span : 1;
    const a = attack * k;
    const h = hold * k;
    const d = decay * k;

    let finish = t0;
    for (let i = 0; i < steps; i++) {
      const at = t0 + i * gap;
      const mul = Math.pow(stepRatio, i);
      const from = clampFreq(baseFreq * mul, this.nyquist);
      const to = clampFreq(endFreq * mul, this.nyquist);

      osc.frequency.setValueAtTime(from, at);
      if (Math.abs(to - from) > 0.5) {
        // Exponential, because pitch is logarithmic: a linear sweep from 800 to
        // 80 spends most of its time in the top octave and arrives as a thud
        // with a click on the front, rather than as a fall.
        osc.frequency.exponentialRampToValueAtTime(to, at + a + h + d);
      }

      const peak = g * Math.pow(stepGain, i);
      finish = this._envelope(amp.gain, {
        at,
        peak,
        attack: a,
        hold: h,
        decay: d,
        loop: loop && i === steps - 1,
        curve: layer.curve,
      });
    }

    osc.start(t0);
    if (!loop) osc.stop(finish + 0.02);
    // A node does not report the time it was told to stop at, and `play` has to
    // know which source outlives the others so the teardown hangs off that one.
    osc.__bccEnd = finish;
    voice.sources.push(osc);
    voice.layers.push({
      osc,
      filter,
      /**
       * The WRITTEN frequency, not the one this trigger started at.
       *
       * `set({rate})` multiplies by the rate it is given, so storing the
       * already-multiplied value applies the start rate a second time on every
       * later write — a loop created at rate 0.7 and then told 0.7 again lands
       * at 0.49, and its range is squashed by whatever it opened on. The noise
       * layer's `baseRate` and the filter's `baseFilterFreq` are both stored
       * un-multiplied for this reason; this one was not, and it is the same
       * quantity.
       */
      baseFreq: layer.freq ?? 220,
      baseFilterFreq: layer.filter?.freq ?? 0,
    });
    return finish;
  }

  /** One filtered-noise layer. @returns {number} finish time */
  _buildNoise(ctx, voice, layer, { t0, rate, loop, lengthMul }) {
    const g = Math.max(0, layer.gain ?? 1);
    if (g < MIN_GAIN || !this.mixer.noiseBuffer) return t0;

    const src = ctx.createBufferSource();
    src.buffer = this.mixer.noiseBuffer;
    src.loop = true;
    // Noise has no pitch, but the buffer does have a rate, and moving it with
    // the voice keeps a filtered burst's character consistent when the whole
    // sound is transposed.
    const baseRate = Math.max(0.05, layer.rate ?? 1);
    src.playbackRate.value = baseRate * rate;

    const amp = ctx.createGain();
    amp.gain.value = 0;

    /** @type {BiquadFilterNode|null} */
    let filter = null;
    if (layer.filter) filter = this._buildFilter(ctx, layer.filter, { t0, rate, loop });

    if (filter) {
      src.connect(filter);
      filter.connect(amp);
      voice.nodes.push(filter);
    } else {
      src.connect(amp);
    }
    amp.connect(voice.out);
    voice.nodes.push(amp);

    const attack = Math.max(0.0005, layer.attack ?? 0.001);
    const hold = Math.max(0, layer.hold ?? 0) * lengthMul;
    const decay = Math.max(0.005, layer.decay ?? 0.08) * lengthMul;

    const finish = this._envelope(amp.gain, {
      at: t0,
      peak: g,
      attack,
      hold,
      decay,
      loop,
      curve: layer.curve,
    });

    // A random start, so two collisions on the same frame are not the same
    // noise burst played twice — which is audible as a phasing doubling rather
    // than as two hits.
    const offset = audioFloat() * Math.max(0, this.mixer.noiseBuffer.duration - 0.5);
    src.start(t0, offset);
    if (!loop) src.stop(finish + 0.02);
    src.__bccEnd = finish;
    voice.sources.push(src);
    voice.layers.push({
      source: src,
      filter,
      baseRate,
      baseFilterFreq: layer.filter?.freq ?? 0,
    });
    return finish;
  }

  /**
   * A biquad with an optional sweep.
   *
   * The sweep is most of what makes the metallic sounds metallic: a noise burst
   * through a bandpass falling from 4 kHz to 700 Hz in 90 ms is a struck sheet,
   * and the same burst through a fixed filter is a puff of air.
   */
  _buildFilter(ctx, spec, { t0, rate, loop }) {
    const f = ctx.createBiquadFilter();
    f.type = spec.type ?? 'lowpass';
    f.Q.value = Math.max(0.0001, spec.q ?? 1);
    const from = clampFreq((spec.freq ?? 1000) * rate, this.nyquist);
    const to = clampFreq((spec.freqEnd ?? spec.freq ?? 1000) * rate, this.nyquist);
    f.frequency.setValueAtTime(from, t0);
    if (!loop && Math.abs(to - from) > 1) {
      f.frequency.exponentialRampToValueAtTime(to, t0 + Math.max(0.005, spec.sweep ?? 0.09));
    }
    return f;
  }

  /**
   * Attack, hold, decay, on one AudioParam. Returns when it is done.
   *
   * Nothing here sustains except a loop, and that is the brief: "빠른 어택, 짧은
   * 디케이. 길게 늘어지는 소리 금지". A held sound is a deliberate exception with
   * its own reason to exist (a bow being drawn, a cap sliding), never the
   * default shape of an effect.
   */
  _envelope(param, { at, peak, attack, hold, decay, loop, curve }) {
    const top = Math.max(SILENCE, peak);
    param.setValueAtTime(SILENCE, at);
    param.linearRampToValueAtTime(top, at + attack);
    const holdEnd = at + attack + hold;
    if (hold > 0) param.setValueAtTime(top, holdEnd);
    if (loop) return holdEnd;
    if (curve === 'lin') param.linearRampToValueAtTime(SILENCE, holdEnd + decay);
    else param.exponentialRampToValueAtTime(SILENCE, holdEnd + decay);
    return holdEnd + decay;
  }
}

function clamp01(v) {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Keep every scheduled frequency inside the band the device can represent. */
function clampFreq(hz, nyquist) {
  if (!Number.isFinite(hz)) return 20;
  return Math.max(10, Math.min(nyquist * 0.94, hz));
}

/** Nodes do not report their own stop time; this is only used to pick the last. */
function nodeEnd(node) {
  return node.__bccEnd ?? 0;
}
