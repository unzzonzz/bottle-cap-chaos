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
   * The curling lane. STRUCTURAL except where noted.
   *
   * ── it is a THIRD set of surface numbers, not a tweak to the other two ─────
   * "표면 마찰은 서바이벌·축구와 별도로 관리해라. 모드별 물리 설정으로 분리." —
   * so `laneFriction` lives here and `arena.boardFriction` and
   * `football.pitchFriction` are untouched by anything in this block. The cap's
   * OWN friction is shared by all three modes and must stay shared, which is why
   * the lane and the walls combine by `Min`/`Max` rather than by Rapier's
   * default average: see the header in `CurlingLane`. Each number below is the
   * number the cap actually gets.
   */
  curling: {
    /**
     * Distance between the two out lines, in world units. Structural.
     *
     * With `laneRatio`, the only two size controls there are. A real sheet is
     * about 1:9 and the brief rules that out for a measured reason — "너무 길면
     * 뚜껑이 도달하지 못하고 화면에서 하우스가 안 보인다" — so this is a lane you
     * can actually reach the end of: a full-power throw covers a bit more than
     * it, which is what makes the overshoot penalty a real cost rather than a
     * theoretical one.
     */
    laneLength: 100,
    /**
     * Length : width. Structural. The brief's band is 1:4 to 1:5.
     *
     * Drag it up and the lane narrows, which tightens the wall-reflection game
     * and squeezes the house's clearance — `houseMargin` below is what stops the
     * second of those from silently deleting the first.
     */
    laneRatio: 4.5,
    /**
     * Ground past each out line, in world units. Structural.
     *
     * Where an overshooting cap ends up. It is drawn differently from the lane
     * and it is generous on purpose: a cap that crosses the back line at pace
     * has to have somewhere to stop and be SEEN stopping, because the penalty is
     * the thing the player has to learn. Past it the ground stops and there is a
     * catch floor a long way down — a cap that gets that far was out either way.
     */
    runoff: 10,
    groundThickness: 1.0,

    /** Visible side fence. Structural. Low, so it does not hide the lane. */
    wallHeight: 2.2,
    wallThickness: 0.7,
    /**
     * How high the undrawn shell carries the side walls. Structural.
     *
     * The fence has to be low to see past and a low fence is exactly what a
     * tumbling cap gets over — the same problem `FootballPitch` documents at
     * length. So the box is closed above it by geometry nobody can see, sitting
     * directly on the fence so there is no gutter behind it, and a lid across
     * the top. Nothing in ordinary play reaches any of it.
     */
    ceilingHeight: 8,

    /**
     * The house's outer radius, in world units. Structural.
     *
     * CLAMPED by `houseMargin` — see `curlingMetrics`. At the defaults the clamp
     * does not bite and the panel says so.
     */
    houseRadius: 7.5,
    /**
     * Least gap between the house's edge and a wall's inner face. Structural.
     *
     * The brief makes this a rule rather than a preference: "하우스가 벽에 닿으면
     * 벽 반사 전략이 무의미해진다". A cap coming off the wall has to have room to
     * arrive somewhere useful, and if the house reaches the wall then every wall
     * shot is either in the house or off the lane and there is nothing to aim
     * for. Three units is nearly a cap diameter of approach on each side.
     */
    houseMargin: 3.0,
    /** House centre, measured in from the BACK line. Structural. */
    houseFromBack: 15,
    /** Throw spot, measured in from the FRONT line. Structural. */
    throwFromFront: 8,
    /** Caps per team, and therefore half the turns in a match. Structural. */
    capsPerTeam: 4,
    /**
     * Extra room a cap needs at the throw spot before it is dealt there, on top
     * of two cap radii. LIVE.
     *
     * Only the fallback in `CurlingLane.throwSpot` reads it: the spot is the
     * same every turn and this is what decides when a cap knocked back onto it
     * counts as being in the way. At 0 a new cap is dealt exactly touching the
     * old one, which the solver resolves as a shove.
     */
    throwClearance: 0.8,

    // ── materials. All LIVE. ────────────────────────────────────────────────
    /**
     * The ice. LIVE, and the single most important number in the mode.
     *
     * A tenth of the knockout board's 0.34, because "컬링이므로 마찰이 낮다.
     * 뚜껑이 길게 미끄러져야 한다" — and it is the number the cap actually gets
     * rather than an average with the cap's own, because the lane combines
     * friction by `Min`. Drag it up and the throw stops arriving; drag it down
     * and every throw sails past the back line.
     */
    laneFriction: 0.15,
    laneRestitution: 0.03,
    /**
     * The side fences. LIVE.
     *
     * High restitution and low friction, both on purpose and both for the same
     * requirement: "반사 각도가 읽히도록 적당히 높게". A lively wall returns the
     * cap with enough speed left to still reach the house, and a slick one
     * returns it at the angle it arrived at instead of scrubbing the along-wall
     * component off and dropping it down the side of the lane.
     *
     * Combined by `Max` and `Min` respectively against the cap's, so both
     * sliders mean what they say. See `CurlingLane`.
     */
    wallRestitution: 0.7,
    wallFriction: 0.05,

    /**
     * Curling's own turn-end clock. LIVE. See `Layout.turnOverrides`.
     *
     * The shared values in `config.turn` describe a cap on a 0.34 mat, which
     * stops inside a couple of seconds. On ice at 0.10 a full-power throw is
     * still moving at five seconds, so the shared 5 s damping ramp would be
     * braking a cap that is still travelling to its target and the 8 s hard
     * timeout would freeze it mid-slide and report the turn as forced. Both are
     * moved out past where a real throw finishes.
     *
     * The rest thresholds are looser than the caps' shared pair for the matching
     * reason: a low-friction surface has a long creep tail, and the last
     * centimetre of it takes longer than the whole of the rest of the throw
     * while nothing visible happens.
     */
    turn: {
      rest: { cap: { linear: 1.2, angular: 0.8 } },
      quietSteps: 30,
      rampStartSec: 9.0,
      rampCurve: 2.0,
      rampMaxDamping: 9.0,
      hardTimeoutSec: 14.0,
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
    /** The offset dark quad standing in for a drop shadow. Frame pixels. */
    shadowOffsetX: 3,
    shadowOffsetY: -4,
    shadowOpacity: 0.5,
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

    // ── the chaos stars ──────────────────────────────────────────────────
    /**
     * Frames in the stun sprite's rotation. FEW.
     *
     * Eight is 45 degrees a frame and reads as a stepped, mechanical spin, which
     * is the look. Raise it and the star starts to turn smoothly, which is both
     * more work and less period-correct.
     */
    stunFrames: 8,
    /** Texels per frame of that sheet. */
    stunTexels: 24,
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
    ringTexels: 32,
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
    smashInvertFrames: 2,
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

    // ── the trajectory sweep and its line ────────────────────────────────
    /** Height of the swept band, in frame pixels. */
    scanHeight: 40,
    /** Texels down that band. Few: it is a stepped tail, not a gradient. */
    scanTexels: 32,
    /** Samples per dash cycle on the trajectory line. */
    dashLength: 16,
    /** How fast the dashes march, in samples per second. Stepped. */
    dashSamplesPerSecond: 14,
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
     * 1 puts one texel on one framebuffer pixel at the 640x480 target, which is
     * what keeps the thresholded type from being resampled into grey. Above 1
     * authors denser and lets the hardware minify — worse for legibility, which
     * is why it is a knob to prove that with rather than a setting.
     */
    textureScale: 1,

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
   * Nothing in this block can reach the simulation. The sequence runs in its own
   * overlay scene on the RENDER clock, off a match that has already finished and
   * whose physics has stopped stepping — see `MATCH_STATE.OVER` in `Match`. So a
   * slider dragged mid-animation changes what is on screen and cannot change who
   * won, which is why the stage lengths are safe to expose at all.
   *
   * ── the stage lengths, and why they do not add up to the brief's per-stage ──
   * The brief gives both approximate per-stage figures (0.4 / 0.3 / 2-4 frames /
   * 0.5) and a total for stages 1-4 of "1.5~2초, 짧게 갈 필요 없다". Those two
   * disagree by a third of a second — the per-stage numbers sum to about 1.25 —
   * and the total is the one with a reason attached, so it wins. The extra time
   * is spent in the two stages that are actually WATCHED rather than read: the
   * loser hanging there before it is hit, and the winner settling afterwards,
   * which the brief itself calls "승자를 감상하는 구간".
   *
   * Defaults: 0.55 + 0.30 + 3 frames + 0.80 = about 1.70s to the result, and
   * 2.00s to a screen you can press.
   */
  victory: {
    // ── stage lengths ────────────────────────────────────────────────────
    /** 1. The loser is on screen, floating, waiting to be hit. */
    enterSeconds: 0.55,
    /** 2. The winner crosses the frame. */
    chargeSeconds: 0.3,
    /**
     * 3. The hit, in FRAMES.
     *
     * Frames and not seconds, for the same reason `cardFx.smashInvertFrames` is:
     * the colour inversion is a whole-frame blend operation and at three frames
     * the difference between counting time and counting frames is the difference
     * between a flash and nothing at all. See `FxMaterials.createInvert`.
     */
    impactFrames: 3,
    /** 4. The loser leaves, the winner settles. */
    resultSeconds: 0.8,
    /** 5. The text, then the buttons. */
    uiSeconds: 0.3,

    // ── the darkened game behind ─────────────────────────────────────────
    /**
     * How far down the game screen goes.
     *
     * Not 1. The finishing position is the last thing the match said and it
     * stays legible underneath — the sequence is a thing happening in front of
     * the board, not a curtain over it.
     */
    bgOpacity: 0.72,
    bgFadeSeconds: 0.3,

    // ── the caps ─────────────────────────────────────────────────────────
    /**
     * Frame pixels per world unit. A 3.2-unit cap at 38 is 122px across.
     *
     * ── it is the subject of the screen, not the whole of it ─────────────────
     * 52 first, which drew the cap 166px wide — 26% of the frame's width and
     * better than a third of its height. At that size it stopped reading as an
     * object on a screen and started reading as a texture filling one, and it
     * competed with the 340px winner line directly underneath it for the same
     * attention. 38 puts it at 19% of the width: still plainly the thing being
     * looked at, still coarse enough that the 21 flutes and the hem read, and now
     * clearly subordinate to the line that says who won.
     *
     * Going further was tried and is worse — at 32 the flute detail starts to go
     * and the cap is smaller than the plate under it, which inverts the hierarchy.
     *
     * ── four numbers below follow this one ──────────────────────────────────
     * `ringStart`/`ringEnd` and `trailSize`/`trailSpacing` are absolute frame
     * pixels, so they do NOT scale with this on their own and were moved with it
     * by the same 38/52. Everything else that depends on the cap's drawn size —
     * the contact offset and the distance at which the loser is judged to have
     * cleared the frame — is derived from `capScale` in `VictoryLayer` and needs
     * no attention here.
     */
    capScale: 38,
    /** Where they meet, in frame pixels above centre. The buttons get below. */
    capY: 40,
    /**
     * How far back the ground the caps lie on is leaned, in degrees.
     *
     * 0 is dead top-down, which is the one angle a crown cap has nothing to say
     * from: 21 flutes in silhouette and a flat face, identical the right way up
     * and upside down. Leaning it back until the near skirt shows is what makes
     * it a pressed metal object lying on something.
     *
     * 24 is enough to see the skirt and the hem's flare without the panel — the
     * thing the artwork is on, and the thing the whole screen is about —
     * foreshortening away: the face keeps 91% of its height and the skirt gains
     * about a tenth of the cap's width underneath it.
     *
     * Applied to the caps and the flat ground sprites and to NOTHING ELSE. The
     * winner line and the buttons stay square to the screen; see the note on
     * `VictoryLayer._applyTilt`.
     */
    groundTiltDeg: 24,
    /**
     * How far the waiting cap drifts, in frame pixels, and how fast.
     *
     * This is now the whole of "정적이지 않게" for stage 1. The slow turn about
     * the cap's own normal that used to sit alongside it is gone — against panel
     * artwork with an orientation mark it read as a cap being spun by hand, and
     * it competed with the one rotation that has to be legible, which is the
     * loser going over in stage 4.
     */
    floatAmount: 6,
    floatHz: 0.55,

    // ── the winner's charge ──────────────────────────────────────────────
    /**
     * Which way it comes IN from, as a bearing in degrees: 0 right, 90 up,
     * 180 left, 270 down. The hit direction is the opposite of this, and the
     * loser leaves along it.
     *
     * 215 is from the lower left, which the brief asks for ("측면 또는 하단") and
     * which also sends the loser out through the upper right — away from the
     * buttons that are about to appear along the bottom.
     */
    enterAngleDeg: 215,
    /** How far out it starts, in frame pixels. 400 is the frame's half-diagonal. */
    enterDistance: 620,
    /** Afterimage sprites strung out behind it. 0 turns the trail off. */
    trailCount: 3,
    // Both moved with `capScale`: this is an afterimage OF the cap, so it is
    // meaningless at a size the cap is not.
    trailSpacing: 42,
    trailSize: 57,

    // ── the hit ──────────────────────────────────────────────────────────
    /** Whole frames of full-screen colour inversion. The brief asks for 2-3. */
    invertFrames: 3,
    /** Frame pixels of shake at the peak. Quantised to whole pixels. */
    shakeStrength: 14,
    shakeSeconds: 0.22,
    /** Cycles a second. High: this is an impact, not a wobble. */
    shakeHz: 26,
    /**
    * The additive ring, in frame pixels, and how long it takes to get there.
    *
    * Moved with `capScale` when the cap came down, so the ring still opens to
    * about 1.8x the cap's width — it has to read as bigger than what it came out
    * of, and a 300px ring around a 122px cap read as a hoop that had nothing to
    * do with the hit.
    */
    ringStart: 32,
    ringEnd: 219,
    ringSeconds: 0.42,

    // ── the loser leaving ────────────────────────────────────────────────
    /**
     * Turns a second on the flip. It stops at a half turn — face down — and
     * holds there, so this is really "how fast does it go over".
     */
    flipSpeedTurns: 1.4,
    /** Frame pixels a second, along the hit direction. */
    exitSpeed: 1500,

    // ── the winner settling ─────────────────────────────────────────────
    /** How far past centre the hit carries it, in frame pixels. */
    overshoot: 86,
    /** The spring that brings it back. Stiffness against damping. */
    springStiffness: 190,
    springDamping: 17,

    // ── the text and the buttons ─────────────────────────────────────────
    /** How much bigger the winner line gets at the peak of its entrance beat. */
    textPulseScale: 0.16,
    /** Frame pixels below the caps for the winner line. */
    textY: -110,
    /** And below that for the buttons. */
    buttonY: -178,
    /** Extra pixels of give around each button's hit quad, for thumbs. */
    hitMargin: 12,
    /** Draw the press targets, exactly as `ui.showHitAreas` does. */
    showHitAreas: false,
  },

  view: {
    /**
     * Internal render target, by key into RENDER_MODES.
     *
     * 640x480 rather than the authentic 320x240 because this phase is judged by
     * eye in the top-down wireframe view, and at 320x240 a cap's 84 columns land
     * inside one pixel and the whole mesh turns to mush. The PS1 chain is
     * unchanged — same snapping, same dither, same 5-bit channels, just more of
     * them. Drop it back to 320x240 in the panel to see the shipping look.
     */
    renderMode: '640x480',
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
    /** The whole PS1 chain: low-res target, snapping, dither, quantiser. */
    ps1: true,
    /**
     * How hard the vertex snap bites, when PS1 is on at all.
     *
     * Held here rather than written straight onto the shader uniform so that
     * switching PS1 off can zero the uniform without destroying the setting —
     * turn the chain back on and the snap comes back where it was.
     */
    vertexSnap: 1.0,
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
     * The curling lane's zoom range, and the zoom a turn opens at.
     *
     * ── the lane needs its own three, and the reason is its shape ────────────
     * A 1:4.5 rectangle in a 4:3 frame is bound by its LENGTH, so at the
     * whole-field fit it is a ribbon down the middle of the screen and the caps
     * on it are small — measured, about ten framebuffer pixels across against
     * the knockout board's seventeen. That is legible and it is not comfortable
     * to aim with, which is the trade the brief asks to be measured: "최소 줌에서
     * 레인 전체가 보여야 한다" against "하우스가 너무 작게 보이면 플레이가
     * 어렵다".
     *
     * `curlingMinZoom` is 1, so the first of those is true by construction —
     * zoom 1 IS the whole-lane fit. The other two are what make the second one
     * workable: the ceiling is lower than the shared 4x because there is nothing
     * on a lane worth filling the screen with, and the turn opens at the widest
     * rather than at the shared 1.45 because in curling you are aiming from one
     * end AT the other and a view that shows neither end is useless.
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
     * The curling house volume and the in-play volume, outlined.
     *
     * Its own switch rather than sharing `goalSensors`, because the two answer
     * different questions and are looked at while tuning different things — one
     * is "where does a goal start counting" and this is "where does a cap stop
     * being on the lane", which is the number the whole overshoot penalty rests
     * on. Drawn through the geometry, like the goal boxes, because half of each
     * volume is behind the fence.
     */
    curlingSensors: false,
    /** Tint the run-off apart from the pitch, and mark the lines it is judged by. */
    showRunoff: true,
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
