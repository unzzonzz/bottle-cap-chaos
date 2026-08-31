/**
 * The instrument panel. What the iOS verification is actually for.
 *
 * ── why this is DOM and not a mesh ─────────────────────────────────────────────
 * Every other overlay in this project is three.js geometry rendered into the
 * low-res target before the retro pass, and that is exactly why this one must not
 * be. A mesh layer would be dithered and quantised to 15-bit like everything
 * else — unreadable at 11px — it would move with `view.renderMode`, and worst of
 * all it would add draw calls to the very frame it is measuring. A fixed DOM box
 * is composited by the browser outside the WebGL frame and costs nothing the
 * numbers are trying to report.
 *
 * ── why it is not behind ?debug=1 ──────────────────────────────────────────────
 * The existing panel (`PhysicsDebug`) is gated on `?debug=1` in the launch URL,
 * which in a Capacitor app is unreachable: there is no address bar. The gate here
 * is a tap on the badge, and the choice is persisted, so the panel can be raised
 * and lowered on a phone with no keyboard.
 *
 * ── what "accumulator is behind" actually means here ───────────────────────────
 * This is the number the whole exercise turns on, and it is worth being precise
 * about, because the sim CANNOT spiral — two separate clamps stop it:
 *
 *   `Match.update` drains at most MAX_STEPS_PER_FRAME (20) steps and then sets
 *   `_acc = 0`, dropping the remainder rather than carrying it.
 *
 *   `main.js:frame` clamps the frame delta to 0.05 s before the accumulator ever
 *   sees it, which is 6 steps at 1/120 — so the 20-step ceiling is not even
 *   reachable from the main loop at slowmo 1.
 *
 * So the failure mode is not a death spiral, it is SILENT TIME LOSS: past 50 ms
 * of frame time the clamp throws away real seconds and the simulation runs slower
 * than the wall clock while every individual step stays correct. `drop` below
 * counts those frames and totals the discarded seconds, which is the honest
 * measure of "밀리고 있다". `sat` counts the 20-step ceiling separately, because
 * if it ever fires it means something other than the main loop is driving the
 * accumulator.
 */

const KEY = 'bcc.metrics.v1';

/** off -> compact -> full -> off. The tap cycle. */
const MODES = ['off', 'compact', 'full'];

/** Frame delta above which `main.js` clamps and real time is discarded. */
const CLAMP_MS = 50;

/** How many frames the rolling window holds. ~4 s at 60 Hz. */
const WINDOW = 240;

/** DOM writes per second. The numbers accumulate every frame regardless. */
const REDRAW_HZ = 4;

function readMode() {
  try {
    const raw = window.localStorage.getItem(KEY);
    // Compact by default, and compact is three short lines on purpose: the full
    // readout is 16 lines and on a 402-pixel-wide phone that is most of the
    // bottom band, i.e. on top of the card hand. Full is a deliberate tap away.
    return MODES.includes(raw) ? raw : 'compact';
  } catch {
    // Private mode throws on ACCESS, not just on write. Same seam every other
    // storage in this project uses; see MarkStorage.
    return 'compact';
  }
}

function writeMode(mode) {
  try {
    window.localStorage.setItem(KEY, mode);
  } catch {
    /* a preference that cannot be saved is still a preference for this session */
  }
}

/** p-th percentile of an unsorted numeric array, without mutating it. */
function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.max(0, Math.round((p / 100) * (sorted.length - 1))));
  return sorted[i];
}

export class MetricsOverlay {
  /**
   * @param {object} opts
   * @param {number} [opts.bootMs]
   *   Wall-clock ms from navigation start to the first frame, measured by the
   *   caller. Includes the Rapier WASM compile, which is the interesting part.
   */
  constructor({ bootMs = 0 } = {}) {
    this.bootMs = bootMs;

    this._mode = readMode();
    this._frames = [];
    this._ticks = [];
    this._phys = [];

    /** Frames whose raw interval exceeded the clamp — real time was discarded. */
    this._dropped = 0;
    /** Seconds of wall clock thrown away by that clamp, cumulative. */
    this._lostSec = 0;
    /** Frames where the step drain hit its own ceiling. Should stay 0. */
    this._saturated = 0;

    this._steps = 0;
    this._stepPeak = 0;
    this._backlogMs = 0;

    this._aiMs = 0;
    this._aiPeak = 0;
    this._aiTotalMs = 0;
    this._aiTurns = 0;
    this._aiActive = false;

    this._label = '';
    this._note = '';
    this._lastNow = 0;
    this._lastPaint = 0;

    this._root = null;
    this._body = null;
    this._badge = null;
    this._build();
    this._applyMode();
  }

  // ── the panel ───────────────────────────────────────────────────────────────

