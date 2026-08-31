/**
 * The far seat, when a person on another machine is sitting in it.
 *
 * ── it is the same interface as the other two, and that is the whole point ─
 * `HumanController`, `AiController` and this are interchangeable in the
 * `controllers` array, and nothing in `Match`, the rule sets, the renderer or
 * the HUD asks which one it got. The brief states the requirement — "게임 로직은
 * 상대가 사람인지 AI인지 온라인인지 몰라야 한다" — and the codebase already
 * arranged for it: `Match.js` does not contain the word "controller".
 *
 * ── this one is deliberately thin, like `HumanController` ─────────────────
 * `HumanController` is a no-op stub, and its header explains why: a human turn
 * is already fully implemented by `PointerRouter → AimInput → Match.fire`, and
 * routing it through a controller would be a second path to the same call.
 *
 * The same argument applies here, one layer out. A remote turn is driven by
 * packets that arrive whenever they arrive — including while the previous turn
 * is still settling, or during the opening cutscene — so the code that applies
 * them has to run on EVERY frame, not only on the frames where this seat happens
 * to be `active()`. `main.js` only calls `update` on the controller whose turn it
 * is, which means a "turn skipped" message for the LOCAL player would arrive
 * while this object is not being ticked at all.
 *
 * So the per-frame work lives in `OnlineMatch`, which is ticked unconditionally,
 * and this stays what it usefully is: the thing that says whose seat it is, what
 * they are called, and that the local player may not shoot for them.
 *
 * ── `isAi` is true, and it is a lie that happens to be exactly right ──────
 * `main.js` overloads that flag: it is the gate that decides whether a
 * controller is driven at all (`main.js:1131`), and it is also the presentation
 * switch behind `hasAi()` — which pins the local hand to the bottom of the
 * screen, stops the viewpoint flipping between turns, and draws the opponent's
 * cards face down. Every one of those is what an online match wants, for the
 * same underlying reason: there is one person at this screen. Reporting `false`
 * would flip the board between turns as though two people were passing the
 * device back and forth.
 */
export class OnlineController {
  /**
   * @param {number} player            seat index this controller occupies
   * @param {import('./OnlineSession.js').OnlineSession} session
   */
  constructor(player, session) {
    this.player = player;
    this.session = session;
    /**
     * Read by `main.js` as the drive gate. Never anything but 'idle' here: the
     * gate only fires `begin` when it is idle, and this has no work to begin.
     */
    this.phase = 'idle';
  }

  get isAi() {
    return true;
  }

  /**
   * The local player may never act on this seat.
   *
   * Read through `active().acceptsInput`, which gates the card branch and the
   * aim branch of `PointerRouter` and nothing else — so the camera, the reset
   * button and the HUD stay live while the opponent thinks, which is what a
   * spectating seat should feel like.
   */
  get acceptsInput() {
    return false;
  }

  /**
   * What the turn plate says for this seat.
   *
   * The opponent's nickname, not "PLAYER 2". `main.js`'s `labelFor` prefers a
   * controller's `displayName` when it has one and falls back to the old
   * `PLAYER n` + `label` shape when it does not, so `AiController` is untouched.
   */
  get displayName() {
    return this.session?.opponent?.nickname || 'PLAYER ' + (this.player + 1);
  }

  get label() {
    return '';
  }

  begin() {}
  update() {}
  skip() {}

  /**
   * The seat was taken away — a rebuild, a mode switch, the match ending.
   *
   * Nothing to abort: this holds no timer, no search and no in-flight request.
   * The socket belongs to the session, which outlives any one controller and is
   * closed by whoever opened it.
   */
  cancel() {
    this.phase = 'idle';
  }
}
