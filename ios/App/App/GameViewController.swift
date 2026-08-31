import UIKit
import Capacitor

/**
 * The one piece of native code in the project, and it exists for exactly two
 * reasons that CSS cannot reach.
 *
 * `CAPBridgeViewController` already reads `UIStatusBarHidden` out of Info.plist
 * (see its `setStatusBarDefaults`), so the status bar is handled there and not
 * here. What it does not override are the two system-gesture properties below,
 * and both of them are the difference between a drag landing in the game and a
 * drag landing in iOS.
 */
class GameViewController: CAPBridgeViewController {
    /**
     * ── the home indicator is NOT overridden here, and cannot be ──────────────
     * The obvious version of this file also overrode `prefersHomeIndicatorAutoHidden`.
     * It does not compile:
     *
     *     error: overriding non-open property outside of its defining module
     *
     * Capacitor 8 claims that property for its built-in `SystemBars` plugin
     * (Plugins/SystemBars.swift) and declares it `public override` rather than
     * `open`, so it is closed to subclasses in other modules. The getter returns
     * the plugin's own `hideHomeIndicator` flag.
     *
     * The supported route is therefore configuration, not inheritance — and it
     * is taken, in capacitor.config.json:
     *
     *     "plugins": { "SystemBars": { "hidden": true } }
     *
     * which makes the plugin's `load()` call `setHidden(hidden: true)` with no
     * `bar` argument, setting `hideHomeIndicator = true` (and hiding the status
     * bar, which Info.plist also asks for — see the note there).
     *
     * Why it matters at all: the bar never truly disappears, but the flag is
     * also what turns on the "first swipe only reveals it" rule. The card hand
     * sits along the bottom of the frame and every card gesture is a drag UPWARD
     * out of it, which is the same stroke as the home gesture. Without it, a card
     * played from the lowest row is a coin flip between playing the card and
     * leaving the game.
     *
     * `preferredScreenEdgesDeferringSystemGestures` below is a different story:
     * Capacitor does not declare it at all, so the override lands on UIKit's own
     * `open` property and compiles.
     */

    /**
     * The same protection, for the other three edges.
     *
     * A pull from the top edge is the notification shade, from the top-right
     * corner Control Center, from the bottom the app switcher. All three are
     * strokes this game asks for: the camera pans and orbits from anywhere on
     * the board, an aim drag can start on a cap near the frame's edge and be
     * pulled outward, and the letterbox means the frame's edge often IS the
     * screen's edge.
     *
     * `.all` does not disable any of them. It makes each one take two swipes
     * instead of one, so the first stroke reaches the game and only a deliberate
     * repeat reaches the system.
     */
    override var preferredScreenEdgesDeferringSystemGestures: UIRectEdge {
        return .all
    }
}
