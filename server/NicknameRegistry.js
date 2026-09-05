import { nicknameKey, validateNickname } from '../src/net/protocol.js';

/**
 * Who is called what, and the promise that no two people are called the same.
 *
 * ── the interface exists because the storage is going to change ────────────
 * Right now a registration lives in this process's memory and dies with it:
 * restart the server and every name is free again. That is a real limitation
 * and it is written down here rather than discovered later — see
 * `MemoryNicknameRegistry`.
 *
 * When accounts arrive, the thing that changes is which class is constructed in
 * `index.js`. Nothing else in the server knows how a name is stored, and the
 * three methods below are the whole of what it may assume. They are synchronous
 * today for the same reason `MarkStorage`'s are (`src/marks/MarkStorage.js`):
 * a database turns them into promises and the callers grow an `await`, which is
 * a smaller change than pretending to be async before anything is.
 */
export class NicknameRegistry {
  /**
   * Claim a name for a connection.
   *
   * @param {string} raw       what the client asked for
   * @param {string} ownerId   the connection claiming it
   * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
   */
  // eslint-disable-next-line no-unused-vars
  claim(raw, ownerId) {
    return { ok: false, code: 'not_implemented', message: 'no registry' };
  }

  /** Give a name back. Called when a connection closes. */
  // eslint-disable-next-line no-unused-vars
  release(ownerId) {}

  /** Everything currently claimed. For the operator, not for players. */
  list() {
    return [];
  }
}

/**
 * The whole registry in a `Map`, for the local-server phase.
 *
 * ── the limitation, stated plainly ─────────────────────────────────────────
 * REGISTRATIONS ARE TEMPORARY AND LAST ONLY AS LONG AS THE PROCESS. There is no
 * file, no database, and no attempt at one. Restart the server and every
 * nickname is available again; two people who had agreed on names yesterday can
 * take each other's today.
 *
 * That is the correct behaviour for what this currently is — a relay somebody
 * runs on their own machine for an evening — and the wrong behaviour for
 * anything with accounts in it. The seam for that is the class above.
 *
 * ── uniqueness is case-folded and NFC-composed ─────────────────────────────
 * Both via `nicknameKey`. The display form is kept separately, so a player who
 * registers `Neo` is shown `Neo` while still blocking `neo`.
 */
export class MemoryNicknameRegistry extends NicknameRegistry {
  constructor() {
    super();
    /** key -> {value, ownerId} */
    this._byKey = new Map();
    /** ownerId -> key */
    this._byOwner = new Map();
  }

  claim(raw, ownerId) {
    const checked = validateNickname(raw);
    if (!checked.ok) return checked;

    const key = nicknameKey(checked.value);
    const held = this._byKey.get(key);
    if (held && held.ownerId !== ownerId) {
      return { ok: false, code: 'nickname_taken', message: '이미 사용 중인 닉네임입니다' };
    }

    // A connection that renames gives its previous name back in the same breath,
    // or a client that changes its mind twice leaks two names for the session.
    this.release(ownerId);

    this._byKey.set(key, { value: checked.value, ownerId });
    this._byOwner.set(ownerId, key);
    return { ok: true, value: checked.value };
  }

  release(ownerId) {
    const key = this._byOwner.get(ownerId);
    if (key === undefined) return;
    this._byOwner.delete(ownerId);
    // Only if it is still ours. Between a rename and a disconnect the key may
    // already belong to somebody else, and releasing it then would evict them.
    if (this._byKey.get(key)?.ownerId === ownerId) this._byKey.delete(key);
  }

  list() {
    return [...this._byKey.values()].map((v) => v.value);
  }
}
