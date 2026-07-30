/**
 * The black fade, shared by every way OUT of somewhere.
 *
 * ── why this is DOM and not drawn in the canvas ─────────────────────────────
 * Everything else in this project is careful to go through the low-resolution
 * target and come out the other side of the retro pass, and this deliberately
 * does not. Two reasons, and they are both about the fade being a page-level
 * event rather than a scene-level one:
 *
 *   IT HAS TO COVER THE LETTERBOX. The canvas is a 4:3 box in the middle of the
 *     window and there are black bars either side of it. A fade drawn inside
 *     the canvas leaves those bars untouched, which on a wide window means the
 *     screen visibly fades to black in a rectangle.
 *   IT HAS TO OUTLIVE THE RENDERER. Leaving a match tears the whole page down.
 *     A fade being drawn by a renderer that is about to stop would freeze
 *     halfway through and then jump.
 *
 * It is also the one effect here with no period technique to be faithful to: it
 * is not part of the game's picture, it is the picture being put away.
 *
 * ── three shapes, one implementation ────────────────────────────────────────
 * `fadeOut` is for leaving: fade to black and stay there, because a navigation
 * is about to replace the document. `fadeIn` is the other half of that trip, run
 * by the document that ARRIVES. `fadeThrough` is for swapping something
 * underneath in one document: fade to black, do the thing, fade back. The brief
 * asks for "복귀 시에는 전환 연출 없이 짧은 페이드", and both ways back — out of a
 * match and out of the settings screen — now use exactly these, so they look the
 * same because they ARE the same.
 *
 * ── a navigation needs BOTH halves, and that is why `fadeIn` exists ──────────
 * `fadeThrough` fades out and back in, so swapping the settings scene is
 * symmetric and reads as one movement. A document swap could not be: `fadeOut`
 * ends with the screen black and the page about to be replaced, and the
 * replacement then painted itself at full brightness the instant it was ready.
 * Black, then a fully lit menu, with nothing in between — which is exactly the
 * hard cut that leaving a match had and swapping to 설정 did not. `fadeIn` is
 * the missing half, and it is deliberately the same veil, the same colour and
 * the same 180 ms as the half that preceded it.
 *
 * ── the two routes are THREE EQUAL BEATS, and that took measuring ────────────
 * The fades were already identical and still did not feel it. Both veils resolve
 * to the same `opacity 0.18s linear` off the same one rule in `styles.css` —
 * checked, not assumed — so nothing about the SPEED differed. What differed was
 * the hold at black in the middle:
 *
 *   설정 -> 메인   two animation frames, about 33 ms
 *   게임 -> 메인   a whole document load. Measured on this project:
 *                 `domContentLoadedEventEnd` at 116 ms, plus two frames, so
 *                 about 149 ms — four times as long, and VARIABLE with the
 *                 cache, which is why it never felt the same twice.
 *
 * So the hold is now a stated number rather than whatever the machine took, and
 * both routes are told to honour it: out for `FADE_MS`, black for `HOLD_MS`, in
 * for `FADE_MS`. `holdThenLift` is the one place that waits, and each caller
 * only has to say WHEN the screen went black — which for a navigation is its own
 * document's time origin, because that is the instant the page before it
 * finished fading and called `location.assign`.
 */

/** Matches the transition duration in styles.css. Do not change one alone. */
const FADE_MS = 180;

/**
 * How long the screen stays fully black between the two halves.
 *
 * Equal to the fade, so a transition is three beats of the same length whichever
 * route it took. It also has to be a CEILING the slower route can actually reach:
 * the measured document load is about 149 ms to the point the veil could lift, so
 * 180 clears it with a little room. A first load on a cold cache can still
 * overrun it, and then the black simply lasts as long as the load does — there is
 * no honest way to be faster than the page is ready.
 */
const HOLD_MS = 180;

/**
 * @param {boolean} [opaque]
 *   Start fully black. The class goes on BEFORE the element is in the document,
 *   so black is the first style it ever resolves and there is nothing for the
 *   browser to animate into — a veil that faded 0 -> 1 on arrival would flash
 *   the new page before hiding it again, which is worse than no fade at all.
 */
function makeVeil(opaque = false) {
  const el = document.createElement('div');
  el.className = opaque ? 'page-fade is-on' : 'page-fade';
  document.body.appendChild(el);
  return el;
}

