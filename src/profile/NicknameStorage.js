import { validateNickname } from '../net/protocol.js';

/**
 * What this player is called, persisted.
 *
 * ── its own key, its own version, its own validator ────────────────────────
 * Not a field on the mark book. `AudioSettings` was split out of the marks
 * document for exactly this reason and says so at length: a foreign field
 * smuggled into somebody else's document is destroyed the next time that
 * document's own sanitiser runs, and the loss is silent. A nickname is not a
 * property of a mark book; it gets its own document.
 *
 * ── the same three-method seam as `MarkStorage` ────────────────────────────
 * `load` / `save` / `delete`, synchronous, with a base class that is a usable
 * null object rather than an abstract that throws. The brief asks for the
 * nickname store to be an interface so that an account system can replace it,
 * and the shape that replacement should fit is the one already in the project —
 * so this is a deliberate copy of it rather than a second convention.
 *
 * When names become server-side and permanent, the class constructed in
 * `main.js` and `bootMenu.js` changes and nothing else does. That is the same
 * promise `MarkStorage` makes, and it is the reason `LocalStorageNicknames` is
 * named in exactly two places in the project.
 */

export const KEY = 'msa.profile.v1';
export const VERSION = 1;

/**
 * @typedef {object} ProfileData
 * @property {string} nickname  '' when unset — a real state, not a missing one
 * @property {string} server    the relay this player last used, '' for the default
 */

export function emptyProfile() {
  return { nickname: '', server: '' };
}

/**
 * Coerce anything into a valid profile.
 *
 * Field by field from `emptyProfile`, like `MarkStorage.sanitise`, so a document
 * written by a build with more fields in it comes back usable rather than being
 * thrown away whole — and so a field this build does not know about cannot ride
 * along into memory.
 *
 * The nickname is re-validated on the way IN as well as on the way out. What is
 * in storage was legal when it was written, and the rules can change; a name
 * that is no longer legal is dropped to '' rather than carried into a handshake
 * the server will refuse for reasons the player cannot see.
 */
function sanitise(raw) {
  const out = emptyProfile();
  if (!raw || typeof raw !== 'object') return out;

  const checked = validateNickname(raw.nickname);
  if (checked.ok) out.nickname = checked.value;

  // Not validated beyond being a string: it is an address the player typed, and
  // the only thing that can judge it is trying to connect to it.
  if (typeof raw.server === 'string' && raw.server.length <= 200) out.server = raw.server;

  return out;
}

/** The contract. Subclass it, or hand in anything with these three methods. */
export class NicknameStorage {
  /** @returns {ProfileData} never null. */
  load() {
    return emptyProfile();
  }

  /** @param {ProfileData} profile @returns {boolean} whether it landed */
  save(_profile) {
    return true;
  }

  /** Forget it. The panel's reset, and nothing else. */
  delete() {}
}

/**
 * The browser implementation. One JSON document under one key.
 *
 * Every call wrapped, for the reason `LocalStorageMarks` gives: `localStorage`
 * throws on a full quota and throws on mere ACCESS in a privacy mode. Being
 * unable to open the settings screen in private browsing because a nickname
 * could not be read would be a poor trade.
 */
export class LocalStorageNicknames extends NicknameStorage {
  constructor(key = KEY) {
    super();
    this.key = key;
  }

  load() {
    let raw = null;
    try {
      raw = window.localStorage.getItem(this.key);
    } catch {
      return emptyProfile();
    }
    if (!raw) return emptyProfile();
    try {
      return sanitise(JSON.parse(raw));
    } catch {
      return emptyProfile();
    }
  }

  save(profile) {
    try {
      window.localStorage.setItem(
        this.key,
        JSON.stringify({ version: VERSION, ...sanitise(profile) }),
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
      /* nothing depends on this succeeding */
    }
  }
}

/** In memory. For tests, and to prove the seam is real. */
export class MemoryNicknames extends NicknameStorage {
  constructor(profile = emptyProfile()) {
    super();
    this._p = sanitise(profile);
  }

  load() {
    return sanitise(this._p);
  }

  save(profile) {
    this._p = sanitise(profile);
    return true;
  }

  delete() {
    this._p = emptyProfile();
  }
}

/**
 * The live profile, with change notification.
 *
 * Mirrors `MarkBook`: the storage is injected, every mutation commits through
 * one place, and `onChange` lets a screen redraw without polling. Kept small
 * because there are only two fields — this is not a book.
 */
export class Profile {
  /** @param {NicknameStorage} storage */
  constructor(storage) {
    this.storage = storage;
    this._data = storage.load();
    this._listeners = new Set();
  }

  get nickname() {
    return this._data.nickname;
  }

  get server() {
    return this._data.server;
  }

  /** Has this player chosen a name yet? Gates the online menu. */
  get named() {
    return this._data.nickname.length > 0;
  }

  /**
   * @param {string} raw
   * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
   *   Validated HERE as well as on the server. Client-side validation is a
   *   courtesy that gives an instant, specific message; the server's is the one
   *   that counts, because this one is trivially bypassed.
   */
  setNickname(raw) {
    const checked = validateNickname(raw);
    if (!checked.ok) return checked;
    this._data.nickname = checked.value;
    this._commit();
    return checked;
  }

  setServer(url) {
    this._data.server = String(url ?? '').trim();
    this._commit();
    return true;
  }

  reset() {
    this._data = emptyProfile();
    this.storage.delete();
    this._notify();
  }

  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _commit() {
    // `undefined` counts as success, as `MarkBook._commit` does — the base class
    // returns nothing and is a legitimate no-op store.
    const ok = this.storage.save(this._data) !== false;
    this._notify();
    return ok;
  }

  _notify() {
    for (const fn of [...this._listeners]) {
      try {
        fn(this._data);
      } catch (err) {
        console.error('[profile] listener threw', err);
      }
    }
  }
}
