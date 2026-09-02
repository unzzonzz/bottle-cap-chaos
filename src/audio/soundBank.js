import { CATEGORY } from './categories.js';

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
 *   velPitch   the same for pitch. "강한 충돌은 크고 높게".
 *   velLength  the same for the envelope. "약한 충돌은 짧고".
 */

/**
 * The shared frequency set, in Hz.
 *
 * Two octaves of a pentatonic on A plus the three sub-bass anchors the impacts
 * live in. Named by role rather than by note, because nothing here reads them as
 * music: `SUB` is what a body sounds like, `RING` is what metal sounds like.
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

/** A minor third, a fourth and a fifth as ratios, for the stepped arpeggios. */
const STEP = { THIRD: 1.19, FOURTH: 1.335, FIFTH: 1.5, OCTAVE: 2, DOWN_FIFTH: 0.667, DOWN_FOURTH: 0.749 };

/**
 * One oscillator layer, with the house defaults filled in.
 *
 * A factory rather than sixty literals, so a field nobody set is the same value
 * everywhere — which is most of what "the same palette" means in practice. The
 * result is a plain object; nothing survives of the function.
 */
function tone(o = {}) {
  return {
    wave: o.wave ?? 'square',
    freq: o.freq ?? F.A4,
    freqEnd: o.freqEnd ?? o.freq ?? F.A4,
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

/** One filtered-noise layer, same arrangement. */
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
 * 기본파와 3배음만 남은 블립은 유리가 아니라 나무 소리다. 유리와 물이 유리와 물로
 * 들리는 것은 그 위의 배음들이다.
 *
 * 7200 은 그 배음이 살아나면서도 여전히 상한이 있는 자리다. 완전히 열지 않는
 * 이유는 사각파의 고차 배음이 그대로 남으면 새 잔향의 꼬리에 실려 쉭쉭거리기
 * 때문이다 — 크러셔의 접힘 대신 잔향이 그것을 드러낸다.
 *
 * 여전히 맨 톤 블립에만 적용된다. 충돌음과 스팅어는 대역폭을 다 쓴다.
 */
const BLIP_CEILING = 7200;

/** A high-pass. Air, paper, shimmer. */
function high(from, to = from, sweep = 0.09) {
  return { type: 'highpass', freq: from, freqEnd: to, q: 0.7, sweep };
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

  /** Cap on cap. Metal on metal: a filtered noise crack with a short ring. */
  cap_cap: {
    category: CATEGORY.IMPACT,
    priority: 3,
    gain: 0.5,
    cooldown: 0.035,
    voices: 4,
    velGain: 0.85,
    velPitch: 0.55,
    velLength: 0.6,
    noise: noise({ gain: 0.5, decay: 0.1, filter: band(4200, 900, 6, 0.07) }),
    tone: tone({ wave: 'square', freq: 320, freqEnd: 180, gain: 0.3, decay: 0.07, filter: low(2600) }),
    // The inharmonic partial. A cap is a shallow dish, not a string, so its
    // second mode is nowhere near an octave — 3.6x is what makes it read as
    // pressed steel rather than as a tuned bell.
    tone2: tone({ wave: 'triangle', freq: 1180, freqEnd: 940, gain: 0.16, decay: 0.05 }),
  },

  /** Cap on wall or fence. Deliberately duller and lower than cap on cap. */
  cap_wall: {
    category: CATEGORY.IMPACT,
    priority: 2,
    gain: 0.42,
    cooldown: 0.05,
    voices: 3,
    velGain: 0.85,
    velPitch: 0.4,
    velLength: 0.5,
    noise: noise({ gain: 0.4, decay: 0.12, filter: low(900, 260, 0.1) }),
    tone: tone({ wave: 'triangle', freq: F.LOW, freqEnd: F.THUD, gain: 0.45, decay: 0.11 }),
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
    noise: noise({ gain: 1, attack: 0.09, decay: 0.2, filter: band(1500, 1500, 1.2) }),
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
    noise: noise({ gain: 0.2, decay: 0.05, filter: high(1800, 3400, 0.07) }),
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
    noise: noise({ gain: 0.25, decay: 0.02, filter: high(3000, 3000, 0.02) }),
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
    tone: tone({ wave: 'square', freq: F.A5, freqEnd: F.C6, gain: 0.4, decay: 0.045, filter: low(BLIP_CEILING) }),
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
    tone: tone({ wave: 'sawtooth', freq: F.A4, freqEnd: F.G6, gain: 0.26, decay: 0.2, filter: low(1600, 6200, 0.2) }),
    noise: noise({ gain: 0.14, decay: 0.2, filter: high(1800, 6000, 0.2) }),
  },

  ui_confirm_open: {
    category: CATEGORY.UI,
    priority: 6,
    gain: 0.3,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.A4, gain: 0.4, decay: 0.07, steps: 2, stepGap: 0.07, stepRatio: STEP.FOURTH, filter: low(BLIP_CEILING) }),
  },

  ui_confirm_yes: {
    category: CATEGORY.UI,
    priority: 7,
    gain: 0.36,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.C5, gain: 0.38, decay: 0.07, steps: 2, stepGap: 0.06, stepRatio: STEP.FIFTH, filter: low(BLIP_CEILING) }),
  },

  ui_confirm_no: {
    category: CATEGORY.UI,
    priority: 7,
    gain: 0.32,
    jitter: 0,
    tone: tone({ wave: 'square', freq: F.C5, gain: 0.34, decay: 0.07, steps: 2, stepGap: 0.06, stepRatio: STEP.DOWN_FOURTH, filter: low(BLIP_CEILING) }),
  },

  /** Not allowed. Low, buzzing, and short enough not to be a punishment. */
  ui_denied: {
    category: CATEGORY.UI,
    priority: 8,
    gain: 0.4,
    cooldown: 0.18,
    jitter: 0.2,
    tone: tone({ wave: 'square', freq: 98, freqEnd: 82, gain: 0.5, decay: 0.2, filter: low(700, 420, 0.18) }),
  },

  // ══ CARDS ══════════════════════════════════════════════════════════════

  card_hover: {
    category: CATEGORY.CARD,
    priority: 0,
    gain: 0.2,
    cooldown: 0.06,
    voices: 2,
    noise: noise({ gain: 0.4, decay: 0.055, filter: high(2200, 5200, 0.05) }),
  },

  card_drag: {
    category: CATEGORY.CARD,
    priority: 2,
    gain: 0.24,
    cooldown: 0.05,
    noise: noise({ gain: 0.4, decay: 0.07, filter: band(1400, 2600, 1.2, 0.06) }),
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
    tone: tone({ wave: 'square', freq: F.C6, gain: 0.34, decay: 0.045, steps: 2, stepGap: 0.042, stepRatio: STEP.THIRD, filter: low(BLIP_CEILING) }),
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
    tone: tone({
      wave: 'triangle',
      freq: 620,
      freqEnd: 300,
      gain: 0.4,
      decay: 0.09,
      steps: 2,
      stepGap: 0.075,
      stepRatio: 0.62,
      stepGain: 0.7,
    }),
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
  //   원모어  the same note again an octave up. Literally a repeat.
  //   강타    everything low and loud with a noise punch. Weight.
  //   스왑    two tones crossing in opposite directions. An exchange.

  card_fx_trajectory: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.42,
    jitter: 0,
    tone: tone({
      wave: 'triangle',
      freq: F.G4,
      gain: 0.38,
      decay: 0.07,
      steps: 4,
      stepGap: 0.058,
      stepRatio: 1.26,
      stepGain: 0.94,
      filter: high(700),
    }),
    noise: noise({ gain: 0.12, decay: 0.22, filter: high(3200, 6000, 0.2) }),
  },

  card_fx_chaos: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.44,
    jitter: 0.3,
    tone: tone({ wave: 'sawtooth', freq: 300, freqEnd: 176, gain: 0.34, decay: 0.3, filter: low(1500, 600, 0.28) }),
    // Six hertz apart, which is a wobble rather than a chord and is the closest
    // a two-oscillator palette gets to "어지러운".
    tone2: tone({ wave: 'sawtooth', freq: 306, freqEnd: 182, gain: 0.3, decay: 0.3, filter: low(1500, 600, 0.28) }),
    noise: noise({ gain: 0.14, decay: 0.26, filter: band(900, 1800, 2, 0.24) }),
  },

  card_fx_onemore: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.42,
    jitter: 0,
    tone: tone({
      wave: 'square',
      freq: F.E5,
      gain: 0.36,
      decay: 0.1,
      steps: 2,
      stepGap: 0.13,
      stepRatio: STEP.OCTAVE,
      filter: low(3400),
    }),
  },

  card_fx_smash: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.58,
    jitter: 0.2,
    tone: tone({ wave: 'square', freq: 180, freqEnd: 58, gain: 0.55, decay: 0.3, filter: low(1800, 500, 0.26) }),
    tone2: tone({ wave: 'sawtooth', freq: 90, freqEnd: 44, gain: 0.3, decay: 0.3 }),
    noise: noise({ gain: 0.45, decay: 0.18, filter: low(2200, 300, 0.16) }),
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
   * 그 배음이 "금속성 잔향"이다. 3.7배는 옥타브 근처가 아니므로 종이 아니라 눌린
   * 강판으로 읽힌다 — `cap_cap` 이 같은 이유로 3.6배를 쓴다. 두 소리가 같은 재료의
   * 것으로 들려야 하는데, 이 카드가 하는 일이 바로 그 뚜껑을 더 두껍게 만드는
   * 것이기 때문이다.
   */
  card_fx_resist: {
    category: CATEGORY.CARD,
    priority: 9,
    jitter: 0,
    gain: 0.5,
    tone: tone({ wave: 'square', freq: F.THUD, gain: 0.5, decay: 0.16, filter: low(1200, 400, 0.14) }),
    tone2: tone({ wave: 'triangle', freq: F.THUD * 3.7, gain: 0.18, decay: 0.34, filter: band(1100, 700, 3, 0.3) }),
    noise: noise({ gain: 0.2, decay: 0.07, filter: low(1400, 400, 0.06) }),
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
    tone: tone({ wave: 'square', freq: F.G5, freqEnd: F.E5, gain: 0.3, decay: 0.045, filter: low(4200) }),
    tone2: tone({ wave: 'triangle', freq: F.G5 * 2.9, gain: 0.12, decay: 0.035 }),
  },

  card_fx_swap: {
    category: CATEGORY.CARD,
    priority: 9,
    gain: 0.42,
    jitter: 0,
    tone: tone({ wave: 'triangle', freq: F.C5, freqEnd: F.C6, gain: 0.34, decay: 0.26, filter: low(4000) }),
    tone2: tone({ wave: 'triangle', freq: F.C6, freqEnd: F.C5, gain: 0.34, decay: 0.26, filter: low(4000) }),
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
    noise: noise({ gain: 0.12, decay: 0.26, filter: high(3600, 7000, 0.24) }),
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
    noise: noise({ gain: 0.14, decay: 0.14, filter: high(4000, 8000, 0.13) }),
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
      // Wide and high. A narrow band here is a resonance, and a resonance is a
      // pipe — which is the thing this sound was rebuilt to stop being.
      filter: band(4200, 4200, 1.1),
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

  /** The ball, struck. Lighter and springier than cap on cap, as asked. */
  ball_cap: {
    category: CATEGORY.IMPACT,
    priority: 5,
    gain: 0.5,
    cooldown: 0.04,
    voices: 2,
    velGain: 0.8,
    velPitch: 0.6,
    velLength: 0.4,
    tone: tone({ wave: 'triangle', freq: 520, freqEnd: 340, gain: 0.5, decay: 0.09, filter: low(3600) }),
    noise: noise({ gain: 0.28, decay: 0.05, filter: band(2000, 1100, 3.4, 0.045) }),
  },

  ball_wall: {
    category: CATEGORY.IMPACT,
    priority: 4,
    gain: 0.4,
    cooldown: 0.05,
    voices: 2,
    velGain: 0.8,
    velPitch: 0.45,
    velLength: 0.4,
    tone: tone({ wave: 'triangle', freq: 300, freqEnd: 210, gain: 0.45, decay: 0.08 }),
    noise: noise({ gain: 0.24, decay: 0.07, filter: low(1400, 600, 0.06) }),
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
    noise: noise({ gain: 0.2, decay: 0.4, filter: high(3400, 7600, 0.36) }),
  },

  /** The woodwork. A ring that goes nowhere — the sound of nearly. */
  goal_post: {
    category: CATEGORY.STINGER,
    priority: 7,
    gain: 0.6,
    cooldown: 0.1,
    jitter: 0.15,
    velGain: 0.5,
    velPitch: 0.25,
    tone: tone({ wave: 'triangle', freq: 1245, freqEnd: 1180, gain: 0.4, decay: 0.4, filter: high(800) }),
    tone2: tone({ wave: 'triangle', freq: 1868, freqEnd: 1760, gain: 0.2, decay: 0.28 }),
    noise: noise({ gain: 0.35, decay: 0.1, filter: band(3400, 1400, 8, 0.09) }),
  },

  /** The net taking the pace off. Soft, and it fades rather than stopping. */
  ball_net: {
    category: CATEGORY.IMPACT,
    priority: 6,
    gain: 0.3,
    cooldown: 0.2,
    noise: noise({ gain: 0.5, attack: 0.01, decay: 0.34, curve: 'lin', filter: low(900, 190, 0.3) }),
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
    noise: noise({ gain: 0.55, attack: 0.02, decay: 0.3, curve: 'lin', filter: high(500, 6400, 0.28) }),
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
