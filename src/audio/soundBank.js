import { CATEGORY } from './categories.js';
import { scaleRate } from './scale.js';

/**
 * Every sound in the game, as data.
 *
 * ── the palette is fixed FIRST, and everything is built out of it ───────────
 * The brief's requirement is that sixty separately-designed sounds have to be
 * recognisably one machine, and the way that is achieved is not by tuning each
 * of them until they match — it is by giving them all the same materials and
 * then only choosing numbers. Three parts and nothing else:
 *
 *   TONE    one oscillator. square / sawtooth / triangle carry the game; `sine`
 *           appears exactly twice, both times underneath something else, because
 *           a sine on its own has no era.
 *   TONE2   a second oscillator, used for one of three jobs and never for a
 *           chord: an inharmonic partial (metal), a close detune (a beat, which
 *           is what "어지러운" sounds like), or a contrary sweep (a swap).
 *   NOISE   white noise through one biquad, usually SWEEPING. The sweep is what
 *           separates a struck cap from a puff of air, and it is the single most
 *           load-bearing number in this file.
 *
 * Everything then goes through the global chain — a space, and a bit crusher that
 * is at unity by default (see `config.audio`) — so
 * the family resemblance is applied to the output as well as designed into the
 * input — the same logic as the render chain's 5-bit quantiser, and for the same
 * reason: it is easier to make things belong together by damaging them
 * identically than by drawing them identically.
 *
 * ── the frequencies come from ONE set ──────────────────────────────────────
 * `F` below. Not because the game is musical — nothing here is in a key — but
 * because a UI blip at 1319 and another at 1274 are two arbitrary numbers, while
 * two entries from one table are two members of one set. It is the audio version
 * of `MarkEditor`'s palette: the constraint is what produces the coherence.
 *
 * ── why this is not in CONFIG ──────────────────────────────────────────────
 * `deepAssign` in `config.js` treats an array as a leaf and copies it BY
 * REFERENCE, so any array inside `CONFIG` aliases `CONFIG_DEFAULTS` after one
 * press of 전체 리셋 and the next edit silently corrupts the defaults. These
 * definitions are nested plain objects and the panel edits them live, so they
 * keep their own frozen copy and their own reset — the same arrangement
 * `PALETTE` has, and for the same reason.
 *
 * ── the fields ─────────────────────────────────────────────────────────────
 *   category   which bus, and the floor of its priority. See `categories.js`.
 *   priority   0..9 WITHIN the category. Cannot lift a sound out of one.
 *   gain       its own level, before the bus and the master.
 *   cooldown   seconds before the same id may fire again at full level.
 *   voices     how many of this id may be live at once.
 *   jitter     multiplies the global pitch wander. 0 pins the pitch exactly.
 *   velGain    how much of the level `intensity` controls. 0 = a fixed sound.
 *   velPitch   the same for pitch. Zero on every collision — see `velBright`.
 *   velLength  the same for the envelope. "약한 충돌은 짧고".
 *   velBright  the same for BRIGHTNESS: filter corners and the partial's level.
 *              This is what a hard hit actually changes, and it is what the
 *              collisions use. See the header of `Synth`.
 *   scale      quantise the pitch to a rung of the pentatonic, taken from
 *              `opts.degree`. See `scale.js`.
 *   send       how much of this sound goes to the shared room, overriding its
 *              category's default. See `Mixer.sendFor`.
 */

/**
 * The shared frequency set, in Hz.
 *
 * Two octaves of a pentatonic on A plus the three sub-bass anchors. Named by
 * role rather than by note, because nothing here read them as music: `SUB` is
 * what a body sounds like, `RING` is what metal sounds like.
 *
 * ── it turned out to be a scale, and now it has rungs ───────────────────────
 * Read as a MAJOR pentatonic the same five notes are C D E G A, and `deg()`
 * below numbers them. The collisions, the interface and the cards all name
 * their pitches through `deg` now, because they need to be TRANSPOSED and a
 * bare frequency cannot say which rung it is. What is left naming `F` directly
 * is everything that never moves — the menu, the orbs, the victory sequence —
 * and the sub-bass anchors, which are below the bottom of the table's own
 * scale and belong to sounds that are felt rather than heard as pitch.
 */
const F = {
  SUB: 55,
  THUD: 82,
  BODY: 110,
  LOW: 147,
  TENOR: 196,
  MID: 262,
  A3: 220,
  C4: 262,
  D4: 294,
  E4: 330,
  G4: 392,
  A4: 440,
  C5: 523,
  D5: 587,
  E5: 659,
  G5: 784,
  A5: 880,
  C6: 1046,
  D6: 1175,
  E6: 1319,
  G6: 1568,
  RING: 2093,
};

/**
 * The tonal centre of the whole game, and the rungs above it.
 *
 * ── `F` was already a scale, and nobody had said so ─────────────────────────
 * The table above is described as "two octaves of a pentatonic on A". Read as a
 * MAJOR pentatonic — which is what `scale.js` produces — the same five notes are
 * C, D, E, G, A: a C major pentatonic. So the set every pitched sound in this
 * file was already drawn from and the set the collision chain walks are the
 * same set, and all that was missing was a name for the rungs.
 *
 * `ROOT` is `F.C4`, chosen so the rungs land on the table rather than beside
 * it. `deg(7)` is 660 Hz, which is `F.E5` to within two cents — and 660 is the
 * root `cap_cap` was tuned to before any of this existed, which is the
 * coincidence that made the whole arrangement possible without retuning
 * anything.
 *
 * ── why a rung and not just a frequency ─────────────────────────────────────
 * A sound that carries `scale: n` is saying "I am written on rung n", and
 * `Synth` uses that to work out the INTERVAL to whatever rung it is asked for.
 * It has to, because a pentatonic is not symmetric: transposing by rungs
 * measured from each sound's own pitch would give every sound a private scale.
 * See the note in `Synth.play`.
 *
 * So `freq: deg(n)` and `scale: n` belong together, and a definition that sets
 * one without the other is either fixed on purpose (`goal_post`, which is a
 * physical object with one mode and must ring the same every time) or wrong.
 */
const ROOT = F.C4;

/**
 * A rung of the shared pentatonic, in Hz. Rounded, because the panel edits it.
 *
 * @param {number} n  0 is `ROOT`. Five to the octave; negatives run down.
 */
function deg(n) {
  return Math.round(ROOT * scaleRate(n));
}

/**
 * The multiplier from one rung to another. For `stepRatio` and for glides.
 *
 * @param {number} from  the rung the layer is written on
 * @param {number} n     how many rungs to move. Negative runs down.
 */
function rungStep(from, n) {
  return +(scaleRate(from + n) / scaleRate(from)).toFixed(4);
}

/**
 * A minor third, a fourth and a fifth as ratios, for the stepped arpeggios.
 *
 * ── FIFTH is the only one of these that can be repeated, and only so far ────
 * `steps` applies ONE ratio over and over, so an arpeggio of more than two
 * notes stays in the scale only if that ratio walks the scale. Exactly one
 * interval does: the major pentatonic IS a chain of five fifths — C G D A E —
 * so multiplying by 1.5 moves one link along it.
 *
 * The chain has an END, which is the part that is easy to get wrong. Starting
 * on C leaves four fifths above; on G, three; on D, two; on A, one; on E, none.
 * So a four-note figure must begin on C or G, and `card_fx_trajectory` begins
 * on C for that reason. Start it on D and the fourth note is B, which is in no
 * other sound in this file.
 *
 * Anything else leaves immediately. `THIRD` four times from G gives G, B, D#,
 * G — one note of four inside the set — which is what `card_fx_trajectory` used
 * to do. Two-note figures are safe with any of these, because a single interval
 * can simply be chosen to be a rung; use `rungStep` and say which.
 */
const STEP = { THIRD: 1.19, FOURTH: 1.335, FIFTH: 1.5, OCTAVE: 2, DOWN_FIFTH: 0.667, DOWN_FOURTH: 0.749 };

/**
 * One oscillator layer, with the house defaults filled in.
 *
 * A factory rather than sixty literals, so a field nobody set is the same value
 * everywhere — which is most of what "the same palette" means in practice. The
 * result is a plain object; nothing survives of the function.
 */
function tone(o = {}) {
  /**
   * A layer names its pitch in ONE unit, never both.
   *
   * `ratio` is against `tone.freq` — the root of the sound — and it is how a
   * partial should be written, because a partial IS a ratio: move the root and
   * it has to follow, or the timbre changes with the note. `freq` is an absolute
   * hertz value and is right for a root, for a layer that is its own voice, and
   * for everything in this file that predates the idea.
   *
   * Emitting only the one that was asked for is what keeps the panel honest —
   * `audioDebug` builds its rows from the keys that are actually present, so a
   * ratio layer gets ratio sliders and no phantom frequency to drag.
   */
  const pitched =
    o.ratio != null
      ? { ratio: o.ratio, ratioEnd: o.ratioEnd ?? o.ratio }
      : { freq: o.freq ?? F.A4, freqEnd: o.freqEnd ?? o.freq ?? F.A4 };
  return {
    wave: o.wave ?? 'square',
    ...pitched,
    gain: o.gain ?? 0.4,
    attack: o.attack ?? 0.002,
    hold: o.hold ?? 0,
    decay: o.decay ?? 0.08,
    curve: o.curve ?? 'exp',
    steps: o.steps ?? 1,
    stepGap: o.stepGap ?? 0.055,
    stepRatio: o.stepRatio ?? 1,
    stepGain: o.stepGain ?? 1,
    filter: o.filter ?? null,
  };
}

/**
 * One filtered-noise layer, same arrangement.
 *
 * ── Q is load-bearing here, and it does not look like it ────────────────────
 * The shared buffer is WHITE noise: equal power per hertz, which means its
 * power per OCTAVE rises at 3 dB an octave. A two-pole band-pass rolls off at 6
 * dB an octave. So above the centre those two nearly cancel — the net slope is
 * about −3 dB an octave, and a band-pass that looks narrow on paper still hands
 * over a great deal of top end.
 *
 * Measured: `band(1500, 1500, 1.2)` on this buffer — a Q that reads as "gently
 * focused" — puts 27% of its energy above 4 kHz and has a spectral centroid of
 * 5.6 kHz, nearly two octaves above the band it names. Raising Q to 2.2 halves
 * the first number. That is why the beds in this file carry Qs that look tight
 * for what they are: they are not resonances, they are the roll-off the noise
 * does not have.
 *
 * The other lever is the buffer itself. Tilting it — pink, or a one-pole
 * low-pass around 5 kHz — would turn that net −3 dB an octave into −9 and tame
 * every layer at once, which is the structurally right fix and is deliberately
 * NOT taken here: it moves all thirty-nine noise layers, including the six
 * collisions that were just tuned by measurement, and it is a bigger change
 * than the fault being repaired. It is the next lever, not this one. See
 * `Mixer._makeNoise`.
 */
