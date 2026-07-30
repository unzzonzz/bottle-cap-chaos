import { KnockoutBoard } from './layout/KnockoutBoard.js';
import { FootballPitch } from './layout/FootballPitch.js';
import { CurlingLane } from './layout/CurlingLane.js';
import { KnockoutRules } from './rules/KnockoutRules.js';
import { FootballRules } from './rules/FootballRules.js';
import { CurlingRules } from './rules/CurlingRules.js';

/**
 * A mode is a layout plus a rule set, and nothing else.
 *
 * Those are the two halves of "what game is this": one says what the world is
 * shaped like, the other says what happens in it. Everything between them — the
 * bow, the impulse, the fixed step, the settle detector, the snapshot rewind, the
 * interpolation, the camera — is shared, and a third mode should add one entry
 * here and two files, not a copy of anything.
 *
 * The camera block is part of the mode because the two modes are looked at
 * differently and neither angle is a preference: knockout is a square board and
 * is played from directly above or from behind one player's row, football is a
 * 105:68 pitch and the brief fixes it at a slight tilt with zoom as the only
 * control. Putting it here rather than on the camera keeps `GameCamera` a thing
 * that fits a rectangle, with no idea which game it is fitting.
 */

export const MODES = {
  knockout: {
    key: 'knockout',
    /**
     * The URL segment this mode lives at. NOT the key.
     *
     * ── they were the same thing and that was two decisions in one ──────────
     * The key is what the code calls this mode — `KnockoutBoard`,
     * `KnockoutRules`, `CONFIG.mode`, every comment in the project — and the
     * path is what the address bar says, which is a product decision the menu
     * already made: the item is labelled 서바이벌. Deriving one from the other
     * meant `/knockout`, and changing it would have meant renaming two classes,
     * three files and a hundred comments to move a word in a URL.
     *
     * So the two are separate strings and this is the only place either of them
     * is written down. `modeKeyFromPath` reads paths, `destinationUrl` writes
     * them, and nothing else in the project knows a URL segment exists.
     */
    path: 'survival',
    name: '알까기 (기본)',
    createLayout: (config) => new KnockoutBoard(config),
    createRules: (arena) => new KnockoutRules(arena),
    /**
     * The same camera block football has, term for term.
     *
     * ── it used to be `rotatable: false`, and that was the whole difference ──
     * The argument was that a square board looks the same from four sides so
     * there is nothing to turn. True of the BOARD and false of the match: the
     * two players sit at opposite ends of it, and whose end is at the bottom of
     * the screen is exactly as much a question here as it is on a pitch. Player
     * 1's row starts at one edge and player 2's at the other, so "your own half
     * at the bottom" has the same meaning and the same answer.
     *
     * Turning it on is all that was needed. Everything downstream — `faceTo`,
     * `holdsOwnHalf`, the per-frame invariant in `main.js`, the handover reset,
     * the snap, the fling — is mode-agnostic and was already running; it was
     * simply being handed `null` for the bearing every turn. There is no
     * knockout branch anywhere in it and there is not one now.
     *
     * ── what it costs, and why that is the right price ──────────────────────
     * `fitDistance` frames a turning camera by the CIRCLE the field fits in
     * rather than the field itself, because the field has to stay on screen at
     * every bearing — and a square's diagonal is 41% wider than its side. So
     * the board is smaller at minimum zoom than it was.
     *
     * That is the same trade football already makes, and taking it is what
     * makes the two modes frame alike rather than merely look alike: both now
     * show their whole field with room to turn it. `knockoutMinZoom` is tuned
     * against the new fit — see the note there.
     */
    camera: {
      fixedPitch: null,
      rotatable: true,
      minZoom: (config) => config.view.knockoutMinZoom,
      /**
       * Identical to football's, and identical for the same reason: a player's
       * half is the end their caps start at, that end never moves, so this is a
       * constant per player and the view built from it is the same every turn.
       * Both values are in `SNAP_BEARINGS`, so a turn lands where a hand could
       * have put it.
       */
      ownHalfBearing: (player) => (player === 0 ? 0 : Math.PI),
    },

    /**
     * What the scoreboard shows. Knockout is won by outlasting, so the headline
     * is how many caps each player has left.
     *
     * `key` is what the texture cache is keyed on — see `hudTextures` — so it
     * has to change when and only when the drawing would. The turn number is in
     * it because the caption shows it.
     */
    /**
     * Where an orb may appear. The slab, inside the out line.
     *
     * Pulled in by the orb's own reach so one never straddles the edge it would
     * be unreachable past — a cap that went out there to fetch it would fall.
     */
    orbArea: (arena, config) => {
      const inset = config.orbs.sensorRadius + arena.desc.radius;
      const h = Math.max(1, config.arena.boardHalf - inset);
      return { halfX: h, halfZ: h };
    },

    scoreboard: (rules) => {
      const a = rules.livingCapsOf(0).length;
      const b = rules.livingCapsOf(1).length;
      return {
        key: `knockout:${a}:${b}:${rules.turn}`,
        left: String(a),
        right: String(b),
        caption: `남은 뚜껑  ·  턴 ${rules.turn}`,
      };
    },
  },

  football: {
    key: 'football',
    /** See the note on knockout's. */
    path: 'football',
    name: '알까기 축구',
    createLayout: (config) => new FootballPitch(config),
    createRules: (arena) => new FootballRules(arena),
    /**
     * Read off `view.footballPitchAngle` rather than pinned to a literal, so the
     * angle is inspectable — but there is no camera-angle control on the panel
     * for this mode and there is not meant to be. The brief gives the player
     * zoom and nothing else.
     */
    // `minZoom` stays 1: "최소 줌에서 필드 전체가 보인다" is a completion
    // criterion for this mode, and 1 is the whole-field fit by construction.
    camera: {
      fixedPitch: (config) => config.view.footballPitchAngle,
      rotatable: true,
      minZoom: null,
      /**
       * The bearing that puts THIS player's caps at the bottom of the screen.
       *
       * ── it asks where the caps ARE, not which team they belong to ─────────
       * This used to be `player === 0 ? 0 : Math.PI` — the end each team starts
       * at — and the swap card makes that a lie. After a swap every cap is at
       * the other end, so both players were shown the OPPONENT's half at the
       * bottom. Pressing what looks like your own cap selects nothing, the press
       * falls through to the camera, and nothing on the board moves for either
       * player: the game appears to freeze, when in fact it is telling both
       * players to look the wrong way.
       *
       * `apply` builds bearing 0 with −Z nearest the camera, so the sign of the
       * caps' mean Z is the whole answer. Both results are bearings the snap
       * already magnets to, so the turn-over still lands where a hand could have
       * put it.
       */
      /**
       * The bearing that puts THIS player's own half at the bottom.
       *
       * A player's half is the end their goal is at, and that never moves. So
       * this is a constant per player and the view built from it is the same
       * every single turn: you always attack up the screen.
       *
       * ── it was derived from the caps, twice, and both were wrong ──────────
       * First from the mean Z of the player's caps, then from a majority vote of
       * them. Both were attempts to keep the view pointing at where the pieces
       * are, and both have the same defect: caps MOVE. Measured mid-match, the
       * two teams' mean Z had drifted to −11 and +6, so a single ricochet
       * flipped the answer and mirrored the board between turns; the majority
       * version then tied 2–2 often enough that the view simply stopped
       * correcting itself, which is the "camera stops changing after a while"
       * this kept coming back as.
       *
       * The half is not the caps. Goals do not move — not even the swap card
       * moves them, it moves caps — so there is nothing here to drift, tie, or
       * flip. The swap leaves your caps up the far end for a turn, which is the
       * card doing its job and is plain to see, and your own half is still at
       * the bottom of the screen where it has always been.
       */
      ownHalfBearing: (player) => (player === 0 ? 0 : Math.PI),
    },

    /** Inside the LINES, not the run-off — the pitch, not the wall. */
    orbArea: (arena, config) => {
      const m = arena.layout.metrics;
      const inset = config.orbs.sensorRadius + arena.desc.radius;
      return {
        halfX: Math.max(1, (m?.halfX ?? 10) - inset),
        halfZ: Math.max(1, (m?.halfZ ?? 10) - inset),
      };
    },

    /**
     * Not in a goal mouth.
     *
     * The brief calls this out and it is the one place where "pure luck" has to
     * give way: an orb sitting in the goal would be picked up by the ball going
     * in, or worse, would look like it should be. The band is the goal's own
     * width, widened by the orb's reach so it cannot poke into the mouth from
     * beside the post either.
     */
    orbForbids: (x, z, arena, config) => {
      const m = arena.layout.metrics;
      if (!m) return false;
      const nearGoalLine = Math.abs(z) > m.halfZ - m.goalAreaDepth;
      const inMouth = Math.abs(x) < m.goalHalfWidth + config.orbs.sensorRadius;
      return nearGoalLine && inMouth;
    },

    /** Football is won by goals, so the headline is the score. */
    scoreboard: (rules, config) => ({
      key: `football:${rules.score[0]}:${rules.score[1]}:${config.football.winningGoals}`,
      left: String(rules.score[0]),
      right: String(rules.score[1]),
      caption: `${config.football.winningGoals}선승`,
    }),
  },

  curling: {
    key: 'curling',
    /** See the note on knockout's. */
    path: 'curling',
    name: '알까기 컬링',
    createLayout: (config) => new CurlingLane(config),
    createRules: (arena) => new CurlingRules(arena),

    /**
     * No cards, no orbs, no hand.
     *
     * ── a switch, not a deletion ────────────────────────────────────────────
     * "카드 시스템 코드를 삭제하지 말고, 모드 설정으로 비활성화하는 구조로
     * 처리해라. 다른 모드는 계속 카드를 쓴다." This one flag is read in three
     * places and nowhere else: `Match.playCard` refuses, `Match._endTurn` does
     * not roll for an orb, and `main.js` does not draw either hand. Every line
     * of the card system is still there and still runs in the other two modes.
     *
     * It does not empty anybody's hand, and that is deliberate too — nothing in
     * the curling path touches `Match.hands`. A new match is the only thing that
     * ever clears a hand, which is what `CardHands.reset` already says.
     */
    cards: false,

    /**
     * ── both players look at the lane the same way up ───────────────────────
     * `ownHalfBearing` is a constant zero rather than a per-player value, and
     * that is the mode being different rather than the mode not bothering: in
     * curling both players throw from the SAME end. There is no own half. The
     * throw line is at the bottom of the screen and the house is at the top, for
     * everybody, every turn — mirroring the lane on the handover would mean each
     * player spent their turn aiming down a board the other one had just learned.
     *
     * The invariant machinery above this is unchanged and still runs: it simply
     * finds the view already correct on almost every frame, and puts it back if
     * a rotation left it somewhere else.
     *
     * `fixedPitch` is null, so the lane uses the panel's top-down toggle exactly
     * as the knockout board does. There is no curling camera angle to invent —
     * top-down is what reads on a long lane, and it is already the default.
     */
    camera: {
      fixedPitch: null,
      rotatable: true,
      minZoom: (config) => config.view.curlingMinZoom,
      maxZoom: (config) => config.view.curlingMaxZoom,
      turnZoom: (config) => config.view.curlingTurnZoom,
      ownHalfBearing: () => 0,
    },

    // No `orbArea`, and its absence is load-bearing rather than an omission:
    // `Orbs.maybeSpawn` gives up without one, so even if the `cards` flag above
    // were ever missed, there is still nowhere for an orb to appear. Two
    // independent reasons for the same guarantee.

    /**
     * Curling is won by a COUNT, so the headline is how many caps each side has
     * in the house — live, updated as they arrive and as they are knocked out.
     *
     * ── `pulseKey` is the whole of the "과한 연출은 빼라" ────────────────────
     * The caption carries the throws left, which changes on every single turn,
     * and the plate's texture is keyed on everything drawn on it — so a single
     * key would fire the score's emphasis beat eight times a match at something
     * nobody did. `pulseKey` names only the two numbers the beat is ABOUT, so
     * the flourish happens when and only when a cap enters or leaves the house.
     * See `HudLayer._updateScore`.
     */
    scoreboard: (rules) => {
      const a = rules.house[0];
      const b = rules.house[1];
      const per = rules.perTeam;
      return {
        key: `curling:${a}:${b}:${rules.thrown[0]}:${rules.thrown[1]}:${per}`,
        pulseKey: `curling:${a}:${b}`,
        left: String(a),
        right: String(b),
        // Short on purpose: the plate is 208 frame pixels wide and the caption
        // gets 10 of its 42, so a longer sentence is a resampled one. The two
        // numbers above it are already the house count, in the team colours.
        caption: `남은 투구 ${per - rules.thrown[0]}/${per} · ${per - rules.thrown[1]}/${per}`,
      };
    },
  },
};

