/**
 * Where marks live, and the seam an account system will replace.
 *
 * ── the interface is the point, not the implementation ──────────────────────
 * The brief is explicit that this is going to become an account plus a database,
 * so the rule is that NOTHING above this file knows what a `localStorage` is.
 * The menu asks a `MarkStorage` for a book of marks and hands one back; whether
 * that round trip is a JSON string in the browser, a fetch to a server, or a
 * stub in a test is decided at construction and nowhere else.
 *
 * It is the first persistence in this project — there was no `localStorage`,
 * `sessionStorage` or `indexedDB` anywhere before it — so there is no house
 * style to follow and this one is set deliberately narrow.
 *
 * ── three methods, and `delete` is the whole store ──────────────────────────
 * `load` / `save` / `delete`, as asked for. The unit is the whole BOOK rather
 * than one mark, and that is a decision worth stating: five 128-pixel canvases
 * is a few tens of kilobytes, so there is nothing to gain from partial writes,
 * and a single-document store is the shape that ports to a row per account
 * without inventing a mark table first. Deleting ONE mark is therefore an edit
 * to the book followed by a `save` — see `MarkBook.clearSlot` — while `delete`
 * here means "forget this device ever had marks", which is what the panel's
 * reset button wants.
 *
 * ── a bad read must never take the menu down ────────────────────────────────
 * Everything coming out of storage is treated as hostile: hand-edited, written
 * by an older build, or written by something else entirely on the same origin.
 * `load` therefore validates rather than trusts, and returns an EMPTY book on
 * anything it does not recognise. A player whose saved data is unreadable gets
 * the first-run experience, which is the failure worth having; a menu that
 * throws on boot is not.
 */

/** Drawable slots in the shared pool. Both players choose from these five. */
export const SLOT_COUNT = 5;

/**
 * The built-in logo, which is not a slot.
 *
 * It is assignable like a mark and it is not stored like one: it cannot be
 * drawn, edited or deleted, so there is nothing about it to persist beyond the
 * fact that a player has chosen it. Kept as a string sentinel rather than an
 * index so it can never collide with a slot number.
 */
export const DEFAULT_MARK = 'default';

/** Storage schema version. Bumped when the saved shape changes. */
const VERSION = 1;
const KEY = 'msa.marks.v1';

/**
 * What a player has chosen: a slot index, the built-in logo, or nothing.
 *
 * `null` is a real choice and not an absence — "깨끗한 뚜껑", a cap with no
 * artwork at all — which is why it is spelled out here rather than left as a
 * missing key.
 *
 * @typedef {number|typeof DEFAULT_MARK|null} MarkRef
 */

/**
 * @typedef {object} MarkBookData
 * @property {(string|null)[]} slots
 *   One entry per slot, `SLOT_COUNT` long. A base64 PNG data URL for a filled
 *   slot, or `null` for an empty one. A slot that exists but has been cleared
 *   of its drawing is still a data URL — of a fully transparent image — because
 *   "슬롯은 유지되고 그림만 없어진다" is a different state from an empty slot.
 * @property {[MarkRef, MarkRef]} assigned  what P1 and P2 are wearing
 */

/** An empty book. What a device that has never saved anything gets. */
export function emptyBook() {
  return {
    slots: Array.from({ length: SLOT_COUNT }, () => null),
    /**
     * BOTH PLAYERS START WITH NOTHING ON THEIR CAPS.
     *
     * Not the logo. The brief asks for a first run in which "양 플레이어 뚜껑은
     * 아무 그림도 없는 깨끗한 상태" and calls out placeholders specifically, so
     * defaulting either of these to `DEFAULT_MARK` would be the exact thing it
     * rules out — the logo is available to choose, not chosen for you.
     */
    assigned: [null, null],
  };
}

/** Is this a slot index that exists? */
export function isSlotRef(ref) {
  return Number.isInteger(ref) && ref >= 0 && ref < SLOT_COUNT;
}

/** Is this a mark reference of any kind? `null` counts — it means "clean cap". */
function isMarkRef(ref) {
  return ref === null || ref === DEFAULT_MARK || isSlotRef(ref);
}

/**
 * Coerce anything at all into a valid book.
 *
 * Field by field rather than a shape check, so a book written by a build with
 * four slots, or six, comes back usable instead of being thrown away whole.
 */
function sanitise(raw) {
  const book = emptyBook();
  if (!raw || typeof raw !== 'object') return book;

  const slots = Array.isArray(raw.slots) ? raw.slots : [];
  for (let i = 0; i < SLOT_COUNT; i++) {
    const v = slots[i];
    // A data URL and nothing else. A bare string from somewhere would be handed
    // straight to an `Image`, and this is the layer that decides it is a mark.
    book.slots[i] = typeof v === 'string' && v.startsWith('data:image/') ? v : null;
  }

  const assigned = Array.isArray(raw.assigned) ? raw.assigned : [];
  for (let p = 0; p < 2; p++) {
    const ref = assigned[p] ?? null;
    // An assignment pointing at a slot that is now empty is not an error — it is
    // what a deleted mark leaves behind — and it resolves to a clean cap, which
    // is what the brief asks for. Dropped to `null` here so there is one
    // representation of "nothing" rather than two.
    book.assigned[p] = isMarkRef(ref) && !(isSlotRef(ref) && !book.slots[ref]) ? ref : null;
  }
  return book;
}

/**
 * The contract. Subclass it, or hand in anything with these three methods.
 *
 * Deliberately synchronous, because the one implementation that exists is and
 * the menu reads marks while building a scene. The day this becomes a fetch,
 * these become async and the callers grow an `await` — which is a smaller change
 * than pretending to be async now and threading promises through a UI that has
 * nothing to do while it waits.
 */
export class MarkStorage {
  /** @returns {MarkBookData} never null; an empty book if there is nothing. */
  load() {
    return emptyBook();
  }

  /** @param {MarkBookData} book */
  save(_book) {}

  /** Forget everything. The panel's reset button, and nothing else. */
  delete() {}
}

/**
 * The browser implementation. One JSON document under one key.
 *
 * Every call is wrapped: `localStorage` throws on a full quota, and it throws on
 * mere ACCESS in a privacy mode or a sandboxed frame. A menu that cannot be
 * opened in private browsing because saving a doodle failed would be a poor
 * trade, so a failed write is reported to the caller as `false` and a failed
 * read is an empty book.
 */
export class LocalStorageMarks extends MarkStorage {
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
      return emptyBook();
    }
    if (!raw) return emptyBook();
    try {
      return sanitise(JSON.parse(raw));
    } catch {
      // Unparseable. Treated as absent rather than repaired: there is nothing
      // in a corrupt blob worth guessing at.
      return emptyBook();
    }
  }

  /** @returns {boolean} whether it actually landed. */
  save(book) {
    try {
      window.localStorage.setItem(
        this.key,
        JSON.stringify({ version: VERSION, ...sanitise(book) }),
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

/**
 * An in-memory store. For the panel's "start over" and for anything under test.
 *
 * It exists to prove the seam is real: swapping this in changes nothing above
 * it, which is the property the brief is buying.
 */
export class MemoryMarks extends MarkStorage {
  constructor(book = emptyBook()) {
    super();
    this._book = sanitise(book);
  }

  load() {
    return sanitise(this._book);
  }

  save(book) {
    this._book = sanitise(book);
    return true;
  }

  delete() {
    this._book = emptyBook();
  }
}
