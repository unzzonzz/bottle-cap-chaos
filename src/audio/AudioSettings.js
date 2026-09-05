/**
 * What the player chose about sound, and where it lives.
 *
 * ── it is a second document, not a field on the first ───────────────────────
 * `MarkStorage.sanitise` builds from `emptyBook()` and copies exactly `slots`
 * and `assigned`, and `save` re-sanitises on the way OUT — so an audio field
 * smuggled into the marks document would be silently destroyed the next time
 * anybody drew a mark. Its own key, its own version, its own validator.
 *
 * ── everything else about this file is copied on purpose ────────────────────
 * The shape is `MarkStorage`'s, deliberately and line for line in spirit: an
 * abstract base whose methods return a valid default (so it is usable as a null
 * object, not merely as a type), a browser implementation with every call
 * individually try/caught, and an in-memory twin that proves nothing above names
 * an implementation. The brief asks for the same storage abstraction and this is
 * what following it means — not "also use localStorage", but "be the same seam".
 *
 * ── two try blocks in `load`, and that is not redundant ─────────────────────
 * `localStorage` throws on mere ACCESS in a privacy mode or a sandboxed frame,
 * which is a different failure from a corrupt blob, and conflating them would
 * mean a private-browsing session takes the JSON path and dies there.
 *
 * ── what is NOT in here ────────────────────────────────────────────────────
 * Every tuning number — crush strength, voice caps, cooldowns, per-category
 * trims, the sound definitions themselves. Those are `CONFIG.audio` and
 * `soundBank`, they belong to the developer rather than to the player, and
 * `CONFIG` is never persisted anywhere in this project. What is here is the
 * three things the settings screen offers.
 */

/** Storage schema version. Bumped when the saved shape changes. */
const VERSION = 1;
const KEY = 'msa.audio.v1';

/**
 * @typedef {object} AudioSettingsData
 * @property {number} volume   master, 0..1
 * @property {boolean} muted   independent of volume, so muting does not lose it
 *
 * There was a third field for the mark editor's stroke tick. Both the sound and
 * its toggle were removed on the player's instruction, and nothing had to be
 * migrated: `sanitise` builds from the defaults and copies field by field, so a
 * document written by the build that had it comes back clean instead of being
 * rejected. That is exactly what the discipline is for, and why the version did
 * not need bumping.
 */

/**
 * A device that has never saved anything.
 *
 * 0.7 rather than 1: the master sits before a limiter, and a game that opens at
 * full scale has nowhere to go when the player wants it louder. Muted is false —
 * an audio system that ships silent reads as broken, and the toggle is one press
 * away on the settings screen.
 */
export function defaultAudioSettings() {
  return { volume: 0.7, muted: false };
}

function sanitise(raw) {
  const out = defaultAudioSettings();
  if (!raw || typeof raw !== 'object') return out;

  // Field by field with a type AND a range test, never a whole-shape check: a
  // document written by a build with two fields, or four, comes back usable
  // instead of being thrown away whole.
  if (typeof raw.volume === 'number' && Number.isFinite(raw.volume)) {
    out.volume = Math.max(0, Math.min(1, raw.volume));
  }
  if (typeof raw.muted === 'boolean') out.muted = raw.muted;
  return out;
}

/**
 * The contract. Subclass it, or hand in anything with these three methods.
 *
 * Synchronous, like `MarkStorage`, and for the same reason: the one
 * implementation that exists is, and the settings screen reads while building a
 * scene. The day it becomes a fetch, these grow an `await` and so do the two
 * call sites.
 */
export class AudioSettingsStorage {
  /** @returns {AudioSettingsData} never null. */
  load() {
    return defaultAudioSettings();
  }

  /** @param {AudioSettingsData} _s */
  save(_s) {}

  /** Forget this device ever had settings. */
  delete() {}
}

/** The browser implementation. One JSON document under one key. */
export class LocalStorageAudioSettings extends AudioSettingsStorage {
  /** @param {string} [key] */
  constructor(key = KEY) {
    super();
    this.key = key;
  }

  load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return defaultAudioSettings();
    }
    if (!raw) return defaultAudioSettings();
    try {
      return sanitise(JSON.parse(raw));
    } catch {
      // Unparseable. Treated as absent rather than repaired — there is nothing
      // in a corrupt blob worth guessing at.
      return defaultAudioSettings();
    }
  }

  /** @returns {boolean} whether it actually landed. */
  save(settings) {
    try {
      window.localStorage.setItem(
        this.key,
        JSON.stringify({ version: VERSION, ...sanitise(settings) }),
      );
      return true;
    } catch {
      return false;
    }
  }

  delete() {
    try {
      window.localStorage.removeItem(this.key);
    } catch {
      /* nothing to do about it, and nothing that depends on it succeeding */
    }
  }
}

/** In-memory. For the panel's reset and for anything under test. */
export class MemoryAudioSettings extends AudioSettingsStorage {
  constructor(settings = defaultAudioSettings()) {
    super();
    this._s = sanitise(settings);
  }

  load() {
    return sanitise(this._s);
  }

  save(settings) {
    this._s = sanitise(settings);
    return true;
  }

  delete() {
    this._s = defaultAudioSettings();
  }
}

/**
 * The model: holds the document, applies the rules, writes through, notifies.
 *
 * `MarkBook`'s shape, including the parts that look like details and are not:
 * the storage is INJECTED and loaded eagerly in the constructor (the mixer wants
 * the volume before its first sound), every mutator validates and returns a
 * boolean rather than throwing, `_commit` emits UNCONDITIONALLY because a quota
 * failure is a reason to warn and not a reason to show the player a slider that
 * did not move, and `onChange` returns its own unsubscribe so a consumer can
 * drop it in `dispose()`.
 */
export class AudioSettingsBook {
  /** @param {AudioSettingsStorage} storage */
  constructor(storage) {
    this.storage = storage;
    /** @type {AudioSettingsData} */
    this._data = storage.load();
    this._listeners = new Set();
  }

  get volume() {
    return this._data.volume;
  }

  get muted() {
    return this._data.muted;
  }

  /** The gain the mixer should actually run at. One place computes it. */
  get effectiveVolume() {
    return this._data.muted ? 0 : this._data.volume;
  }

  snapshot() {
    return { ...this._data };
  }

  /** @param {number} v 0..1 */
  setVolume(v) {
    if (typeof v !== 'number' || !Number.isFinite(v)) return false;
    const next = Math.max(0, Math.min(1, v));
    if (next === this._data.volume) return true;
    this._data.volume = next;
    return this._commit();
  }

  setMuted(on) {
    const next = !!on;
    if (next === this._data.muted) return true;
    this._data.muted = next;
    return this._commit();
  }

  toggleMuted() {
    return this.setMuted(!this._data.muted);
  }

  /**
   * Back to first-run, and FORGET the key.
   *
   * Deliberately not through `_commit`, exactly as `MarkBook.reset` is not: a
   * reset that saved would immediately write the defaults back rather than
   * forgetting that this device ever had settings.
   */
  reset() {
    this._data = defaultAudioSettings();
    this.storage.delete();
    this._emit();
    return true;
  }

  /** @returns {() => void} unsubscribe */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _commit() {
    const ok = this.storage.save(this._data) !== false;
    this._emit();
    return ok;
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }
}