/**
 * The scoreboard for a mode, as two coloured values and a caption.
 *
 * ── the MODE supplies the content; the HUD only draws it ────────────────────
 * `status()` next door does the same job for a single line of text, and this is
 * its structured sibling: football's headline is a score and knockout's is a
 * count of what is still alive, and there is no arrangement of one that
 * produces the other. Putting the branch here rather than in the scoreboard
 * component means a third mode adds an entry to this file and touches nothing
 * in `ui/`.
 *
 * `left` and `right` are player 0 and player 1, as strings. They carry no
 * colour: which colour a player is is a fact about how the game is DRAWN, and
 * `modes.js` has no business importing from `render/` to find out.
 *
 * `pulseKey` is optional and separates WHAT IS DRAWN from WHAT IS WORTH A
 * FLOURISH. `key` has to change whenever any pixel of the plate would, because
 * it is what the texture cache is keyed on; the emphasis beat is about the
 * SCORE changing and nothing else. The two are the same string in the first two
 * modes, where the caption is a constant. They are not in curling, whose caption
 * counts down every turn — see the note there.
 *
 * @returns {{key: string, pulseKey?: string, left: string, right: string, caption: string}}
 */
export function scoreboardFor(mode, rules, config) {
  return (
    mode.scoreboard?.(rules, config) ?? {
      key: `none:${rules.turn}`,
      left: '-',
      right: '-',
      caption: '',
    }
  );
}