  _build() {
    if (typeof document === 'undefined') return;

    const root = document.createElement('div');
    root.className = 'metrics-hud';
    // The canvas owns every pointer event in this app — `PointerRouter` binds
    // pointerdown/move/up on it directly — so a DOM box laid over the game
    // silently eats shots. Only the badge opts back in.
    root.style.pointerEvents = 'none';

    const badge = document.createElement('button');
    badge.className = 'metrics-hud__badge';
    badge.type = 'button';
    badge.textContent = 'FPS';
    badge.setAttribute('aria-label', '성능 측정 오버레이 전환');

    const press = (e) => {
      // pointerdown, not click: this app is pointer-driven throughout, and a
      // click would arrive after a 300 ms wait on some configurations. Stopping
      // propagation keeps the tap off the board behind it.
      e.preventDefault();
      e.stopPropagation();
      this.cycle();
    };
    badge.addEventListener('pointerdown', press);

    const body = document.createElement('pre');
    body.className = 'metrics-hud__body';

    root.appendChild(badge);
    root.appendChild(body);
    document.body.appendChild(root);

    this._root = root;
    this._badge = badge;
    this._body = body;
  }

  cycle() {
    const next = MODES[(MODES.indexOf(this._mode) + 1) % MODES.length];
    this._mode = next;
    writeMode(next);
    this._applyMode();
  }

  _applyMode() {
    if (!this._root) return;
    this._root.dataset.mode = this._mode;
    if (this._body) this._body.hidden = this._mode === 'off';
  }

  // ── sampling ────────────────────────────────────────────────────────────────

  /**
   * Called at the very top of the rAF callback, with the raw timestamp.
   *
   * Before the clamp on purpose: the clamped delta is what the simulation gets,
   * and the raw one is what actually happened. The gap between them IS the
   * measurement.
   */
  beginFrame(now) {
    if (this._lastNow) {
      const raw = now - this._lastNow;
      // A resume after `visibilitychange` re-seeds `last` and the first interval
      // back is the length of the background stay. Counting it would put a
      // multi-second outlier in every percentile for the rest of the window.
      if (raw < 2000) {
        this._push(this._frames, raw);
        if (raw > CLAMP_MS) {
          this._dropped++;
          this._lostSec += (raw - CLAMP_MS) / 1000;
        }
      }
    }
    this._lastNow = now;
  }

  /** Reset the interval chain. Call where the loop restarts after a pause. */
  resume() {
    this._lastNow = 0;
  }

  /**
   * Everything the frame cost, handed over in one call once `tick` has returned.
   *
   * @param {object} s
   * @param {number} s.tickMs      wall time of the whole tick, ms
   * @param {number} s.physicsMs   wall time of `match.update(dt)`, ms
   * @param {number} s.steps       physics steps run this frame
   * @param {number} s.backlogSec  the accumulator's leftover, seconds
   * @param {boolean} s.saturated  the drain hit MAX_STEPS_PER_FRAME
   * @param {number} [s.aiMs]      ms the AI planner burned this frame
   * @param {boolean} [s.aiThinking]
   * @param {string} [s.label]     mode name, for the readout
   * @param {string} [s.note]      free-text line; used for the render size
   */
  endFrame(s) {
    this._push(this._ticks, s.tickMs);
    this._push(this._phys, s.physicsMs);

    this._steps = s.steps;
    if (s.steps > this._stepPeak) this._stepPeak = s.steps;
    if (s.saturated) this._saturated++;
    this._backlogMs = s.backlogSec * 1000;

    const ai = s.aiMs ?? 0;
    this._aiMs = ai;
    if (ai > this._aiPeak) this._aiPeak = ai;

    // A turn is the span the planner is thinking across, not a frame. Totalled
    // on the rising edge so the readout survives the turn it describes.
    const thinking = !!s.aiThinking;
    if (thinking) this._aiTotalMs += ai;
    if (thinking && !this._aiActive) this._aiTurnMs = 0;
    if (thinking) this._aiTurnMs = (this._aiTurnMs ?? 0) + ai;
    if (!thinking && this._aiActive) {
      this._aiTurns++;
      this._aiLastTurnMs = this._aiTurnMs ?? 0;
    }
    this._aiActive = thinking;

    if (s.label) this._label = s.label;
    if (s.note) this._note = s.note;

    this._maybePaint();
  }

  _push(arr, v) {
    if (!Number.isFinite(v)) return;
    arr.push(v);
    if (arr.length > WINDOW) arr.shift();
  }

  /** Clear the rolling stats. The peaks and the drop counters survive. */
  resetWindow() {
    this._frames.length = 0;
    this._ticks.length = 0;
    this._phys.length = 0;
  }

