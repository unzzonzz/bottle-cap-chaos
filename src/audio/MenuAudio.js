import { STAGE } from '../menu/Transition.js';
import { DEFAULT_MARK } from '../marks/MarkBook.js';

/**
 * The menu page's ears.
 *
 * ── it is TOLD, where the game page is polled, and that is not inconsistent ─
 * On the game page every event is a field on a state object that the renderer
 * already reads every frame, so polling is the house idiom. The menu is the
 * opposite shape: it is four screens sharing one pointer protocol —
 * `pick` → `setHover` → `activate`/`press` — and the interesting moment is the
 * CALL, not a value left behind by it. Worse, two of the four (`MarksScreen`
 * and `MarkEditor`) run their whole `setHover` body on every pointer move with
 * no change test at all, so a poll would have to reconstruct an edge that the
 * call site already has for free.
 *
 * So `bootMenu` hands the same hit it just computed to `press`, and everything
 * that IS a per-frame value — the shake envelope, the transition stage — comes
 * through `update`.
 *
 * ── the dialog answers three different questions ───────────────────────────
 * `ConfirmDialog` is one object reused for "delete this mark", "save this mark"
 * and "leave without saving", and it reports only which button was pressed. The
 * sentence is the only thing that differs, and the sound has to differ too — a
 * deletion and a save must not share a confirmation noise. So the question is
 * remembered when the dialog is OPENED, which is the moment the caller still
 * knows what it is asking about.
 *
 * ── two things this deliberately no longer does ────────────────────────────
 * HOVER made a sound, on every screen. It is gone: a hover fires from pointer
 * motion the player is not thinking about, and it is the single most repeated
 * event on a page made entirely of plates.
 *
 * THE BRUSH made a rate-limited tick while drawing. Also gone, along with its
 * settings-screen toggle. The brief warned it would be fatiguing and it was —
 * a stroke is the one gesture a player holds for minutes at a time.
 */

/** Editor control ids that are all "a tool was chosen". */
const TOOL_IDS = new Set(['eraser', 'mode:draw', 'mode:view']);