export const MODE_KEYS = Object.keys(MODES);

/** @param {string} key */
export function modeByKey(key) {
  return MODES[key] ?? MODES.knockout;
}

/** URL segment -> mode key. Built once, from the modes' own `path`. */
const MODE_BY_PATH = new Map(MODE_KEYS.map((key) => [MODES[key].path, key]));

/** The URL segment a mode lives at. The only reader outside this file is the
 *  menu's `destinationUrl`. */
export function modePath(key) {
  return MODES[key]?.path ?? '';
}

/**
 * The mode a URL asks for: `/survival` is knockout, `/` is NOT a mode at all.
 *
 * ── null means the menu now, and that is the whole of the routing change ────
 * `/` used to open knockout, so the game was the front door and the menu was a
 * `?view=menu` behind it. It is the other way round: the menu is the front door
 * and a mode is a place you go from it. Nothing here decides that — this only
 * reports whether the path names a mode, and `main.js` reads the absence as
 * "show the menu". That keeps `/menu`, `?view=menu` and any other stray address
 * working as the menu for free, without a single alias.
 *
 * ── it matches PATHS, not keys ─────────────────────────────────────────────
 * `survival` is knockout's path and `knockout` is its key; see the note on the
 * mode entry for why those are two strings. `/knockout` therefore names no mode
 * and lands on the menu, which is the right answer for an address that is not a
 * route.
 *
 * ── it searches the path backwards ──────────────────────────────────────────
 * Rather than looking at one fixed segment, because the segment a mode name
 * lands in depends on how the site is served and this should not care. Under a
 * sub-path it is `/bottle-cap-chaos/football`; on a static host that implements
 * the route by putting a copy of the page in a directory it is
 * `/football/index.html`. Both name football, and both would miss on any single
 * fixed position. Backwards so that the nearest match wins, which is the one the
 * URL is actually about.
 *
 * ── it does not decode ──────────────────────────────────────────────────────
 * Every path here is a plain ASCII word, so percent-decoding could only ever
 * turn a match into the same match — while `decodeURIComponent` throws on a
 * malformed escape, and this runs at module top level where a throw is a blank
 * page rather than a caught error. A URL is under no obligation to be
 * well-formed; the one thing this must do with a strange one is fall through.
 *
 * @param {string} pathname  normally `location.pathname`
 * @returns {string|null} a key in `MODES`, or null if the path names no mode
 */
export function modeKeyFromPath(pathname) {
  const segments = String(pathname || '').split('/');
  for (let i = segments.length - 1; i >= 0; i--) {
    const hit = MODE_BY_PATH.get(segments[i].toLowerCase());
    if (hit) return hit;
  }
  return null;
}

/** Is this segment one of the mode routes? For `basePath`'s stripping. */
export function isModePath(segment) {
  return MODE_BY_PATH.has(String(segment || '').toLowerCase());
}