  /** Everything the report needs, as plain data. Also what a console dump reads. */
  snapshot() {
    const f = this._frames;
    const mean = f.length ? f.reduce((a, b) => a + b, 0) / f.length : 0;
    return {
      fps: mean > 0 ? 1000 / mean : 0,
      // The 99th percentile FRAME is the 1% low FPS. The slow frames are the
      // ones that are felt, and an average hides them completely.
      fpsLow: percentile(f, 99) > 0 ? 1000 / percentile(f, 99) : 0,
      frameMs: mean,
      frameP99: percentile(f, 99),
      tickMs: this._ticks.length ? this._ticks.reduce((a, b) => a + b, 0) / this._ticks.length : 0,
      tickP99: percentile(this._ticks, 99),
      physicsMs: this._phys.length ? this._phys.reduce((a, b) => a + b, 0) / this._phys.length : 0,
      physicsP99: percentile(this._phys, 99),
      steps: this._steps,
      stepPeak: this._stepPeak,
      backlogMs: this._backlogMs,
      dropped: this._dropped,
      lostSec: this._lostSec,
      saturated: this._saturated,
      aiPeakMs: this._aiPeak,
      aiTurnMs: this._aiLastTurnMs ?? 0,
      aiTurns: this._aiTurns,
      aiTotalMs: this._aiTotalMs,
      bootMs: this.bootMs,
      heap: readHeap(),
      label: this._label,
      note: this._note,
    };
  }

  // ── painting ────────────────────────────────────────────────────────────────

  _maybePaint() {
    if (this._mode === 'off' || !this._body) return;
    const now = performance.now();
    if (now - this._lastPaint < 1000 / REDRAW_HZ) return;
    this._lastPaint = now;

    const s = this.snapshot();
    this._badge.textContent = `${s.fps.toFixed(0)}`;
    // The badge is the whole readout when the body is down, so it carries the
    // one bit that matters: is the loop keeping up.
    this._badge.dataset.warn = s.dropped > 0 || s.saturated > 0 ? '1' : '0';

    this._body.textContent =
      this._mode === 'compact' ? this._compactText(s) : this._fullText(s);
  }

  _compactText(s) {
    return [
      `fps  ${pad(s.fps.toFixed(1), 6)} low ${s.fpsLow.toFixed(1)}`,
      `phys ${pad(s.physicsMs.toFixed(2), 6)} x${s.steps}`,
      `drop ${s.dropped}`,
    ].join('\n');
  }

  _fullText(s) {
    const heap = s.heap
      ? `${(s.heap.used / 1048576).toFixed(0)}/${(s.heap.limit / 1048576).toFixed(0)} MB`
      : 'n/a (WebKit)';

    const lines = [
      `${s.label || 'bottle-cap-chaos'}`,
      `boot  ${s.bootMs ? `${s.bootMs.toFixed(0)} ms` : '—'}`,
      '',
      `fps   ${pad(s.fps.toFixed(1), 6)}  low ${s.fpsLow.toFixed(1)}`,
      `frame ${pad(s.frameMs.toFixed(2), 6)}  p99 ${s.frameP99.toFixed(2)} ms`,
      `tick  ${pad(s.tickMs.toFixed(2), 6)}  p99 ${s.tickP99.toFixed(2)} ms`,
      `phys  ${pad(s.physicsMs.toFixed(2), 6)}  p99 ${s.physicsP99.toFixed(2)} ms`,
      '',
      `steps ${pad(String(s.steps), 6)}  peak ${s.stepPeak}`,
      `acc   ${pad(s.backlogMs.toFixed(2), 6)} ms leftover`,
      `drop  ${pad(String(s.dropped), 6)}  lost ${s.lostSec.toFixed(2)} s`,
      `sat   ${s.saturated}`,
      '',
      `ai    ${s.aiTurnMs ? `${s.aiTurnMs.toFixed(0)} ms/turn` : '—'}  peak ${s.aiPeakMs.toFixed(1)} ms/frame`,
      `mem   ${heap}`,
    ];
    if (s.note) lines.push('', s.note);
    return lines.join('\n');
  }

  dispose() {
    this._root?.remove();
    this._root = null;
  }
}

function pad(text, width) {
  return String(text).padStart(width, ' ');
}

/**
 * The JS heap, where the engine will say.
 *
 * `performance.memory` is a Chromium extension. WebKit — every iOS browser and
 * every WKWebView — does not implement it and never has, so on the device this
 * reads null and the panel says so rather than showing a zero. The real number
 * on iOS comes from Xcode's memory gauge or Instruments, and it is the only way
 * to get it: there is no JS API for the WASM heap either.
 */
function readHeap() {
  const m = performance.memory;
  if (!m || !Number.isFinite(m.usedJSHeapSize)) return null;
  return { used: m.usedJSHeapSize, limit: m.jsHeapSizeLimit };
}

/** The stub, so a caller never branches on whether measurement is on. */
export const NO_METRICS = {
  beginFrame() {},
  endFrame() {},
  resume() {},
  resetWindow() {},
  cycle() {},
  snapshot: () => ({}),
  dispose() {},
};
