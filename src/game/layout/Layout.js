/**
 * Layer 2a: what the world IS SHAPED LIKE.
 *
 * `RuleSet` already answered "what does the physics mean". This answers the
 * question underneath it, which the knockout mode never had to ask because it
 * only ever had one answer: what static geometry exists, what dynamic bodies
 * start where, and how big the place is.
 *
 * It exists because `RuleSet`'s own doc promised something the code could not
 * deliver — "a mode that needs a goal or a house adds sensors at build time and
 * reads them in `resolveTurn`". There was no build time to add them at: `Arena`
 * hardcoded a square slab, a catch floor, an in-bounds sensor and two rows of
 * caps, and a football pitch is none of those things. Rather than teach `Arena`
 * about pitches, `Arena` was made to know nothing at all and ask a layout.
 *
 * ── the split against RuleSet ────────────────────────────────────────────────
 * A layout is STATIC and a rule set is BOOKKEEPING. The layout builds the world
 * once per rebuild and then only answers questions about it; it holds no per-turn
 * state, is never serialised, and takes no part in the replay rewind — because a
 * rewound world is the same world, built by the same layout, and only the rules'
 * bookkeeping has to be put back. Pairing them is `modes.js`'s job.
 *
 * ── handles live here ────────────────────────────────────────────────────────
 * `buildStatic` is called again on every structural rebuild, into a world whose
 * arena has been reset, so an implementation MUST clear whatever handles it kept
 * from last time rather than appending. Rapier reuses freed slots; a stale handle
 * resolves to somebody else's collider instead of failing.
 */

export class Layout {
  /** @param {typeof import('../config.js').CONFIG} config */
  constructor(config) {
    this.config = config;
    /** Named sensors, filled by `buildStatic`. Read by the rules. */
    this.sensors = {};
  }

  /** Shown in the panel. */
  get name() {
    return 'layout';
  }

  /**
   * Half-extents of everything that has to be on screen, in world units.
   *
   * What the camera fits to. A rectangle rather than the old single
   * `boardHalf`, because a pitch is not square and fitting its length to a
   * square box would put a third of the screen outside the fence.
   */
  get extents() {
    return { x: 1, z: 1 };
  }

  /**
   * Build every fixed body and collider this world needs.
   *
   * Called from inside `Arena.build()`, before any dynamic body exists, with a
   * freshly reset physics world. Implementations write their sensor handles into
   * `this.sensors`.
   *
   * @param {import('../Arena.js').Arena} _arena
   */
  buildStatic(_arena) {}

  /**
   * The dynamic bodies, in creation order.
   *
   * Order is part of the determinism contract: Rapier hands out handles in
   * creation order and builds its islands in it, so two runs that create the
   * same bodies in a different sequence are two different worlds.
   *
   * `y` is optional and almost never given: a cap's resting height is a property
   * of the cap, not of where it is put, so `Arena` supplies it. A layout only
   * names it when the body starts somewhere that is not the playing surface —
   * curling parks its undealt caps far below the lane. See `pocketFor`.
   *
   * @returns {Array<{kind: 'cap'|'ball', owner?: number, role?: string, x: number, y?: number, z: number}>}
   */
  placements() {
    return [];
  }

  /**
   * Where a body that is OUT OF PLAY belongs, or null if this mode has nowhere.
   *
   * Null is the answer for every mode where leaving play is something a cap does
   * physically: a knockout cap that is out has already fallen thirty units onto
   * the catch floor, and there is nothing left to tidy. Curling's out is a LINE,
   * so an eliminated cap is still standing on the run-off where it stopped —
   * invisible, because the rules have marked it dead, and still solid, which
   * would make it an invisible wall for the next throw.
   *
   * A REQUEST answered by `Arena.stowCap`, which is what actually moves it. The
   * layout only says where; it never touches the world outside `buildStatic`.
   *
   * @returns {{x: number, y: number, z: number}|null}
   */
  pocketFor(_index) {
    return null;
  }

  /**
   * Turn-end values this mode replaces, or null to use the shared ones.
   *
   * `config.turn` is one set of numbers for the whole project and it describes
   * caps sliding on a mat at 0.34 friction. A mode built on a different surface
   * needs a different clock — a curling lane at a tenth of that friction slides
   * for several seconds longer, and the shared 8-second hard timeout would end
   * nearly every throw early and report it as forced.
   *
   * Shallow-merged over `config.turn` by `Arena.turnConfig`, with `rest` merged
   * one level deeper, so a mode names only what it changes.
   *
   * @returns {object|null}
   */
  turnOverrides() {
    return null;
  }

  /**
   * Push live-tunable material values onto the static colliders.
   *
   * The counterpart of `Arena.applyMaterialTuning` for everything the layout
   * owns — board friction, wall restitution. Only values that can change while
   * something is sliding; shape and size are structural and rebuild instead.
   *
   * @param {import('../Arena.js').Arena} _arena
   */
  retune(_arena) {}

  /**
   * Plain data for the renderer: no three.js types, no Rapier types.
   *
   * The render layer reads this and draws it. Keeping it a plain record is what
   * lets the same layout be inspected from the console and tested without a
   * canvas — and stops the renderer from reaching into collider handles to work
   * out where to put a line.
   */
  describe() {
    return { kind: 'none' };
  }
}