export class MenuAudio {
  /**
   * @param {import('./AudioSystem.js').AudioSystem} audio
   * @param {typeof import('../menu/menuConfig.js').MENU_CONFIG} menuConfig
   * @param {typeof import('../game/config.js').CONFIG.audio} audioConfig
   * @param {import('../marks/MarkBook.js').MarkBook} book
   * @param {import('./AudioSettings.js').AudioSettingsBook} settings
   */
  constructor({ audio, audioConfig, book, settings }) {
    this.audio = audio;
    this.config = audioConfig;
    this.book = book;
    this.settings = settings;

    this._stage = STAGE.IDLE;
    /** What the open dialog is asking about: 'save' | 'delete' | 'exit'. */
    this._asking = null;
    this._spinning = false;
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /**
   * A press landed. Called with the hit `bootMenu` just computed, BEFORE the
   * screen acts on it — so anything that needs the pre-press state (whether a
   * badge was already lit, whether undo has anywhere to go) can still read it.
   */
  press(screen, hit, ctx = {}) {
    if (!hit) return;

    if (hit.kind === 'dialog') {
      this._dialog(hit.hit);
      return;
    }

    if (screen === 'menu') {
      // The wind-up starts here; the cap fires on release. See `Transition`.
      this.audio.play('ui_click');
      return;
    }

    if (screen === 'settings') {
      this.audio.play('ui_click');
      return;
    }

    if (screen === 'marks') {
      this._marks(hit);
      return;
    }

    if (screen === 'editor') {
      this._editor(hit, ctx.editor);
    }
  }

  _marks(hit) {
    switch (hit.kind) {
      case 'badge': {
        // An empty slot cannot be worn, and the screen silently refuses it.
        if (hit.ref !== DEFAULT_MARK && !this.book?.hasSlot(hit.ref)) return;
        // Read BEFORE the screen acts, which is why `press` runs first: pressing
        // a lit badge is how "없음" is chosen, and taking a mark off must not
        // sound like putting one on.
        const already = this.book?.assignedTo(hit.player) === hit.ref;
        this.audio.play(already ? 'mark_badge_off' : 'mark_badge_on');
        return;
      }
      case 'trash':
        this._asking = 'delete';
        this.audio.play('ui_confirm_open');
        return;
      case 'tile':
      case 'back':
        this.audio.play('ui_click');
        return;
      default:
    }
  }

  _editor(hit, editor) {
    // The drawing surface and the turntable are gestures, not presses, and
    // neither makes a sound: the brush tick was removed on the player's own
    // instruction, together with its settings-screen toggle.
    if (hit.kind === 'canvas' || hit.kind === 'turntable') return;

    const id = hit.id;
    if (!id) return;

    if (id.startsWith('colour:')) {
      this.audio.play('draw_color');
      return;
    }
    if (id.startsWith('brush:') || TOOL_IDS.has(id)) {
      // The built-in logo opens read-only, and `_activate` then swallows a press
      // on the pencil without changing anything — the mode buttons stay visible
      // and pickable, unlike the save button, which is hidden outright. So this
      // is a real refusal with a visibly greyed control behind it, and it has to
      // say no rather than answer as though a tool had been chosen.
      if (id === 'mode:draw' && editor?.readOnly) this.audio.play('ui_denied');
      else this.audio.play('draw_tool');
      return;
    }
    if (id === 'undo' || id === 'redo') {
      // Both return silently at the ends of the history and both report true, so
      // the only way to tell a real undo from a no-op is the same predicate the
      // panel uses to grey the icon — asked here, before the press lands.
      const can = id === 'undo' ? canUndo(editor) : canRedo(editor);
      this.audio.play(can ? (id === 'undo' ? 'draw_undo' : 'draw_redo') : 'ui_denied');
      return;
    }
    if (id === 'clear') {
      this.audio.play('draw_clear');
      return;
    }
    if (id === 'save') {
      if (editor?.readOnly) {
        this.audio.play('ui_denied');
        return;
      }
      this._asking = 'save';
      this.audio.play('ui_confirm_open');
      return;
    }
    if (id === 'back') {
      // A clean editor leaves straight away; a dirty one is asked first.
      if (editor?.dirty) {
        this._asking = 'exit';
        this.audio.play('ui_confirm_open');
      } else {
        this.audio.play('ui_click');
      }
    }
  }

  _dialog(hit) {
    const id = hit?.id ?? null;
    // A press on the veil is swallowed by the dialog and means nothing.
    if (!id) return;
    const asking = this._asking;
    this._asking = null;

    if (id === 'cancel') {
      this.audio.play('ui_confirm_no');
      return;
    }
    this.audio.play('ui_confirm_yes');
    // The action itself, which happens inside the dialog's own closure a moment
    // later. Announced from what the question WAS, because by the time it runs
    // nothing left on screen says what it was about.
    if (asking === 'save') this.audio.play('draw_save', { when: 0.09 });
    else if (asking === 'delete') this.audio.play('draw_delete', { when: 0.09 });
  }

  /**
   * Every gesture ends here, whatever it was.
   *
   * Nothing to do: the menu item's release is the cap firing, which `Transition`
   * reports as a stage change, and the editor's release ends a stroke that no
   * longer makes a sound. Kept as the seam rather than deleted, because
   * `bootMenu.endGesture` is the one place every gesture on the page converges.
   */
  release() {}

  /**
   * A screen swap behind the black fade.
   *
   * ── it makes no sound, and that is the third answer to one report ───────
   * There was a sweep here. The player heard the two screen-changing rows in
   * 설정 as "띡 + 퍽" where every other button in the game is just "띡", and the
   * sweep was the 퍽: it opened on a 220 Hz sawtooth behind a 700 Hz low-pass,
   * carrying 14.2% of its energy under 400 Hz against the click's 1.7%, and
   * landing on the same millisecond as the click for a combined peak two and a
   * half times anything else.
   *
   * Raising its floor and delaying it fixed the measurements and did not fix
   * the complaint — it was still there, quieter. So it is gone. A press is one
   * sound, everywhere, and the 180 ms black fade is the screen change; it does
   * not need announcing on top of the press that caused it.
   *
   * The brief does ask for "화면 전환: 짧은 스윕". That was built, measured and
   * removed on the player's repeated instruction, which outranks it. The
   * definition is still in the bank and the panel can still audition it.
   */
  screenChange() {}

  // ── per frame ─────────────────────────────────────────────────────────────

  /**
   * @param {number} _dt
   * @param {{stage: string, t: number, pop: number}} state  from `Transition.update`
   */
  update(_dt, { state } = {}) {
    if (!state) return;

    const stage = state.stage;
    if (stage !== this._stage) {
      const before = this._stage;
      this._stage = stage;
      // POP and COVER both have callbacks in `bootMenu`, but COVER's fires from
      // two places — the cover branch and a long-frame backstop past it — so the
      // stage edge is the honest single event for both.
      if (stage === STAGE.POP) this.audio.play('menu_launch');
      else if (stage === STAGE.COVER && before !== STAGE.COVER) this.audio.play('menu_cover');
    }

    /**
     * ── 탄산 소리는 없다 ──────────────────────────────────────────────────
     *
     * `menu_shake` 루프가 상시 깔려 있었다. 원래는 병을 흔드는 제스처가 만드는
     * 소리였고, §6.1 이 그 제스처를 없애면서 "음료 자신의 것" 인 배경 소리로
     * 바꿔 두었다 — 병이 화면에 있었기 때문에 성립하던 근거다.
     *
     * 병이 없어졌다. 화면에 탄산이 없는데 탄산 소리가 나면 그건 분위기가 아니라
     * 출처 없는 잡음이고, 조용한 화면에서 잡음은 유일하게 계속되는 것이라 더
     * 크게 들린다.
     *
     * 루프를 끄되 지우지 않는 이유는 `stopLoops` 가 아니라 `on: false` 로 두면
     * 페이드가 걸려 켜져 있던 상태에서 화면을 옮겨도 뚝 끊기지 않기 때문이다.
     */
    this.audio.setLoop('menu_shake', { on: false, fade: 0.4 });
  }

  dispose() {
    this.audio.stopLoops(0.05);
  }
}

/** The same predicates `MarkEditor.refresh` greys the icons with. */
function canUndo(editor) {
  return !!editor && editor._historyAt > 0;
}

function canRedo(editor) {
  return !!editor && editor._historyAt < (editor._history?.length ?? 1) - 1;
}