function noise(o = {}) {
  return {
    gain: o.gain ?? 0.35,
    rate: o.rate ?? 1,
    attack: o.attack ?? 0.001,
    hold: o.hold ?? 0,
    decay: o.decay ?? 0.09,
    curve: o.curve ?? 'exp',
    filter: o.filter ?? band(2000, 800, 3),
  };
}

/** A band-pass that falls. The metal sweep — see the header. */
function band(from, to, q = 3, sweep = 0.09) {
  return { type: 'bandpass', freq: from, freqEnd: to, q, sweep };
}

/** A low-pass. Dull, bodied, close. */
function low(from, to = from, sweep = 0.09) {
  return { type: 'lowpass', freq: from, freqEnd: to, q: 0.8, sweep };
}

/**
 * The ceiling every bare blip sits under, in Hz.
 *
 * ── 2600 이었고, 그 근거는 크러셔였다 ───────────────────────────────────────
 * 원래 계산: 사각파의 배음은 나이퀴스트까지 간다. 전역 체인이 7비트로 양자화하고
 * 16 kHz 로 붙잡으므로 8 kHz 위가 전부 **비조화** 성분으로 접혀 돌아오고,
 * 양자화 잡음이 감쇠 꼬리를 탄다 — 짧고 밝은 블립이 브로드밴드 트랜지언트를
 * 달고 도착한다. 설정 클릭에서 실측한 스펙트럴 플랫니스가 0.27 대 0.14 였고,
 * 사용자는 그것을 "스네어" 로 들었다.
 *
 * 크러셔가 유니티가 됐다(`config.audio.crushBits`). 접힘도 양자화 잡음도 없으므로
 * 2.6 kHz 천장이 막고 있던 것은 이제 아무것도 아니고, 남은 것은 부작용뿐이다 —
 * 기본파와 3배음만 남은 블립은 두껍고 둔한 나무 소리다. 종이와 물과 유리가 각자로
 * 들리는 것은 그 위의 배음들이다.
 *
 * 7200 은 그 배음이 살아나면서도 여전히 상한이 있는 자리다. 완전히 열지 않는
 * 이유는 사각파의 고차 배음이 그대로 남으면 새 잔향의 꼬리에 실려 쉭쉭거리기
 * 때문이다 — 크러셔의 접힘 대신 잔향이 그것을 드러낸다.
 *
 * 여전히 맨 톤 블립에만 적용된다. 충돌음과 스팅어는 대역폭을 다 쓴다.
 */
const BLIP_CEILING = 7200;

/**
 * A high-pass. For a TONE layer, whose spectrum has a top of its own.
 *
 * ── never on noise, and that took a measurement to notice ───────────────────
 * Nine noise layers used this and every one of them was a fault. A high-pass
 * has no upper bound, and white noise carries equal power per hertz — so half
 * of the shared buffer's energy is in the top octave alone (12–24 kHz). A
 * high-pass on it does not select "air": it deletes the bottom and hands over
 * everything above the corner, which is the brightest possible thing the buffer
 * can produce.
 *
 * Measured on `card_hover` and `draw_clear`, the two worst: spectral centroid
 * 12.4 kHz and 12.1 kHz, with 66% and 65% of the energy above 8 kHz. That is
 * not a texture. It is hiss, sitting in the octave the ear is least willing to
 * forgive, and it is what the player reported as a high-pitched burst.
 *
 * An oscillator is different: a square at 880 Hz has harmonics that thin out on
 * their own, so high-passing it removes weight without exposing anything. That
 * is the one remaining caller.
 *
 * For noise, use `air`.
 */
function high(from, to = from, sweep = 0.09) {
  return { type: 'highpass', freq: from, freqEnd: to, q: 0.7, sweep };
}

/**
 * The highest a noise band may be CENTRED, in Hz.
 *
 * The counterpart of `BLIP_CEILING`, and it exists for the same reason that one
 * does — read that note first, because it describes this failure and then only
 * fixes it for tones: "사각파의 고차 배음이 그대로 남으면 새 잔향의 꼬리에 실려
 * 쉭쉭거리기 때문이다". High content riding the reverb tail hisses.
 *
 * Noise is worse at it than any oscillator, and it had no ceiling at all. 7000
 * is where a band centre still reads as bright without the band's own skirt
 * reaching into the top octave: a Q of 2 puts 14 kHz 12 dB down from there.
 *
 * It is a CENTRE ceiling, not a wall — a band-pass has a skirt above it, and
 * that skirt is the whole point. What is banned is an unbounded shelf.
 */
const NOISE_CEILING = 7000;

/**
 * Air, paper, shimmer. What `high` was being used for, with a top on it.
 *
 * A band-pass whose centre sweeps, so the gesture a high-pass sweep was making
 * survives — opening upward reads as something taking off, closing downward as
 * something landing or being wiped away. What does not survive is the open
 * shelf above it.
 *
 * `q` is the width. Around 1.0 is nearly two octaves and still reads as a
 * broadband rush; 2.5 is narrow enough to be a tick with a pitch to it. Below
 * about 0.8 the skirts are shallow enough that the ceiling stops meaning much.
 */
function air(from, to = from, q = 2, sweep = 0.09) {
  return {
    type: 'bandpass',
    freq: Math.min(from, NOISE_CEILING),
    freqEnd: Math.min(to, NOISE_CEILING),
    q,
    sweep,
  };
}

/**
 * @type {Record<string, {
 *   category: string, priority?: number, gain?: number, cooldown?: number,
 *   voices?: number, jitter?: number, velGain?: number, velPitch?: number,
 *   velLength?: number, tone?: object, tone2?: object, noise?: object,
 * }>}
 */
