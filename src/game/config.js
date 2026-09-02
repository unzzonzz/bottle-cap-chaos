import { COLLIDER_DEFAULTS } from '../physics/capCollider.js';

/**
 * Every number the debug panel is allowed to move, in one mutable object.
 *
 * One object rather than constructor arguments scattered across eight modules,
 * because the whole point of this phase is dragging these while playing. A value
 * that has to be passed at construction time is a value you have to reload the
 * page to change, and nobody tunes a game that way.
 *
 * Two groups behave differently and it matters:
 *  - `collider` and `arena` are STRUCTURAL. Changing them rebuilds the world
 *    from scratch and abandons the current match.
 *  - everything else is LIVE. It is read on the step it is used.
 */

export const CONFIG = {
  /** Which mode is loaded. Structural: changing it rebuilds the world. */
  mode: 'knockout',

  arena: {
    /**
     * Half-edge of the square board, in world units (cm). 28 -> a 56 cm board.
     *
     * ── it was 18, and one shot ended the game ──────────────────────────────
     * What matters is not the board's size but the RUN-OFF: how far a cap has
     * to travel after being hit before it goes over. That is `boardHalf - rowZ`,
     * and at 18/11 it was 7 units against a hit that shoves a cap 33.
     *
     * Measured over every opening shot — each of the three shooters at each of
     * the three targets at five powers, 45 in all:
     *
     *   boardHalf/rowZ/spacing   run-off   opening shots that killed
     *   18 / 11 / 6                 7        17 of 45
     *   26 / 12 / 8                14         0 of 45
     *   28 / 12 / 9                16         0 of 45
     *
     * 26 already gets there, but only by 1.7 units — the worst hit still shoves
     * a cap 12.8. 28 keeps the same 0 and nearly doubles the margin, and it also
     * halves how often the SHOOTER flies off its own board (4 of 45 down to 2),
     * because a full-power shot lands well inside rather than over the edge.
     *
     * Weak shots no longer cross: 34 of 45 connected at the old size against 27
     * now. That is the point of a bigger board rather than a cost of it — the
     * first shot is a positioning move, and a kill has to be set up.
     */
    boardHalf: 28,
    /**
     * How far the rim slopes OUT as it drops, in world units.
     *
     * Past the out line the surface does not stop and it does not continue flat —
     * it tilts away and runs downhill to the board's underside. A cap that
     * crosses the line therefore tips onto the slope and slides off it, tumbling,
     * which is what a cap going over the edge of a table does.
     *
     * This replaced a flat apron, which was a mistake: extending the level
     * surface past the line did fix the contact problem below, and it did it by
     * removing falling from the game — caps skated out of bounds and sat there
     * upright. A slope fixes the same problem for a better reason.
     *
     * The problem: a cap left HANGING over the rim is a broken cap. Measured, a
     * fully supported cap's travel varies by 0.2 units across a full turn of its
     * own yaw; a cap overhanging by 0.4 varies by 15 and gets thrown into the air
     * — the overhanging part rests on the rim, the rim is a ramp, and a shove
     * inward makes it climb. Rounding both surfaces, inscribing the skirt ring,
     * stiffening contacts, disabling CCD and zeroing the allowed penetration were
     * all tried; the best any managed was to halve it.
     *
     * A slope steeper than the friction angle cannot be rested on, so no cap ever
     * comes to a stop hanging over the rim — the pathological pose stops existing
     * instead of being tolerated. At 1.0 of run against 1.0 of board thickness
     * that is 45 degrees, against a friction angle of about 19.
     */
    edgeSlopeRun: 1.0,
    /**
     * Flat surface between the out line and the top of the slope, in world units.
     *
     * The slope is what makes a cap fall, and it is also a ramp that gravity
     * pulls caps down. A cap resting with part of itself on it gets dragged
     * outward — measured at 45 degrees off the aim once three quarters of the cap
     * is over. Since a cap counts as in while ANY part of it is over the line, a
     * cap can be in play and in that state at the same time, which is where the
     * pull comes from.
     *
     * This shelf is how far the flat carries on before the slope starts, and it
     * is a straight trade against how soon a cap falls. Measured as the worst
     * angular deviation from the aim over twelve directions at each position,
     * with the error cone switched off so only the physics shows:
     *
     *              worst deviation           worst deviation
     *   shelf      (centre inside line)      (anywhere still in play)   falls at
     *   0.8        5.4 deg                   9.4 deg                    19.0
     *   1.6        0.0 deg                   5.4 deg                    19.5
     *   2.4        0.0 deg                   0.0 deg                    20.5
     *
     * A cap counts as in while any part of it is over the line, so it can be a
     * full radius past the line and still in play; for NONE of those to touch the
     * ramp the flat has to reach a radius beyond that again. 2.4 is the first
     * value where every cap that can still be shot goes exactly where it is
     * aimed. Below it there is a band near the rim where the ramp steers the shot
     * — small at 1.6, obvious at 0.8.
     *
     * The cost is 2.5 units of extra push before a cap goes over on its own. It
     * is judged out at the line regardless; this only moves where it physically
     * falls. Shots aimed outward still take caps off at the same rate (6 of 8
     * across a power sweep, identical to shelf 0.8).
     */
    /**
     * ── and why it is 0 now ─────────────────────────────────────────────────
     * Every word above is about caps that are still IN PLAY resting near the
     * rim, and "in play" meant inside the out line at `boardHalf`. There is no
     * out line any more — a cap dies by falling off — so a cap far enough over
     * to be steered by the ramp is a cap that is about to go, which is the
     * outcome rather than the problem.
     *
     * Dropping it also buys back 2.4 units of board on every side that nothing
     * plays on, which is 12% off the board's radius: the caps are that much
     * bigger against it at the same zoom, and the whole slab now fits the frame
     * with its edge visible. The measurements above are kept because they are
     * why this number existed, and they apply again the moment a line does.
     */
    edgeShelf: 0,
    boardThickness: 1.0,
    /**
     * Fillet on the board's rim, in world units (1.5 mm).
     *
     * Not cosmetic — the collider is never drawn. A right-angled rim makes the
     * board's own side face act as a wall against caps resting at the lip; see
     * the note in Arena. Big enough to keep the contact normal continuous,
     * small enough that the playable surface still ends where the out line is.
     */
    boardEdgeRadius: 0.15,
    boardFriction: 0.34,
    boardRestitution: 0.05,
    /** Caps per player. */
    capsPerPlayer: 3,
    /**
     * How far from the centre line each player's row starts.
     *
     * Held at 12 rather than scaled with the board. It sets two things at once:
     * the gap between the rows (24, which a mid-power shot still crosses) and
     * the run-off behind each row (`boardHalf - rowZ`), which is what stops an
     * opening shot being lethal. Pushing the rows out to 14 puts them 28 apart
     * and the shot stops arriving at all — measured, the target never moved.
     */
    rowZ: 12,
    /**
     * Gap between neighbouring caps in a row.
     *
     * 9 spreads three caps across 18 units of a 56-unit board. Wide enough that
     * the outer caps are a real angle off the centre one — so which cap you
     * shoot at is a choice — and tight enough that the row still reads as a
     * formation rather than as three separate pieces.
     */
    rowSpacing: 9,
  },

  collider: { ...COLLIDER_DEFAULTS },

  /**
   * The football pitch. STRUCTURAL except where noted — the pitch is geometry.
   *
   * There is exactly one size parameter here and it is the LENGTH. Everything
   * else about the pitch — width, penalty area, goal, centre circle — is a fixed
   * fraction of it, computed in `pitchMetrics.js` from the Laws of the Game. A
   * width slider would be the fastest way to break "필드 비율이 105:68 이다", so
   * there isn't one.
   */
  football: {
    /**
     * Touchline length, in world units (cm). Width follows at 68/105 of it.
     *
     * 84 put the pitch at 84 x 54.4, which is nearly three full-power cap shots
     * from end to end — measured, a full charge covers about 31. That reads as a
     * lot of empty grass: the caps are small on it, crossing it takes several
     * turns of shunting, and the ball spends most of its life a long way from
     * anything.
     *
     * 64 is a little over two shots long, so a good strike genuinely threatens
     * the other goal and the eight caps fill the space they are standing in. The
     * pitch is still exactly 105:68 — this is the only size parameter there is,
     * and everything else on it, goal and markings included, is a fixed fraction
     * of this number.
     */
    pitchLength: 64,
    groundThickness: 1.0,
    pitchFriction: 0.36,
    pitchRestitution: 0.04,

    /**
     * Run-off outside the touchlines, in world units. Structural.
     *
     * The walls stand at the outer edge of this rather than on the lines, and
     * that is a fix for a geometry problem rather than a decoration. A ball
     * resting against a wall built on the touchline was unplayable: the wall
     * took up the whole half of the approach, so no cap could get behind the
     * ball, and no wall restitution or friction changes that — it is about where
     * the wall IS.
     *
     * 5.6 is one and three quarter cap diameters, inside the brief's 1.5-2x
     * band. It has to clear a cap comfortably, because "a cap can get behind the
     * ball" is the entire specification for this number.
     */
    runoffWidth: 5.6,

    /** Visible boundary fence, now at the outer edge of the run-off. Structural. */
    fenceHeight: 2.4,
    fenceThickness: 0.6,
    /**
     * Fillet on the four boundary corners, in world units. Structural.
     *
     * A square corner is where a ball goes to die. It is not that the corner is
     * tight — it is that two walls meet at a point, so every strike from the
     * pitch drives the ball further in, and pushing it along one wall runs it
     * into the other. The fillet removes the vertex: on an arc only one wall is
     * ever in contact and any roughly-sideways hit sends the ball out along it.
     *
     * 7 is two cap diameters, and it is a measured floor rather than a look. See
     * `pitchMetrics` for the geometry and `FootballPitch` for how it is built.
     * Drag it to 0 to get the square corner back and feel the difference in one
     * shot — a ball tucked into the corner at 0 is freed by a narrow wedge of
     * aims, and at 7 by most of a half-turn.
     */
    cornerRadius: 7,
    /** LIVE. How lively the boundary is. See the panel note. */
    wallRestitution: 0.45,
    wallFriction: 0.22,
    /**
     * LIVE. Drag of the netting behind each goal.
     *
     * Its RESTITUTION is not tunable and is pinned at zero with a Min combine
     * rule — see `FootballPitch`. A bouncy net would let a ball cross the line
     * and come back out before the turn-end query, and the goal would vanish.
     */
    netFriction: 0.9,

    /**
     * Goal size, as a multiple of the real 7.32 x 2.44. Structural.
     *
     * The one figure on this pitch that is not the Laws' — see `pitchMetrics`.
     *
     * Set by measurement, twice. 33 shots on goal from three positions and
     * eleven aim points, with the error cone on and the keeper on his line:
     *
     *   scale   mouth   scored
     *   1.35     7.91   12%
     *   1.60     9.37   15%
     *   1.85    10.83   18%
     *   2.00    11.71   21%
     *   2.10    12.30   24%
     *
     * The aim points are FIXED WORLD POINTS spanning ±8, which straddle the
     * posts at every scale on the table. An earlier pass aimed at fractions of
     * the mouth instead, so the shot moved with the goal, every shot was inside
     * the frame at every size and the result came out flat and non-monotonic —
     * 14/14/18/14/25. The measurement has to make the mouth the thing that
     * varies or it is measuring the keeper.
     *
     * Re-measured after the pitch was shortened to 64 and the ball grown to
     * 0.60, both of which move this: the goal is a fraction of the pitch, so it
     * shrank, and the ball got bigger, so the same mouth holds fewer of them. At
     * the old 2.0 the mouth had fallen from 9.1 ball widths to 4.6.
     *
     *   scale   mouth   ball widths   scored
     *   2.0      8.92      4.6        15%
     *   2.4     10.71      5.6        30%
     *   2.8     12.49      6.5        36%
     *
     * 2.4, because 2.8 is the first value whose posts stand OUTSIDE the goal
     * area line — that line comes from the Laws and does not scale with this, so
     * past 2.4 the goal stops looking like it belongs to the markings around it.
     *
     * The pitch is untouched by it: still exactly 105:68.
     */
    goalScale: 2.4,

    /** Opening placement, by key into `FORMATIONS`. Structural. */
    formation: '기본 (1-3 넓게)',
    /** LIVE. First to this many goals takes the match. */
    winningGoals: 3,

    /**
     * How long the screen sits still on a goal before the kickoff reset. LIVE.
     *
     * The reset rebuilds the world and puts everything back on its marks, and
     * doing that the instant the turn ends means the goal is gone before it has
     * registered — the ball is in the net for one frame and then the pitch looks
     * like nothing happened. This is the beat in between.
     *
     * Counted in PHYSICS STEPS derived from this, like every other duration in
     * the turn loop, so it is the same length of simulated time at any frame
     * rate. 0 gives exactly the old behaviour: no hold, straight to the reset.
     */
    goalHoldSeconds: 0.8,

    /**
     * When the hold starts counting. LIVE.
     *
     * `turnEnd` — everything has stopped, the screen is completely still, and
     *   the hold is added on top of the turn. Tidy, but there is a gap between
     *   the goal going in and the pause that marks it.
     * `ballStop` — the moment the ball comes to rest in the net, while the caps
     *   may still be rolling. The hold OVERLAPS the rest of the turn rather than
     *   following it, so the pause lands on the goal itself; the cost is that
     *   there is still movement on screen during it.
     *
     * `turnEnd` by default. Both are on the panel because which one feels right
     * is a question about playing it, not about the code.
     */
    goalHoldMode: 'turnEnd',
  },

  /**
   * The curling table. STRUCTURAL except where noted.
   *
   * ── it is a THIRD set of surface numbers, not a tweak to the other two ─────
   * "표면 마찰은 컬링 전용값으로 별도 관리한다. 다른 모드 값을 건드리지 마라." —
   * so `tableFriction` lives here and `arena.boardFriction` and
   * `football.pitchFriction` are untouched by anything in this block. The cap's
   * OWN friction is shared by all three modes and must stay shared, which is why
   * the table combines friction by `Min` rather than by Rapier's default
   * average: see the header in `CurlingTable`. The number below is the number
   * the cap actually gets.
   *
   * ── there is nothing here about walls, and there cannot be ────────────────
   * The table has none, on any side. What used to be a fence height, a fence
   * restitution, a run-off and two out lines is gone with the lane it belonged
   * to: the edge is the hazard, falling off is survival mode's falling off, and
   * the only line left is the one distances are measured to.
   */
  curling: {
    /**
     * The table's width, in CAP DIAMETERS. Structural, and the whole tuning
     * problem in one number.
     *
     * "시작점: 책상 폭 = 뚜껑 지름의 6~8배." The brief states the two forces
     * pulling on it and they pull opposite ways: narrow enough that a cap is a
     * thing you can see, wide enough that hitting the opponent's cap is a shot
     * rather than a formality. Both are about the RATIO of the cap to the table
     * and nothing else, because the camera frames the table's own extents — the
     * table is always the same size on screen whatever its world size is.
     *
     * Which is also why there is no cap-size slider beside it. The cap's
     * diameter is in `CAP_DEFAULTS` and is shared by all three modes, so moving
     * it would resize the survival board's caps and the football team; and
     * scaling the cap and the table together is a pure zoom that changes nothing
     * anybody can see. One control, one degree of freedom. See
     * `curlingTableMetrics`.
     *
     * ── the brief's starting point was 6 to 8; PLAYING it moved it ───────────
     * "슬라이더로 노출하고 실제로 플레이하며 맞춘다", and this is the number that
     * came back: at 7 the table read as cramped — the far line was close enough
     * that a throw arrived before it had visibly travelled, and the opponent's
     * cap was hard to MISS rather than hard to hit. Half again as big in both
     * directions is where it settled. The ratio is unchanged, so the length grew
     * with it: 22.4 x 49.3 became 33.6 x 73.9.
     *
     * The slider's range runs well past both ends of that so the two failure
     * modes stay visible: at 5 the opponent's cap is unmissable, at 18 it is
     * unhittable and the line is out of reach.
     */
    widthCaps: 10.5,
    /**
     * Length : width. Structural. The brief's band is 2 to 2.5.
     *
     * Drag it up and the throw gets longer, which makes reaching the line harder
     * and makes hitting the opponent's cap harder with it — the two difficulties
     * are the same difficulty here, because there is only one axis in this game.
     */
    ratio: 2.2,

    /**
     * How thick the slab is, and how far its rim runs out. Both structural.
     *
     * The rim is the fall. Its slope is `thickness / slopeRun` and it has to be
     * steeper than the friction angle or a cap can come to rest on it — which is
     * the pathological pose `KnockoutBoard` documents at length, and the reason
     * survival's board is a truncated pyramid rather than a slab. At 1.2 over 2.0
     * the slope is 31 degrees against a surface that cannot hold much past 13,
     * so a cap that gets far enough over tips and goes rather than teetering.
     */
    tableThickness: 1.2,
    slopeRun: 2.0,
    /**
     * The fillet where the flat meets the rim. Structural.
     *
     * Not cosmetic. A right-angled edge flips the contact normal sideways and
     * throws a cap sliding toward it straight back — measured on the survival
     * board at 136 cm/s in and −8.8 cm/s out one step later. See
     * `curlingTableMetrics`, which also clamps it against the slab's thickness.
     */
    edgeRadius: 0.15,

    /**
     * Where a cap is dealt, measured in from the NEAR edge. Structural.
     *
     * "등장 위치는 책상 시작부 중앙. 매 투구 동일." Far enough in that a cap is
     * standing on flat table rather than half over the rim, and no further —
     * every unit of it is a unit taken off the throw.
     */
    throwFromEdge: 4.0,
    /**
     * Extra room a cap needs at the throw spot before it is dealt there, on top
     * of two cap radii. LIVE.
     *
     * Only the fallback in `CurlingTable.throwSpot` reads it: the spot is the
     * same every throw, and this is what decides when the round's first cap —
     * which starts there and may not have gone far — counts as being in the way.
     * At 0 the second cap is dealt exactly touching the first, which the solver
     * resolves as a shove rather than as a throw.
     */
    throwClearance: 0.8,

    /**
     * Rounds in a match, and therefore caps per player. Structural.
     *
     * "총 4라운드 … 한 라운드에 각 플레이어가 딱 1번씩만 던진다." One cap per
     * player per round, so this is also half the bodies the table builds and the
     * whole of `CurlingRules.rounds`.
     */
    rounds: 4,
    /**
     * Who throws first in round 1: 'p1', 'p2', or 'random'.
     *
     * After that it alternates and nothing can change that — throwing second is
     * the advantage, so a fixed lead would hand it to one player four times out
     * of four. This decides only where the alternation starts.
     */
    firstLead: 'p1',
    /**
     * The draw, when `firstLead` is 'random'.
     *
     * A SEED, not a call to `Math.random`. "같은 시드·같은 입력이면 결과가 완전히
     * 동일하다" has to survive the first decision the match makes, and a coin
     * flipped from the clock would break it before a cap had moved. Change this
     * to change the draw; leave it and the coin lands the same way every time,
     * which is what makes the determinism check meaningful at all.
     */
    leadSeed: 0x5eed,

    // ── materials. All LIVE. ────────────────────────────────────────────────
    /**
     * The table top. LIVE, and the single most important number in the mode.
     *
     * "뚜껑이 적당히 미끄러져야 하되, 컨트롤이 가능한 수준으로." Below the
     * survival board's 0.34 and far above the old lane's 0.15, and the value is
     * MEASURED against the table's length rather than picked for feel — the two
     * are one number, because what the player actually experiences is how much
     * of the pull range lands on the table.
     *
     * Travel is very close to quadratic in power here (measured k ≈ 91.4 world
     * units at full draw, holding to three digits across the range), so the
     * whole of the tuning is one ratio: full draw against the throw's run. At
     * 0.26 that comes out at 91.4 against 69.9, which is 1.31 —
     *
     *   the far line is reached at 87% of the pull, so the top 13% is the
     *     overshoot, always present and never the only option;
     *   a percent of pull near the line is about 1.6 units, half a cap, so the
     *     last stretch is controllable rather than a coin toss.
     *
     * Both ends of that were checked. At 0.30 full draw is only 1.14 of the run:
     * every throw needs a near-maximum pull and only 6% of the range is over the
     * edge, so the penalty stops existing. At 0.22 it is 1.86, the line is
     * reached at 73%, and the last quarter of the pull is undifferentiated
     * "gone" — which is the version that made the shot a guess.
     *
     * It is the number the cap actually gets rather than an average with the
     * cap's own, because the table combines friction by `Min` — see
     * `CurlingTable`. That also caps it: above the cap's own 0.34 the `Min`
     * takes the cap's and this slider stops meaning anything.
     */
    tableFriction: 0.26,
    /**
     * Nearly dead. LIVE.
     *
     * There is nothing to bounce off in this mode — no walls, and the only other
     * cap on the table is the one you are trying to hit — so restitution here
     * only decides how much a cap chatters on landing after a hard strike. High
     * enough to read as metal, low enough not to skate.
     */
    tableRestitution: 0.04,

    /**
     * Curling's own turn-end clock. LIVE. See `Layout.turnOverrides`.
     *
     * The shared values in `config.turn` describe a cap on a 0.34 mat, which
     * stops inside a couple of seconds. At 0.22 on a table this size a full
     * throw is still moving at three, so the shared 5 s damping ramp would be
     * braking a cap that is still travelling to its target. Both the ramp and
     * the timeout are moved out past where a real throw finishes — and not
     * further: the old lane's 14 s timeout was sized for a 77-unit slide on ice,
     * and on a 45-unit table it is eleven seconds of waiting for a cap that
     * stopped long ago.
     *
     * The rest thresholds are looser than the caps' shared pair for the matching
     * reason: a slippery surface has a long creep tail, and the last centimetre
     * of it takes longer than the whole of the rest of the throw while nothing
     * visible happens. This mode has to be watched four rounds in a row, so that
     * tail is paid eight times a match.
     */
    turn: {
      rest: { cap: { linear: 1.1, angular: 0.8 } },
      quietSteps: 30,
      rampStartSec: 4.5,
      rampCurve: 2.0,
      rampMaxDamping: 9.0,
      hardTimeoutSec: 8.0,
    },
  },

  /**
   * Bringing the ball back when it stops outside the lines. All LIVE.
   *
   * Every number here is read at the moment a turn ends, and the search that
   * uses them is a fixed sequence with no randomness in it — same world, same
   * ball position, same answer, which is what keeps the replay check honest
   * through a respawn.
   */
  respawn: {
    /**
     * How far inside the line the ball is put back, in world units.
     *
     * Enough that it is unambiguously in play and reads as a throw-in taken at
     * the line, rather than as a ball balanced on the paint.
     */
    inset: 1.6,
    /**
     * Clearance a candidate spot needs, ON TOP of the ball and cap radii.
     *
     * The test is `ball radius + cap radius + this`, so at zero a spot counts as
     * free when the ball would be exactly touching a cap. The margin is what
     * makes "free" mean playable.
     */
    margin: 0.5,
    /** Step between candidates when sliding along the line, in world units. */
    slideStep: 2.4,
    /**
     * How far the slide may travel, as a fraction of the pitch length.
     *
     * A throw-in taken a few metres up the line is unremarkable; one taken from
     * the other half is not. This is where "slightly off" stops.
     */
    maxSlideFraction: 0.22,
    /** Step when pushing in off the line, once sliding has failed. */
    inwardStep: 2.4,
    /** How many of those steps to try before the spiral takes over. */
    inwardSteps: 6,
    /**
     * How long the ball takes to roll back, in seconds.
     *
     * It rolls rather than teleporting, and it is counted in PHYSICS STEPS
     * derived from this — so the animation is the same length in simulated time
     * whatever the frame rate, and the world the next turn starts in is the same
     * world every time.
     */
    travelSeconds: 0.5,
    /** Draw the candidate spots the search walked through. */
    showSearch: false,
  },

  /**
   * The ball. Size and mass are STRUCTURAL; surface and damping are LIVE.
   *
   * Every number here is deliberately unlike the cap's. It is smaller, much
   * lighter, slipperier and far more elastic, which between them are what make
   * it read as a ball being struck rather than as a third cap.
   */
  ball: {
    /**
     * Ball diameter as a fraction of the cap's. The brief's band is 40-50%,
     * starting mid and tuned; this is the tuned value and it is at the bottom of
     * the band for a measured reason.
     *
     * A cap is 6.35 mm tall and its highest point is therefore at 0.635 world
     * units. A ball of radius r is struck at whatever height the cap can reach,
     * so any ball with r > 0.635 is struck BELOW its equator and the contact
     * normal tilts upward — the strike lofts it. At 0.45 (r = 0.72) that is
     * exactly what happens: measured over a 16-shot matrix of run-ups and aim
     * points, peak ball height ran to 1.55 and five of those shots clipped the
     * underside of the crossbar at 1.95 and were turned away. A shot that looks
     * dead on target being rejected by a bar you cannot see from a near-top-down
     * camera is the worst kind of miss.
     *
     * At 0.40 (r = 0.64) the strike lands on the ball's equator instead and the
     * loft disappears: peak height across the same matrix was 0.61 to 0.65, i.e.
     * the ball rolls. The crossbar stops being a factor without the goal having
     * to stop being to scale.
     *
     * ── and why it is no longer 0.40 ────────────────────────────────────────
     * That whole argument was about the CROSSBAR, which used to sit at 1.95. It
     * is at 3.9 now that the goal has been doubled, so a shot that peaks at 1.55
     * passes under it with room to spare and the loft has stopped being a way to
     * lose a goal. What is left is that the ball was hard to see and hard to hit
     * cleanly, which was the actual complaint.
     *
     * 0.60 of a 32 mm cap is a 19 mm ball — three fifths of the cap that strikes
     * it, against two fifths before.
     */
    diameterScale: 0.6,
    /**
     * How much harder gravity pulls on the ball than on everything else.
     *
     * This is what makes the size above possible: a ball this big is struck
     * below its equator and would otherwise be lofted over the bar. Weight is
     * the honest way to stop that — the ball still has a vertical axis, still
     * presses on the turf, and is therefore still spun by it.
     *
     * It replaced a locked Y axis, which held the ball down perfectly and left
     * it SLIDING: no vertical freedom, no normal force, no friction, no roll.
     * See `Arena._createBall`.
     *
     * Measured on a clean strike — every other cap moved out of the way, so the
     * numbers are the strike and not a ricochet:
     *
     *   scale   hop    rolls after   travel
     *   1.0     2.40   13 frames     38.4
     *   1.6     1.70    8 frames     38.4
     *   2.5     1.30    6 frames     37.2
     *   4.0     1.04    4 frames     38.4
     *
     * None of them clears the 3.57 crossbar, so this is no longer about keeping
     * the ball legal — the goal grew and that stopped being the question. It is
     * about how a struck ball READS: at 1.0 it lobs two and a half diameters
     * into the air and takes a fifth of a second to start turning, which from a
     * near-top-down camera looks like it is skidding. 2.5 skips once and rolls,
     * and the distance it covers is the same either way.
     */
    gravityScale: 2.5,
    /** Grams. The cap is 2.2, so a struck ball leaves at nearly twice its speed. */
    massGrams: 0.8,
    /** Low. A ball rolls; it does not scrub. */
    friction: 0.16,
    /** High, against the cap's 0.14. This is most of what makes a strike read. */
    restitution: 0.62,
    /**
     * The ball's own damping, and the reason turns end.
     *
     * A sliding cap is stopped by friction against the mat. A rolling sphere is
     * not stopped by anything — rolling contact does almost no work — so on the
     * caps' 0.18 / 1.3 a hard shot needs about nine seconds of simulated time to
     * fall below the rest threshold, and every turn with a struck ball in it
     * would end on the eight-second timeout instead of at rest. These are that
     * mode's rolling resistance, and they are what keeps a typical turn under
     * four seconds.
     */
    linearDamping: 0.5,
    angularDamping: 2.2,
  },

  /**
   * The card hand. All LIVE — every one is read on the frame it is used, so the
   * whole thing can be tuned with a hand on screen.
   *
   * ── the unit is a FRAME PIXEL ────────────────────────────────────────────
   * The cards are Three.js meshes in their own orthographic scene, and that
   * scene covers a fixed 640x480 box however big the window is and whatever the
   * internal render target is set to. So every length here is a fraction of the
   * FRAME rather than of the browser window, which is why they do not match the
   * numbers the DOM version carried: a 96 px card was 7% of a wide window and
   * would be 15% of the frame.
   *
   * The card width is worth one more line, because it is not a taste decision.
   * The card art is a texture drawn at `textureWidth` texels, sampled with
   * NearestFilter and no mipmaps. Draw a 128-texel card at 96 frame pixels and
   * a quarter of the texel columns are simply not sampled — which is survivable
   * for a border and fatal for 10 px type. At 128 against 128 the card lands one
   * texel per pixel and every stroke of the description reaches the screen.
   *
   * None of it reaches the simulation. The cards are drawn from a separate scene
   * and animated on the render clock; nothing here is in the state hash and
   * nothing here can change a shot.
   */
  cards: {
    /** Cards dealt to each hand. One of each; the panel goes to 8 to test the fan. */
    /**
     * DEAD. Kept only so an old saved config does not read as a change.
     *
     * Hands start empty and fill from the field now — see `CardHands`. Nothing
     * reads this any more; the ceiling is `handLimit`.
     */
    handSize: 0,
    /**
     * The most cards a player may hold.
     *
     * A pickup at the ceiling does not happen: the orb stays on the field and
     * says so. It is not a queue and nothing is discarded to make room.
     */
    handLimit: 5,
    /**
     * How far a drag must travel before it is read as anything, in frame pixels.
     *
     * Below this a press with a pixel of hand jitter in it stays undecided, so a
     * tap is never accidentally a sort. See `CardHand.moveDrag`.
     */
    sortDeadzone: 6,
    /**
     * How far a card being SORTED lifts out of the fan.
     *
     * Enough to read as picked up and well under `useLiftFactor`, which is the
     * line it has already been decided not to cross.
     */
    sortLift: 26,
    /**
     * Relative chance of each card turning up in an orb.
     *
     * Even to start with, as asked. Zero is allowed and simply means that card
     * is never found. `swap` is not here because it is shelved from `CARDS` —
     * see the note in `cardCatalog`.
     */
    orbWeights: {
      trajectory: 1,
      chaos: 1,
      onemore: 1,
      smash: 1,
      resist: 1,
      silence: 1,
    },
    /** Card width in frame pixels. Height follows at 1.5x. */
    width: 128,

    // ── the texture ──────────────────────────────────────────────────────
    /**
     * Card face resolution in texels. Height follows at 1.5x, as the card does.
     *
     * 128 is the readability floor, not a starting guess: at 64 the description
     * is a grey texture. Keep it equal to `width` unless you want the
     * mismatch — see the note above.
     */
    textureWidth: 128,
    /**
     * And what a raised card swaps up to. An LOD, in the ordinary sense: the
     * card you have lifted to READ is the one that wants the detail.
     *
     * 144, and NOT the 256 that the obvious "double it" reasoning gives. The
     * hovered card is `hoverScale` bigger — 1.16, not 2 — so 144 is what lands
     * one texel per pixel on it, and it is genuinely more detail than the base
     * 128 because the card is genuinely bigger.
     *
     * Going higher makes the card LESS readable, which is worth stating plainly
     * because it is the opposite of the usual instinct. There are no mipmaps
     * here, by design; a 256-texel face on a 148-pixel card is point-sampled at
     * 1.72 texels per pixel, so 42% of the texel columns are never read. That is
     * not softness, it is DELETION — measured on this card set, the ㅁ in 무 lost
     * its bottom stroke and the description read 부거워져. At 144 every stroke
     * survives.
     *
     * The panel's texel/pixel readout is there to keep this honest: whatever
     * these two are dragged to, keep both ratios at or just under 1.00.
     */
    hoverTextureWidth: 144,

    // ── the fan ──────────────────────────────────────────────────────────
    /** Total angle across the whole hand, in degrees. Split between the cards,
     *  so more cards means a tighter angle rather than a wider fan. */
    spreadDeg: 34,
    /** Horizontal step between neighbours, in frame pixels. Well under a card
     *  width: they are meant to overlap, the way a hand does. */
    spacing: 59,
    /** How far the ends sag, at the outermost card. */
    curvature: 7,

    // ── hover ────────────────────────────────────────────────────────────
    /**
     * How far the hovered card rises out of the fan.
     *
     * Not a free number: the hand sits partly off the bottom edge, so this has
     * to be at least `width * 1.5 - activeExposure` or the description stays
     * below the screen on the one card you are trying to read.
     */
    hoverLift: 78,
    hoverScale: 1.16,
    /**
     * DAYLIGHT left either side of the raised card, in frame pixels.
     *
     * Not the whole step the neighbours take. The step needed just to stop them
     * covering the raised card is worked out from the card width, the hover
     * scale and the spacing — see `_targets` — because a raised card no longer
     * jumps in front of the stack and so has to be given room instead. This is
     * what is added on top of that, and it is the part that is a matter of
     * taste. 0 leaves the cards exactly touching.
     *
     * It needs to be enough to cover the neighbour's TILT as well: a 192-tall
     * card leaning 8.5 degrees reaches 28 further sideways than an upright one.
     */
    neighbourPush: 30,

    // ── the springs ──────────────────────────────────────────────────────
    /**
     * Stiffness and damping. Damping is deliberately under critical — which for
     * this stiffness is about 30 — so a card released from a hover comes back
     * past its mark and settles, rather than sliding into place. That overshoot
     * is the difference between a card and a panel.
     */
    stiffness: 220,
    damping: 18,
    /** Velocity kick on the SCALE spring as the use threshold is crossed, in
     *  scale units per second. Against this stiffness it peaks at about
     *  kick/15 of extra size, so 2 is a seven percent pop. */
    snapKick: 2,

    // ── using one ────────────────────────────────────────────────────────
    /**
     * How far up a card must come to be usable, as a multiple of its height.
     *
     * VERTICAL TRAVEL, not proximity to a drop target. A circle in the middle of
     * the screen is a small thing to find and makes the gesture feel refused;
     * "has it come up far enough" is the same test wherever along the hand you
     * started, and it is what the gesture already is. Generous on purpose: a
     * card that will not go reads as broken long before it reads as strict.
     *
     * Measured from where the fan HOLDS the card, so the hover rise is already
     * most of the way there and only the rest of it is a pull. 0.9 of a 192 px
     * card is 173 px, of which the hover gives 78 — so the gesture is a 95 px
     * pull, a fifth of the frame. At 0.6 it was 37 px, which is a nudge: a card
     * would go off in your hand while you were still deciding.
     *
     * It is also the distance the card takes to come forward through the stack
     * — see `_forward` — so shortening it makes the layer change abrupt as well
     * as making the gesture twitchy.
     */
    useLiftFactor: 0.9,
    /** How long the used card takes to fly to the middle and fade. */
    useFlySeconds: 0.32,

    // ── tucked, until it is reached for ──────────────────────────────────
    /**
     * Frame pixels showing when your own hand is at rest, before you reach it.
     *
     * The hand is not a panel that lives at the bottom of the screen — it is a
     * thing on the table. At rest it sits in the bottom edge the way the
     * opponent's sits in the top one, and it comes up when the pointer reaches
     * it. A hand permanently at `activeExposure` covers a quarter of the pitch
     * for the whole match to show five cards you look at twice a turn.
     *
     * This is the only part of the hand that is a hover target while it is
     * down, so it has to be big enough to reach without aiming — but every
     * pixel of it is pixels off the pitch.
     */
    idleExposure: 54,
    /**
     * How grey the tucked hand goes, as a fraction of `greyStrength`.
     *
     * Not the full amount. Fully drained is what the OPPONENT's hand is, and
     * "not your turn" and "your hand, not reached for" should not look the
     * same — one of them becomes yours again by moving the mouse.
     */
    idleGrey: 0.7,
    /** How long the hand takes to come up and drop back. */
    raiseSeconds: 0.16,

    // ── the two hands ────────────────────────────────────────────────────
    /** Frame pixels of card showing above the bottom edge for the raised hand.
     *  Low enough not to cover the pitch, high enough to read the names. */
    activeExposure: 120,
    /** And below the top edge for the other one — a corner, no more. */
    inactiveExposure: 48,
    /**
     * How big the AI's card is drawn once it has been turned over.
     *
     * A multiple of an ordinary card. Big enough that the name and the one line
     * of description read at 320x240 — which is the whole reason the reveal
     * exists — and small enough not to cover the board it is about to act on.
     *
     * 1.3 puts the card at 166x250 of the 640x480 frame, a little over half its
     * height. It started at 1.9 and that was measured as wrong: 243x365 is 76%
     * of the frame, so the board the card is about to change was completely
     * hidden behind the announcement that it was going to change.
     */
    revealScale: 1.3,
    inactiveScale: 0.82,
    inactiveOpacity: 0.55,
    /** How long the two hands take to trade ends. */
    turnSwapSeconds: 0.55,

    // ── the look ─────────────────────────────────────────────────────────
    /**
     * Vertex snap for the CARD scene, separate from the game's.
     *
     * Separate so the two can be judged against each other, not so the cards
     * can be exempted. At 1 a card jitters as it moves, exactly as the pitch
     * does, and that is the point of drawing them through this pipeline at all.
     */
    vertexSnap: 1.0,
    /** How far the grey goes on a hand that cannot act. 1 is fully desaturated. */
    greyStrength: 1.0,
    /**
     * 그림자가 카드에서 떨어지는 거리와 진하기. 프레임 픽셀.
     *
     * ── 값만 바뀌었다. 키는 그대로다 ────────────────────────────────────────
     * `cards` 는 `SYNCED_CONFIG_PATHS` 안이라 키를 더하거나 빼면 `configHash` 가
     * 바뀌고 구버전 클라이언트와 매칭이 거절된다. 흐림 반경은 그래서 `cardFx` 쪽에
     * 있다 — 이름은 `cardFx.shadowBlur` 다.
     *
     * 각진 검은 쿼드를 밀어 놓은 것이 아니라 부드러운 얼룩이 되면서 세 값이 전부
     * 다른 답을 갖는다. 흐린 그림자는 같은 알파에서 훨씬 무겁게 보이므로 0.5 에서
     * 0.3 으로 내렸고, X 는 0 이다 — `tokens.ELEVATION` 의 모든 단계가 아래로만
     * 떨어지고, 카드만 오른쪽으로 비켜 있으면 화면에 광원이 둘 있게 된다. Y 는
     * `ELEVATION.raised.dy` 와 같은 3 (이 좌표계에서 아래는 음수다).
     */
    shadowOffsetX: 0,
    shadowOffsetY: -3,
    shadowOpacity: 0.3,
    /** Slack around a card's edge for the raycast, in frame pixels. */
    hitMargin: 8,
    /** Draw those hit areas. */
    showHitAreas: false,

    // ── a card that cannot be played ─────────────────────────────────────
    /**
     * How grey and how dim an unplayable card is, before it is touched.
     *
     * "Before it is touched" is the whole requirement. A card that looked
     * ordinary and bounced back at the end of the gesture would read as the
     * drag having failed rather than as the play being illegal, and the player
     * would try it again.
     */
    blockedGrey: 1.0,
    blockedBrightness: 0.55,
    /** The refusal shake: how far, how many cycles, over how long. */
    refuseShakeAmount: 9,
    refuseShakeCycles: 3,
    refuseShakeSeconds: 0.28,

    // ── the drop guide ───────────────────────────────────────────────────
    /**
     * The card-shaped slot drawn while a card is being dragged to be used.
     *
     * ── it draws the threshold, it does not become one ──────────────────────
     * The play gesture is still vertical travel out of the fan and nothing about
     * `useLiftFactor` changes — see the note on it above, which explains at
     * length why a drop TARGET was rejected. What was missing was any way to see
     * where that travel ends, so the guide is placed at exactly the height the
     * card arms at: following it always plays the card, and a card that arms
     * without reaching it horizontally still plays. Strictly forgiving in the
     * one direction, never the other.
     */
    showUseGuide: true,
    /**
     * How much bigger than the card the slot is, in frame pixels, per side.
     *
     * Not decoration. A border exactly the card's size is one the card covers
     * completely the instant it lands, so the guide would disappear at the exact
     * moment it is confirming something. 10 leaves a visible edge all the way
     * round a card sitting in it.
     */
    guideMargin: 10,
    /** How present the slot is before the card has reached it, and after. */
    guideOpacity: 0.5,
    guideArmedOpacity: 1,
    /**
     * How much the slot swells the moment the card arms, as a fraction.
     *
     * Applied in one step rather than eased. The card crossing the line is an
     * EVENT — `snapKick` already pops the card itself for it — and a slot that
     * grew smoothly into its confirmed size would be reporting a process.
     */
    guideArmedGrow: 0.06,

    // ── what the cards DO ────────────────────────────────────────────────
    /**
     * Half-width of the chaos deviation, in degrees.
     *
     * The full ±90 the brief asks for. It is enormous on purpose: the card is
     * not a penalty on accuracy, it is the shot being taken away, and anything
     * small enough to aim around would just be a wider error cone.
     */
    chaosMaxDeg: 90,
    /**
     * How far ahead the trajectory card looks, in seconds.
     *
     * Against the ordinary 1. At 3.5 s a struck ball has crossed the pitch and
     * come off a wall or two, which is the point — the card is bought for the
     * reflections, not for the first metre.
     *
     * It costs: 420 solver steps against 120, spread over frames at the
     * preview's own budget, so the line takes about three times as long to grow
     * to full length.
     */
    trajectorySeconds: 3.5,
    /**
     * 강타: what this turn's impulse is multiplied by.
     *
     * 1.5, and NOT 2. At 500 g·cm/s base a doubled impulse is a cap crossing the
     * pitch in a handful of steps, which is where a 1/120 step starts asking the
     * CCD to catch a wall it has already passed, and it is also a turn that
     * spends much longer coming to rest. 1.5 is the strongest shot in the game
     * by a clear margin without either.
     *
     * Independent of the spread multiplier below on purpose — the trade the card
     * offers IS the ratio between these two, and one number cannot express it.
     */
    smashImpulseMul: 1.5,
    /**
     * And what the CHARGE CONE's half-angle is multiplied by. The cost.
     *
     * Starts equal to the impulse multiplier and is expected not to stay there:
     * this is the dial that decides whether the card is a bargain or a gamble,
     * and it should be moved on its own with the other one held still.
     *
     * It scales the charge cone ONLY. The 혼란 card's deviation has its own
     * source and is untouched — see `AimInput._mul`.
     */
    smashSpreadMul: 1.5,
    /**
     * ── 철벽 has no multiplier of its own, and that is deliberate ────────────
     * The card's promise is that a braced cap is shoved less by the ratio this
     * number shoves more, so 철벽's mass multiplier is DERIVED from it — as
     * `2k − 1`, which is not the obvious `k` and `CardEffects.massMulFor`
     * measures out why at length.
     *
     * A `resistMassMul` key here would be a second dial for one number. The
     * first time somebody moved `smashImpulseMul` alone the two would stop
     * cancelling — silently, because nothing prints the ratio and the card face
     * would go on claiming it. So the mass multiplier is READ from
     * `smashImpulseMul`, once, in `CardEffects.massMulFor`, and there is nothing
     * to tune here. Moving the slider above moves both halves together.
     *
     * Adding one would also cost a key in `SYNCED_CONFIG_PATHS` for a value that
     * is a pure function of a key already there.
     */
    /**
     * 침묵: how many of the victim's own turns the seal lasts.
     *
     * One, as the card's face says. It is a dial rather than a constant because
     * the whole question the card asks is how much a turn of somebody else's
     * hand is worth, and that is not answerable without moving it — but the
     * value is read ONCE, at the cast, so dragging this never changes a lockout
     * somebody is already inside. See `CardEffects.play`.
     *
     * Whole turns only, and at least one: a seal of zero would be a card that
     * is spent and does nothing, which reads as the game having eaten it.
     */
    silenceTurns: 1,
    /**
     * How long the hand takes to come back from grey when the seal lifts.
     *
     * Presentation only — the seal is already gone by the time this runs; this
     * is the hand catching up. It exists because the release is otherwise
     * invisible: a hand that snaps from grey to colour between two frames tells
     * the player nothing, and "다시 쓸 수 있게 됐다" is the one thing they need
     * out of the moment.
     *
     * Short. The seal lifts as the turn ends, so this plays over the start of
     * the hand swap and anything longer finishes after the hand has left.
     */
    silenceReleaseSeconds: 0.4,
    /** How long the caps take to trade places, in seconds of simulated time. */
    swapSeconds: 0.45,
    /** How high the exchange arcs, in world units. Visual only — see `CapSwap`. */
    swapArcHeight: 0.6,

    /**
     * How long each card's effect holds the screen, in seconds. LIVE.
     *
     * Under a second, all of them. This is a turn-based game and the effect sits
     * between the player deciding and the player acting; a long one is a wait,
     * not a flourish.
     */
    fxSeconds: {
      swap: 0.75,
      trajectory: 0.45,
      chaos: 0.6,
      onemore: 0.5,
      smash: 0.55,
      /**
       * Shortest of the six, and it earns it by having almost nothing to show.
       *
       * 침묵's cast is a two-frame darkening — the padlock happens on the
       * VICTIM'S turn, not this one — so the rest of this window is only there
       * to cover the card's own flight to the middle of the screen, which is
       * `useFlySeconds` at 0.32. It was 0.6 while a bolt was crawling across the
       * pitch, and 0.6 of a frozen board for two frames of flash is a stall.
       */
      silence: 0.35,
      /**
       * 철벽. Shorter than 강타's 0.55 and longer than 침묵's 0.35.
       *
       * The cast is three beats — a press, a ring that overshoots and sits down,
       * one glint — and all three are counted in FRAMES rather than in this
       * window (see `cardFx.resist*Frames`), so what this length actually buys
       * is the card's own flight to the middle of the screen at `useFlySeconds`
       * 0.32 plus enough afterwards to see the ring settle.
       */
      resist: 0.45,
    },
  },

  /**
   * How the card effects are DRAWN. All LIVE, none of it reaches the simulation.
   *
   * Every value here feeds `CardFx`, which runs on the render clock and writes
   * nothing anyone else reads. Dragging any of these mid-turn changes what is on
   * screen and cannot change what the turn does.
   */
  cardFx: {
    /** Vertex snap for the effects, separate from the game's and the cards'. */
    vertexSnap: 1.0,

    // ── the card FACE: hologram, shadow, drop guide ──────────────────────
    /**
     * 왜 카드의 시각 노브가 `cards` 가 아니라 여기 있는가.
     *
     * `cards` 는 `protocol.js` 의 `SYNCED_CONFIG_PATHS` 에 들어 있다. 거기에 키를
     * 하나라도 더하면 `configHash` 가 바뀌고, 구버전 클라이언트와 매칭이 거절된다 —
     * 그림 하나 고치자고 네트워크 호환을 깨는 것이다. `cardFx` 는 그 목록에 없고,
     * 이 블록의 모든 값은 순수하게 그리기다. 시뮬레이션은 하나도 읽지 않는다.
     *
     * 반대로 `cards` 쪽의 기존 키는 **값만** 움직인다. `guideOpacity` 와
     * `guideArmedOpacity` 가 여전히 가이드의 두 끝을 정하고, 새로 생긴 것은 그 둘
     * 사이를 잇는 방법뿐이다.
     */
    /**
     * 테두리 홀로그램의 세기. 앞면 기준.
     *
     * 가산이라 배경이 밝을수록 덜 보인다. 0.45 는 흰 유리 위에서 테두리를 따라
     * 파스텔 띠가 지나가는 것이 보이고 글자에는 닿지 않는 값이다. 그 이상은 카드가
     * 젖은 것처럼 보이기 시작한다.
     */
    holoStrength: 0.45,
    /**
     * 뒷면의 세기. 앞면의 4분의 1 이하다.
     *
     * `cardTexture.cardBackTexture` 의 주석에 근거가 있다 — 상대의 손패는 화면
     * 위쪽에 늘 떠 있어서 대비를 일부러 낮춰 뒀고, 빗금을 진하게 칠했더니 다섯 장이
     * 회색 덩어리가 됐다는 기록이 남아 있다. 그 다섯 장이 무지개로 빛나면 판 위에서
     * 눈이 계속 그쪽으로 간다. 0 이 아닌 것은 코팅된 카드라는 사실은 남기기 위해서다.
     */
    holoBackStrength: 0.1,
    /**
     * 무장한 카드의 배수. 카드가 문턱을 넘으면 테두리가 확실히 켜진다.
     *
     * `cards.guideArmedOpacity` 가 슬롯 쪽에서 하는 말을 카드 쪽에서 한 번 더 하는
     * 것이고, 그 중복은 의도다: 무장은 손이 카드를 보고 있을 때 일어나므로, 슬롯만
     * 밝아지면 시선 밖에서 확인이 일어난다.
     */
    holoArmedBoost: 2.0,
    /** 단위 길이당 위상. 카드 대각선에 한 바퀴 남짓 들어가는 값. */
    holoScale: 0.035,
    /**
     * 무지개의 채도. 0 이면 흰빛, 1 이면 완전 포화.
     *
     * 0.42. 완전 포화 무지개는 네온이고 이 화면에 네온은 없다 — 에어로의 이리데선스는
     * 비눗방울이지 LED 가 아니다.
     */
    holoSaturation: 0.42,
    /** 테두리 띠의 폭. 카드의 짧은 변에 대한 비율. */
    holoRimWidth: 0.05,
    /** 아무도 손대지 않는 손패가 죽은 그림이 되지 않을 만큼의 드리프트. rad/s. */
    holoDriftPerSecond: 0.5,

    /**
     * 카드 그림자의 흐림 반경. 프레임 픽셀, 카드 폭 150 기준.
     *
     * `tokens.ELEVATION.raised.blur` 와 같은 10 이다. 이 화면의 다른 판이 전부 그
     * 값으로 떠 있으므로, 카드만 다른 높이에 있으면 손패가 UI 와 다른 층에서 온
     * 것으로 보인다. 카드가 호버로 커지면 이 값도 같은 비율로 커진다 — 큰 물건은
     * 큰 그림자를 만든다.
     */
    shadowBlur: 10,

    // ── the drop guide ───────────────────────────────────────────────────
    /**
     * 무장하는 프레임에 한 번 터지는 링이 남는 프레임 수.
     *
     * 초가 아니라 **프레임**인 이유는 `smashFlashFrames` 와 같다: 이 길이의 창은
     * 주사율이 다르면 다른 프레임 수에 걸리고, 그 차이가 "보임"과 "아무것도 아님"의
     * 차이다.
     *
     * 그리고 이것은 `guideArmedGrow` 를 대신하는 것이 아니라 **확인**이다. 진행도가
     * 연속으로 밝아지다가 1 에서 한 번 튀어야, 놓쳤는지 아닌지가 애매하지 않다.
     */
    guideBurstFrames: 6,
    /** 그 링이 가이드 밖으로 퍼지는 정도. 배수. */
    guideBurstGrow: 0.22,

    // ── 뽑기의 착지 ──────────────────────────────────────────────────────
    /**
     * 날아온 카드가 부채꼴에 도착하며 뒤집히는 데 걸리는 시간.
     *
     * `CardFlight` 는 뒷면으로 날아온다 — 찾아낸 것이 무엇인지는 도착해서 알아야
     * 한다 — 그리고 예전에는 비행이 끝나면 메시가 사라지고 다음 sync 에서 앞면이
     * 부채꼴에 **나타났다**. 뒤집는 동작이 없으니 뒤집혔다는 사실도 없었다.
     *
     * AI 의 공개가 쓰는 것과 같은 수평 스케일 통과다 — `CardHand._reveal` 을 보라.
     * 0.22 는 도착의 일부로 읽히고, 그 이상이면 부채꼴이 열리기를 기다리게 된다.
     */
    landFlipSeconds: 0.22,
    /**
     * 착지가 이웃 카드를 미는 거리. 프레임 픽셀.
     *
     * 스프링의 목표를 한 프레임 흔드는 것이지 위치를 옮기는 것이 아니다 — 부채꼴은
     * 이미 언더댐프드라, 목표가 한 번 튀면 이웃이 밀렸다가 되돌아온다. 카드가 자리를
     * 만들며 들어가는 것으로 보이는 것은 그 되돌아옴이다.
     */
    landPushAmount: 26,
    /** 도착한 자리에 짧게 퍼지는 흰 빛이 남는 프레임 수. */
    landGlowFrames: 8,

    // ── the chaos stars ──────────────────────────────────────────────────
    /**
     * Frames in the stun sprite's rotation. FEW.
     *
     * Eight is 45 degrees a frame and reads as a stepped, mechanical spin, which
     * is the look. Raise it and the star starts to turn smoothly, which is both
     * more work and less period-correct.
     */
    stunFrames: 16,
    /** Texels per frame of that sheet. */
    stunTexels: 96,
    /**
     * World-unit size of the drawn sprite.
     *
     * Against a 3.2-unit cap, so the star is half again as wide as the thing it
     * is spinning over. That sounds like too much and is not: the camera sits
     * 72 degrees up and a long way back, and at 2.2 — a size that looks right in
     * a close-up — four of these came out as specks two pixels across and read
     * as dirt on the pitch rather than as a state the caps were in.
     */
    stunSize: 5.0,
    /** How far out it orbits, and how high above the cap it floats. */
    stunOrbitRadius: 3.2,
    stunHeight: 3.0,
    /** Orbits per second. The frame index steps with it — see `CardFx`. */
    stunRotationsPerSecond: 0.9,
    /** How fast the tint walks its palette. A CLUT rotation, in effect. */
    paletteCyclesPerSecond: 1.4,
    /** How far an afflicted cap wobbles, and how fast. Drawing only. */
    shakeAmount: 0.16,
    shakeHz: 7,

    // ── swap and one-more ────────────────────────────────────────────────
    /** Texels of the ring and flash sprites. */
    ringTexels: 192,
    /** World-unit size of them, and how far above the pitch they sit. */
    ringSize: 5.5,
    ringHeight: 0.9,
    /** Fraction of the swap spent vanishing at each end. */
    swapVanishFraction: 0.3,
    /** How much a one-more cap swells, at the peak of its pulse. */
    pulseAmount: 0.35,
    /** How many on/off beats the screen edge flashes for. */
    edgeBeats: 2,

    // ── 강타 ──────────────────────────────────────────────────────────────
    /**
     * Frames of full-screen colour inversion when the card lands.
     *
     * FRAMES, not seconds, and one or two of them. The era's screen flashes were
     * whole frames of a value written over the framebuffer; the closest honest
     * thing here is `1 - dst` for a couple of frames, which is over before the
     * eye resolves it and reads as an impact rather than as a transition. Three
     * or more and it starts to look like a strobe.
     */
    smashFlashFrames: 2,
    /**
     * 섬광의 세기. 1 이면 완전한 흰 프레임이다.
     *
     * 그 아래인 이유는 §0.4 다 — 효과가 도는 동안에도 뚜껑이 어디 있는지 읽혀야
     * 한다. 0.68 이면 아래가 비치면서도 충분히 아프다.
     */
    smashFlashStrength: 0.5,
    /**
     * How long the condensing ring takes to close, as a fraction of the effect.
     *
     * It has to finish EARLY: the ring closing is the force arriving, and the
     * cap's answering pulse has to happen after it, inside the same effect. At 1
     * the two would land together and the sequence would read as one flash.
     */
    smashRingFraction: 0.62,
    /** Where the ring starts, as a multiple of `ringSize`. It closes to zero. */
    smashRingStart: 3.4,
    /** Steps the ring's contraction is quantised to. Few: it snaps inward. */
    smashRingSteps: 6,
    /** How much the cap swells when the ring lands. Against onemore's 0.35. */
    smashPulseAmount: 0.5,

    // ── and the aura it leaves, until the shot ───────────────────────────
    /** Size of the standing aura ring, in world units, and its height. */
    smashAuraSize: 4.2,
    smashAuraHeight: 0.55,
    /** How bright it holds. It never fades out — the card has not expired. */
    smashAuraStrength: 0.85,
    /** How fast the aura walks its palette. Its own dial: the aura is a STATE
     *  and the chaos stars are a different one, so they must not pulse in step. */
    smashPaletteCyclesPerSecond: 2.2,
    /** How hard an armed cap trembles, in world units, and how fast. Drawing
     *  only — applied after the physics transform, exactly like the chaos wobble. */
    smashJitterAmount: 0.07,
    smashJitterHz: 19,

    // ── 철벽's brace, which is the quietest marker in the file ────────────
    /**
     * ── this one is on THREE OR FOUR CAPS AT ONCE, and nothing else is ───────
     * 강타's aura marks the armed player's caps too, but 강타 and 철벽 are not in
     * the same position: an armed player is ABOUT TO SHOOT, so their aura is on
     * screen for one aim and then gone. A brace is on for the whole of the
     * opponent's turn, on survival's three caps or football's four, while the
     * player is trying to read the board and aim through them.
     *
     * So everything below is sized DOWN from 강타's numbers rather than across
     * from them. It is not a taste preference and it is not timidity — it is the
     * one constraint this effect has that no other effect in the file does.
     */
    /**
     * Quad size in world units. The octagon inside it is 0.78 of this.
     *
     * ── it has to CLEAR the cap, and the first value did not ─────────────────
     * 3.6 was picked to sit under 강타's `smashAuraSize` of 4.2, on the reasoning
     * that this marker has to be the quieter one. Measured on the board, the
     * octagon it produced was 2.8 units across against a cap 3.2 wide — the ring
     * was drawn INSIDE the cap it was marking, and read as a rim highlight on
     * the cap rather than as anything around it.
     *
     * 5.0 puts the octagon at 3.9, a comfortable margin outside the cap's edge,
     * which is the only size at which a ring is a ring. The quietness belongs to
     * the ALPHA, not to the diameter: a marker made quiet by being hidden under
     * the thing it marks is not quiet, it is absent.
     */
    resistRingSize: 5.0,
    /** How far above the cap's centre of mass it lies. Low: it sits ON the board. */
    resistRingHeight: 0.32,
    /**
     * How bright it holds. Well under the aura's 0.85.
     *
     * Four of these at 0.85 is a board with four bright rings on it and a ball
     * somewhere underneath. §0.4 wants the position readable while an effect is
     * running, and four simultaneous markers is the case that tests it.
     */
    resistRingStrength: 0.42,
    /**
     * Corners on the ring. Six or eight — angular is the whole statement.
     *
     * A circle is the shape every other marker in this file already uses, and it
     * says "field" or "aura". Flat facets say the cap has been braced into
     * something with sides. Eight reads as hard at this size without turning
     * into a circle again; six starts to read as a nut.
     */
    resistRingSides: 8,
    /**
     * How fast the ring walks its palette.
     *
     * SLOW, and it never pulses in brightness — see `RESIST_PALETTE`. A hardness
     * that throbs is a contradiction: 강타's aura pulses because something is
     * being LOADED, and this is a state that is not going anywhere.
     */
    resistPaletteCyclesPerSecond: 0.55,
    /**
     * The cast, in FRAMES. `smashFlashFrames` says why frames.
     *
     * Three beats: the cap presses down for `resistPressFrames`, the ring
     * overshoots outward and settles over `resistSettleFrames`, and a single
     * crystalline glint runs for `resistGlintFrames`. At two or three frames
     * apiece, a window measured in seconds would land on a different count at 60
     * and at 120 Hz — which at this length is the difference between a beat and
     * nothing.
     */
    resistPressFrames: 3,
    resistSettleFrames: 7,
    resistGlintFrames: 3,
    /** How far the cap presses down, as a scale. Tiny — it is bracing, not shrinking. */
    resistPressAmount: 0.06,
    /** How far the ring overshoots before it sits down, as a multiple of its size. */
    resistSettleOvershoot: 1.7,
    /**
     * Frames the ring flashes white when a braced cap actually takes a hit.
     *
     * ── the card's only visible OUTPUT, and it must not be cut ───────────────
     * Everything else 철벽 does is a NON-event: the cap that would have gone off
     * the board does not. A player with no marker for that cannot tell the card
     * worked from the card doing nothing, and the honest reading of a quiet turn
     * is that they wasted it.
     *
     * The hit is read off `ContactAudio`, which is already the one collision
     * observer in the project — see `CardFx._updateResist`. A second detector
     * would be a second answer, and the day the two disagreed the sound and the
     * flash would land on different frames.
     */
    resistHitFrames: 3,
    /** How far toward white the ring goes on that hit, 0..1. */
    resistHitStrength: 0.9,

    // ── the trajectory sweep and its line ────────────────────────────────
    /** Height of the swept band, in frame pixels. */
    scanHeight: 40,
    /** Texels down that band. Few: it is a stepped tail, not a gradient. */
    scanTexels: 128,
    /** Samples per dash cycle on the trajectory line. */
    dashLength: 64,
    /** How fast the dashes march, in samples per second. Stepped. */
    dashSamplesPerSecond: 14,

    // ── 침묵 ─────────────────────────────────────────────────────────────
    // Every length here is in FRAME PIXELS: the seal is drawn in the CARD
    // scene, whose camera covers a fixed 640x480 box whatever the render
    // target is. Nothing about this card touches the world — it is an effect
    // on a HAND, so nothing of it is billboarded over a cap.
    /**
     * Texels of the padlock sprite.
     *
     * 16, which is small even by this file's standards. The lock is drawn at 26
     * frame pixels on the hand and the whole of it is a shackle, a body and a
     * keyhole — three shapes. At 32 the keyhole becomes two pixels of detail
     * nobody at 640x480 will ever resolve, and the sprite starts to look
     * photographed rather than drawn.
     */
    sealLockTexels: 96,
    /**
     * How the padlock ARRIVES on the sealed player's hand.
     *
     * It comes in oversized and lands at 1, quantised to `sealStampSteps`: a
     * thing pressed onto the picture from in front of it, which is the one
     * gesture that reads as a seal being APPLIED rather than as an icon fading
     * in. A smooth contraction is a tween; three jumps is a blow.
     *
     * This runs when the victim's turn OPENS, not when the card is cast — see
     * `CardLayer._updateSeals`. It is the moment the marker is worth anything.
     */
    sealStampStart: 3.2,
    sealStampSteps: 3,
    /** How long that stamp takes. Short — it is a strike, not an entrance. */
    sealStampSeconds: 0.22,
    /**
     * Frames of full-frame DARKENING when the card is cast. One or two.
     *
     * The whole of 침묵's cast effect, now that the reaching bolt is gone — it
     * read as smoke drifting across a board where nothing drifts, and it spent
     * half a second saying what the padlock says better on the turn it matters.
     *
     * The mirror of 강타's inversion, and drawn with the same kind of
     * arithmetic: `dst - src`, which is one of the four semi-transparency modes
     * the hardware actually had. Counted in FRAMES rather than seconds for the
     * reason given on `smashFlashFrames` — at this length the frame rate would
     * otherwise decide whether it happens at all.
     */
    sealDarkenFrames: 2,
    /** How far that flash pulls the picture down, 0..1 of full black. */
    sealDarkenStrength: 0.55,

    // ── and the padlock on the sealed player's own turn ──────────────────
    /** Size of the seal marker, in frame pixels. */
    sealIconSize: 26,
    /**
     * Where it sits relative to the hand, in frame pixels.
     *
     * X out from the middle of the hand, Y up from the bottom edge — and there
     * is only one edge to measure from, because the marker is drawn on the
     * sealed player's OWN turn and their hand is at the bottom then.
     *
     * Off to the side rather than over the middle of the fan: the marker says
     * the hand is sealed, and a marker that covers the cards it is talking
     * about is in the way of the very thing the player is trying to read.
     *
     * Measured against the fan rather than guessed. The hand spans about ±182
     * frame pixels at five cards and reaches 120 up when it is raised, so 236
     * clears the widest card and 96 sits beside the fan instead of across the
     * card NAMES — which is where the first pair of numbers put it, over the top
     * third of the two rightmost cards.
     */
    sealIconX: 236,
    sealIconY: 96,
    /** How fast the marker's palette walks while the seal holds. */
    sealPaletteCyclesPerSecond: 0.7,
  },

  physics: {
    /** Base damping. The turn's convergence ramp adds to these, never replaces them. */
    linearDamping: 0.18,
    // Tumbling caps end up rolling on their rims, and a rolling cap loses almost
    // nothing to friction — left alone it will cross the board twice. This is
    // what stops a flipped shot outrunning a flat one.
    angularDamping: 1.3,
    solverIterations: 8,
    ccdSubsteps: 4,
  },

  shot: {
    /**
     * Impulse at full power, in g·cm/s.
     *
     * ABSOLUTE. Resizing the board does not touch it: a cap and a flick are the
     * same cap and the same flick whatever they are played on, so a bigger board
     * is simply a bigger place and a full draw covers less of it. Measured on the
     * 36 cm default, 70% power carries a cap the 22 cm from its own row to the
     * opposing one, so reaching the enemy is a two-thirds pull and the top third
     * is genuinely overkill — which is what gives the error cone something to be
     * a real cost against.
     */
    maxImpulse: 500,

    // ── the bow ──────────────────────────────────────────────────────────────
    /**
     * Pull distance at which power reaches 100%, in world units (cm).
     *
     * Absolute, like the impulse it drives — the two have to agree or the same
     * gesture would mean different energy on different boards. 10 on the 36 cm
     * default is about a third of its width: long enough to have real resolution
     * under the hand, short enough not to run off the screen from the far row.
     * On a much larger board the camera pulls back, so the same 10 units is a
     * shorter drag on screen and power gets coarser under the hand.
     */
    maxPullDistance: 10,
    /**
     * Release inside this and nothing is fired, in world units.
     *
     * Slightly larger than the cap's own 1.6 radius on purpose: pressing a cap
     * and letting go without dragging must never launch it, and the press point
     * can be anywhere on the cap.
     */
    deadzone: 1.8,
    /**
     * Pull distance -> power. `linear` | `easeIn` | `easeOut`.
     *
     * Linear to start with, as specified. easeIn puts more of the pull into the
     * low end (finer control on soft shots); easeOut does the opposite.
     */
    pullCurve: 'linear',


    // ── spread ───────────────────────────────────────────────────────────────
    /** Half-angle of the error cone at full power, in degrees. */
    maxSpreadDeg: 7.0,
    /** Exponent on power -> spread. Above 1 keeps light pulls nearly true. */
    spreadCurve: 1.8,

    /** Pin the seed so every shot draws the same deviation. For A/B testing feel. */
    lockSeed: false,
    lockedSeed: 0x1234abcd,
  },

  turn: {
    /**
     * Rest thresholds, PER BODY KIND. Keys match `BODY_KIND`.
     *
     * Two pairs rather than one, because rest is the same physical state for a
     * cap and for a ball and the numbers that describe it are not. A cap at the
     * moment it stops is sliding; the threshold that catches that is a LINEAR
     * one and its angular partner can be tight, since a cap that has stopped
     * sliding has stopped turning. A ball at the moment it stops is rolling, and
     * a sphere of radius 0.72 creeping at the caps' 0.9 cm/s is turning at 1.25
     * rad/s — twice the caps' angular threshold. Judged by the caps' numbers it
     * would hold every turn open for another second and a half of nothing
     * visible happening.
     *
     * So the ball's pair is deliberately more generous in both axes, and the
     * angular one much more so. Both are on the panel; drag the ball's linear
     * threshold toward the cap's and turns get noticeably longer with no change
     * to anything you can see on screen, which is the whole argument for the
     * split in one gesture.
     */
    rest: {
      cap: { linear: 0.9, angular: 0.6 },
      ball: { linear: 2.4, angular: 4.5 },
    },
    /** Consecutive quiet PHYSICS steps needed to end the turn. 30 = 0.25 s. */
    quietSteps: 30,
    /** When the convergence ramp starts, in seconds of simulated time. */
    rampStartSec: 5.0,
    /** Ramp shape. Above 1 stays gentle for longer, then bites. */
    rampCurve: 2.0,
    /** Damping added at the top of the ramp. */
    rampMaxDamping: 9.0,
    /** Hard stop. Velocities are zeroed and the turn ends, whatever is happening. */
    hardTimeoutSec: 8.0,
  },

  preview: {
    /**
     * The development trajectory line. OFF.
     *
     * It draws the exact path the cap will take, which is an instrument rather
     * than a game: knowing where the shot goes before taking it removes the
     * thing the shot is for. It stays here because it is still the fastest way
     * to see what the solver is doing, and because the 궤적 card is built on the
     * same machinery — the card turns it on for one turn regardless of this
     * switch, which is what makes the card worth playing.
     */
    enabled: false,
    /** How far ahead to simulate, in seconds. */
    seconds: 1.0,
    /** Record one point every N physics steps. 4 -> 30 points a second. */
    sampleEvery: 4,
    /**
     * Preview steps allowed per rendered frame.
     *
     * A step costs about 0.33 ms — nearly all of it CCD, which the preview
     * cannot skip without ceasing to be exact — so 20 is a ~6.6 ms slice of a
     * 16.7 ms frame and a one-second preview completes in 6 frames. That is
     * what makes it fit inside one charge bucket. Raise it and the line snaps
     * in sooner at the cost of frame time; drop it and aiming stays smoother
     * while the line lags further behind the bar.
     */
    stepBudget: 20,
  },

  /**
   * The mystery orbs. Where they come from and how big they are.
   *
   * Nothing here is a collider setting, because an orb is not a collider — see
   * the header in `game/Orbs.js` for why "no shape at all" is the strongest way
   * to guarantee it never blocks a cap or a ball.
   */
  orbs: {
    /** Chance of one appearing at the end of a turn. Rolled once, always. */
    spawnChance: 0.3,
    /** Ceiling on how many may sit on the field at once. */
    maxOnField: 3,

    /**
     * The drawn sphere's radius, in world units.
     *
     * Comparable to a cap, because it has to read as a THING on the board from
     * the wide turn view rather than as a speck. At 0.9 it was a dot.
     */
    radius: 1.45,
    /**
     * The pickup radius, deliberately larger than the drawn one.
     *
     * A cap that visibly grazes an orb should take it. Making the test exactly
     * the sphere means near-misses that looked like hits, which reads as the
     * orb being broken rather than as the player having missed.
     */
    sensorRadius: 1.8,

    /** Extra clearance a spawn keeps from caps, the ball and other orbs. */
    spawnMargin: 0.6,
    /** How many positions a spawn will try before giving the turn up. */
    placementRetries: 24,

    // ── look ────────────────────────────────────────────────────────────────
    /** Turns a second. The shell spins; the "?" inside is a billboard and does not. */
    spinSpeed: 0.35,
    /** How far it bobs, and how fast. */
    floatAmplitude: 0.22,
    floatSpeed: 1.1,
    /** How high it sits off the board. */
    hover: 1.1,
    /** Palette cycle rate, in full cycles a second. */
    paletteSpeed: 0.22,

    // ── timings ─────────────────────────────────────────────────────────────
    /** The pop-in. Under the brief's 0.3. */
    spawnSeconds: 0.26,
    /** Orb burst plus the card's flight to the hand. Under the brief's 0.5. */
    pickupSeconds: 0.42,
    /** How long a refused orb flashes red for. */
    refuseSeconds: 0.35,

    /** Draw the pickup radius. */
    showSensors: false,
  },

  /**
   * The AI opponent. Search budget, what a position is worth, and how long the
   * turn takes to WATCH.
   *
   * ── every number here was chosen against a measurement ────────────────────
   * One exact rollout — restore the turn snapshot into a throwaway world, apply
   * the impulse through the real `resolveImpulse`, and step until `TurnSettle`
   * says the turn is over — costs 14.5 ms and takes 95 steps on average, at
   * about 153 us a step. The rollout agrees with the live turn exactly: same
   * step count, same end position to the last digit. So the search is not
   * approximating anything, and the only question is how many of these fit in
   * the time available.
   *
   * That single number decides the shape of everything below. A blind grid of
   * 3 caps x 24 angles x 4 powers is 288 rollouts and four seconds; the budget
   * here buys about 45. Hence targeted candidates rather than an even sweep —
   * see `ai/candidates.js`.
   *
   * ── the AI is not made weak by aiming badly ───────────────────────────────
   * `executionErrorDeg` is 0 and is meant to stay there until the thing has been
   * played against. Measured from a position with an opponent near the rim, 12
   * of 160 candidate shots drop that cap and 78 lose one of the AI's own — so
   * the difficulty of this mode is entirely in knowing which shot is which, and
   * an AI detuned by adding aim error would not play worse, it would play
   * randomly. `pickRandomness` is the honest dial for that: it degrades the
   * CHOICE among good moves rather than the execution of one.
   */
  ai: {
    /**
     * How many candidate shots to build, per axis.
     *
     * `anglesPerTarget` is the fan around each target bearing and `powerSteps`
     * the draw strengths tried on each. Total is roughly
     * `maxShooters x (opponents + orbs + 1) x anglesPerTarget x powerSteps`,
     * of which the deadline may only reach the first few dozen.
     */
    sampling: {
      maxShooters: 3,
      anglesPerTarget: 3,
      angleSpreadDeg: 9,
      powerSteps: 5,
      /**
       * Aim to send the target OFF the board rather than merely away from the
       * shooter — the pool player's ghost ball. See `candidates.js`.
       *
       * Measured over five matches against a fixed opponent, caps taken per AI
       * turn: 0.017 without it, 0.25 with. It is the difference between an
       * opponent that shoves caps around and one that finishes.
       */
      ghostBall: true,
      /**
       * How many candidates actually get simulated. THE budget.
       *
       * A count rather than a time limit, and that is a determinism fix rather
       * than a preference — a wall-clock deadline made the AI pick a different
       * move on two identical runs, because a busy machine fit three fewer
       * rollouts into the same 700 ms. See the header in `ai/AiPlanner.js`.
       *
       * 48 x the measured 14.5 ms is about 0.7 s, which fits inside the card
       * animation and the pause that follow it. The generator is breadth-first,
       * so the first fifteen or so already cover every cap, every target and the
       * retreat; the rest is refinement.
       */
      maxCandidates: 64,
    },

    /**
     * ── random cone sampling was tried, measured, and is gone ────────────────
     * `robustnessSamples` / `robustnessPool` lived here. The idea was to rank on
     * the intended shot and then re-roll the best few through real draws. It was
     * measured over 16 long shots (30-46 units, 강타 armed), each chosen shot
     * then fired under 10 draws the AI never saw:
     *
     *     samples  0 (off)   88% of those draws landed
     *     samples  3         33%
     *     samples  5         75%
     *     samples  8         85%
     *     samples 12         91%   (and over the time budget)
     *
     * Three samples is not a weak estimate, it is an actively misleading one: a
     * robust line that loses two draws by chance ranks below a poor line that
     * won two. It takes eight to claw back to where the blind ranking already
     * was, and twelve to beat it, at four times the rollouts.
     *
     * The knobs then sat at 0 with no code path reading them at all — the array
     * they gated was never filled — so they were dials that moved a number
     * nobody read, which is worse than no dial. `spreadProbes` does the job
     * properly: the two cone EDGES instead of random draws from inside it,
     * deterministic, and a better discriminator for the same two rollouts.
     */

    /**
     * Milliseconds of solver allowed inside a single rendered frame.
     *
     * Changes how long the search takes in wall clock and NOTHING about what it
     * decides — the decision is fixed by `maxCandidates`. Raise it and the AI
     * answers sooner at the cost of frame time; lower it on a device that
     * stutters.
     *
     * ── 6, and it is not the compromise it looks like ───────────────────────
     * This sat at 4 on an earlier reading that also changed `maxRolloutSteps` in
     * the same step, so the two were never separated. Measured again in the
     * browser with only this number moving, `stepChunk` at 8, and the AI holding
     * 강타+궤적 so the boost probe runs every turn:
     *
     *     4 ms   think frames p50 8.2  p95 12.4  worst 31.2   0.4% long   search 3.0 s
     *     6 ms   think frames p50 7.9  p95 12.4  worst 25.6   0.3% long   search 2.3 s
     *     (idle frames, for scale: p50 8.3  p95 9.1  worst 13.5  0.0% long)
     *
     * Better on both axes, which is not a trade-off and is worth saying plainly:
     * a bigger slice finishes a chunk instead of abandoning it mid-way and
     * resuming next frame, so there is less resume overhead and fewer frames
     * carrying it. A thinking frame is now indistinguishable from an idle one.
     */
    frameBudgetMs: 6,
    /**
     * What a THINKING frame is allowed to cost, in total. 0 = the flat slice.
     *
     * ── the number above is a share of a frame nobody measured ──────────────
     * `frameBudgetMs` is one constant against every refresh rate, and it is
     * wrong at both ends. Measured on an M3 at 120 Hz with the game's own work
     * at about 4 ms of an 8.3 ms frame: thinking frames ran 10–25 ms, so the
     * search was getting 62% of the wall clock — 3.1 s to spend 1.9 s of solver
     * — while the frame was already over its vsync period anyway. Filling the
     * vsync period instead is worse, not better: at 120 Hz that leaves 4 ms and
     * the AI gets SLOWER than it is now.
     *
     * What is actually true of these frames is that nothing is moving. Nothing
     * has been fired, no cap is in flight, no card is out; the only animation is
     * the camera easing into the turn's framing. So the right target is a frame
     * LENGTH, and 60 Hz is the one a moving camera still reads smoothly at.
     * `ThinkBudget` hands the search whatever is left of it once the rest of the
     * frame has taken its measured share, which adapts to the device instead of
     * assuming one.
     *
     * ── 17 and not 16.7, because it is rounded DOWN to whole refreshes ───────
     * `requestAnimationFrame` is aligned to vsync, so the target has to land on a
     * multiple of the display's period or the frame spills into the next one and
     * the search pays a whole interval for a fraction of a millisecond —
     * `ThinkBudget` has the measurement. 17 is the smallest number that takes two
     * intervals on a 120 Hz panel and one on a 60 Hz panel, which is 16.7 ms on
     * both; 16 would take ONE interval at 120 Hz and halve the budget there.
     *
     * Measured over the two AI fixtures — knockout / football, search wall clock
     * per turn, with the frame quantised to vsync the way rAF actually
     * quantises it and the game's own work modelled at 4 ms:
     *
     *                       60 Hz panel                120 Hz panel
     *     off (flat 6 ms)   5.40 s / 5.35 s  38% duty  5.31 s / 5.30 s  38%
     *     17 ms             2.82 s / 2.78 s  71% duty  2.83 s / 2.80 s  71%
     *
     * The thinking frame lands at 16.7 ms on both panels either way — the search
     * takes the slack rather than the frame rate. `tools/bench/think-frames.mjs`
     * is what produced those rows.
     *
     * How much it is worth depends on what the frame costs WITHOUT the search,
     * which is the whole reason it is measured rather than assumed. On a desktop
     * at 120 Hz whose render is 1.5 ms the flat slice already fit inside one
     * refresh interval and the gain is small; it is largest exactly where it is
     * wanted, on a 60 Hz panel or a device whose frame is not nearly free.
     *
     * `npm run det:ai` digests are unmoved at 2b19511a / 449d0891, because the
     * decision is fixed by `maxCandidates` and this only changes how many frames
     * it is spread over. Set it to 0 to hand the flat slice back.
     */
    thinkFrameMs: 17,
    /**
     * Physics steps run before the search checks the clock again.
     *
     * ── the frame budget is only honest if a CANDIDATE can be interrupted ────
     * A whole rollout is ~95 steps and measured at 10.2 ms in the browser, so a
     * search that evaluated one candidate atomically per frame spent 10 ms in
     * frames that also have to render — 14 of 122 went over 16.7 ms and the
     * worst hit 23.7. No frame budget below 10 could do anything about it,
     * because the unit was indivisible.
     *
     * A chunk is also how far a frame can OVERSHOOT its budget, since the clock
     * is only consulted between chunks — and 24 was too coarse once the boost
     * probe and the combo's two replans were added. Measured over six turns with
     * 강타+궤적 held, so the probe runs every time:
     *
     *     stepChunk 24   20.3% of think frames over 16.7 ms   worst 35.7 ms
     *     stepChunk 12    0.3%                                worst 26.8 ms
     *     stepChunk  8    0.1%                                worst 20.2 ms
     *     stepChunk  4    0.0%                                worst 18.7 ms
     *
     * 8 is where the judder stops. The total solver work is identical at every
     * setting — only its distribution changes — so this buys smoothness with
     * more frames rather than with a worse decision, and the decision itself is
     * fixed by `maxCandidates` either way. Lower it further on a slow device,
     * for the reason `TrajectoryPreview` gives about spreading its own stepping.
     */
    stepChunk: 8,
    /**
     * Safety valve, not the normal path. Well above `maxCandidates x 14.5 ms`.
     *
     * If this trips the search did not finish its configured list, so that turn
     * is not reproducible — it warns to the console rather than absorbing it.
     * The fix is to lower `maxCandidates`, not to raise this.
     */
    totalBudgetMs: 2500,

    /**
     * What a position is worth. Every term is a line from the brief.
     *
     * They are absolute rather than normalised, so `dropOpponent` at 100 against
     * `loseOwn` at 140 says plainly that the AI will not trade a cap for a cap —
     * it needs to come out ahead. That asymmetry is the single most important
     * pair of numbers in the file: at parity the search happily plays mutual
     * destruction, which reads as an AI flailing rather than an AI attacking.
     */
    weights: {
      /**
       * Per opponent cap knocked off. The win condition, and it must WIN.
       *
       * ── 100 against `foeEdge` 60 was why kills got passed up ──────────────
       * Two caps shoved to the brink scored 2 x 0.81 x 60 = 97, near enough to
       * killing one outright that positional noise decided between them — so a
       * shot that finished a cap lost to a shot that merely tidied the board.
       * Reported from play as "90%로 죽일 수 있는데 안 죽이고 다른 판단할 때가
       * 많다", which is exactly what that arithmetic produces.
       *
       * A cap is a third of a side here. Removing one has to dominate every
       * amount of position, and at 260 against a reduced `foeEdge` it does.
       */
      dropOpponent: 260,
      /** Per own cap lost. Above `dropOpponent`, deliberately — see above. */
      loseOwn: 300,
      /** Squared nearness to the brink, summed over surviving own caps. */
      edgeRisk: 20,
      /**
       * Own caps an enemy is lined up to push off next turn, 0..1 each.
       *
       * ── the defensive half, and it is what makes retreating INTELLIGENT ───
       * `edgeRisk` only knows how near the edge a cap is; this knows whether
       * anybody can do anything about it. A cap on the rim with the enemy on the
       * far side of the board scores nothing here, and a cap in mid-board with
       * someone lined up behind it scores heavily — which is the difference
       * between running away for a reason and running away on principle.
       *
       * Above `dropOpponent` per unit, because a fully-lined-up cap is close to
       * a cap already lost and the AI should pay real value to break the line.
       */
      selfThreat: 40,
      /**
       * Opponent caps left near the brink, squared. The aggressive half.
       *
       * ── this is the gradient the evaluator did not have ──────────────────
       * `dropOpponent` is all or nothing: shove a cap to within a hair of going
       * over and score the same zero as missing it completely. So there was no
       * reason to attack unless the kill resolved this turn, and the AI shuffled
       * to the middle in every other position — reported as "너무 멍청하다".
       *
       * Pricing the opponent's edge makes a near miss into progress worth
       * having, so the AI can work a cap outward over two turns. 45 means
       * driving one from the middle to the rim is worth about 45, against 100
       * for finishing it — enough to be worth doing, not enough to prefer over
       * the kill.
       */
      foeEdge: 22,
      /**
       * Opponent caps THIS side is lined up to push off next turn. OFF.
       *
       * ── it was a proxy for lookahead and it got farmed ───────────────────
       * The idea was to price "I am in position to kill next turn" without
       * searching for it. Measured against a fixed opponent over ten matches at
       * a weight of 60: zero kills, one cap lost, every match unfinished. Being
       * in position scores WITHOUT COMMITTING, so hovering at range beat
       * attacking, and the AI turtled.
       *
       * The reply search does the same job honestly — it asks what the opponent
       * actually does rather than what the geometry hints at — so this is off.
       * It is kept because it is cheap and a mode without a reply search (a
       * lower `replyCandidates`, a slower device) can lean on it as a prior.
       */
      foeThreat: 0,
      /**
       * Credit for moving a cap inward. A TIEBREAKER now, not a policy.
       *
       * It was 12 and it was most of the reason the AI ever did anything: every
       * inward shot scored, whether or not the cap was in any trouble, so
       * "toward the middle" beat every attack that did not kill outright.
       * Danger is priced by `selfThreat` now, which only fires when there is a
       * real threat to answer. This is what is left: a nudge toward the middle
       * when two moves are otherwise equal.
       */
      centre: 3,
      /**
       * Per orb this AI's own cap reaches. One card.
       *
       * ── it turned out to BE a weight, and this is the measurement ────────
       * "오브 먹으면 죽는데 오브 먹으려고 목숨을 희생해" was reported from play, and
       * two plies of lookahead did not fix it. This did. Five matches against a
       * fixed opponent, same seeds, changing only this number:
       *
       *     orbGain 24   taken 12  lost 11   orb runs cost a cap 6 of 47
       *     orbGain 10   taken 15  lost  1   orb runs cost a cap 0 of 30
       *
       * Same caps taken, an order of magnitude fewer lost, and the orb suicides
       * gone. At 24 a card was worth a sixth of a cap and the search would walk
       * into a losing position for one; at 10 it is worth a fourteenth and only
       * a genuinely safe pickup clears the bar.
       *
       * ── and then lower still, once the search could actually shoot ────────
       * It was raised to 16 on the reasoning that better card use makes cards
       * worth more. That was wrong, and re-running the same five matches after
       * the power ladder was fixed says so:
       *
       *     orbGain 16   taken 15  lost 2  over 100 turns   orb 39% of shots
       *     orbGain 10   taken 15  lost 1  over  78 turns   orb 26%
       *     orbGain  5   taken 15  lost 0  over  79 turns   orb 16%
       *
       * Same caps taken at every setting — so the orb runs were never buying
       * kills, they were only costing caps and turns. At 5 the AI loses none of
       * its own and spends 65% of its shots attacking instead of 38%, which is
       * "오브만 모으지 말고" measured rather than asserted.
       */
      orbGain: 5,
      /** Per orb an opponent's cap is pushed onto. A card handed over. */
      orbGift: 34,
      /** Per overlapping pair of own caps. Chain-fall risk. */
      clump: 9,
      /** How close counts as clumped, in cap diameters. */
      clumpRadiusCaps: 1.6,
    },

    /**
     * The geometry the threat model measures with. World units.
     *
     * "죽을 확률이 높은 위치" is a question about two distances: can the enemy get
     * here, and is there any board left behind me. Both are absolute lengths on
     * the board rather than fractions, because that is what they are.
     */
    /**
     * How far ahead the search looks.
     *
     * ── one ply cannot see a cap die, which is where this came from ─────────
     * The evaluator scores the instant a shot settles. A cap that grabs an orb
     * and stops on the rim with nobody yet in range scores well and is dead next
     * turn, and no weight can express that because the information is not in the
     * position — it is in the reply. See `AiPlanner._finishStage1`.
     */
    /**
     * Hard ceiling on a single rollout, in physics steps.
     *
     * ── most turns settle in 95 steps; the outliers cost ten times that ─────
     * `TurnSettle`'s hard timeout is 8 s — 960 steps — and a messy position with
     * caps still creeping runs to it. Measured during a ten-match sweep: turns
     * that hit the timeout took 89 ms a candidate instead of the usual 10, and
     * the search tripped its own safety valve at 2.5 s on four of them.
     *
     * 240 steps is 2 s of simulated time — two and a half times the 95-step
     * median, so ordinary turns are untouched, and it bounds the tail. Measured
     * in the browser over one AI turn, against 420:
     *
     *     420 steps, 6 ms budget   p50 12.2 ms  p95 18.9  23 of 104 frames long
     *     240 steps, 4 ms budget   p50  6.5 ms  p95 16.3   3 of 137 frames long
     *
     * Same total work, spread properly. What it costs is the rare cap still
     * rolling at two seconds whose fall goes uncounted — a fair trade against a
     * turn that judders while it thinks.
     */
    maxRolloutSteps: 240,

    /**
     * How many shortlisted shots are re-fired at the edges of their own cone,
     * and how many of them get that treatment.
     *
     * ── the AI must not see its DRAW, but it must see its SPREAD ────────────
     * Planning is blind to the deviation so the search cannot aim off and cancel
     * it. Implemented as "blind to the cone entirely", which is a different and
     * worse thing: a forty-unit full charge looked exactly as reliable as a
     * six-unit tap, because with the deviation zeroed both land perfectly. The
     * AI took the long one and threw its cap off the board — "너무 멀면 오차가
     * 심해지는데 그거 생각 안 하고 멀어도 풀차징해서 혼자 죽는다".
     *
     * 2 probes puts each shortlisted shot at both edges of the cone it would
     * really be drawn from, and the score becomes the mean of the two edges and
     * the middle. Power now costs accuracy in the search the way it does in the
     * game. 0 turns it off and hands back the blind behaviour.
     */
    spreadProbes: 2,
    spreadPool: 12,

    /**
     * How many shortlisted ATTACKS are also re-fired as 강타 would fire them.
     *
     * Three rollouts each — the boosted cone's centre and both edges — and only
     * when 강타 is actually in hand and legal, so most turns pay nothing. It
     * replaces `reachShortfall`, a proxy that was measured to be inverted: 강타
     * was being spent at 40–48 units, where the shooter died, and held at 24–36,
     * where it would have landed.
     *
     * 4 keeps the cost at twelve extra rollouts on a search that already runs
     * about ninety. 0 turns the probe off, and with it every use of 강타.
     */
    boostPool: 4,

    /** How many of the ranked candidates get a reply searched. 0 = one ply. */
    replyPool: 5,
    /**
     * How many opponent answers to try per candidate. 0 = one ply. OFF.
     *
     * ── it was asked for, it was built, and the numbers say it does not pay ──
     * Five matches against a fixed opponent, same seeds, counting caps taken and
     * lost and how often collecting an orb cost a cap inside two turns:
     *
     *   1 ply, selfThreat 25    taken 6  lost 4   orb cost a cap 2%   394 ms
     *   2 ply, selfThreat 25    taken 5  lost 4                 1%   761 ms
     *   2 ply, selfThreat 10    taken 4  lost 7                 3%   761 ms
     *   2 ply, selfThreat  0    taken 4  lost 9                 5%   761 ms
     *   1 ply, selfThreat  0    taken 3  lost 9                 6%   394 ms
     *
     * Two readings, and they agree. At the same first-ply caution the reply
     * search is indistinguishable — `replyWeight` 1.0 and 0.6 returned byte-
     * identical results, which is what a term that never changes the ranking
     * looks like. And handing it the safety job outright, by dropping
     * `selfThreat` and letting the reply catch blunders, is worse than the cheap
     * model on every count.
     *
     * The reason is that the two overlap: `threatOn` already refuses to leave a
     * cap where it can be pushed off, so by the time a shortlist exists there is
     * rarely a kill left for the second ply to find. It re-confirms the first
     * ply's decision at twice the cost.
     *
     * Kept, with the slider, because that reasoning is width-dependent: a wider
     * `replyPool`, more candidates, or a mode whose danger is less local could
     * change it. Raise this to 10 to turn it on.
     */
    replyCandidates: 0,
    /**
     * How much of the opponent's best reply comes off the score.
     *
     * Below 1 on purpose. A full subtraction assumes both that the opponent
     * plays their best answer and that ten candidates found it; over-trusting a
     * sample that size makes the AI flinch from good moves because one plausible
     * answer looked strong.
     *
     * Only the KILLS in the reply are counted now, not its whole score — see
     * `AiPlanner`. Subtracting the full score turtled the AI twice: after any
     * committal move the opponent has some decent answer, so every attack was
     * penalised and standing still was not. Measured at zero caps taken across
     * five matches. Kills are nearly binary and ten candidates estimate them
     * well; a positional score they do not.
     */
    replyWeight: 1.0,

    threat: {
      /**
       * How far away an enemy cap can still be a threat.
       *
       * Measured travel: a cap struck at power 0.54 covers about 20 units and
       * at 0.75 about 27. 26 is therefore roughly "one solid shot away" — past
       * it the attacker has spent the shot arriving and cannot also push
       * anything off.
       */
      reach: 26,
      /**
       * How far a STRUCK cap travels. What decides whether a push kills.
       *
       * A cap with more than this much board behind it survives being hit; less
       * and it goes over. 12 is the honest figure for the mid-power shots the
       * search actually chooses — raise it and the AI treats more of the board
       * as lethal, which makes it more timid.
       */
      pushDistance: 12,
    },

    /**
     * Degrees of aim error injected AFTER the decision. 0 = perfect execution.
     *
     * "기본 오차 주입값은 0이다. 다만 오차 폭 슬라이더는 반드시 만들어라." This is
     * that slider. It twists the chosen heading, so the AI still decides well and
     * simply fails to carry it out — which is what a strong player missing looks
     * like. It is NOT the charge cone: that is the game's own error, it applies
     * to the AI untouched, and it is already in the shot by the time this runs.
     */
    executionErrorDeg: 0,
    /**
     * How far down the ranking the pick may wander. 0 = always the best move.
     *
     * A softmax temperature over `pickPoolSize` candidates. The right dial to
     * reach for if the AI turns out too strong, for the reason the block header
     * gives: it weakens the choice among good moves instead of making the
     * execution bad.
     */
    pickRandomness: 0,
    pickPoolSize: 5,

    /**
     * How long the AI's turn takes to WATCH. None of this is thinking time.
     *
     * "인위적인 '생각 중' 딜레이를 추가하지 마라. 이 연출이 그 역할을 한다." The
     * search runs underneath these, so the animation is not covering a wait — it
     * is the only reason a human can tell what the AI did. The calculation
     * finishes during the card phase and the pause.
     */
    show: {
      /**
       * Draw, move to the middle, and turn face up. 0.6 s, and the floor is real.
       *
       * "그보다 짧으면 뭐가 뒤집혔는지 인지가 안 되어 애니메이션 의미가 사라진다.
       * 0.6초 아래로 무리하게 줄이지 마라." Split three ways below; the sum is
       * what matters and the split is taste.
       */
      cardPullSeconds: 0.18,
      cardMoveSeconds: 0.22,
      cardFlipSeconds: 0.2,
      /** Face up and still, so it can be read. Short, but not zero. */
      cardHoldSeconds: 0.32,

      /** Between the card finishing and the aim starting. Keeps them separate. */
      gapSeconds: 0.2,

      /** The cap about to be fired is picked out before anything moves. */
      aimHighlightSeconds: 0.22,
      /** The pull vector grows from nothing to its full length. */
      aimDrawSeconds: 0.62,
      /** Held at full draw, then released. */
      aimHoldSeconds: 0.16,
    },

    /**
     * When the AI spends a card. Thresholds, not preferences — see
     * `ai/cardPolicy.js`, where each of these is argued for.
     *
     * The five are 궤적 · 혼란 · 원모어 · 강타 · 침묵, which is what
     * `CardHands.DRAWABLE` actually contains. 스왑 is shelved out of `CARDS` and
     * cannot reach a hand, so there is deliberately no rule for it.
     */
    cards: {
      /**
       * Neither 강타 nor 궤적 has a threshold any more. Both are decided by
       * simulating the shot — `ai.boostPool` for the boosted one, `spreadProbes`
       * for the cone — so what used to be tuned here is now measured per turn.
       *
       * 강타's window was a band on `reachShortfall`, which turned out to read a
       * fact about the board rather than about the shot. 궤적's was
       * `trajectoryMaxGap`, a score-gap tiebreak, from when the card was thought
       * to be worth only a nudge; it is now played whenever precision alone
       * opens a kill, at any range. Both are gone rather than retuned, and their
       * panel sliders with them — a dial that moves a number nothing reads is
       * worse than no dial.
       */
      /** 원모어 needs the turn to be worth repeating, when it is not a kill. */
      oneMoreMinScore: 25,
      /** 혼란 when (my exposure − theirs) clears this. Positive = I am worse off. */
      chaosThreatMin: 0.12,
      /** 침묵 needs the opponent to actually be holding something. */
      silenceMinCards: 2,
      /**
       * 철벽 when my worst-placed cap is at least this far out, 0..1.
       *
       * `exposureOf` is a CHEBYSHEV fraction of the brink, so 0.6 is a cap three
       * fifths of the way to the edge it would fall off — far enough that one
       * good hit finishes it, near enough that it turns up regularly rather than
       * only in already-lost positions.
       *
       * On the worst cap, not the average, and `cardPolicy` says why: the brace
       * covers every cap the player owns, so its value is set by the one that is
       * actually in trouble.
       *
       * Football reads this against a different quantity — the pressure on the
       * net rather than a distance to a rim — and overrides it below.
       */
      resistEdgeMin: 0.6,
      /**
       * How many cards the AI may spend in one turn.
       *
       * The brief said one, written when the cards were judged independently.
       * Two of them are complementary rather than alternative — 강타 buys the
       * reach to arrive and 궤적 removes the spread that reach costs — and a
       * long kill often needs both. `Match` allows it: a non-physical effect
       * returns the turn to AIM, so a second card is legal.
       *
       * 2 rather than unlimited because each one costs a full reveal animation,
       * and a turn with four of them stops being a turn and becomes a cutscene.
       */
      maxPerTurn: 2,
    },

    /**
     * Per-mode overrides. A key that is absent here uses the common value.
     *
     * ── the two modes are not the same size of problem ─────────────────────
     * Football is 4v4 plus a ball — nine bodies against knockout's six — and its
     * weights are in different units entirely: `goal` against `dropOpponent`,
     * world units of ball travel against squared edge fractions. Folding them
     * into one block would give every survival number a second, unrelated
     * meaning, and re-tuning either mode would silently re-tune the other.
     *
     * A mode that overrides nothing gets `config.ai` back BY IDENTITY, so the
     * survival AI reads exactly what it read before this block existed and its
     * panel sliders stay live mid-search. See `ai/strategy.js: aiTuning`.
     */
    perMode: {
      football: {
        /**
         * ── the shooter cap is four, which is every cap ────────────────────
         * A side has four here. So the ranking in `footballCandidates` never
         * actually cuts anybody at the shipped value and the "which caps may
         * shoot" question is moot — it only bites if this slider comes down,
         * and then nearest-the-ball is the right order.
         *
         * ── and the fan is NARROWER than survival's, from measurement ───────
         * A cap aimed dead at a ball 9.6 units away hit it on 96 of 96 draws
         * through the real error cone, which is 1.5° to 7.0° at these powers.
         * Aiming is not what fails in this mode; choosing what to aim AT is. So
         * the budget goes on more targets rather than a wider spread around
         * each, and `angleSpreadDeg` comes down from 9 to 6.
         */
        sampling: {
          maxShooters: 4,
          anglesPerTarget: 3,
          angleSpreadDeg: 6,
          powerSteps: 5,
          /**
           * ── the same 64 knockout uses, and that is a measurement ──────────
           * This was set to 96 on the reasoning that football generates several
           * hundred candidates where knockout generates a few dozen, so a bigger
           * slice of the list ought to be worth having. That reasoning is wrong,
           * and the numbers say so plainly. Two AI-vs-AI matches per row, 60
           * turns each, changing only this:
           *
           *     maxCand   goals  own   ball%  idle%   eval/turn   think p50/p95
           *          48       3    0      75     18          72   1767 / 3035 ms
           *          64       4    0      88      7          89   2152 / 3132 ms
           *          80       2    0      83     12         105   2525 / 3759 ms
           *          96       4    0      83      8         121   2745 / 4314 ms
           *
           * 64 is the best row on every quality axis at once — most goals, most
           * turns that touch the ball, fewest that do nothing — and it costs 27%
           * less search than 96 to get there. Above it the extra candidates are
           * refinements of plans the search had already found, and they buy
           * nothing while pushing the tail out.
           *
           * 48 is where it starts to hurt: ball contact falls to 75% and idle
           * turns nearly triple, which is the generator's later waves getting
           * cut off rather than a worse choice among what survived.
           *
           * It also lands football's search time on knockout's: 2152 ms against
           * 2157 ms measured on the same machine, at 89 rollouts a turn against
           * 88. So the AI takes the same time to move in both modes, which is
           * what "drop이 넉아웃 AI 대비 증가하지 않음" asks for — and it is reached
           * by choosing the candidate count, never by opening `totalBudgetMs`.
           *
           * Affordable at all because a football rollout is CHEAPER than a
           * knockout one: measured settle length over 384 shots, p50 63 steps
           * against knockout's 92. The pitch has more friction and the caps
           * travel a third as far.
           */
          maxCandidates: 64,
        },

        /**
         * Hard ceiling on a single rollout, in physics steps.
         *
         * ── football's turns are shorter in the middle and much longer in the
         * tail, and the tail is where the goals are ─────────────────────────
         * Measured over 384 shots from the kickoff:
         *
         *     mode      p50   p90   p95   p99   max   over 240
         *     football   63    79    88   298   324    10/384
         *     knockout   92   144   149   162   175     0/288
         *
         * The common 240 truncates 2.6% of football rollouts, and they are not a
         * random 2.6%: a rollout still running at 240 steps is a ball still
         * ROLLING, which is exactly the shot that is on its way into a net. One
         * verified own goal in the accuracy test took 410 steps to trickle in.
         * Truncating there would score a scoring shot as "ball somewhere near
         * the goal" and the search would never choose it.
         *
         * 420 covers p99 with room, and costs almost nothing on average because
         * the median is 63: the mean rises from about 74 steps to about 76.
         */
        maxRolloutSteps: 420,

        /**
         * What a pitch is worth. Every term is measured or argued; see
         * `ai/footballEvaluate.js`, where each one is defined.
         *
         * ── the scale is set by the two facts at the top ───────────────────
         * A goal has to dominate every amount of position, exactly as
         * `dropOpponent` does next door and for the same reason: a shot that
         * scores must never lose to a shot that tidies. The largest positional
         * total a candidate can realistically reach is `ballAdvance` at its
         * measured ceiling — the best single strike moves the ball 31 units —
         * so about 340, plus a full `ballThreat` at 200. `goal` at 2600 is
         * roughly four times that combined, which is the margin the survival
         * file found it needed.
         */
        weights: {
          /** Their net. The win condition, and it must WIN. */
          goal: 2600,
          /**
           * Mine. Above `goal`, and the asymmetry is structural rather than
           * taste: conceding hands over the score AND the kickoff
           * (`FootballRules._kickoffBy`), so the opponent moves next as well. A
           * goal for and a goal against are not mirror images.
           *
           * The same shape as `dropOpponent` 260 against `loseOwn` 300: the AI
           * will not trade a goal for an own goal, it has to come out ahead.
           */
          ownGoal: 3200,
          /**
           * Per world unit the ball got closer to their net. THE gradient.
           *
           * 11 rather than something rounder because of what it has to buy: a
           * measured good strike moves the ball 15 to 31 units, so a typical
           * attacking turn is worth 165 to 340 — the same order as `ballThreat`
           * and `goalUncovered`, and an order below a goal. Raise it and the AI
           * hoofs the ball anywhere forward; lower it and the mode's only
           * gradient stops being able to outvote a tie-break.
           */
          ballAdvance: 11,
          /**
           * Per world unit it came back toward mine. Above `ballAdvance`.
           *
           * Not the same measurement with a sign — these are distances to two
           * different goals, so a ball shoved sideways scores near zero on both.
           * Heavier because the two are not symmetric in consequence: ground
           * given up in front of my own net is where own goals come from.
           */
          ballRetreat: 15,
          /** Can I score NEXT turn from this position, 0..1. */
          ballThreat: 200,
          /** Can they, 0..1. Heavier, same asymmetry as the goal pair. */
          foeBallThreat: 260,
          /**
           * How much of the road to my net nobody of mine is covering, 0..1.
           *
           * The term that makes the AI defend, and the one with no survival
           * counterpart. It is what stops the keeper being fired upfield and
           * leaving an open goal — priced below a conceded goal and above any
           * single attacking gain, so abandoning the line is a move the search
           * will make when it wins the ball and not otherwise.
           */
          goalUncovered: 180,
          /**
           * My caps within a strike of the ball, 0..1 each. A tiebreaker.
           *
           * ── it has a CUTOFF, and the cutoff is deliberate ─────────────────
           * `supportRadius` is 14, so a cap 30 units from the ball scores
           * nothing here and gains nothing by closing to 22. That looks like a
           * missing gradient and was measured as a suspect: a ball beyond one
           * flick of every cap gives the search no reason to walk toward it.
           *
           * Measured over three AI-vs-AI matches, splitting the brief's
           * "무의미 턴" by whether the ball was within a full-power flick
           * (20.9 units) of ANY of that player's caps when the turn opened:
           *
           *     seed        idle    of which the ball was reachable
           *     5e6f7a8b      7%                                 7%
           *     11117777     18%                                 8%
           *     2b2b9999      5%                                 3%
           *
           * So the turns that look idle in the worst seed are mostly turns where
           * NOTHING could have touched the ball — the pitch is 64 long and a cap
           * travels 21 — and the rate of "could have reached it and did not"
           * sits at 3–8% across all three. There is no missing gradient to add;
           * there is a pitch longer than a flick.
           *
           * What the AI does on those turns is drop back and cover, because
           * `goalUncovered` and `foeBallThreat` are the only terms still moving.
           * That is the right football answer to a ball you cannot contest, and
           * it comes out of the existing terms rather than out of a new one.
           */
          shooterSupport: 10,
          /**
           * Per own cap left outside the lines.
           *
           * NOT a loss: `FootballRules` says plainly there is no out for a cap
           * in this mode, so it is still on the field and still selectable. It
           * is merely somewhere useless. Priced as a nudge, nowhere near the
           * price of losing one — because it has not lost one.
           */
          capStranded: 25,
          /** Per orb my own cap reaches, and per orb theirs does. As knockout. */
          orbGain: 5,
          orbGift: 34,
        },

        /**
         * The distances the pitch terms measure with. World units, on a pitch
         * that is 41.4 x 64.0 with a 10.7-wide goal mouth.
         */
        pitch: {
          /**
           * How far away a cap can still be a threat to the ball.
           *
           * Measured cap travel on this surface: 0.42 -> 9.4 units, 0.61 ->
           * 14.5, 0.81 -> 18.7, 1.00 -> 20.9. So 20 is "one full-power flick
           * away" — past it the cap has spent the whole shot arriving and
           * cannot also drive the ball anywhere. Note how much shorter this is
           * than knockout's 26: the pitch has more friction than the board.
           */
          reach: 20,
          /**
           * How far from a net the ball has to be for a strike to reach it.
           *
           * The measured ceiling for ball travel off one cap is 31 units, and
           * that is the best case with everything lined up. 26 is the honest
           * figure for a shot that also has to be accurate enough to go in.
           */
          strikeRange: 26,
          /**
           * How near my net the ball has to be before the goal counts as
           * exposed — and the same radius that puts `clear` and `block` into
           * wave 0.
           *
           * 22 is about a third of the pitch's length, which is the defensive
           * third by the usual reckoning, and comfortably outside the penalty
           * area (10 deep at this scale) so the AI starts defending before the
           * ball is already in the box.
           */
          coverRange: 22,
          /**
           * How far off the goal-to-ball line a cap still counts as covering.
           *
           * 4.0, against a cap radius of 1.6 and a ball of 0.96: a cap covers a
           * corridor about two and a half cap-radii wide, which is roughly what
           * it can actually intercept given that the striker has to come
           * through it. Widen it and one cap "covers" the whole mouth from the
           * side; narrow it and nothing ever counts as defended.
           */
          coverWidth: 4,
          /** How near the ball a cap has to be to count as support. */
          supportRadius: 14,
        },

        /**
         * 원모어's threshold, on football's scale rather than knockout's.
         *
         * The common value is 25, which is meaningful against survival scores
         * where a whole cap is 260. Here `ballAdvance` alone makes 25 on two
         * units of ball movement, so the common figure would play the card on
         * every turn that touched the ball. 180 is about a sixth of a good
         * attacking turn — the turn has to be genuinely worth repeating.
         */
        cards: {
          oneMoreMinScore: 180,
          /**
           * 철벽's threshold on football's scale rather than knockout's.
           *
           * The common 0.6 is a fraction of the distance to a rim, and there is
           * no rim here — `myEdgeRisk` is `goalThreat`, a product of two 0..1
           * terms, so it lives an order of magnitude lower and 0.6 would mean
           * the card was never played at all. 0.18 is comparable to the value
           * 혼란 tests the DIFFERENCE of two of these against (`chaosThreatMin`
           * 0.12), which is the only other rule reading this quantity.
           */
          resistEdgeMin: 0.18,
        },
      },
    },

    /**
     * Draw the top N evaluated trajectories, with their scores. Panel only.
     *
     * "이게 있어야 AI가 왜 그 수를 뒀는지 알 수 있다." It is the only window into
     * a decision that is otherwise 48 numbers computed and thrown away — a move
     * that looks wrong is unreadable without seeing what it was chosen OVER.
     *
     * Off by default because collecting the paths costs an array per candidate
     * and the lines are unreadable during actual play.
     */
    showCandidates: false,
    candidateCount: 5,
    /** Record one path point every N physics steps. As `preview.sampleEvery`. */
    candidateSampleEvery: 4,
  },

  /**
   * The in-game readouts, which are meshes rather than DOM. See `ui/HudLayer`.
   *
   * Positions are NOT here: they are derived from the overlay frame's edges in
   * `HudLayer.layout`, and what is exposed is an OFFSET from where that put
   * them. A hard-coded world coordinate would stop being right the moment the
   * frame or a plate's size changed.
   */
  ui: {
    /**
     * The HUD's own vertex snap, separate from `view.vertexSnap`.
     *
     * 1 — the same as everything else on screen — because exempting the readout
     * from the look is the thing this whole conversion exists to stop doing.
     * It is a dial for one specific failure: if the score turns out to shimmer
     * between two readings as the camera drifts, this comes down until it does
     * not, and nothing else on screen goes smooth with it.
     */
    vertexSnap: 1,
    /**
     * Texels per frame pixel for every HUD plate.
     *
     * UI 텍스처를 프레임 픽셀의 몇 배로 그릴 것인가.
     *
     * ── 1 이었고, 그 이유가 사라졌다 ──────────────────────────────────────
     * 예전 근거는 "640x480 타겟에서 텍셀 하나가 프레임버퍼 픽셀 하나에 얹혀야
     * 임계 처리된 글자가 회색으로 리샘플되지 않는다" 였다. 저해상도 타겟도
     * 임계 처리도 없다. 이제 UI 는 기기 해상도에 그대로 그려지므로, 1 로 두면
     * 3배 화면에서 프레임 픽셀 하나가 화면 픽셀 세 개가 되고 글자가 흐려진다.
     *
     * `main.js` 가 부팅과 리사이즈 때마다 devicePixelRatio 와 캔버스 크기에서
     * 계산해 덮어쓴다 — 여기 값은 그 전까지의 기본값이자 패널이 손으로 바꿀 때의
     * 출발점이다. 계산식과 상한은 그쪽 주석에 있다.
     */
    textureScale: 2,

    /** Seconds for the score to fade in or out as the zoom crosses. */
    scoreFadeSeconds: 0.22,
    /** Length of the emphasis beat when the score changes. Under 0.3, per brief. */
    scorePulseSeconds: 0.26,
    /** How much bigger it gets at the peak of that beat. */
    scorePulseScale: 0.16,
    /** Panel override: 'auto' follows the zoom, 'on'/'off' force it. */
    forceScore: 'auto',

    /**
     * How long the HUD and the card hand take to clear out while a shot is
     * being drawn, and to come back after it.
     *
     * Short — this happens on every single press that grabs a cap, so it has to
     * be over before the player has finished the pull. Not zero: a hand that
     * blinks out is a flicker, and a flicker on every press reads as a fault.
     */
    aimHideSeconds: 0.1,

    /**
     * How faint the buttons go when the board is zoomed in.
     *
     * A VISUAL weight only. The hit quads know nothing about it — see
     * `HudLayer._updateButtons` — so a dimmed 나가기 is exactly as pressable as
     * a bright one.
     */
    dimOpacity: 0.4,
    /** Extra pixels of give around a button's hit quad, for thumbs. */
    hitMargin: 10,

    scoreOffsetX: 0,
    scoreOffsetY: 0,
    exitOffsetX: 0,
    exitOffsetY: 0,

    /** Draw the press targets. For checking the give is where it looks. */
    showHitAreas: false,
  },

  /**
   * The winning sequence, and the screen it lands on.
   *
   * ── every number here is presentation, and that is load-bearing ───────────
   * Nothing in this block can reach the simulation. The sequence runs on the
   * RENDER clock, off a match that has already finished and whose physics has
   * stopped stepping — see `MATCH_STATE.OVER` in `Match`. So a slider dragged
   * mid-animation changes what is on screen and cannot change who won, which is
   * why the stage lengths are safe to expose at all.
   *
   * ── the sequence was a cap fight and is now a broadcast ────────────────────
   * There were five stages and they replayed the game: the losing cap floated,
   * the winning one charged across the frame, they collided with a screen shake
   * and a white flash, the loser flipped out and the winner sprang back. Every
   * number for all of that lived here — entry angles, trail spacing, ring radii,
   * spring constants, shake frequency — and it is gone.
   *
   * Three things were wrong with it and only the last one is about taste. It
   * replayed, non-interactively, the exact thing the player had just spent a
   * match doing with their hands. It knew nothing about the MODE, so a football
   * match won on goals and a curling match won on a tiebreaker both ended with
   * the same two caps hitting each other. And it was visually stranded: 2D
   * sprite caps on a tilted ground with afterimage trails, shaking the frame by
   * 14 pixels at 26 Hz, which nothing else in this game looks remotely like.
   *
   * What replaces it is what sports coverage does. The board stays on screen,
   * the camera pushes in on whatever decided the match, the letterbox closes
   * over it, and the result is stated with the mode's own number in it. Four
   * stages, about 2.85s at the defaults to a screen you can press, and the same
   * frame the match OPENED in — see `core/Cinematic.js`.
   */
  victory: {
    // ── stage lengths ────────────────────────────────────────────────────
    /**
     * 1. The board holds and the camera pushes in on what decided it.
     *
     * Long, and it is the one stage that has to be. This is the replay — the
     * finishing position is the last thing the match said, and a push-in that
     * arrives before the eye has followed it is a cut with extra steps. Sports
     * coverage holds the shot for about this long before it cuts to a caption,
     * which is exactly the structure being copied.
     */
    freezeSeconds: 1.1,
    /** 2. The letterbox closes over it. */
    barSeconds: 0.4,
    /** 3. The result, in the band. */
    resultSeconds: 0.9,
    /** 4. The bars retreat and the two buttons come up. */
    releaseSeconds: 0.45,

    // ── the push-in ──────────────────────────────────────────────────────
    /**
     * How much tighter the camera frames during stage 1, as a multiplier on
     * whatever zoom the match ended at.
     *
     * A multiplier and not an absolute, because where the player left the view
     * is part of what they were looking at — pulling to a fixed framing would
     * undo their own zoom at the moment it mattered most. 1.35 is about one
     * wheel notch and a half: plainly a move IN, and not so far that a knockout
     * board's last cap fills the frame.
     */
    pushZoom: 1.35,
    /**
     * The celebratory beat on the winning caps, in seconds.
     *
     * `CardFx.play('onemore', winner, …)` and nothing else — the glint and the
     * one soft ring the 원모어 card already draws over a player's caps, played
     * with no card behind it. Reusing that vocabulary is the whole of the
     * decoration budget for this screen: a second effect system for one beat is
     * how a result screen ends up looking like a different game.
     *
     * The flourish's own timing is `CardFx`'s and stays there — see
     * `VictoryClock`'s note on where the frame-counting discipline went.
     */
    sparkleSeconds: 0.55,

    // ── the darkened game behind ─────────────────────────────────────────
    /**
     * How far down the board goes once the bars are shut.
     *
     * 0.72 while the screen was a cap fight in front of it; the board was
     * scenery then and it is the SUBJECT now — the camera has just pushed in on
     * the thing that decided the match and the whole point is that it stays
     * legible under the result. 0.34 is enough to seat white type on it and far
     * enough from a curtain that the finishing position still reads.
     *
     * Not applied until stage 2. Nothing dims during the push-in: that stage is
     * a replay of the match, and a replay behind a veil is a memory.
     */
    bgOpacity: 0.34,
    bgFadeSeconds: 0.3,

    // ── the bubbles ──────────────────────────────────────────────────────
    /**
     * Streams of carbonation up the frame under the result. See `ResultFizz`.
     *
     * Bottles, water and bubbles are this project's celebration vocabulary and
     * confetti is not — "색종이를 쓰지 마라" — so the thing that rises when
     * somebody wins is the same thing that rises when the menu's bottle is
     * shaken, running the same growth-and-rise law.
     */
    bubbleCount: 30,
    /** Overall brightness of them. The menu's own is `fizzStrength`. */
    bubbleStrength: 0.9,

    // ── the text and the buttons ─────────────────────────────────────────
    /** How much bigger the winner line gets at the peak of its entrance beat. */
    textPulseScale: 0.16,
    /**
     * Frame pixels from the middle for the winner line, and for the number
     * under it.
     *
     * Both inside the letterbox band by construction at the authored frame: the
     * band is ±184 of 480 and the lowest thing here is the score plate's bottom
     * edge at −98. A bar is a margin, not a UI surface, and nothing may be
     * written into one.
     */
    textY: 44,
    scoreY: -56,
    /** And the buttons, which arrive after the bars have gone. */
    buttonY: -178,
    /** Extra pixels of give around each button's hit quad, for thumbs. */
    hitMargin: 12,
    /** Draw the press targets, exactly as `ui.showHitAreas` does. */
    showHitAreas: false,
  },

  /**
   * The sound system's mix, and nothing else.
   *
   * ── NOTHING IN HERE CAN REACH THE SIMULATION ────────────────────────────
   * Stated the way `cardFx` and `victory` state it, and it is stronger here than
   * for either of them: the audio layer only ever READS the world — velocities,
   * narrow-phase contacts, match state — and its randomness comes from its own
   * stream (`audio/audioRng.js`), never from `nextSeed()`. Every value below
   * changes what is heard and nothing else. Same seed, same input, same result,
   * whatever any of these are set to.
   *
   * ── the PLAYER's settings are not here ──────────────────────────────────
   * Master volume and mute live behind `audio/AudioSettings.js`, because they
   * are persisted and `CONFIG` is not written to storage anywhere in this
   * project. What is here is what the developer drags on the panel.
   *
   * ── and neither are the sounds ──────────────────────────────────────────
   * The per-sound parameter tables live in `audio/soundBank.js`. They have to:
   * `deepAssign` treats an ARRAY as a leaf and assigns it by reference, so a
   * sound definition holding one would alias `CONFIG_DEFAULTS` after a single
   * press of 전체 리셋 and the next panel edit would corrupt the defaults. The
   * bank keeps its own frozen copy and its own reset, exactly as `PALETTE` does.
   */
  audio: {
    /**
     * A trim under the player's own master, so the shipping loudness can be set
     * without moving anybody's saved slider. 1 = whatever they chose.
     */
    masterTrim: 1,

    /**
     * Per-category trims, multiplied under the master.
     *
     * Keyed by the bus names in `audio/categories.js`. A keyed object rather
     * than an array, for the `deepAssign` reason in the block header above.
     */
    category: {
      /** The continuous beds: sliding, the stun hum, the orb shimmer, the shake. */
      ambient: 0.75,
      impact: 1,
      /** The mark editor's brush, which the brief singles out as fatiguing. */
      draw: 0.6,
      ui: 0.85,
      orb: 1,
      card: 1,
      stinger: 1,
    },

    // ── the tone ───────────────────────────────────────────────────────────
    /**
     * 공간. 예순 개의 소리를 한 곳에 있게 만드는 장치.
     *
     * ── 크러셔가 하던 일을 물려받았다 ─────────────────────────────────────
     * 아래 `crushBits` 주석이 원래 근거를 적어 두었다: 5비트 색 양자화기의 오디오
     * 절반. 그 양자화기가 없다. 지금 화면은 유리와 물과 빛이고, 그 등가물은
     * 양자화 잡음이 아니라 짧고 밝은 잔향이다 — 유리잔 안에서 나는 소리는 어디서
     * 나든 같은 방에서 난다.
     *
     * 카테고리마다 다른 이유: UI 클릭에 잔향을 먹이면 화면이 헐거워지고, 충돌음에
     * 안 먹이면 판이 진공에 있는 것으로 들린다. 브러시는 손 아래에서 연속으로
     * 울리는 유일한 소리라 0 이다 — 거기에 꼬리를 붙이면 지시서가 말한 "과하면
     * 극도로 피로하다" 가 그대로 일어난다.
     */
    space: {
      /** 임펄스 길이. 방 하나만큼, 홀이 아니라. */
      seconds: 0.42,
      /** 꼬리의 감쇠 지수. 클수록 빨리 죽는다. */
      decay: 3.2,
      /** 전체 보내기 배수. 0 이면 공간이 통째로 꺼진다. */
      mix: 1,
      category: {
        ambient: 0.22,
        impact: 0.3,
        draw: 0,
        ui: 0.12,
        orb: 0.34,
        card: 0.26,
        stinger: 0.4,
      },
    },

    /**
     * Bit depth of the global crusher, in bits. 16 switches it off entirely.
     *
     * ── 7 이었고, 16 이 됐다 ─────────────────────────────────────────────
     * 원래 근거: "5비트 색 양자화기의 오디오 절반 — `RetroPass` 참조. 7 은 잡음
     * 버스트에서 결이 분명히 들리면서 조용한 UI 블립이 버즈가 되지는 않는 대역이다."
     *
     * `RetroPass` 는 PHASE 1 에 삭제됐다. 양자화기도, 디더 격자도, 저해상도
     * 프레임버퍼도 없다. 화면이 유리가 된 마당에 소리만 콘솔로 남으면 그 둘이 서로
     * 다른 게임의 것으로 들린다.
     *
     * 장치는 남긴다. 코드도 워클릿도 실재하고 패널의 다이얼로 살아 있으므로,
     * 지우는 대신 유니티로 둔다 — 16 에서 `_shaper.curve` 는 `null` 이고 이것은
     * 진짜 무처리다(감쇠도 지연도 없다).
     */
    crushBits: 16,
    /**
     * Sample-and-hold rate, in Hz. At or above the device rate it does nothing.
     *
     * 16000 이었다. 위와 같은 이유로 유니티다 — 48 kHz 는 어떤 기기에서도
     * `holdFrames = 1`, 즉 아무것도 붙잡지 않는다.
     */
    crushRateHz: 48000,

    // ── the physical mapping ──────────────────────────────────────────────
    /**
     * How far a pitch may wander from the written value, either side, as a
     * fraction. "같은 소리가 반복되지 않게 피치를 미세하게 랜덤 변조 (±5% 정도)."
     * Each sound scales this by its own `jitter`.
     */
    pitchJitter: 0.05,
    /** Time constant for a loop's gain and pitch writes. See `SynthVoice.set`. */
    smoothingSeconds: 0.02,

    // ── overload control ──────────────────────────────────────────────────
    /** Voices that may sound at once, across everything. */
    maxVoices: 14,
    /** And of any one sound id, unless its own definition says otherwise. */
    voicesPerSound: 3,
    /** Multiplies every definition's cooldown. 0 disables cooldowns entirely. */
    cooldownScale: 1,
    /**
     * How far past its cooldown a repeat is still ducked, as a multiple of the
     * cooldown itself, and how far down. A chain should taper rather than
     * machine-gun and then stop dead. See `VoicePool.request`.
     */
    repeatWindowScale: 3,
    repeatDuck: 0.45,

    // ── collisions ────────────────────────────────────────────────────────
    /**
     * How the contact observer turns a frame of physics into a few sounds.
     *
     * ── the thresholds are in cm/s of velocity CHANGE ──────────────────────
     * A cap resting on the board is in permanent contact carrying about 18
     * g·cm/s of impulse, so a level test fires continuously; what separates a
     * hit from a rest is that a hit CHANGES a velocity. `gravityBias` is added
     * to the floor in proportion to how many physics steps the frame ran, since
     * a body in free fall legitimately gains 8.2 cm/s per step.
     */
    impact: {
      /** Minimum velocity change to count as a hit at all, in cm/s. */
      minDeltaV: 26,
      /** Added to that per physics step in the frame. Gravity's own share. */
      gravityBias: 9,
      /** The change that maps to full intensity. Above this it is just loud. */
      fullDeltaV: 320,
      /**
       * How many impacts one frame may sound, loudest first.
       *
       * "연쇄 충돌은 가장 강한 충돌 몇 개만 소리를 낸다. 전부 내면 소음이다."
       * Three is enough to read as a chain and few enough to stay a chain.
       */
      perFrame: 3,
      /** Cap-on-board landings are real but dull. Their share of a wall hit. */
      groundGain: 0.5,
      /**
       * How far apart two caps may be and still be judged to have hit each
       * other when the narrow phase has already let go of the pair, in
       * multiples of the cap radius. The fallback classifier; see `ContactAudio`.
       */
      pairRadius: 2.6,
    },

    /**
     * The sliding bed: how cap speed becomes level.
     *
     * `full` is the speed at which it reaches its own volume; below `min` it is
     * silent, so a board that is nearly at rest is actually at rest.
     */
    slide: {
      minSpeed: 14,
      fullSpeed: 190,
      /** Level at full speed, before the category trim. */
      gain: 0.5,
      /** Pitch at full speed. Below it the bed drops toward 1. */
      rateAtFull: 1.5,
    },

    /** A cap turning over. Angular speed, in rad/s, that counts as a flip. */
    flipMinSpin: 3.0,
    /**
     * A cap falling off the board. World y, in cm, below which it is falling.
     *
     * The board's top surface is y = 0 and the knockout pit's ceiling is at -6,
     * so anything under this is over the edge and on its way down.
     */
    fallY: -3.0,

    // ── the continuous UI sounds ──────────────────────────────────────────
    /**
     * ── the bow has no bed, and no clamp blip ──────────────────────────
     * Both existed and both were removed on the player's own instruction. A
     * sustained tone under every aim, and a chirp every time the pull crosses
     * the clamp, are the two sounds a player hears most in this game — which is
     * exactly what makes them the two that wear out first. Aiming is silent now
     * apart from the grab and the release.
     */

    /** The stun hum, per confused player. Deliberately very quiet. */
    chaosGain: 0.3,
    /**
     * ── and the mark editor draws in silence ───────────────────────────
     * A rate-limited brush tick was built, tuned and then removed on the
     * player's instruction, together with its settings-screen toggle. The brief
     * warned it would be fatiguing; it was.
     */
    /**
     * The menu bottle being worked up. Level at a fully wound shake.
     *
     * Higher than it reads on a meter, and deliberately. The sound is a thin
     * band of noise around 4-5 kHz with nothing under it — measured, its energy
     * below 500 Hz is about 1.4% of its energy above 2 kHz — and a band that
     * narrow and that high is perceived far quieter than the same peak spread
     * across the spectrum. The previous version did not need this because it had
     * a 62 Hz sawtooth doing the work, which is exactly why it sounded like an
     * engine.
     */
    shakeGain: 0.55,
  },

  view: {
    /**
     * Bloom, over the WORLD only.
     *
     * The scene is drawn at the device's own resolution now — there is no
     * internal low-resolution target to name, which is what `renderMode` used to
     * pick — and the one post-processing pass in the chain is this.
     *
     * `threshold` decides WHAT glows and is the dial to reach for first: below
     * about 0.6 it starts catching diffuse surfaces and the whole frame hazes.
     * `strength` and `radius` decide how much and how far. See `core/Composer.js`
     * for why this is deliberately visible rather than the near-invisible bloom
     * a restrained direction would use.
     */
    bloom: {
      enabled: true,
      threshold: 0.72,
      strength: 0.45,
      radius: 0.6,
    },
    /**
     * 그래픽 품질 다섯 단계. **개발자의 표이고, 저장되지 않는다.**
     *
     * 플레이어가 고른 것은 `core/GraphicsSettings.js` 의 문서에 있다 — 여기 있는
     * 것은 그 숫자 하나를 무엇으로 푸는가이고, `CONFIG` 는 이 프로젝트 어디에도
     * 저장되지 않는다는 규율(`AudioSettings.js` 머리말)이 그대로 적용된다.
     * 부팅 경로가 이 배열을 `core/quality.configureQuality` 에 꽂는다.
     *
     * ── `view` 아래인 것이 온라인 안전성이다 ─────────────────────────────────
     * `SYNCED_CONFIG_PATHS`(`net/protocol.js`)는 physics·shot·turn·cards·orbs·
     * curling·football·knockout·arena·cap 뿐이고 `view` 는 없다. 그러니 여기
     * 어떤 값을 바꿔도 `configHash` 가 움직이지 않고, 품질이 다른 두 기기가 서로
     * 붙는다. 반대로 말하면 이 표에서 시뮬레이션 값을 건드리는 순간 그 검사가
     * 못 잡는 비호환이 생긴다 — 특히 `ball` 과 `collider` 는 목록에 없으면서
     * `RolloutArena._baseDamping()` 이 읽는 값이다. 여기 그 이름이 나오면 안 된다.
     *
     * ── 마지막 칸은 **오늘 출시되는 그림 그대로**여야 한다 ───────────────────
     * 품질 설정은 깎는 장치이지 더하는 장치가 아니다. 최대를 지금보다 위로 올리면
     * 기본값을 쓰는 모든 기기의 화면이 바뀌는데, 그건 품질 노브가 아니라 아트
     * 변경이다. 그래서 각 열의 마지막 값은 이 파일과 `core/` 가 오늘 쓰고 있는
     * 값과 같고, `core/quality.js` 의 `QUALITY` 리터럴이 같은 값을 들고 있다.
     * 둘이 어긋나면 표를 고쳐라.
     *
     * ── 표에 **없는** 두 줄, 그리고 없는 이유 ────────────────────────────────
     * `PCFSoftShadowMap` 은 three 0.185 에서 폐기됐다 — 지정하면 콘솔에 경고를
     * 남기고 `PCFShadowMap` 으로 조용히 대체된다(`WebGLShadowMap.js`). 부드러움은
     * `sun.shadow.radius` 가 담당하므로 그림자 줄은 **크기만** 티어에 건다.
     * `Viewport` 의 같은 자리에 이미 같은 근거가 적혀 있다.
     *
     * 대기 원근/거리 페이드는 이 프로젝트에 존재하지 않는다. 씬에 `Fog` 가 없고
     * 모든 재질이 `fog: false` 로 만들어진다. 없는 효과를 티어를 채우려고 새로
     * 만드는 것은 품질 노브가 아니라 신규 아트다.
     *
     * ── `worldTexture` 는 최저에서만 실제로 문다 ─────────────────────────────
     * 이 프로젝트의 월드 텍스처는 넷이고 전부 512 로 저술되어 있다 —
     * `boardTexture`, `pitchTexture`, `metalTexture`, `cap/capTexture`. 상한이지
     * 목표가 아니므로, 512 인 티어부터 위로는 아무것도 달라지지 않는다. 실제로
     * 줄어드는 것은 최저의 256 한 칸뿐이다. 1024 를 위 세 칸에 적어 둔 것은
     * 저술 크기가 올라가는 날 상한이 먼저 걸려 있지 않게 하기 위해서다.
     *
     * ── 실측 (§8.5) ──────────────────────────────────────────────────────────
     * M3 Pro / Chrome / 알까기, 에뮬레이트 뷰포트 3400x2300. 이 크기는 일부러
     * 터무니없다 — 실제 창(716x866 캔버스, dpr 2)에서는 **다섯 티어가 전부
     * 120 fps 로 vsync 에 붙어** 구별되지 않기 때문이다. 티어의 비용 차이를 보려면
     * GPU 를 실제로 병목으로 만들어야 하고, 아래가 그 상태의 값이다.
     * `MetricsOverlay`(lil-gui 패널은 숨김), 12초 관측:
     *
     *     티어    드로잉 버퍼    fps     1% low   drop   sat   tick
     *     최저    3067x2300     117.3    78.1      1     0    0.57 ms
     *     낮음    3834x2875      82.6    39.4      1     0    0.33 ms
     *     보통    4601x3450      33.2    11.5     16     0    0.43 ms
     *     높음    6134x4600      19.1     7.0    202     0    0.59 ms
     *     최대    6134x4600      13.9     5.0    188     0    1.10 ms
     *
     * `sat` 은 다섯 티어 모두 0 이다 — 물리는 어느 티어에서도 프레임 예산을
     * 놓치지 않았다. `drop` 이 아래로 갈수록 커지는 것은 프레임이 50 ms 클램프를
     * 넘긴 횟수이고, 28 메가픽셀을 그리라고 시킨 결과이지 결함이 아니다.
     *
     * 인접한 두 칸이 전부 유의미하게 다르다. 높음↔최대는 MSAA 2 대 4 뿐인데,
     * 축구에서 같은 버퍼(4266x3200)로 3회씩 재면 36.1 / 36.1 / 36.2 대
     * 28.7 / 28.6 / 28.7 fps 로 26% 차이다 — 아래 최대 칸의 주석을 보라.
     *
     * @type {Array<object>}
     */
    graphics: [
      // 0 · 최저
      {
        pixelRatioCap: 1,
        msaaSamples: 0,
        bloom: false,
        bloomScale: 0.25,
        shadowMapSize: 0,
        shadowCasters: 0,
        glass: false,
        clearcoat: 0,
        envSize: 48,
        anisotropy: 1,
        worldTexture: 256,
        bottleColumns: 32,
        fizzScale: 1 / 3,
        bokeh: 0,
      },
      // 1 · 낮음
      {
        pixelRatioCap: 1.25,
        msaaSamples: 0,
        bloom: false,
        bloomScale: 0.25,
        shadowMapSize: 0,
        shadowCasters: 0,
        glass: false,
        clearcoat: 0,
        envSize: 96,
        anisotropy: 1,
        worldTexture: 512,
        bottleColumns: 48,
        fizzScale: 0.5,
        bokeh: 0,
      },
      // 2 · 보통 — 블룸·그림자·환경맵·투과 유리가 한꺼번에 켜지는 칸이다.
      {
        pixelRatioCap: 1.5,
        msaaSamples: 2,
        bloom: true,
        bloomScale: 0.25,
        shadowMapSize: 1024,
        shadowCasters: 1,
        glass: true,
        clearcoat: 0,
        envSize: 128,
        anisotropy: 4,
        worldTexture: 512,
        bottleColumns: 72,
        fizzScale: 1,
        bokeh: 3,
      },
      // 3 · 높음 — MSAA 만 최대보다 한 단계 낮다. 아래 최대 칸의 주석을 보라.
      {
        pixelRatioCap: 2,
        msaaSamples: 2,
        bloom: true,
        bloomScale: 0.5,
        shadowMapSize: 2048,
        shadowCasters: 2,
        glass: true,
        clearcoat: 1,
        envSize: 256,
        anisotropy: 16,
        worldTexture: 1024,
        bottleColumns: 72,
        fizzScale: 1,
        bokeh: 6,
      },
      /**
       * 4 · 최대 — 오늘의 그림.
       *
       * ── 높음과의 차이가 캐스터뿐이면 안 됐다. 재 보고 알았다 ────────────────
       * 처음에는 지시서의 표 그대로 두 칸을 `shadowCasters` 하나만 다르게 뒀다.
       * 높음은 뚜껑·공·오브까지, 최대는 골대·펜스까지 그림자를 던진다 — 눈으로는
       * 골대 그림자가 잔디에 눕는 것으로 읽히므로 가짜 차이는 아니다. 그런데
       * **비용이 재지지 않았다.** 축구, 4266x3200 버퍼, 3회씩:
       *
       *     높음(캐스터 오브까지)   27.9 / 28.5 / 27.9 fps
       *     최대(캐스터 전부)       28.7 / 28.6 / 28.7 fps
       *
       * 최대가 오히려 미세하게 빨랐다. 즉 잡음 안이고, 이유는 분명하다:
       * `main.js` 가 `shadowMap.autoUpdate` 를 꺼 두고 `ArenaView.moved` 가
       * 움직인 프레임에만 켠다. 정지 화면에서 그림자 패스는 아예 돌지 않으므로,
       * 거기에 정적인 골대를 몇 개 더 넣어도 대부분의 프레임에서 0 이다.
       *
       * 그건 "다섯 단계 중 둘이 같다" 는 것이고, 지시서 §9.7 이 사용자를 속이는
       * 것이라고 부르는 상태다. 그래서 **MSAA 를 여기서 가른다**: 높음이 2,
       * 최대가 4. 최대는 오늘 출시되는 값 그대로이고 — 이 표의 규칙이다 — 높음이
       * 한 단계 내려간다. 리졸브 비용은 타겟 면적에 정직하게 비례하므로 재진다.
       * 캐스터 줄은 그대로 남는다: 재지지는 않아도 보이는 차이이고, 둘 다 있는
       * 편이 한쪽만 있는 것보다 낫다.
       */
      {
        pixelRatioCap: 2,
        msaaSamples: 4,
        bloom: true,
        bloomScale: 0.5,
        shadowMapSize: 2048,
        shadowCasters: 3,
        glass: true,
        clearcoat: 1,
        envSize: 256,
        anisotropy: 16,
        worldTexture: 1024,
        bottleColumns: 72,
        fizzScale: 1,
        bokeh: 6,
      },
    ],
    topDown: true,
    /**
     * Off by default now that the caps carry their panel artwork and the board
     * has a surface. The toggle stays, because stripping it all back is still
     * the fastest way to see what the physics is actually doing — but it is no
     * longer the only view in which the board is legible.
     */
    wireframe: false,
    /** Rapier's own collider outlines, over the top of the visual mesh. */
    colliders: false,
    /** Physics time scale. Changes step COUNT per frame, never step LENGTH. */
    slowmo: 1.0,
    /** Degrees above the board for the non-top-down camera. */
    cameraPitch: 52,
    /**
     * Fixed pitch for the football camera, in degrees above the pitch.
     *
     * Not the knockout camera's, and not on the same slider: the brief fixes the
     * football angle and gives the player zoom and nothing else. 72 is near
     * enough to top-down that judging whether a shot is on target is a question
     * about the pitch rather than about perspective, and far enough off it that
     * the goals, the fence and a cap's own thickness still read as objects with
     * height.
     */
    footballPitchAngle: 72,
    /**
     * Camera zoom, as a multiple of the whole-field fit. LIVE.
     *
     * 1 is the fit itself: at 1 the entire field is on screen, which is what the
     * minimum clamp is for in football. Knockout's floor is higher — see
     * `knockoutMinZoom`.
     *
     * It used to say "nothing resets this". A turn change does now: the two
     * players share a screen, and inheriting the last player's framing means
     * every turn opens by undoing it. See `GameCamera.faceTo` — the reset is a
     * request that any input cancels, not an assignment.
     */
    zoom: 1,
    maxZoom: 4,
    /**
     * The knockout board's zoom floor. 1 is the whole-board fit plus its margin.
     *
     * ── it is 1, so knockout is framed exactly as football is ───────────────
     * `GameCamera.FIT_MARGIN` builds 12% of breathing room into what "zoom 1"
     * means, and football's floor is 1 — so pulling all the way out there gives
     * the whole pitch with a band of air around it.
     *
     * This used to be 1.12, which SPENDS that margin precisely: the board's
     * outer edge landed on the top and bottom of the frame with nothing to
     * spare. Nothing was cropped, but nothing was framed either — the board ran
     * off both edges of the screen and the drop that decides the game sat
     * exactly on the boundary. It was chosen to fill the frame, on the grounds
     * that a square board in a 4:3 window leaves black at the sides and there
     * is nothing outside the board worth looking at.
     *
     * That trade is off. Filling the frame is not worth losing the margin, and
     * the two modes reading differently at the same "zoomed all the way out"
     * was the part that actually cost something.
     *
     * The side bars are wider for it and that is inherent: a square board is
     * bound by its HEIGHT in a 4:3 frame, so the width it leaves over is the
     * shape of the board, not a framing choice. No zoom removes them.
     *
     * ── and then the camera became rotatable, which cost 41% ────────────────
     * A turning camera is framed by the CIRCLE the field fits in rather than by
     * the field — it has to stay on screen at every bearing — and a square's
     * diagonal is 1.414 times its side. So enabling the turn shrank the board
     * from 0.893 of the frame's half-height to 0.631, against football's 0.739.
     * Football pays the same toll and barely notices it, because a 105:68
     * rectangle's diagonal is only 1.19 times its length.
     *
     * 1.10 is the largest floor that still keeps the WHOLE board on screen at
     * every bearing, which is the guarantee football's own floor of 1 exists to
     * make. Measured at the worst bearing, 45 degrees, where the diagonal is
     * what has to fit:
     *
     *     floor   board (NDC y)   fits at 45 degrees
     *     1.00    0.631           yes, 12% to spare
     *     1.10    0.694           yes, 2% to spare
     *     1.17    0.738           NO — corners over by 1.15 units
     *     1.25    0.789           NO — corners over by 2.79 units
     *
     * 1.17 would match football's apparent size exactly and is the tempting
     * one. It is not taken: knockout is a game about falling off the edge, and
     * a floor that hides the corners — even only while the field is being
     * turned by hand through 45 degrees — hides the thing the game is played
     * over. The remaining size difference is the shape of a square, not a
     * setting.
     */
    knockoutMinZoom: 1.1,

    /**
     * The curling table's zoom range, and the zoom a turn opens at.
     *
     * ── the floor is 1, and that is a GUARANTEE rather than a setting ────────
     * "최소 줌에서 책상 전체가 보인다" is a completion criterion, and zoom 1 is
     * the whole-of-`extents` fit by construction — see `GameCamera.fitDistance`.
     * So the criterion holds at every table width the panel can produce rather
     * than at the one it was measured against, and the slider on the panel is
     * bounded at 1 from below for the same reason. Raising it above 1 frames
     * tighter than the whole table and is the one way to break the criterion,
     * which is why the row says so.
     *
     * The ceiling is lower than the shared 4x because a table two caps wide on
     * screen is not a view anybody aims from, and the turn opens at the widest
     * because in curling you are throwing from one end AT the other — a view
     * that shows only one of them is useless whichever end it picks.
     *
     * `maxZoom` and `turnZoom` are injected by the mode — see `MODES.curling` —
     * exactly as `minZoom` already was.
     */
    curlingMinZoom: 1,
    curlingMaxZoom: 3.5,
    curlingTurnZoom: 1,

    /**
     * The zoom a turn opens at, once the view has come round. See
     * `GameCamera.turnZoom` for what it costs.
     *
     * 1.45 on the football pitch shows about seventy per cent of its length —
     * your own half, the halfway line and most of the way to the far goal. Close
     * enough that a cap is a thing you aim WITH rather than a dot, far enough
     * that the shot's destination is on screen when you take it.
     *
     * Clamped up to the mode's minimum, so it is a no-op wherever that is
     * already higher — the knockout board opens at its own 1.12.
     */
    turnZoom: 1.45,
    /**
     * Follow the ball with the camera while the turn plays out.
     *
     * On, because at the turn zoom the ball can leave the frame entirely on a
     * hard shot and the player loses the one thing they are watching. Off gives
     * the old fixed view.
     *
     * UNDER `track`, which is the player's own switch. This one stays a
     * developer's knob for whether football has a ball follow at all; the person
     * playing gets one control that says "카메라 추적", and it would be a lie in
     * the one mode where the automatic camera is this line rather than
     * `CamTracker`. See the gate in `main.js`.
     */
    followBall: true,
    /**
     * How long the view takes to come round at a turn change, in seconds.
     *
     * Its own constant rather than `transitionSec`, because it is doing a much
     * bigger job: that one is a pan glide of a few units and this one is up to
     * half a turn of the pitch plus a zoom back out. At the pan's 0.22 the board
     * whips round; this is slow enough to follow and short enough not to be a
     * wait before your turn.
     */
    turnViewSec: 0.55,

    /**
     * ── riding the thrown cap ────────────────────────────────────────────────
     *
     * A separate thing from `followBall`, and deliberately so. That one keeps a
     * BALL in frame in football and is a straight pan target with the camera's
     * own glide behind it. This is the survival and curling behaviour: a spring
     * on the cap the shot was taken with, a fast cut to whatever goes over the
     * edge, and a hand-back at the end of the turn. `CamTracker` owns all of it;
     * WHICH modes it runs in is decided by `MODES.*.camera.track` and not here.
     *
     * Nothing in this block can reach the simulation. Every one of them is read
     * on the render clock by a module that writes to the camera's pan and to
     * nothing else, so a match played with tracking on and one played with it
     * off produce the same hashes.
     *
     * ── and it is the MASTER switch, not only the tracker's ──────────────────
     * This is what the settings screen's "카메라 추적" writes, and a player
     * turning it off is asking for the camera to stop moving on its own — not
     * asking about `CamTracker` specifically, which they have never heard of. So
     * `followBall` is gated on it too. Without that the switch did nothing
     * whatsoever in football, which is the one mode that does not use the
     * tracker: "카메라 추적 껐는데 축구에서는 자동 카메라가 그대로 따라간다".
     */
    track: true,
    /**
     * The spring pulling the view toward the cap: `a = k*(x-look) - c*v`.
     *
     * Critical damping is `2*sqrt(k)` — 18.97 at this stiffness — and the
     * damping sits just above it. Overshoot is what an underdamped camera does
     * at the end of every travel, and at 320x240 a view that arrives, slides
     * past and comes back reads as the board wobbling rather than as the camera
     * settling. Being slightly over costs a little arrival time and nothing else.
     *
     * ── 90 rather than the 30 this started at, and it cost nothing ───────────
     * A second-order follow lags a moving target by `v*c/k`, and a curling
     * throw crosses the table at about 150 units a second — so at 30 the cap
     * was a board-length ahead of the view and spent most of a zoomed-in throw
     * off screen. Measured over a ricocheting knockout shot at 2.2x, raising it
     * to 90 took the cap from on screen 34% of the turn to 58%, and the
     * camera's peak pan speed and acceleration — which is what actually makes a
     * view unwatchable — barely moved: 44 and 382 at 30 against 40 and 361 at
     * 90. They barely move because the pan CLAMP is what bounds the travel, not
     * the spring. Past about 160 the tracking stops improving for the same
     * reason and the acceleration starts climbing again, so there is nothing up
     * there worth having.
     *
     * It still plainly lags — peak lag is around 18 units on a 58-unit board —
     * which is the point. Wind it up toward 400 and the camera locks to the cap
     * and the low-res frame turns to mush on every ricochet; wind it down toward
     * 8 and the shot is over before the view arrives.
     */
    trackStiffness: 90,
    trackDamping: 20,
    /**
     * How long the cut onto a cap that has just gone over the edge takes.
     *
     * "스냅이라 하되 순간이동은 아니다." A duration and not a stiffness, so it is
     * the same length of move whether the cap went over the near rim or the far
     * corner. Under about 0.15 it reads as a cut and the eye loses where it is;
     * over about 0.4 the fall is finished before the camera arrives.
     */
    trackFallSnapSec: 0.25,
    /**
     * How long the pan takes to come back to the default framing, in seconds.
     *
     * Only ever used on a turn that ended WITHOUT the seat changing — an AI or
     * online opponent, or today an extra-turn card. A local handover is put back
     * by the turn-over reset itself and never reaches this. See
     * `CamTracker._release`.
     */
    trackReturnSec: 0.4,
    /**
     * How far inside the frame's edge curling's target line is kept, in world
     * units.
     *
     * The same inset guards the cap, so when the two are too far apart to both
     * fit — a throw still at the near end, zoomed in — the cap sits exactly this
     * far inside its own edge and the line is as close as the frame can bring
     * it. At the turn's opening zoom the whole table is on screen and this does
     * nothing at all. Roughly two cap diameters.
     */
    trackLineInset: 8,
    /** The two trails, drawn on the board. A tuning instrument; see `TrackPathView`. */
    trackPath: false,

    /**
     * Camera bearing, in radians. LIVE.
     *
     * The field appears to turn; nothing in the world moves. Kept here rather
     * than on the camera object so that it survives a rebuild — a goal reset
     * throws the entire physics world away, and coming back from it at a
     * different angle would be a jump the player did not ask for.
     *
     * A turn change now steers it to whichever bearing puts the player's own
     * half at the bottom of the screen. Same note as the zoom above.
     */
    azimuth: 0,
    /**
     * Pointer pixels -> world units when panning. 1 tracks the finger exactly.
     *
     * The conversion itself is derived from the frustum, so this is a multiplier
     * on top of correct rather than the thing that makes it correct.
     */
    panSpeed: 1,
    /**
     * Gain on the angle the pointer sweeps about the centre of the view.
     *
     * 1 means the field turns by exactly what the hand turned, so whatever point
     * you grabbed stays under the finger for the whole gesture — which is what
     * makes "the wrong way round" impossible to express rather than merely
     * fixed. The rotation used to be `dx * speed`, a rule that is right above
     * the centre of the screen and reversed below it; a gain on a swept angle
     * has no such half.
     *
     * Anything other than 1 breaks that tracking, so it is a feel knob to be
     * left alone unless you want the field to lead or lag the hand deliberately.
     */
    rotateSpeed: 1,
    /** How fast a fling dies, per second of wall clock. Exponential. */
    rotateDamping: 3.2,
    /**
     * How close to vertical the goal axis has to get before it is pulled the
     * rest of the way, in degrees.
     *
     * A magnet at two bearings, not a grid: everywhere else the angle stays
     * free. 7 degrees is wide enough to catch a rotation that was meant to end
     * up straight and narrow enough that a deliberate slight tilt survives.
     *
     * It only pulls once the field is otherwise still — no hand on it, no fling
     * left — so it never fights a turn in progress. 0 turns it off.
     */
    snapWindowDeg: 7,
    /**
     * How far above minimum zoom still counts as minimum, as a fraction.
     *
     * Not a nicety. A wheel notch multiplies the zoom, so landing on exactly 1
     * is a matter of whether the arithmetic happens to come out that way; an
     * equality test would strand the player at 1.0001 with the rotation
     * unavailable and nothing on screen to explain it.
     */
    rotateBand: 0.06,
    /** Time constant for the pan glide and the return-to-centre. Seconds. */
    transitionSec: 0.22,
    /**
     * How far past the field the pan may go, as a fraction of the frame.
     *
     * 0 is the strict reading — the field's edge stops at the frame's edge — and
     * it plays badly for two reasons. Whatever you zoomed in on ends up pinned
     * against the side of the screen instead of sitting in it, and at modest
     * zoom there is hardly any travel: measured on the default pitch, 1.5x left
     * 3.3 units of vertical allowance against a 44.5 half-length, so the drag
     * stopped almost as soon as it started.
     *
     * 0.3 lets the field's edge come three tenths of the way into the frame,
     * which takes that same 1.5x case to 15.7 units and puts a goal comfortably
     * inside the view. It does mean a band outside the fence shows at the limit.
     */
    panMargin: 0.3,
    /**
     * Cap pick radius, as a multiple of the cap's own.
     *
     * Deliberately generous: this is the line between "I am aiming" and "I am
     * moving the camera", and on a touch screen a finger covers the whole cap.
     * Too tight and a shot becomes a camera nudge; too loose and the empty space
     * next to a cap stops being empty.
     */
    grabRadius: 1.6,

    /** Rapier's own outlines for the goal sensors, drawn as boxes. */
    goalSensors: false,
    /**
     * The curling target line and the fall-judgement volume, outlined.
     *
     * Its own switch rather than sharing `goalSensors`, because the two answer
     * different questions and are looked at while tuning different things — one
     * is "where does a goal start counting" and this is "where exactly is the
     * line every distance is measured to, and where does a cap have to get to
     * before it counts as fallen". Both are numbers the whole mode rests on and
     * neither is visible from the sliders.
     *
     * Drawn through the geometry, like the goal boxes, because the pit spans
     * everything under the table and would otherwise be entirely hidden by it.
     */
    curlingGuides: false,
    /** Tint the run-off apart from the pitch, and mark the lines it is judged by. */
    showRunoff: true,
  },

  /**
   * Online play.
   *
   * ── NONE OF THIS IS IN THE CONFIG FINGERPRINT, and that is deliberate ────
   * `protocol.js` hashes the groups the SIMULATION reads — physics, shot, turn,
   * cards, orbs and the three modes — and refuses to pair two clients whose
   * hashes differ. Everything here is presentation and timing: how long the
   * match-found sequence runs, where to find the relay, how the countdown is
   * drawn. Two players with different intro lengths are still playing the same
   * game, and folding these in would refuse matches over nothing.
   *
   * The authority for the numbers that MATTER is the server. `turnMs` and the
   * heartbeat below are what this client shows and what a locally-run relay is
   * started with; the running server's own values arrive in the handshake and
   * win. A client cannot give itself a longer turn by editing a slider.
   */
  online: {
    /**
     * ── there is no `server` here, and there was ─────────────────────────────
     * A `config.online.server` sat here with a panel field bound to it, and
     * nothing anywhere read it: the address actually comes from
     * `Profile.server`, which is what the settings screen writes and what
     * survives a reload. A config key that looks like a setting and changes
     * nothing is worse than no key at all — it answers the question "where do I
     * put the address" wrongly. See `Transport.defaultServerUrl` for the
     * build-time override and the host-derived fallback.
     */
    /** What the countdown shows. The server's value overrides it on connect. */
    turnMs: 15000,
    /** How long without a pong before the relay calls a client gone. */
    heartbeatTimeoutMs: 15000,
  },

  /**
   * The opening sequence, in seconds, one slider per segment.
   *
   * ── top level, not under `online`, because every mode plays it ───────────
   * It was written for 매칭 성립 and lived under `online` while that was the
   * only caller. It is not an online feature: the placement it teaches —
   * opponent top-left, you bottom-right, both sliding into the corners the match
   * keeps those hands in — reads the same whether the other cap belongs to a
   * stranger, to the computer, or to the person across the table. Leaving it
   * nested would have meant a local match reading its timings out of a group
   * named for a network it is not using.
   *
   * Sums to 2.5 at the defaults, inside the brief's two-to-three. The order is
   * the brief's too. See `IntroLayer`.
   */
  intro: {
    /**
     * The letterbox unfolding, before anybody is introduced.
     *
     * The document opens with the bars shut — that is how the seam with the
     * menu is hidden, see `core/Cinematic.js` — so this is the first thing that
     * happens in every match, `enabled` or not. Never skip it: cutting from a
     * covered frame straight to the board is the hard cut the bars exist to
     * replace, and it is also what would make a cold `/survival` open on a
     * flash.
     */
    barSeconds: 0.45,
    selfSec: 0.55,
    opponentSec: 0.55,
    holdSec: 0.9,
    exitSec: 0.5,
    /**
     * Introduce the two players at all. Off, the bars open onto the board and
     * the UI fades in, and nothing else happens.
     *
     * Global rather than per mode, deliberately. A match is a match: survival,
     * football and curling all open with two people and two caps, and a switch
     * that could be off in one of them is a switch somebody has to remember the
     * state of.
     */
    enabled: true,
  },
};

/** For the reset button: a deep copy taken before the GUI touches anything. */
export const CONFIG_DEFAULTS = structuredClone(CONFIG);

/**
 * Put every value back, without handing CONFIG a reference into the defaults.
 *
 * Recursive, and it has to be. The shallow `Object.assign(CONFIG[g], DEFAULTS[g])`
 * this replaced was correct only while every group was one level deep: the
 * moment `turn.rest` appeared, a reset would have pointed `CONFIG.turn.rest` AT
 * the defaults object, and the next slider drag would have edited the defaults —
 * so the reset button would silently stop working, one group at a time, and only
 * after it had been used once.
 */
function deepAssign(target, source) {
  for (const key of Object.keys(source)) {
    const v = source[key];
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      target[key] ??= {};
      deepAssign(target[key], v);
    } else {
      target[key] = v;
    }
  }
}

export function resetConfig() {
  deepAssign(CONFIG, CONFIG_DEFAULTS);
}