/**
 * Run `fn` once, whichever of the two signals arrives first.
 *
 * `transitionend` is the accurate one and a tab that is not compositing never
 * fires it — which would leave the screen black and the game unreachable. The
 * timer is the guarantee; the event is the precision.
 */
function once(el, fn) {
  let done = false;
  const run = () => {
    if (done) return;
    done = true;
    fn();
  };
  el.addEventListener('transitionend', run, { once: true });
  setTimeout(run, FADE_MS + 60);
}

/**
 * Hold a black veil until the screen has been black for `HOLD_MS`, then lift it.
 *
 * The one place either route waits, so neither can drift from the other. Callers
 * say only when the screen WENT black; the arithmetic of how much of that has
 * already been spent lives here.
 *
 * ── two frames before anything, whatever the clock says ────────────────────
 * The scene underneath has to have been drawn at least once or the veil pulls
 * back off a canvas that is still the clear colour. That is the original reason
 * `fadeThrough` waited two frames, and it survives being given a real hold.
 *
 * ── and then it stops waiting ──────────────────────────────────────────────
 * The timer is not a second guess at the frames, it is the guarantee: a tab in
 * the BACKGROUND is served no animation frames at all, so the pair above would
 * never run and a veil nothing ever lifts is a page that is simply black. Same
 * division of labour as `once` — the frames are the precision, the timer is the
 * promise. `fadeThrough` had no such backstop before this and could strand its
 * veil exactly that way; sharing this helper is what fixes it.
 *
 * @param {number} blackSince
 *   A `performance.now()` reading for the moment the screen became fully black.
 *   `0` means "this document's time origin", which is what an arriving page
 *   wants: the origin IS the instant the departing page finished fading out and
 *   navigated, so the load time counts toward the hold instead of being added on
 *   top of it.
 */
function holdThenLift(veil, blackSince, onDone) {
  let lifted = false;
  const lift = () => {
    if (lifted) return;
    lifted = true;
    veil.classList.remove('is-on');
    once(veil, () => {
      veil.remove();
      onDone?.();
    });
  };

  const liftWhenHeldLongEnough = () => {
    const left = HOLD_MS - (performance.now() - blackSince);
    if (left <= 0) lift();
    else setTimeout(lift, left);
  };

  requestAnimationFrame(() => requestAnimationFrame(liftWhenHeldLongEnough));
  setTimeout(lift, HOLD_MS + 400);
}

/**
 * Start black and lift. For a document that has just been navigated TO.
 *
 * The far half of `fadeOut`. Call it once the arriving scene has been built —
 * whatever it draws will be underneath the veil, so it costs nothing to let it
 * get its first frame in before anything is revealed.
 *
 * The hold is measured from this document's own time origin, so however long the
 * load took is time the screen was ALREADY black and comes off the hold rather
 * than being added to it. That is the whole of what makes this route the same
 * length as the settings swap.
 */
export function fadeIn(onDone) {
  const veil = makeVeil(true);
  // Commit "black, not animating" as the state to transition FROM. Without the
  // read the class going on and coming off can land in one style resolution and
  // there is nothing to animate between.
  void veil.offsetHeight;
  holdThenLift(veil, 0, onDone);
}

/** Fade to black and stay. For a navigation that is about to take the page. */
export function fadeOut(atBlack) {
  const veil = makeVeil();
  // One frame between attach and class, so the transition has two states to
  // interpolate between instead of starting already finished.
  requestAnimationFrame(() => veil.classList.add('is-on'));
  once(veil, () => atBlack?.());
}

/**
 * Fade to black, swap, fade back.
 *
 * `atBlack` runs on a screen that is entirely covered, which is the same
 * arrangement the cap wipe uses for its own scene change and for the same
 * reason: whatever it costs, nobody sees it.
 *
 * The swap is synchronous and takes almost no time, so this route used to lift
 * the veil about two frames later and was over in roughly 409 ms. It now holds
 * for `HOLD_MS` like the navigating route does — deliberately slower than it
 * needs to be, because the two being the same length is worth more than this one
 * being as short as it can get. See the header.
 */
export function fadeThrough(atBlack, onDone) {
  const veil = makeVeil();
  requestAnimationFrame(() => veil.classList.add('is-on'));
  once(veil, () => {
    atBlack?.();
    // From HERE: the fade-out has just finished, so this is the instant the
    // screen became fully black.
    holdThenLift(veil, performance.now(), onDone);
  });
}
