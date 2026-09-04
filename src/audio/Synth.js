import { SoundPlayer, Voice } from './SoundPlayer.js';
import { audioFloat, jitter } from './audioRng.js';
import { scaleRate } from './scale.js';

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
 * ── the palette is a discipline, and the discipline outlived its reason ────
 * This header used to rule out reverb, delay, chorus and wavetables on the
 * ground that none of them could have come out of a 1994 console — the audio
 * half of a render pipeline quantised to five bits a channel.
 *
 * That pipeline is gone. It was removed in PHASE 1, and 1994 was never the
 * target. Neither is any console. 지시서 v3 puts this game in a summer house
 * remembered — cobalt and cool white, printed paper, water — and the sound of
 * that place is small wooden and glass objects struck in a room with hard
 * floors and the windows open. Short, pitched, bright, and never dry.
 *
 * The BAN was wrong. The DISCIPLINE it was protecting was not, and it is worth
 * restating in its own words, because it is the reason this file is small:
 *
 *     sixty sounds built out of the same three parts cannot drift into sounding
 *     like sixty different games.
 *
 * So the room came back — as ONE convolver shared by everything, living in
 * `Mixer`, reached through a per-voice send scalar. That is a mix decision, not
 * a new voice part. What stays banned is a per-sound effect: the day one
 * definition carries its own delay and another its own chorus, the palette is
 * over and no amount of tuning brings it back. If a sound seems to need one,
 * the problem is the mix.
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
 * ── pitch is quantised, and that is a design decision made here ──────────
 * A definition may name the rung it is written on (`scale: 7`), and then
 * `opts.degree` moves it by whole rungs of the game's one pentatonic rather
 * than by a continuous multiplier. The reasoning is in `scale.js` and the rung
 * table is `soundBank.deg`; what matters at this level is that the two paths
 * are exclusive by construction — a sound with no `scale` takes exactly the
 * jitter path it always took, so nothing that predates the scale moved.
 *
 * ── loudness moves BRIGHTNESS, not pitch ────────────────────────────
 * Hitting one object harder does not raise its pitch — it makes it louder and
 * brighter, because more energy goes into the higher modes and they decay from
 * a higher starting point. `velPitch` says otherwise and is the sound of a
 * SMALLER object, which is why every collision in the bank now sets it to zero
 * and carries `velBright` instead. The key survives for the sounds that want a
 * pitch bend on purpose.
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
    // entirely (all four at 0) while a collision opts all the way in — without
    // either of them being a special case anywhere else. The collisions leave
    // `velPitch` at zero and take `velBright` instead; the header says why.
    const velGain = clamp01(def.velGain ?? 0);
    const velPitch = clamp01(def.velPitch ?? 0);
    const velLength = clamp01(def.velLength ?? 0);
    const velBright = clamp01(def.velBright ?? 0);

    // Perceptual rather than linear: loudness is roughly the 0.6 power of
    // amplitude, so a linear map makes every collision below about half
    // strength sound like the same very quiet thing.
    const shaped = Math.pow(intensity, 0.6);
    const velGainMul = 1 - velGain + velGain * shaped;
    const velPitchMul = 1 + velPitch * (shaped - 0.5);
    const lengthMul = 1 - velLength + velLength * (0.45 + 0.55 * shaped);
    /**
     * ── how hard it was hit, as BRIGHTNESS ─────────────────────────────────
     * Multiplied into every filter corner and into `tone2`'s level, so a soft
     * hit loses its partial and its top end while keeping its root. That is
     * what actually happens to a struck object — less energy reaches the higher
     * modes — and it is far easier to hear than the level difference alone: a
     * weak collision becomes a DARKER sound rather than a quieter copy of the
     * same one. 0.55..1.20 at the extremes, so a full-strength hit is also
     * slightly brighter than the number written in the table.
     */
    const brightMul = 1 - velBright + velBright * (0.55 + 0.65 * shaped);

    /**
     * The scale rung, when the definition names one. See `scale.js`.
     *
     * ── `scale` is a NUMBER, and a boolean would be the wrong shape ────────
     * It is the rung the sound is written ON, and it has to be, because the
     * scale is shared by the whole game rather than being measured from each
     * sound's own frequency. A pentatonic is not symmetric: transposing E up by
     * "one rung of the pentatonic rooted at E" gives F sharp, which is not in
     * the pentatonic everything else is written in. Do that and each sound
     * walks its own private scale — every one of them internally consonant, and
     * no two of them in the same key.
     *
     * So the interval is taken between two rungs of the ONE scale, which needs
     * to know where the sound already sits. `soundBank.deg()` is the other half
     * of the contract: it turns a rung into the hertz the layer writes, so
     * `scale` and `tone.freq` cannot drift apart.
     *
     * A scaled sound still takes its jitter, which is now doing a different
     * job: a few tens of cents of wander INSIDE the rung, so two hits on the
     * same rung are not identical. The rung is what makes them agree; the
     * jitter is what keeps them from being a copy.
     */
    const base = typeof def.scale === 'number' ? def.scale : null;
    const degreeMul =
      base === null ? 1 : scaleRate(base + Math.round(opts.degree ?? 0)) / scaleRate(base);

    const spread = Math.max(0, (this.config.pitchJitter ?? 0) * (def.jitter ?? 1));
    const rate = Math.max(0.05, (opts.rate ?? 1) * velPitchMul * degreeMul * jitter(spread));

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

    /**
     * ── the send, and why it is a tap off `out` rather than off the bus ────
     * One gain node, in parallel with the dry path, feeding the ONE convolver
     * the mixer owns. The alternative — a send per category bus, which is what
     * this was — cannot express a per-sound amount, and per-sound is where the
     * decisions actually are: a collision wants a room, the hover that fires
     * forty times while a cursor crosses a menu wants almost none, and a held
     * loop wants exactly zero or its own tail piles up on itself until the bed
     * is a wash. See `Mixer.sendFor` for the table.
     *
     * It is still ONE convolver. This is a routing decision, not a new part of
     * the palette — the distinction the file header draws.
     */
    // Guarded, so a mixer stub without a room — a test double, an offline
    // render — is dry rather than a crash. `MockPlayer` is the same idea.
    const sendAmount = this.mixer.sendFor ? this.mixer.sendFor(def, loop) : 0;
    if (sendAmount > 0 && this.mixer.spaceIn) {
      const send = ctx.createGain();
      send.gain.value = sendAmount;
      out.connect(send);
      send.connect(this.mixer.spaceIn);
      voice.nodes.push(send);
    }

    let end = t0;
    // `tone` first, and it has to be: `tone2` may express itself as a RATIO of
    // the root, and the root is `tone.freq`.
    const rootHz = def.tone?.freq ?? 220;
    for (const key of ['tone', 'tone2']) {
      const layer = def[key];
      if (!layer) continue;
      end = Math.max(
        end,
        this._buildTone(ctx, voice, layer, {
          t0,
          rate,
          loop,
          lengthMul,
          brightMul,
          rootHz,
          // The partial is what a soft hit loses. The root is not.
          gainMul: key === 'tone2' ? brightMul : 1,
        }),
      );
    }
    if (def.noise) {
      end = Math.max(
        end,
        this._buildNoise(ctx, voice, def.noise, { t0, rate, loop, lengthMul, brightMul }),
      );
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
  _buildTone(ctx, voice, layer, { t0, rate, loop, lengthMul, brightMul = 1, gainMul = 1, rootHz = 220 }) {
    const g = Math.max(0, layer.gain ?? 1) * gainMul;
    if (g < MIN_GAIN) return t0;

    const osc = ctx.createOscillator();
    osc.type = layer.wave ?? 'square';

    const amp = ctx.createGain();
    amp.gain.value = 0;

    /** @type {BiquadFilterNode|null} */
    let filter = null;
    if (layer.filter) filter = this._buildFilter(ctx, layer.filter, { t0, rate, loop, brightMul });

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

    /**
     * ── a partial is a RATIO, and saying so is the whole point ─────────────
     * `tone2` could only ever name an absolute frequency, which meant the
     * relationship it was actually expressing — "this is the first partial of
     * the root" — was not written down anywhere. Move the root and the partial
     * stayed put; put the sound on a scale and every degree detuned it.
     *
     * With `ratio` the layer is expressed against `tone.freq`, so its END is
     * too: `ratioEnd` if given, and otherwise no glide at all. A `freqEnd` in
     * hertz sitting next to a `ratio` would be half a layer in one unit and
     * half in another, and the first person to move the root would find out.
     *
     * A layer with no `ratio` takes the old path untouched — which is why
     * nothing in the bank that predates this moved by a single hertz.
     */
    const baseHz = layer.ratio != null ? rootHz * layer.ratio : (layer.freq ?? 220);
    const endHz =
      layer.ratio != null
        ? rootHz * (layer.ratioEnd ?? layer.ratio)
        : (layer.freqEnd ?? layer.freq ?? 220);

    const baseFreq = clampFreq(baseHz * rate, this.nyquist);
    const endFreq = clampFreq(endHz * rate, this.nyquist);

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
    osc.__msaEnd = finish;
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
      baseFreq: baseHz,
      /**
       * `brightMul` IS folded in here, and `rate` is not.
       *
       * The rule above is about a quantity `set` re-applies on every write.
       * `rate` is one — hence the bug. Brightness is not: it is decided once
       * from this trigger's intensity and never written again, so it belongs in
       * the stored value exactly as the definition's own numbers do. Leaving it
       * out would make the first `set({rate})` on a loop snap the filter back to
       * the table's corner and undo the trigger's own shaping.
       */
      baseFilterFreq: (layer.filter?.freq ?? 0) * brightMul,
    });
    return finish;
  }

  /** One filtered-noise layer. @returns {number} finish time */
  _buildNoise(ctx, voice, layer, { t0, rate, loop, lengthMul, brightMul = 1 }) {
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
    if (layer.filter) filter = this._buildFilter(ctx, layer.filter, { t0, rate, loop, brightMul });

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
    src.__msaEnd = finish;
    voice.sources.push(src);
    voice.layers.push({
      source: src,
      filter,
      baseRate,
      baseFilterFreq: (layer.filter?.freq ?? 0) * brightMul,
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
  _buildFilter(ctx, spec, { t0, rate, loop, brightMul = 1 }) {
    const f = ctx.createBiquadFilter();
    f.type = spec.type ?? 'lowpass';
    f.Q.value = Math.max(0.0001, spec.q ?? 1);
    // Both ends move together, so a soft hit is a darker version of the same
    // sweep rather than a sweep with a different shape.
    const from = clampFreq((spec.freq ?? 1000) * rate * brightMul, this.nyquist);
    const to = clampFreq((spec.freqEnd ?? spec.freq ?? 1000) * rate * brightMul, this.nyquist);
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
  return node.__msaEnd ?? 0;
}