export const SOUNDS = {
  // ══ CAPS ═══════════════════════════════════════════════════════════════
  //
  // The most numerous sounds in the game by an order of magnitude, and the
  // reason the whole overload apparatus exists. All three of the physical
  // mappings are wide open on them: a graze and a full-charge strike have to be
  // audibly different events, not the same event at two volumes.

  /**
   * Cap on cap. The most-heard sound in the game, and the recipe the other five
   * collisions are derived from.
   *
   * ── it was a noise crack, and a noise crack cannot be hummed ────────────
   * The version this replaces was a 4.2 kHz band-passed noise burst with a
   * square thud under it. Measured, rendered through this exact graph: spectral
   * flatness 0.30 over 200 Hz – 16 kHz on the transient, and a spectrum with no
   * partial in it — the loudest peak at 361 Hz and then a smear at 1107, 1423
   * and 1827 Hz, the first two of them 0.6 dB apart. That is a burst. It fires
   * hundreds of times a match.
   *
   * The model is a struck bar instead — a tuned marimba key, which is where
   * 부록 H's ratio comes from — and it has four properties, each of which is a
   * number here rather than a mood:
   *
   *   PITCH        a sine root you can hum, not filtered noise.
   *   4:1 PARTIAL  a bar left alone puts its first partial at 2.756 times the
   *                root — that is just what a free-free bar does — and a
   *                marimba maker UNDERCUTS the bar until it sits at 4.0
   *                instead. Two octaves is consonant, so the tuned bar reads as
   *                sweet where the raw one reads as clang. `goal_post` is the
   *                one sound in the game that keeps the untuned number.
   *   FALLING      real objects lose tension as they ring, so the pitch sags.
   *                Without it the sound is electronic.
   *   QUIET BODY   noise well under the tone. It supplies mass; past a point it
   *                stops being a hit and goes back to being a burst.
   *
   * ── the tuning procedure, in the order it was run ───────────────────────
   * Every figure is from an offline render of this graph, measured rather than
   * judged. Where a number here disagrees with the appendix that specified it,
   * the disagreement is written down.
   *
   *   ROOT ALONE   partial and noise at zero. Spectral flatness 0.005, one peak
   *                at 648 Hz and nothing else within 31 dB. Hummable by
   *                construction — a sine has nothing to be inharmonic with.
   *
   *   THE RATIO    4.0 against its neighbours and against the 3.6 this sound
   *                used to carry. Two columns, because they say different
   *                things: how far the partial sits from the nearest HARMONIC
   *                of the root, and what PITCH CLASS it introduces.
   *
   *                  3.6  2376 Hz  -182 c   +182 c   the old value
   *                  3.9  2574 Hz   -44 c    +44 c
   *                  4.0  2640 Hz     0 c      0 c   two octaves
   *                  4.1  2706 Hz   +43 c    +43 c
   *                  3.0  1980 Hz     0 c   +498 c   a twelfth
   *                  5.0  3300 Hz     0 c   +386 c   a major third
   *
   *                3.9 and 4.1 are the pair that prove the interval is doing
   *                the work: a quarter-tone either way and the partial beats
   *                against the octave instead of fusing with it. 3.6 is that
   *                same failure four times over, and the whole distance from
   *                sweet to metal is in the one number.
   *
   *                3.0 and 5.0 are the more interesting rejections, because
   *                both are exactly harmonic and neither is wrong on the first
   *                column. They fail on the second: a twelfth and a major third
   *                are NEW PITCH CLASSES, so the partial is a second note. On a
   *                sound that is also being transposed along a scale, that
   *                second note has to agree with the rung — and sometimes it
   *                would not. 4.0 is the only ratio that adds no note at all.
   *
   *   THE NOISE    swept from zero. The appendix asks for `gain` 0.10-0.18 AND
   *                for a level 12-18 dB under the tone, and through a Q=7
   *                band-pass those are not the same instruction: the filter
   *                throws away most of the broadband energy, so 0.13 arrives at
   *                -32.5 dB. Measured (layers soloed, RMS over the first 20 ms,
   *                dB under the root) against the transient flatness of the mix:
   *
   *                  0.13   -32.5 dB   0.027
   *                  0.40   -25.3 dB   0.052
   *                  0.60   -19.2 dB   0.061
   *                  0.80   -16.5 dB   0.074   <-
   *                  1.00   -14.6 dB   0.090
   *
   *                The LEVEL is the perceptual statement and the gain was an
   *                estimate of it, so 0.8 — which lands mid-window. Two anchors
   *                say that is still a hit and not a burst: `ui_click` measures
   *                0.093 on the same instrument, and this file records that
   *                click as the version which stopped sounding like a snare;
   *                the old `cap_cap` measures 0.30.
   *
   *   THE FALL     instantaneous pitch at onset against 60 ms in: 653 -> 640 Hz
   *                with the glide, 660 -> 660 without it. The written fall is
   *                660 -> 624, which is 0.97 of a semitone, and it arrives over
   *                the whole 170 ms decay rather than over the first 30 ms the
   *                appendix describes — `_buildTone` ramps a glide across the
   *                envelope and has no separate glide time. Left alone: a
   *                parameter added for one layer of one sound is how a palette
   *                stops being one, and the sag is audible as written.
   *
   *   THE SEND     0 / 0.16 / 0.30 / 0.60, as the energy after the 170 ms body
   *                as a share of the whole, as what is still ringing 250 ms
   *                after the hit relative to its own peak, and as the time to
   *                -60 dB:
   *
   *                  0.00   -81.6 dB   (below the floor)   119 ms
   *                  0.16   -53.1 dB   -71.9 dB            128 ms
   *                  0.30   -47.6 dB   -67.9 dB            136 ms
   *                  0.60   -41.6 dB   -61.5 dB            215 ms
   *
   *                0.16 was chosen here. At 0.30 the tail carries nearly three
   *                times the energy and every hit in a chain lands inside the
   *                last one's wash — and a chain is the case this sound exists
   *                for. The category default it overrides is 0.30, so the
   *                collisions sat well under the room every other sound is in:
   *                the old burst had nothing to expose, and a clean tone does.
   *
   *                **PHASE 9 moved it to 0.24.** The section below has the
   *                numbers and the reason; the rejection of 0.30 above still
   *                stands, and 0.24 is under it.
   *
   *   VELBRIGHT    spectral centroid of the first 20 ms, at intensity 0.15
   *                against 1.0:
   *
   *                  velBright 0     2141 -> 2214 Hz   x1.03
   *                  velBright 0.7   1902 -> 2450 Hz   x1.29
   *
   *                At zero a soft hit is the same sound played quietly, which is
   *                exactly what the appendix predicts. The partial moves with it
   *                too: -7.2/-7.0 dB under the root at velBright 0, and
   *                -8.7/-5.9 dB at 0.7.
   *
   *                Measure this on the TRANSIENT. Over a 341 ms window the same
   *                comparison reads x1.10 against x1.21, because the root rings
   *                for 170 ms and drowns the thing being measured.
   *
   *   THE CHAIN    ten hits, `ContactAudio` handing out rungs and holding at its
   *                ceiling of 7. Measured fundamentals: 653, 777, 872, 1036,
   *                1164, 1306, 1553, 1744 Hz, then 1744 twice more — 0, 3, 5, 8,
   *                10, 12, 15, 17 semitones above the root. Rungs 7 to 14 of the
   *                shared scale: E G A C D E G A. The top is a sixth above the
   *                octave rather than somewhere shrill, and it is the same A
   *                that `deg(14)` gives every other sound in the file.
   *
   * ── PHASE 9: 꼬리를 조금 더, 고역을 조금 덜 ────────────────────────────
   * §13 keeps the bar and changes what it is a bar being struck BY: a small
   * object hitting water rather than a weapon landing. Two numbers, and the
   * word in the brief is "조금" for both — this is not a new sound, it is the
   * same sound sitting slightly further back in a slightly wetter room.
   *
   *   body band  6600 -> 5000 Hz (sweep end 3200 -> 2600)
   *   send       0.16 -> 0.24
   *
   * Measured on this graph, four renders each, mean. **These windows are not
   * the windows the tables above use** — a window length changes the answer,
   * so every figure below is quoted with the half-spread four runs actually
   * showed, and a difference smaller than that spread is not a difference.
   * (The spread is real and unavoidable: the noise layer reads the shared
   * buffer from a random offset and the jitter moves the pitch, so no two
   * renders are the same file.)
   *
   *                          centroid 0-20ms    after 170ms      at 250ms
   *   before                   3255 ±112 Hz   -40.2 ±0.2 dB   -49.1 ±0.5 dB
   *   band only (5000/2600)    2796 ±144 Hz   -40.2 ±0.2 dB   -48.9 ±0.2 dB
   *   send only (0.24)         3224 ± 76 Hz   -36.6 ±0.1 dB   -45.3 ±0.2 dB
   *   both                     2796 ±144 Hz   -36.6 ±0.1 dB   -45.9 ±0.3 dB
   *
   * The two levers are independent, which is the useful part of that table:
   * the band moves brightness and nothing else, the send moves the tail and
   * nothing else, and neither undoes the other.
   *
   * ── the chain, measured separately and over ten runs ────────────────────
   * The second hit's onset against what the first is still doing 120 ms later
   * — the masking the 0.30 rejection above was about, and the one number that
   * had to be defended. Four runs was not enough to say anything about it:
   *
   *   before   mean 36.7 dB   range 35.1 .. 39.7
   *   now      mean 35.1 dB   range 33.4 .. 39.4
   *
   * The mean costs 1.6 dB and the ranges overlap almost completely, so the
   * honest statement is that the change is at the edge of what this
   * measurement can see. What it CAN say is the floor: the separation never
   * fell below 33.4 dB in twenty renders. Peak level is unmoved (0.166 ->
   * 0.169), so nothing downstream is re-levelled.
   *
   * Two things were measured and REJECTED, and they are worth keeping because
   * each looked like the obvious lever:
   *
   *   a steeper sweep (6600 -> 2400) changed the transient centroid by 44 Hz,
   *     inside the spread. The body decays in 28 ms and the sweep is written
   *     over 30, so the sound is over before the sweep arrives anywhere.
   *   velBright 0.7 -> 0.5 changed nothing at intensity 1, which is where it
   *     was measured — it is the SOFT end of the mapping, so it moves quiet
   *     hits and leaves the loud ones alone. §13 is about all of them.
   *
   * Only this sound got the band move. The other five collisions were measured
   * first and none of them has a top end to take off: `goal_post` 3043 Hz,
   * `ball_cap` 1536, `cap_wall` 1322, `ball_net` 1204, `ball_wall` 795. The
   * brightest collision in the game is this one by 200 Hz over a metal post,
   * and the post is allowed to be metal.
   *
   * Four of the six took the send: this one, `cap_wall`, `ball_cap`,
   * `ball_wall`. `ball_net` did not, because a net absorbs and 0.06 is that
   * fact; `goal_post` did not, because at 0.34 it already has the biggest room
   * of any collision and that is what a post ringing across a pitch is.
   */
  cap_cap: {
    category: CATEGORY.IMPACT,
    priority: 3,
    gain: 0.62,
    cooldown: 0.035,
    voices: 4,

    /**
     * The root. A SINE, and that is not a small choice.
     *
     * A square or a saw brings a full 1:2:3:4 harmonic series with it, which is
     * an organ — the partials are already there and in the wrong proportions,
     * and no amount of filtering turns that into a struck bar. A struck
     * spectrum is built the other way round: a pure root, and then exactly the
     * partials you want, at exactly the ratios you want.
     *
     * 660 Hz is E5. High enough to cut through a full board and low enough that
     * seven rungs of the scale above it still land under 1.7 kHz.
     */
    tone: tone({
      wave: 'sine',
      freq: deg(7),
      freqEnd: 624,
      gain: 0.5,
      attack: 0.002,
      decay: 0.17,
      curve: 'exp',
    }),

    /**
     * The first partial, at exactly 4:1.
     *
     * Two octaves. A tuned marimba bar is undercut until its first partial
     * lands there, and the reason is audible: 4:1 is the same pitch class as
     * the root, so the ear fuses the two into one bright note instead of
     * hearing an interval. 3.9 or 4.1 beat against harmonic 4; 3.6 — what this
     * sound used to use, and what the appendix flags — sits 182 cents off it,
     * and that miss is precisely what "pressed steel" was.
     *
     * It dies in a third of the root's time, which is the other half of what
     * makes a bar a bar: the partials go first and the fundamental is left
     * ringing. A partial that outlives the root is a bell.
     */
    tone2: tone({
      wave: 'sine',
      ratio: 4.0,
      gain: 0.34,
      attack: 0.0015,
      decay: 0.055,
      curve: 'exp',
    }),

    /**
     * The body. A high-Q band-pass standing in for a mode above the partial.
     *
     * It was 6600 Hz, which is 10:1 on the root — where a shallow dish puts
     * its next strong mode, and the reason it was written there. PHASE 9 moved
     * it to 5000 (7.6:1) and that trade is deliberate: 10:1 was the truthful
     * number for a struck dish, and §13 does not want a struck dish. It wants
     * the top end off the most-heard sound in the game. What survives the move
     * is what the layer is FOR — a resonant filter doing the job of a partial
     * is still inside the three-part palette, it is a filter on the noise
     * layer rather than a fourth kind of node, and it buys a mode that would
     * otherwise cost an oscillator.
     *
     * 5000 is still nearly an octave clear of the 4:1 partial at 2640, so the
     * body does not smear into the thing that makes the bar sweet.
     *
     * 0.8, not the 0.13 the appendix asks for, and the whole difference is that
     * band-pass: at Q=7 it discards about 16 dB of broadband energy, so 0.13
     * arrives 32 dB under the root instead of the 12-18 dB the same appendix
     * asks for. See the noise table above.
     */
    noise: noise({
      gain: 0.8,
      attack: 0.001,
      decay: 0.028,
      filter: band(5000, 2600, 7, 0.03),
    }),

    /**
     * Rung 7 of the shared pentatonic, which is the 660 Hz written above. The
     * chain walks UP from here — `ContactAudio._chain` hands out the offset.
     */
    scale: 7,
    velGain: 0.85,
    /** Zero, and deliberately. The scale owns the pitch; see `Synth`'s header. */
    velPitch: 0,
    velBright: 0.7,
    velLength: 0.35,
    /** Only a wobble inside the rung — the rung is what makes two hits agree. */
    jitter: 0.35,
    /** 0.16 until PHASE 9. The table in the header has the numbers. */
    send: 0.24,
  },

  /**
   * Cap on wall or fence. `cap_cap`'s recipe, hitting something that does not
   * ring back.
   *
   * ── the same four parts, three of them turned down ──────────────────────
   * A fence is wood. It takes the energy and gives very little of it back as
   * pitch, so: the root two rungs down, the partial at half level and a third
   * of the length, and the body doing much more of the work. That last one is
   * not a bigger number — it is a WIDER filter. `cap_cap`'s body is a Q=7
   * resonance standing in for a partial, and wood has no such mode; a low-pass
   * passes far more of the noise at a lower written gain, which is both what
   * wood sounds like and how the level gets there without leaving the panel's
   * 0..1 range.
   */
  cap_wall: {
    category: CATEGORY.IMPACT,
    priority: 2,
    gain: 0.5,
    cooldown: 0.05,
    voices: 3,
    tone: tone({ wave: 'sine', freq: deg(5), freqEnd: 496, gain: 0.5, attack: 0.002, decay: 0.1, curve: 'exp' }),
    tone2: tone({ wave: 'sine', ratio: 4.0, gain: 0.17, attack: 0.0015, decay: 0.03, curve: 'exp' }),
    noise: noise({ gain: 0.5, attack: 0.001, decay: 0.05, filter: low(1500, 420, 0.05) }),
    scale: 5,
    velGain: 0.85,
    velPitch: 0,
    velBright: 0.7,
    velLength: 0.5,
    jitter: 0.35,
    /**
     * A fence is right there. Less room than a cap-on-cap, not more — the two
     * moved together in PHASE 9 (0.14 -> 0.20) so the ORDER is preserved.
     * Measured: after-170ms -41.4 -> -38.1 dB, at-250ms -51.8 -> -48.6.
     */
    send: 0.20,
  },

  /**
   * The sliding bed. Held for as long as anything is moving.
   *
   * "지속음이지만 아주 작게. 속도 비례 볼륨." One voice for the whole board
   * rather than one per cap — eight beds at eight speeds is a wash, and the ear
   * cannot separate them anyway. The observer drives it from the fastest cap.
   */
  cap_slide: {
    category: CATEGORY.AMBIENT,
    priority: 0,
    gain: 0.5,
    voices: 1,
    jitter: 0,
    noise: noise({ gain: 1, attack: 0.09, decay: 0.2, filter: band(1500, 1500, 2.2) }),
  },

  /** A cap turning over. Short, and it reads as rotation because it steps up. */
  cap_flip: {
    category: CATEGORY.IMPACT,
    priority: 4,
    gain: 0.34,
    cooldown: 0.09,
    voices: 2,
    velPitch: 0.3,
    tone: tone({
      wave: 'triangle',
      freq: 300,
      freqEnd: 420,
      gain: 0.5,
      decay: 0.05,
      steps: 3,
      stepGap: 0.032,
      stepRatio: 1.26,
      stepGain: 0.8,
    }),
    noise: noise({ gain: 0.2, decay: 0.05, filter: air(2200, 1600, 2.2, 0.07) }),
  },

  /** Off the edge. The pitch falls with it, which is the whole sound. */
  cap_fall: {
    category: CATEGORY.STINGER,
    priority: 1,
    gain: 0.45,
    cooldown: 0.12,
    voices: 3,
    jitter: 0.6,
    tone: tone({ wave: 'sawtooth', freq: 520, freqEnd: 70, gain: 0.45, decay: 0.42, filter: low(3000, 500, 0.4) }),
    noise: noise({ gain: 0.2, decay: 0.4, filter: low(1600, 300, 0.4) }),
  },

  // ══ THE BOW ════════════════════════════════════════════════════════════
  //
  // ── two one-shots, and deliberately no bed ─────────────────────────────
  // There was a `bow_charge` loop whose pitch rode the pull distance, and a
  // `bow_max` blip at the clamp. Both were removed on the player's own
  // instruction after hearing them: aiming is the thing this game does most,
  // and a sound that holds for the whole of it — or fires every time the pull
  // wobbles across the clamp — is the fastest way to make the one action a
  // player takes hundreds of times a match tiring.
  //
  // What is left is the grab and the let-go-with-nothing, both of which are
  // moments rather than states. The release itself is `bow_fire`.

  bow_start: {
    category: CATEGORY.UI,
    priority: 4,
    gain: 0.3,
    cooldown: 0.05,
    tone: tone({ wave: 'square', freq: F.A5, gain: 0.3, decay: 0.022, filter: low(BLIP_CEILING) }),
    noise: noise({ gain: 0.25, decay: 0.02, filter: air(2600, 2600, 2.5, 0.02) }),
  },

  /** Release. The loudest thing a player does on purpose. */
  bow_fire: {
    category: CATEGORY.IMPACT,
    priority: 9,
    gain: 0.7,
    cooldown: 0.08,
    voices: 2,
    velGain: 0.6,
    velPitch: 0.3,
    velLength: 0.35,
    noise: noise({ gain: 0.55, decay: 0.18, filter: band(2600, 400, 2, 0.14) }),
    tone: tone({ wave: 'square', freq: F.A3, freqEnd: F.SUB, gain: 0.55, decay: 0.2, filter: low(2200, 700, 0.18) }),
  },

  /** Let go under the deadzone. The gathered force draining away. */
  bow_cancel: {
    category: CATEGORY.UI,
    priority: 3,
    gain: 0.28,
    cooldown: 0.1,
    tone: tone({ wave: 'triangle', freq: 300, freqEnd: 120, gain: 0.4, decay: 0.14, filter: low(1400, 500, 0.13) }),
  },

  // ══ UI ═════════════════════════════════════════════════════════════════

  /**
   * A press. One blip, and nothing on top of it.
   *
   * ── the noise layer was a snare, and it is gone ─────────────────────────
   * There was a 20 ms burst of 2.6 kHz high-passed noise under the tone, added
   * for attack. That is the recipe for a snare hit, and laid under a square
   * blip on every single button it read as two sounds rather than one — the
   * player heard "the button, plus a snare". Removed on their instruction.
   *
   * The blip carries the attack on its own: the square wave's own edge is a
   * transient, and the small upward glide gives it the shape the noise was
   * being asked for.
   */
  ui_click: {
    category: CATEGORY.UI,
    priority: 5,
    gain: 0.34,
    cooldown: 0.04,
    tone: tone({ wave: 'square', freq: deg(9), freqEnd: deg(10), gain: 0.4, decay: 0.045, filter: low(BLIP_CEILING) }),
    scale: 9,
    /**
     * ── every UI sound is nearly dry, and it is the same reason each time ──
     * A click is FEEDBACK: it says the press landed, and it has to arrive at
     * the same instant as the press or it stops meaning that. A tail puts the
     * event in a room, and a room is somewhere the screen is not — the whole
     * interface starts to feel loose, as though the buttons were somewhere
     * else. Collisions want the room because they happen on a board; the
     * interface is under the player's own hand.
     */
    send: 0.05,
  },

  /**
   * Moving between screens. A sweep, because the screen is sweeping too.
   *
   * ── it started too low, and it thumped ─────────────────────────────────
   * The first version swept a sawtooth from 220 Hz with the low-pass opening
   * from 700, which means its first forty milliseconds were a low sawtooth
   * behind a closed filter — a thud. Measured against the button click: 14.2%
   * of its energy under 400 Hz, against the click's 1.7%. And because the two
   * fire together on 내 마크 and 메뉴로, the combined peak was 0.20 against the
   * 0.08 of every other button in the game. The player heard "띡 + 퍽", which is
   * exactly what was built.
   *
   * A screen sweep has no business being the lowest sound on the screen. It now
   * starts at A4 with the filter already open past the click's own ceiling, so
   * it reads as air moving rather than as something landing — and it is quieter,
   * because it is the background of the gesture and the click is the gesture.
   */
  ui_transition: {
    category: CATEGORY.UI,
    priority: 7,
    gain: 0.22,
    cooldown: 0.12,
    jitter: 0.3,
    tone: tone({ wave: 'sawtooth', freq: deg(4), freqEnd: deg(13), gain: 0.26, decay: 0.2, filter: low(1600, 6200, 0.2) }),
    noise: noise({ gain: 0.14, decay: 0.2, filter: air(2200, 4600, 1.3, 0.2) }),
    scale: 4,
    /** The one UI sound that is allowed a little room: it IS the room changing. */
    send: 0.1,
  },

  /**
   * ── the dialog's three answers are three DIRECTIONS on one scale ────────
   * Opening rises two rungs, yes rises three, no falls two. Same root for the
   * two answers so they are heard as a pair, and the only thing separating them
   * is which way the second note went — which is what the player is being asked.
   * The old versions used the raw `STEP` ratios, and a fourth and a fifth from
   * C are both rungs, so this is mostly the same sound with the interval
   * written down as what it actually is.
   */
  ui_confirm_open: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.3,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: deg(4), gain: 0.4, decay: 0.07, steps: 2, stepGap: 0.07, stepRatio: rungStep(4, 2), filter: low(BLIP_CEILING) }),
    scale: 4,
    send: 0.05,
  },

  ui_confirm_yes: {
    category: CATEGORY.UI,
    priority: 7,
    gain: 0.36,
    jitter: 0,
    tone: tone({ wave: 'square', freq: deg(7), gain: 0.38, decay: 0.07, steps: 2, stepGap: 0.06, stepRatio: rungStep(7, 3), filter: low(BLIP_CEILING) }),
    scale: 7,
    send: 0.05,
  },

  ui_confirm_no: {
    category: CATEGORY.UI,
    priority: 7,
    gain: 0.32,
    jitter: 0,
    tone: tone({ wave: 'square', freq: deg(7), gain: 0.34, decay: 0.07, steps: 2, stepGap: 0.06, stepRatio: rungStep(7, -2), filter: low(BLIP_CEILING) }),
    scale: 7,
    send: 0.05,
  },

  /** Not allowed. Low, buzzing, and short enough not to be a punishment. */
  ui_denied: {
    category: CATEGORY.UI,
    priority: 8,
    gain: 0.4,
    cooldown: 0.18,
    jitter: 0.2,
    // Rung -7 and rung -9: two octaves and change below everything else, and
    // both still inside the set, so a refusal is dark rather than sour.
    tone: tone({ wave: 'square', freq: deg(-7), freqEnd: deg(-9), gain: 0.5, decay: 0.2, filter: low(700, 420, 0.18) }),
    scale: -7,
    send: 0.05,
  },

  // ══ CARDS ══════════════════════════════════════════════════════════════

  /**
   * A card coming under the cursor.
   *
   * ── the quietest sound in the game, and it has to be ────────────────────
   * A hover fires from motion the player is not thinking about, and crossing a
   * fan of five cards fires it five times in a second. 0.078 against `cap_cap`'s
   * 0.62 is 18 dB down, which is where the appendix says to start, and it is
   * nearly dry as well: a tail on a sound that repeats that fast smears into a
   * continuous hiss under the hand.
   *
   * ── it stays UNPITCHED, against the appendix's advice ───────────────────
   * The appendix asks for hovers on a low rung of the scale. Not here, and the
   * reason is already written in `MenuAudio`'s header: hover sounds were
   * removed from every other screen in the game precisely because they are the
   * most repeated event there is. A pitched tick repeating five times a second
   * is a note being hammered; a filtered noise tick is a texture, and a texture
   * can be ignored. What the scale would buy — agreement with the other cards —
   * is worth nothing on a sound with no pitch to disagree with.
   */
  card_hover: {
    category: CATEGORY.CARD,
    priority: 0,
    gain: 0.078,
    cooldown: 0.06,
    voices: 2,
    noise: noise({ gain: 0.4, decay: 0.055, filter: air(2400, 1800, 2.2, 0.05) }),
    send: 0.03,
  },

  card_drag: {
    category: CATEGORY.CARD,
    priority: 2,
    gain: 0.24,
    cooldown: 0.05,
    noise: noise({ gain: 0.4, decay: 0.07, filter: band(1600, 2200, 2.4, 0.06) }),
  },

  /** One tick per slot crossed while reordering. Tiny by design. */
  card_sort: {
    category: CATEGORY.CARD,
    priority: 1,
    gain: 0.16,
    cooldown: 0.04,
    voices: 2,
    tone: tone({ wave: 'square', freq: F.G6, gain: 0.3, decay: 0.02, filter: low(BLIP_CEILING) }),
  },

  /** The use threshold. It has to be felt through the thumb, so it steps up. */
  card_arm: {
    category: CATEGORY.CARD,
    priority: 5,
    gain: 0.3,
    cooldown: 0.12,
    jitter: 0,
    // One rung up, not a bare minor third: `THIRD` from C6 is E flat, which is
    // in nothing else here.
    tone: tone({ wave: 'square', freq: deg(10), gain: 0.34, decay: 0.045, steps: 2, stepGap: 0.042, stepRatio: rungStep(10, 1), filter: low(BLIP_CEILING) }),
    scale: 10,
  },

  /** Committed. The generic 'a card was played' hit, under the effect's own. */
  card_use: {
    category: CATEGORY.CARD,
    priority: 7,
    gain: 0.44,
    cooldown: 0.06,
    tone: tone({ wave: 'square', freq: F.C5, freqEnd: F.C6, gain: 0.4, decay: 0.1, filter: low(3200) }),
    noise: noise({ gain: 0.3, decay: 0.08, filter: band(3000, 1200, 2, 0.07) }),
  },

  /** Let go under the threshold. The spring bringing it home. */
  card_return: {
    category: CATEGORY.CARD,
    priority: 3,
    gain: 0.26,
    cooldown: 0.08,
    // Rung 6 down to rung 1: a spring letting go, and both ends on the scale.
    tone: tone({
      wave: 'triangle',
      freq: deg(6),
      freqEnd: deg(3),
      gain: 0.4,
      decay: 0.09,
      steps: 2,
      stepGap: 0.075,
      stepRatio: rungStep(6, -5),
      stepGain: 0.7,
    }),
    scale: 6,
  },

  /** Dragged all the way and refused. The shake, in sound. */
  card_refused: {
    category: CATEGORY.CARD,
    priority: 8,
    gain: 0.36,
    cooldown: 0.15,
    jitter: 0.2,
    tone: tone({ wave: 'square', freq: 165, gain: 0.45, decay: 0.075, steps: 2, stepGap: 0.07, stepRatio: 0.84, filter: low(900) }),
    noise: noise({ gain: 0.16, decay: 0.06, filter: low(700, 400, 0.06) }),
  },

  /** A found card arriving in the fan. */
  card_land: {
    category: CATEGORY.CARD,
    priority: 4,
    gain: 0.3,
    cooldown: 0.05,
    tone: tone({ wave: 'triangle', freq: F.G4, gain: 0.3, decay: 0.055 }),
    noise: noise({ gain: 0.3, decay: 0.045, filter: low(1400, 700, 0.04) }),
  },

  // ── the five effects ──────────────────────────────────────────────────
  //
  // "각각 구분되어야 한다. 눈 감고도 어떤 카드인지 알 수 있게. 다만 공통 팔레트를
  // 공유해서 같은 게임의 소리로 들려야 한다." So each one takes a DIFFERENT
  // mechanism out of the same three-part palette rather than a different sound:
  //
  //   궤적    a clean rising arpeggio through a high-pass. Scanning ahead.
  //   혼란    two detuned sawtooths beating against each other. Unstable.
  //   원모어  the same note twice. Literally a repeat.
  //   강타    everything low and loud with a noise punch. Weight.
  //   철벽    a short root under a long partial. Arriving and stopping.
  //   스왑    two tones crossing in opposite directions. An exchange.
  //   침묵    noise with the pitch taken out of it. Nothing to hold on to.
  //
  // ── and they are seven rungs of ONE scale ──────────────────────────────
  // "다섯 장이 같은 음계의 다른 칸을 쓴다. 그러면 카드를 연달아 내도 불협이
  // 나오지 않는다." Rungs, low to high: 강타 -2, 철벽 -8, 혼란 0, 궤적 5,
  // 원모어 7, 스왑 5. 침묵 has no pitch at all, which is the point of it.
  //
  // Nothing sequences these — a card is played when a player plays one — so the
  // guarantee has to come from the SET rather than from an arrangement. Any two
  // rungs of a major pentatonic are consonant in any order, which is the whole
  // reason `scale.js` picked that scale.

  /**
   * 궤적. Four notes climbing, and they are now four notes OF THE SCALE.
   *
   * It used to step by 1.26 — a major third — four times from G, which gives
   * G, B, D sharp, G: three of the four are in nothing else in this file. The
   * figure sounded like scanning ahead because it rises, and it sounded like a
   * different game because of where it rose to.
   *
   * A fifth is the one interval that can be repeated inside a pentatonic (see
   * `STEP`), and starting on C leaves exactly enough of the chain for four
   * notes: C G D A, rungs 5, 8, 11, 14.
   */
  card_fx_trajectory: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.42,
    jitter: 0,
    tone: tone({
      wave: 'triangle',
      freq: deg(5),
      gain: 0.38,
      decay: 0.07,
      steps: 4,
      stepGap: 0.058,
      stepRatio: STEP.FIFTH,
      stepGain: 0.94,
      filter: high(700),
    }),
    noise: noise({ gain: 0.12, decay: 0.22, filter: air(3000, 4800, 1.5, 0.2) }),
    scale: 5,
    /** Scanning ahead is a sound that goes somewhere. The wettest card. */
    send: 0.3,
  },

  /**
   * 혼란. The one card whose two oscillators are NOT a rung apart.
   *
   * `tone2` is five hertz off the root rather than a ratio of it, and that has
   * to stay an absolute number: a beat is a DIFFERENCE in hertz, so expressing
   * it as a ratio would make the wobble speed change with the pitch. The
   * appendix asks for "두 칸을 동시에", and two rungs of this scale are
   * consonant by construction — which is the opposite of what this card is for.
   * So the root sits on a rung, so the card agrees with the others, and the
   * detune sits beside it, so the card is still unstable.
   */
  card_fx_chaos: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.44,
    jitter: 0.3,
    tone: tone({ wave: 'sawtooth', freq: deg(0), freqEnd: deg(-4), gain: 0.34, decay: 0.3, filter: low(1500, 600, 0.28) }),
    tone2: tone({ wave: 'sawtooth', freq: deg(0) + 5, freqEnd: deg(-4) + 5, gain: 0.3, decay: 0.3, filter: low(1500, 600, 0.28) }),
    noise: noise({ gain: 0.14, decay: 0.26, filter: band(900, 1800, 2, 0.24) }),
    scale: 0,
    send: 0.2,
  },

  /**
   * 원모어. The same note, twice.
   *
   * It used to be the same note an OCTAVE up, which reads as an answer rather
   * than as a repetition — the second note is a different note. "같은 칸 두 번
   * (2박자)": one rung, struck twice, on the beat `CardFx`'s frame flash uses.
   * There is nothing else to say and that is the card.
   */
  card_fx_onemore: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.42,
    jitter: 0,
    tone: tone({
      wave: 'square',
      freq: deg(7),
      gain: 0.36,
      decay: 0.1,
      steps: 2,
      stepGap: 0.13,
      stepRatio: 1,
      filter: low(3400),
    }),
    scale: 7,
    send: 0.22,
  },

  /** 강타. The lowest rung any card starts on, and it falls seven more. */
  card_fx_smash: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.58,
    jitter: 0.2,
    tone: tone({ wave: 'square', freq: deg(-2), freqEnd: deg(-9), gain: 0.55, decay: 0.3, filter: low(1800, 500, 0.26) }),
    // An octave under the root, falling with it. `ratio` rather than a second
    // set of hertz, so the pair cannot come apart if the root is ever moved.
    tone2: tone({ wave: 'sawtooth', ratio: 0.5, ratioEnd: 0.5 * rungStep(-2, -7), gain: 0.3, decay: 0.3 }),
    noise: noise({ gain: 0.45, decay: 0.18, filter: low(2200, 300, 0.16) }),
    scale: -2,
    send: 0.3,
  },

  /**
   * 철벽의 발동. 낮고 짧은 "쿵" 에 금속성 잔향.
   *
   * ── 강타와 같은 저역을 쓰면서 반대의 것을 말해야 한다 ──────────────────────
   * `card_fx_smash` 도 낮고 시끄럽다. 두 카드가 같은 무게를 다루므로 그건 맞는데,
   * 강타는 **떠나는** 소리라 180→58 로 미끄러져 내려가고 잡음이 앞에 붙는다. 이쪽은
   * 도착해서 멈추는 소리이므로 미끄러지지 않는다: 기음은 한 음에 붙박여 있고
   * (`freqEnd` 가 없다), 짧게 끊기고, 그 위에 조율되지 않은 금속 배음 하나가 더
   * 길게 남는다.
   *
   * ── 배음이 3.7 에서 4.0 이 됐다. 근거는 그대로다 ──────────────────────────
   * 원래 근거: "3.7배는 옥타브 근처가 아니므로 종이 아니라 눌린 강판으로 읽힌다 —
   * `cap_cap` 이 같은 이유로 3.6배를 쓴다. 두 소리가 같은 재료의 것으로 들려야
   * 하는데, 이 카드가 하는 일이 바로 그 뚜껑을 더 두껍게 만드는 것이기 때문이다."
   *
   * 마지막 문장이 이 값을 결정한다. `cap_cap` 이 4.0 이 됐으므로 같은 재료로
   * 들리려면 이쪽도 4.0 이다. 뚜껑을 두껍게 만드는 카드가 뚜껑과 다른 금속으로
   * 울리면 그건 다른 물건이다.
   *
   * "금속성 잔향"은 이제 비율이 아니라 **길이**가 만든다. 배음이 기음보다 두 배
   * 오래 남는다 — `cap_cap` 은 정확히 반대로 배음이 기음의 3분의 1 만에 죽는다.
   * 막대와 종을 가르는 것이 그 순서이고, 이 카드는 종 쪽이다.
   */
  card_fx_resist: {
    category: CATEGORY.CARD,
    priority: 9,
    jitter: 0,
    gain: 0.5,
    tone: tone({ wave: 'square', freq: deg(-8), gain: 0.5, decay: 0.16, filter: low(1200, 400, 0.14) }),
    tone2: tone({ wave: 'triangle', ratio: 4.0, gain: 0.18, decay: 0.34, filter: band(1100, 700, 3, 0.3) }),
    noise: noise({ gain: 0.2, decay: 0.07, filter: low(1400, 400, 0.06) }),
    scale: -8,
    send: 0.24,
  },

  /**
   * 버텼을 때. 짧고 단단한 "탕".
   *
   * ── `cap_cap` 위에 겹쳐 울린다. 대신하지 않는다 ────────────────────────────
   * 충돌은 실제로 일어났으므로 충돌음은 나야 한다. 이 카드가 바꾼 것은 그 충돌이
   * 어떻게 **끝났느냐**이고, 그래서 이것은 crack 을 지우는 것이 아니라 그 꼬리에
   * 붙는 한 음이다: 일반 충돌음보다 높고(F.G5 대 대역 4200 잡음), 짧고, 감쇠가
   * 거의 없다. 부딪혔는데 아무 데도 가지 않은 소리다.
   *
   * ── 속도에 반응하지 않는다 ─────────────────────────────────────────────────
   * `velGain` 도 `velPitch` 도 없고, 그건 이 파일의 충돌음들과 정반대다. 저쪽은
   * 얼마나 세게 맞았는지를 말하고 이쪽은 **결과**를 말한다 — 버틴 것은 세게 버티나
   * 살짝 버티나 버틴 것이다. 세기를 따라 흔들리면 "얼마나 버텼는지"로 읽히고,
   * 그건 이 카드가 하는 일이 아니다.
   *
   * 짧은 쿨다운이 있는 이유는 연쇄 충돌이다. 뚜껑 넷이 다 철벽이면 한 프레임에 두세
   * 개가 동시에 맞을 수 있고, 같은 짧은 음 셋이 몇 밀리초 간격으로 겹치면 그건
   * 강조가 아니라 플램이다.
   */
  resist_hold: {
    category: CATEGORY.IMPACT,
    priority: 5,
    gain: 0.34,
    cooldown: 0.06,
    voices: 2,
    jitter: 0.04,
    tone: tone({ wave: 'square', freq: deg(8), freqEnd: deg(7), gain: 0.3, decay: 0.045, filter: low(4200) }),
    tone2: tone({ wave: 'triangle', ratio: 3.0, gain: 0.12, decay: 0.035 }),
    /**
     * ── 음계를 걷지 않는다. `velPitch` 를 안 쓰는 것과 같은 이유다 ────────────
     * 위의 주석이 이미 그 논거를 적었다: 저쪽은 얼마나 세게 맞았는지를 말하고
     * 이쪽은 결과를 말한다. 연쇄의 몇 번째냐도 같은 종류의 정보다 — 세 번째로
     * 버틴 것과 첫 번째로 버틴 것은 똑같이 버틴 것이고, 칸이 올라가면 "더" 버틴
     * 것으로 읽힌다.
     *
     * 대신 8번 칸에 붙박아 둔다. 어떤 칸의 충돌 위에 겹쳐도 협화다.
     */
    send: 0.12,
  },

  /** 스왑. Rung 5 and rung 10 trading places — an octave, crossing. */
  card_fx_swap: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.42,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: deg(5), freqEnd: deg(10), gain: 0.34, decay: 0.26, filter: low(4000) }),
    tone2: tone({ wave: 'triangle', ratio: 2.0, ratioEnd: 1.0, gain: 0.34, decay: 0.26, filter: low(4000) }),
    scale: 5,
    send: 0.26,
  },

  /**
   * 침묵. The card that takes the opponent's cards away, and it had no sound.
   *
   * ── it was missing, not quiet ───────────────────────────────────────────
   * `CARD_FX_SOUND` in `MatchAudio` listed six cards and the catalogue has
   * seven. Playing 침묵 produced the generic `card_use` and then nothing, which
   * is the one card in the game whose effect the player could not hear.
   *
   * ── and it is the only pitchless card, on purpose ───────────────────────
   * "소리를 뺏는 카드가 소리가 크면 안 된다." Every other effect is a rung of
   * the scale; this one is noise with a filter closing over it — a band-pass
   * falling from 2.6 kHz to 300 with the level going down as it falls, so it
   * reads as something being shut rather than something being struck. Nothing
   * to hum, nothing to hold on to, and quieter than every other card in the
   * fan.
   *
   * Nearly dry too. A tail would be the sound continuing after it stopped.
   */
  card_fx_silence: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.3,
    jitter: 0,
    noise: noise({ gain: 0.55, attack: 0.004, decay: 0.28, curve: 'lin', filter: band(2600, 300, 1.6, 0.22) }),
    send: 0.05,
  },

  /**
   * The stun hum, held while a player is confused.
   *
   * "아주 작게 반복되는 어지러운 소리. 과하면 피로하다." Same beating pair as the
   * cast, an octave up and at a fraction of the level, so the sustained state
   * and the moment it started are recognisably the same idea.
   */
  chaos_loop: {
    category: CATEGORY.AMBIENT,
    priority: 1,
    gain: 0.3,
    voices: 2,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.A3, gain: 0.5, attack: 0.12, decay: 0.3, filter: low(1100) }),
    tone2: tone({ wave: 'triangle', freq: F.A3 * 1.027, gain: 0.42, attack: 0.12, decay: 0.3, filter: low(1100) }),
  },

  // ══ ORBS ═══════════════════════════════════════════════════════════════

  orb_spawn: {
    category: CATEGORY.ORB,
    priority: 4,
    gain: 0.34,
    jitter: 0.4,
    tone: tone({
      wave: 'triangle',
      freq: F.E4,
      gain: 0.34,
      decay: 0.09,
      steps: 3,
      stepGap: 0.062,
      stepRatio: STEP.FIFTH,
      stepGain: 0.86,
    }),
    noise: noise({ gain: 0.12, decay: 0.26, filter: air(3200, 5000, 1.6, 0.24) }),
  },

  // ── the orbs sit there in silence ──────────────────────────────────────
  // A held bed used to run for as long as any orb was on the field, which in
  // practice is most of a match. Removed on the player's instruction, and the
  // design was wrong before the volume was: the brief asked for "아주 작은
  // 반복음" — a small REPEATING sound — and what was built was a sustained high
  // tone with a slow beat under it. That is a drone, and a drone with a 0.3 s
  // attack reads as reverb, which the brief rules out by name.
  //
  // If it comes back it has to come back as a sparse tick: one short blip every
  // second or so, not a held note.

  orb_pickup: {
    category: CATEGORY.ORB,
    priority: 7,
    gain: 0.44,
    cooldown: 0.05,
    jitter: 0,
    tone: tone({
      wave: 'square',
      freq: F.E5,
      gain: 0.36,
      decay: 0.06,
      steps: 3,
      stepGap: 0.046,
      stepRatio: STEP.FIFTH,
      filter: low(5000),
    }),
    noise: noise({ gain: 0.14, decay: 0.14, filter: air(3400, 5200, 1.6, 0.13) }),
  },

  /** Hand full. A refusal, and it must not sound like a pickup at any point. */
  orb_refused: {
    category: CATEGORY.ORB,
    priority: 6,
    gain: 0.34,
    cooldown: 0.12,
    tone: tone({ wave: 'square', freq: F.LOW, freqEnd: F.BODY, gain: 0.42, decay: 0.16, filter: low(800, 500, 0.15) }),
  },

  // ══ PRESENTATION ═══════════════════════════════════════════════════════

  /**
   * The bottle being worked up. Carbonation, and NOT an engine.
   *
   * ── the first version was a car exhaust, and that was a design error ────
   * It layered a 62 Hz sawtooth through a low-pass under noise through a
   * bandpass at 900 Hz with Q 2.2. Those two things together are not "a bottle
   * being shaken" — they are the definition of an exhaust note: a low periodic
   * fundamental plus a resonant mid formant. The player heard exactly what was
   * built, and no amount of gain riding would have fixed it.
   *
   * Carbonation has NO fundamental. It is thousands of tiny gas transients, and
   * at this scale that is broadband noise with the whole bottom removed. So
   * there is no oscillator here at all — a tone layer is the one thing this
   * sound must not have — and the noise is band-passed high and wide.
   *
   * The build is carried by `rate` rather than by gain alone: the observer
   * raises it with the shake envelope, which lifts both the noise playback rate
   * and the filter with it, so the fizz gets brighter and more agitated as the
   * pressure climbs instead of merely louder. That is the difference between
   * something filling up and something being turned up.
   */
  menu_shake: {
    category: CATEGORY.AMBIENT,
    priority: 2,
    gain: 0.4,
    voices: 1,
    jitter: 0,
    noise: noise({
      gain: 1,
      attack: 0.07,
      decay: 0.25,
      /**
        * ── measured at the rate it actually runs at, which is the point ─────
        * `MenuAudio` drives this loop's rate from 0.7 to 1.45, and the rate
        * carries the band centre with it. At 4.2 kHz and Q 1.1 that meant 66%
        * of the energy above 4 kHz and 17% above 8 kHz — on a bed that is HELD
        * for the whole of the shake. Auditioned at rate 1 it measured half
        * that, which is how it survived: the panel plays it at rest.
        *
        * The original note stands and constrains the fix: "A narrow band here
        * is a resonance, and a resonance is a pipe — which is the thing this
        * sound was rebuilt to stop being." So Q goes to 2.4 and not to 3.5,
        * which is where the brightness would be lowest and the fizz would be a
        * whistle. Carbonation is thousands of tiny bubbles; it has to stay wide.
        * An octave down and a little tighter: 25% above 4 kHz, 4% above 8.
        */
       filter: band(2200, 2200, 2.4),
    }),
  },

  /** The cap comes off. A pop with a rush behind it. */
  menu_launch: {
    category: CATEGORY.STINGER,
    priority: 8,
    gain: 0.7,
    jitter: 0.2,
    noise: noise({ gain: 0.6, decay: 0.32, filter: band(3200, 300, 1.4, 0.28) }),
    tone: tone({ wave: 'square', freq: 420, freqEnd: 80, gain: 0.5, decay: 0.26, filter: low(3000, 600, 0.22) }),
  },

  /** The screen goes opaque. The moment the scene is swapped underneath it. */
  menu_cover: {
    category: CATEGORY.STINGER,
    priority: 9,
    gain: 0.62,
    jitter: 0.15,
    noise: noise({ gain: 0.5, decay: 0.26, filter: low(600, 180, 0.24) }),
    tone: tone({ wave: 'square', freq: 92, freqEnd: 56, gain: 0.5, decay: 0.3, filter: low(500) }),
  },

  victory_charge: {
    category: CATEGORY.STINGER,
    priority: 7,
    gain: 0.5,
    jitter: 0.1,
    noise: noise({ gain: 0.45, attack: 0.05, decay: 0.3, filter: band(300, 3400, 1.1, 0.28) }),
    tone: tone({ wave: 'sawtooth', freq: 120, freqEnd: 420, gain: 0.3, attack: 0.05, decay: 0.3, filter: low(900, 3000, 0.28) }),
  },

  victory_impact: {
    category: CATEGORY.STINGER,
    priority: 9,
    gain: 0.85,
    jitter: 0.1,
    noise: noise({ gain: 0.7, decay: 0.4, filter: band(5000, 200, 1, 0.3) }),
    tone: tone({ wave: 'square', freq: 260, freqEnd: 48, gain: 0.6, decay: 0.36, filter: low(2600, 400, 0.3) }),
    tone2: tone({ wave: 'triangle', freq: 1300, freqEnd: 900, gain: 0.2, decay: 0.16 }),
  },

  /** The loser flipping out of frame. */
  victory_loser: {
    category: CATEGORY.STINGER,
    priority: 6,
    gain: 0.45,
    jitter: 0.2,
    tone: tone({ wave: 'sawtooth', freq: 420, freqEnd: 92, gain: 0.4, decay: 0.5, filter: low(2600, 500, 0.45) }),
    noise: noise({ gain: 0.18, decay: 0.45, filter: band(1600, 500, 1.6, 0.4) }),
  },

  victory_text: {
    category: CATEGORY.STINGER,
    priority: 8,
    gain: 0.5,
    jitter: 0,
    tone: tone({
      wave: 'square',
      freq: F.C5,
      gain: 0.4,
      decay: 0.1,
      steps: 3,
      stepGap: 0.075,
      stepRatio: STEP.FOURTH,
      filter: low(5000),
    }),
  },

  /** A draw. Neither a win nor a loss, and it must not sound like either. */
  victory_draw: {
    category: CATEGORY.STINGER,
    priority: 8,
    gain: 0.42,
    jitter: 0,
    tone: tone({
      wave: 'triangle',
      freq: F.A4,
      gain: 0.4,
      decay: 0.22,
      steps: 2,
      stepGap: 0.16,
      stepRatio: 1,
      filter: low(2400),
    }),
  },

  // ══ FOOTBALL ═══════════════════════════════════════════════════════════

  /**
   * The ball, struck. The same bar, bigger.
   *
   * Four rungs under `cap_cap` — 0.60 of its root, which is the ratio the
   * appendix asks for and happens to land exactly on a rung — and ringing half
   * again as long. Big things are low and they hold on. The partial is quieter
   * because a ball is not a bar: it has the mode, it just does not carry it.
   */
  ball_cap: {
    category: CATEGORY.IMPACT,
    priority: 5,
    gain: 0.55,
    cooldown: 0.04,
    voices: 2,
    tone: tone({ wave: 'sine', freq: deg(3), freqEnd: 372, gain: 0.5, attack: 0.0025, decay: 0.26, curve: 'exp' }),
    tone2: tone({ wave: 'sine', ratio: 4.0, gain: 0.2, attack: 0.0015, decay: 0.08, curve: 'exp' }),
    noise: noise({ gain: 0.5, attack: 0.001, decay: 0.035, filter: band(2600, 1300, 5, 0.045) }),
    scale: 3,
    velGain: 0.8,
    velPitch: 0,
    velBright: 0.6,
    velLength: 0.4,
    jitter: 0.35,
    /**
     * 0.16 until PHASE 9. A ball is bigger than a cap and sits in more room,
     * but it is also the sound that overlaps a chain of cap hits, so it moves
     * with them rather than past them. Measured: at-250ms -51.6 -> -48.8 dB.
     * The after-170ms figure barely moves (-37.0 -> -36.9) and that is not a
     * failure — this root rings for 260 ms, so that window is mostly the note.
     */
    send: 0.22,
  },

  /** `cap_wall`, lower and duller again. The ball against the woodwork's fence. */
  ball_wall: {
    category: CATEGORY.IMPACT,
    priority: 4,
    gain: 0.45,
    cooldown: 0.05,
    voices: 2,
    tone: tone({ wave: 'sine', freq: deg(1), freqEnd: 278, gain: 0.5, attack: 0.003, decay: 0.12, curve: 'exp' }),
    tone2: tone({ wave: 'sine', ratio: 4.0, gain: 0.12, attack: 0.002, decay: 0.03, curve: 'exp' }),
    noise: noise({ gain: 0.5, attack: 0.001, decay: 0.06, filter: low(1000, 300, 0.06) }),
    scale: 1,
    velGain: 0.8,
    velPitch: 0,
    velBright: 0.6,
    velLength: 0.4,
    jitter: 0.35,
    /** 0.12 until PHASE 9. Measured: at-250ms -58.8 -> -56.3 dB. */
    send: 0.16,
  },

  /**
   * A goal.
   *
   * "게임에서 가장 기분 좋은 소리여야 한다." Four notes climbing a fourth at a
   * time under a bright shimmer, on top of a low thump so it has a body as well
   * as a tune. The only sound in the bank that gets three layers AND four steps.
   */
  goal: {
    category: CATEGORY.STINGER,
    priority: 9,
    gain: 0.8,
    jitter: 0,
    tone: tone({
      wave: 'square',
      freq: F.G4,
      gain: 0.42,
      decay: 0.13,
      steps: 4,
      stepGap: 0.085,
      stepRatio: 1.26,
      stepGain: 0.97,
      filter: low(5200),
    }),
    tone2: tone({ wave: 'triangle', freq: F.TENOR, freqEnd: F.G4, gain: 0.32, decay: 0.45, filter: low(1800) }),
    noise: noise({ gain: 0.2, decay: 0.4, filter: air(3200, 5200, 1.4, 0.36) }),
  },

  /**
   * The woodwork. A ring that goes nowhere — the sound of nearly.
   *
   * ── the ONE metal sound in the game, and the only one allowed to clang ──
   * Every collision above is a TUNED bar: its partial pulled to 4:1, two
   * octaves, fused with the root. This one is 2.76:1 — measured at 144 cents
   * off the nearest harmonic, a semitone and a half sharp of nothing — and the
   * number is not arbitrary. 2.756 is where a uniform free-free bar puts its
   * second mode when nobody has touched it; 4.0 is where a marimba maker moves
   * it to by carving the underside away.
   *
   * So the whole family is one material in two states. A bottle cap is a
   * pressed dish that happens to ring sweetly; a goalpost is a length of raw
   * steel tube that nobody tuned, and it is the one object on the board that
   * has no business being in tune. Hitting it should ache.
   *
   * Two more things follow from it being metal rather than a cap. The partial
   * lives nearly as long as the root instead of dying in a third of the time,
   * which is what separates a bell from a bar. And the root barely sags — steel
   * holds its pitch where a bottle cap does not.
   *
   * ── it does NOT walk the scale, and that is not an oversight ────────────
   * The post is one physical object with one mode. It should ring identically
   * every time it is hit, so a player learns the sound of nearly rather than
   * hearing a different near-miss depending on how deep the chain was. It is
   * written on rung 11 all the same, so the fixed pitch is inside the set every
   * other sound is drawn from and cannot clash with the rung a chain is on.
   */
  goal_post: {
    category: CATEGORY.STINGER,
    priority: 7,
    gain: 0.6,
    cooldown: 0.1,
    jitter: 0.15,
    tone: tone({ wave: 'sine', freq: deg(11), freqEnd: 1150, gain: 0.42, attack: 0.002, decay: 0.44, curve: 'exp' }),
    tone2: tone({ wave: 'sine', ratio: 2.76, gain: 0.26, attack: 0.0015, decay: 0.34, curve: 'exp' }),
    noise: noise({ gain: 0.5, attack: 0.001, decay: 0.05, filter: band(4600, 2200, 6, 0.06) }),
    velGain: 0.5,
    velPitch: 0,
    velBright: 0.45,
    /** The biggest room of any collision. A post rings across the whole board. */
    send: 0.34,
  },

  /**
   * The net taking the pace off. Soft, and it fades rather than stopping.
   *
   * The one collision with essentially no pitch, because netting has none —
   * there is nothing in it to ring. The root is still there at a tenth of the
   * level and on rung 0, so the sound belongs to the family and cannot fight
   * whatever rung the chain reached, but it is a colour under the noise rather
   * than a note.
   */
  ball_net: {
    category: CATEGORY.IMPACT,
    priority: 6,
    gain: 0.34,
    cooldown: 0.2,
    tone: tone({ wave: 'sine', freq: deg(0), freqEnd: 254, gain: 0.1, attack: 0.006, decay: 0.09, curve: 'exp' }),
    noise: noise({ gain: 0.5, attack: 0.01, decay: 0.34, curve: 'lin', filter: low(900, 190, 0.3) }),
    scale: 0,
    velGain: 0.7,
    velPitch: 0,
    velBright: 0.4,
    jitter: 0.35,
    /** A net absorbs. Almost nothing reaches the room. */
    send: 0.06,
  },

  // ── the ball is put back in silence ──────────────────────────────────
  // A `ball_respawn` bed used to hold for the length of the roll to the corner
  // flag or the touchline. Removed on the player's instruction: a throw-in is
  // bookkeeping between two turns rather than an event, and a sound running for
  // the whole of it announces the game tidying up after itself.

  score_tick: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.3,
    cooldown: 0.05,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.C6, gain: 0.32, decay: 0.05, filter: low(BLIP_CEILING) }),
  },

  /** The whistle-and-hold after a goal, and the whistle that restarts play. */
  goal_hold_start: {
    category: CATEGORY.STINGER,
    priority: 8,
    gain: 0.45,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.G6, freqEnd: F.E6, gain: 0.3, decay: 0.24, filter: low(4200) }),
    noise: noise({ gain: 0.22, decay: 0.24, filter: band(2600, 2600, 6) }),
  },

  goal_hold_end: {
    category: CATEGORY.STINGER,
    priority: 7,
    gain: 0.4,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.E6, gain: 0.3, decay: 0.09, steps: 2, stepGap: 0.09, stepRatio: STEP.THIRD, filter: low(4200) }),
  },

  // ══ CURLING ════════════════════════════════════════════════════════════

  /** A new stone appearing at the throw spot. It is placed, not dropped. */
  curl_deploy: {
    category: CATEGORY.UI,
    priority: 5,
    gain: 0.38,
    jitter: 0.3,
    tone: tone({ wave: 'triangle', freq: F.TENOR, freqEnd: F.LOW, gain: 0.4, decay: 0.1 }),
    noise: noise({ gain: 0.3, decay: 0.12, filter: low(700, 300, 0.11) }),
  },

  curl_house_in: {
    category: CATEGORY.STINGER,
    priority: 6,
    gain: 0.4,
    cooldown: 0.08,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.D5, gain: 0.36, decay: 0.09, steps: 2, stepGap: 0.06, stepRatio: STEP.FIFTH, filter: low(4000) }),
  },

  curl_house_out: {
    category: CATEGORY.STINGER,
    priority: 6,
    gain: 0.38,
    cooldown: 0.08,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.D5, gain: 0.34, decay: 0.09, steps: 2, stepGap: 0.06, stepRatio: STEP.DOWN_FIFTH, filter: low(4000) }),
  },

  /** Over the line and gone. */
  curl_overshoot: {
    category: CATEGORY.STINGER,
    priority: 7,
    gain: 0.46,
    cooldown: 0.1,
    jitter: 0.2,
    tone: tone({ wave: 'sawtooth', freq: F.E4, freqEnd: F.BODY, gain: 0.42, decay: 0.26, filter: low(2000, 500, 0.24) }),
    noise: noise({ gain: 0.22, decay: 0.22, filter: band(1400, 400, 1.8, 0.2) }),
  },

  curl_throws: {
    category: CATEGORY.UI,
    priority: 4,
    gain: 0.26,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.G5, gain: 0.3, decay: 0.05, filter: low(BLIP_CEILING) }),
  },

  // ══ SURVIVAL ═══════════════════════════════════════════════════════════

  /**
   * A cap knocked off the table.
   *
   * "통쾌해야 한다." So it is not the falling sound — `cap_fall` already covers
   * the trip over the edge — it is the CONFIRMATION, played at the verdict, and
   * it is allowed to be the second loudest thing in the mode.
   */
  ko_out: {
    category: CATEGORY.STINGER,
    priority: 8,
    gain: 0.62,
    cooldown: 0.09,
    jitter: 0.15,
    noise: noise({ gain: 0.5, decay: 0.3, filter: band(1800, 200, 1.3, 0.26) }),
    tone: tone({ wave: 'square', freq: 300, freqEnd: 66, gain: 0.5, decay: 0.3, filter: low(2400, 500, 0.26) }),
  },

  /** The last one. The match is decided by it, so it gets a tail. */
  ko_last: {
    category: CATEGORY.STINGER,
    priority: 9,
    gain: 0.75,
    jitter: 0.1,
    noise: noise({ gain: 0.55, decay: 0.42, filter: band(2600, 180, 1.2, 0.36) }),
    tone: tone({ wave: 'square', freq: 330, freqEnd: 55, gain: 0.55, decay: 0.42, filter: low(2800, 400, 0.36) }),
    tone2: tone({
      wave: 'triangle',
      freq: F.G4,
      gain: 0.26,
      decay: 0.12,
      steps: 3,
      stepGap: 0.09,
      stepRatio: STEP.FOURTH,
    }),
  },

  // ══ THE TURN ═══════════════════════════════════════════════════════════

  /**
   * The turn ran out of time and every body was frozen in one step.
   *
   * Deliberately unlike `ui_denied`: nobody did anything wrong, the simulation
   * simply gave up. Two flat low notes rather than a falling buzz.
   */
  turn_timeout: {
    category: CATEGORY.UI,
    priority: 8,
    gain: 0.38,
    jitter: 0,
    tone: tone({ wave: 'square', freq: 73, gain: 0.45, decay: 0.13, steps: 2, stepGap: 0.14, stepRatio: 1, filter: low(520) }),
  },

  // ══ MARKS ══════════════════════════════════════════════════════════════

  mark_badge_on: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.32,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.E5, gain: 0.34, decay: 0.06, steps: 2, stepGap: 0.055, stepRatio: STEP.FOURTH, filter: low(BLIP_CEILING) }),
  },

  mark_badge_off: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.28,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.E5, gain: 0.3, decay: 0.06, steps: 2, stepGap: 0.055, stepRatio: STEP.DOWN_FOURTH, filter: low(BLIP_CEILING) }),
  },

  // ══ THE DRAWING SCREEN ═════════════════════════════════════════════════
  //
  // "브러시 스트로크: 그리는 동안 아주 작은 소리. 과하면 극도로 피로하다."
  // Its own bus, its own on/off toggle in the settings screen, the lowest gain
  // in the bank, and a hard minimum interval in the observer on top of the
  // cooldown here — because the pointer can deliver a hundred moves a second and
  // a stroke is the one gesture a player holds for minutes at a time.

  draw_color: {
    category: CATEGORY.UI,
    priority: 5,
    gain: 0.28,
    cooldown: 0.03,
    tone: tone({ wave: 'square', freq: F.D6, gain: 0.3, decay: 0.03, filter: low(BLIP_CEILING) }),
  },

  draw_tool: {
    category: CATEGORY.UI,
    priority: 5,
    gain: 0.28,
    cooldown: 0.03,
    tone: tone({ wave: 'square', freq: F.A5, gain: 0.3, decay: 0.035, filter: low(BLIP_CEILING) }),
  },

  draw_undo: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.32,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.D5, freqEnd: F.A4, gain: 0.38, decay: 0.1, filter: low(3000) }),
  },

  draw_redo: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.32,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.A4, freqEnd: F.D5, gain: 0.38, decay: 0.1, filter: low(3000) }),
  },

  /** Wiping the canvas. A sweep across, and the only long noise in the screen. */
  draw_clear: {
    category: CATEGORY.UI,
    priority: 7,
    gain: 0.4,
    jitter: 0.2,
    noise: noise({ gain: 0.55, attack: 0.02, decay: 0.3, curve: 'lin', filter: air(2400, 800, 1.6, 0.28) }),
  },

  draw_save: {
    category: CATEGORY.UI,
    priority: 8,
    gain: 0.4,
    jitter: 0,
    tone: tone({
      wave: 'square',
      freq: F.C5,
      gain: 0.36,
      decay: 0.08,
      steps: 3,
      stepGap: 0.06,
      stepRatio: 1.26,
      filter: low(5000),
    }),
  },

  /** Gone. It must not be mistakable for the save, so it falls and it thuds. */
  draw_delete: {
    category: CATEGORY.UI,
    priority: 8,
    gain: 0.4,
    jitter: 0.15,
    tone: tone({ wave: 'square', freq: F.C5, gain: 0.36, decay: 0.1, steps: 2, stepGap: 0.075, stepRatio: 0.63, filter: low(1800) }),
    noise: noise({ gain: 0.2, decay: 0.16, filter: low(900, 300, 0.15) }),
  },
};

