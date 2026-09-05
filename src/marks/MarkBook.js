import { DEFAULT_MARK, emptyBook, isSlotRef, SLOT_COUNT } from './MarkStorage.js';

/**
 * The marks, as the menu edits them.
 *
 * A thin mutable layer over whatever `MarkStorage` was injected: it holds the
 * book in memory, applies the rules that govern it, and writes through on every
 * change. There is no save button for any of this — the brief asks for slot
 * deletion and player assignment to be "즉시 반영", and the only thing behind a
 * confirm is the drawing itself, which is a different transaction entirely and
 * lives in the editor.
 *
 * ── it owns the rules, not the UI ───────────────────────────────────────────
 * Two of them are easy to get wrong in a view and impossible to get wrong here:
 *
 *   DELETING A WORN MARK STRIPS THE PLAYER. Not "falls back to the logo" — the
 *     brief rules that out in as many words. The cap goes blank.
 *   BOTH PLAYERS MAY WEAR THE SAME MARK. There is no exclusivity check, and
 *     adding one later would be a rule nobody asked for.
 *
 * ── listeners, because a mark is worn in four places ────────────────────────
 * The board's caps, the victory screen's caps, the menu bottle and the editor's
 * own preview all read the same assignment. Rather than have the menu remember
 * to poke each of them, anything that draws a cap subscribes and is told.
 */
export class MarkBook {
  /** @param {import('./MarkStorage.js').MarkStorage} storage */
  constructor(storage) {
    this.storage = storage;
    /** @type {import('./MarkStorage.js').MarkBookData} */
    this._book = storage.load();
    this._listeners = new Set();
  }

  // ── reading ───────────────────────────────────────────────────────────────

  /** The stored PNG for a slot, or null when the slot is empty. */
  slotImage(index) {
    return isSlotRef(index) ? this._book.slots[index] : null;
  }

  /** Is there a mark in this slot at all? An empty slot shows a `+`. */
  hasSlot(index) {
    return !!this.slotImage(index);
  }

  /** How many slots are taken. For the panel's readout. */
  get filledCount() {
    return this._book.slots.filter(Boolean).length;
  }

  /** What this player is wearing: a slot index, `DEFAULT_MARK`, or null. */
  assignedTo(player) {
    return this._book.assigned[player] ?? null;
  }

  /** Which players, if any, are wearing this reference. Drives the slot badges. */
  wearersOf(ref) {
    const out = [];
    for (let p = 0; p < 2; p++) if (this._book.assigned[p] === ref) out.push(p);
    return out;
  }

  /** A copy, for the panel and for anything that wants to inspect without editing. */
  snapshot() {
    return {
      slots: this._book.slots.slice(),
      assigned: this._book.assigned.slice(),
    };
  }

  // ── writing ───────────────────────────────────────────────────────────────

  /**
   * Put a drawing in a slot. Used by the editor's save, and only by it.
   *
   * A cleared-but-saved drawing arrives here as a fully transparent PNG rather
   * than as null, and that distinction is load-bearing: the brief separates
   * "비우기 후 저장" — the slot survives with nothing drawn on it — from
   * deleting the slot, and collapsing the two here would silently turn one into
   * the other.
   */
  setSlot(index, dataUrl) {
    if (!isSlotRef(index) || typeof dataUrl !== 'string') return false;
    this._book.slots[index] = dataUrl;
    return this._commit();
  }

  /**
   * Delete a slot, and strip it from anyone wearing it.
   *
   * The stripping is the rule that is easy to miss and the brief calls out
   * twice: a player whose mark has just been deleted gets a CLEAN cap, not the
   * default logo. Done here rather than at the call site so there is one place
   * it can be true.
   */
  clearSlot(index) {
    if (!isSlotRef(index)) return false;
    this._book.slots[index] = null;
    for (let p = 0; p < 2; p++) {
      if (this._book.assigned[p] === index) this._book.assigned[p] = null;
    }
    return this._commit();
  }

  /**
   * Dress a player. `null` is a real choice — a cap with nothing on it.
   *
   * A slot that is empty cannot be worn; asking for one is treated as asking for
   * nothing, which is the same resolution `MarkStorage.load` applies to a stale
   * assignment and keeps the two from disagreeing.
   */
  assign(player, ref) {
    if (player !== 0 && player !== 1) return false;
    const valid =
      ref === DEFAULT_MARK || (isSlotRef(ref) && this.hasSlot(ref)) ? ref : null;
    this._book.assigned[player] = valid;
    return this._commit();
  }

  /** Throw everything away. The panel's reset, and the first-run path after it. */
  reset() {
    this._book = emptyBook();
    this.storage.delete();
    this._emit();
    return true;
  }

  // ── plumbing ──────────────────────────────────────────────────────────────

  /**
   * Subscribe. Returns an unsubscribe, matching `Viewport.onResize`'s shape so
   * the two feel like the same facility.
   */
  onChange(fn) {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  _emit() {
    for (const fn of this._listeners) fn(this);
  }

  _commit() {
    const ok = this.storage.save(this._book) !== false;
    // Told regardless of whether the write landed: what is on screen has already
    // changed, and a quota failure is a reason to warn, not a reason to show the
    // player something different from what they just did.
    this._emit();
    return ok;
  }
}

export { DEFAULT_MARK, SLOT_COUNT };