// The id is the key, and carrying it on the object means every layer downstream
// — the pool's cooldown map, the panel's rows, a warning about an unknown
// sound — can name what it is holding without being handed the key separately.
for (const [id, def] of Object.entries(SOUNDS)) def.id = id;

/** Ids in declaration order. The panel builds its rows from this. */
export const SOUND_IDS = Object.keys(SOUNDS);

/**
 * A frozen copy, taken before anything can edit one.
 *
 * The bank's own `CONFIG_DEFAULTS`. It is here rather than in `config.js`
 * because these definitions nest and `deepAssign` cannot walk them safely — see
 * the file header.
 */
export const SOUND_DEFAULTS = structuredClone(SOUNDS);

/** Put every parameter back. The panel's reset, and only it. */
export function resetSounds() {
  for (const id of SOUND_IDS) {
    const src = SOUND_DEFAULTS[id];
    const dst = SOUNDS[id];
    // Key by key rather than by replacing the object, because the panel binds
    // its controllers to the LEAF objects (`SOUNDS.goal.tone`) and swapping the
    // parent would leave every one of those rows writing into an orphan.
    restore(dst, src);
  }
}

function restore(dst, src) {
  for (const key of Object.keys(src)) {
    const v = src[key];
    if (v && typeof v === 'object') {
      if (!dst[key] || typeof dst[key] !== 'object') dst[key] = {};
      restore(dst[key], v);
    } else {
      dst[key] = v;
    }
  }
}
