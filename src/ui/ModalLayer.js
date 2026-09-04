import { Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { FRAME as SHARED_FRAME, frameCamera, frameScale, refitFrameCamera } from '../core/frame.js';
import { HudMaterials } from './HudMaterial.js';
import { buttonTexture, modalTexture, slotTexture } from './hudTextures.js';
import { PALETTE, toRgb } from '../core/palette.js';
import { MOTION, ROLE, SIZE, SPACE, TYPE } from '../core/tokens.js';
import { approach, easeOut, overshoot } from './motion.js';
import { FONT_FAMILY } from './fonts.js';

/**
 * Every modal question in the game, drawn as geometry.
 *
 * ── it replaced a DOM overlay, and the reason is the whole render pipeline ──
 * The first version of this was an HTML panel over the canvas. It worked and it
 * was wrong for the reason `ConfirmDialog` and `bootMenu` both state at length:
 * a DOM element is composited by the browser at native resolution, AFTER the
 * retro pass — so at the exact moment the screen is a 320-wide dithered
 * five-bits-a-channel image, the most important thing on it is a crisp modern
 * dialog with antialiased type. It is the one smooth thing on a deliberately
 * rough screen.
 *
 * Drawn straight onto the finished frame, after the world's bloom chain has
 * run. A modal is nothing but type on a plate, so it is the last thing that
 * should be fed to a bright-pass.
 *
 * ── the ONE exception, and why it survives ─────────────────────────────────
 * A text field is still a real `<input>`, positioned over this panel while a
 * prompt is open. Not a compromise: Hangul is composed by an operating-system
 * IME — `한` is built from ᄒ, ᅡ and ᆫ as you type — and an IME only speaks to
 * real focusable fields. Drawing a keyboard here would mean reimplementing
 * Hangul composition, which is a project of its own and would be a worse
 * keyboard than the one already on the player's device.
 *
 * So the input is stripped to a transparent caret-and-glyphs box with no
 * chrome of its own: everything the player reads as the dialog — the veil, the
 * panel, the heading, the wrapped body, the buttons — is in the render target.
 * The exception is one line of text, and only while somebody is typing it.
 *
 * ── it is modal, so it takes the input ─────────────────────────────────────
 * Listeners are attached at the CAPTURE phase on the canvas while open, and
 * they stop propagation. Neither `PointerRouter` nor `bootMenu` has to learn
 * that a dialog exists, and neither can act underneath one — which is what
 * "modal" has to mean for a question like "leave and forfeit?".
 */

/** The virtual frame every overlay in this project is authored against. */
/** The layout box, in frame pixels. The shared, live one — see core/frame.js. */
const FRAME = SHARED_FRAME;

/**
 * 모달의 폭. 토큰이 상한이고, 좁은 프레임에서는 프레임이 이긴다.
 *
 * `SIZE.modal.w` 는 440 이고 640 프레임 기준이다. 800x459 창의 프레임은 421 이라
 * 그대로 쓰면 좌우가 화면 밖으로 나간다. 함수인 것은 창이 바뀌면 답도 바뀌기
 * 때문이다 — `_layout` 이 매번 다시 묻는다.
 */
function panelWidth() {
  return Math.min(SIZE.modal.w, FRAME.width - SPACE.md * 2);
}
/** 저술 크기. 실제 크기는 `frameScale()` 을 곱한 것이고 `_layout` 이 푼다. */
const BUTTON = { width: SIZE.buttonSecondary.w, height: SIZE.buttonSecondary.h };
const BUTTON_GAP = SPACE.sm;
/** Between the field and the button row. */
const BUTTON_DROP = SPACE.sm;
const FIELD_HEIGHT = SIZE.buttonSecondary.h;
/** 가림막의 최종 불투명도. 등장 동안 0 에서 여기까지 짙어진다. */
const VEIL_ALPHA = 0.52;

export class ModalLayer {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {object} opts.config
   */
  constructor({ canvas, config }) {
    this.canvas = canvas;
    this.config = config;
    this.open = false;

    this.scene = new Scene();
    this.camera = frameCamera();

    this.materials = new HudMaterials();
    this._quad = new PlaneGeometry(1, 1);

    /**
     * The veil.
     *
     * `createSolid` needs no texture, which is what makes it the right thing for
     * a flat dim: a mapped quad would be one more texture to hold for a
     * rectangle of one colour.
     */
    /**
     * 0.78 짜리 거의 검은 막이었다. 그 뒤의 화면이 사실상 사라졌다.
     *
     * 어두운 UI 위에서는 맞았다 — 이미 어두운 것을 조금 더 어둡게 하는 것은
     * 가라앉히는 일이다. 밝은 유리 위에서 같은 일을 하면 뒤가 **없어진다**, 그리고
     * 모달은 뒤를 지우는 것이 아니라 앞을 세우는 것이다. 뒤가 보여야 어디로
     * 돌아가는지 알 수 있고, 유리 판이 무언가 위에 떠 있다는 것도 그때만 읽힌다.
     *
     * 잉크는 팔레트의 깊은 파랑이다. 검정이 아닌 이유는 이 프로젝트에 순수한
     * 검정이 없기 때문이고(팔레트 감사 규칙 1), 색이 있는 막은 유리 아래에 물이
     * 있는 것처럼 보이기 때문이다.
     */
    this.veil = new Mesh(this._quad, this.materials.createSolid(VEIL_ALPHA));
    // `toRgb` 는 0..255 를 준다. 셰이더는 0..1 이다.
    const veilRgb = toRgb(PALETTE.accent.skyDeep).map((c) => c / 255);
    this.veil.material.uniforms.uTint.value.set(veilRgb[0], veilRgb[1], veilRgb[2]);
    this.veil.scale.set(FRAME.width, FRAME.height, 1);
    this.veil.renderOrder = 100;
    this.scene.add(this.veil);

    this.panel = new Mesh(this._quad, this.materials.create(null));
    this.panel.renderOrder = 101;
    this.scene.add(this.panel);

    /** Up to two, right-most first. Built once and re-labelled. */
    this.buttons = [0, 1].map(() => {
      const mesh = new Mesh(this._quad, this.materials.create(null));
      mesh.renderOrder = 102;
      mesh.scale.set(BUTTON.width, BUTTON.height, 1);
      mesh.visible = false;
      this.scene.add(mesh);
      return { mesh, id: null, label: '', tone: 'idle' };
    });

    /** The field's frame — drawn here; only the glyphs are DOM. */
    /**
     * 입력 칸의 홈. 하나의 텍스처 쿼드다.
     *
     * 예전에는 어두운 quad + 금색 테두리 quad 두 장이었다. 셰이더 uniform 에 손으로
     * 적힌 RGB 두 개였고 팔레트를 거치지 않았다 — 그래서 배경이 밝아진 뒤에도
     * 그대로 검었다. `slotTexture` 의 주석에 자세히 있다.
     */
    this.field = new Mesh(this._quad, this.materials.create(null));
    this.field.renderOrder = 102;
    this.field.visible = false;
    this.scene.add(this.field);

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this.hovered = null;

    this._input = null;
    this._resolve = null;
    this._onKey = null;
    this._bound = null;
    this.scene.visible = false;
  }

  // ── the three questions ──────────────────────────────────────────────────

  /** @returns {Promise<boolean>} */
  confirm({ title, body, confirmLabel = '확인', cancelLabel = '취소', danger = false }) {
    return this._show({
      title,
      body,
      accent: danger ? PALETTE.ui.danger : PALETTE.accent.cyan,
      /**
       * 부록 B2.2-1 — RETREAT 왼쪽, 실행 오른쪽. 순서가 곧 화면 순서다.
       *
       * `tone: 'hover'` 로 오른쪽을 강조하던 것은 없앴다. 그 시절에는 판 상태가
       * idle/hover 둘뿐이라 "이쪽이 기본 답" 을 말할 방법이 그것뿐이었고,
       * `skinFor` 가 호버를 idle 과 같은 스킨으로 접은 뒤로는 아무 말도 하지
       * 않고 있었다. 지금은 역할이 말한다.
       */
      buttons: [
        { id: 'cancel', label: cancelLabel, value: false, role: ROLE.RETREAT },
        {
          id: 'ok',
          label: confirmLabel,
          value: true,
          role: danger ? ROLE.DESTRUCTIVE : ROLE.COMMIT,
        },
      ],
      fallback: false,
    });
  }

  /** @returns {Promise<void>} */
  tell({ title, body, okLabel = '확인' }) {
    return this._show({
      title,
      body,
      accent: PALETTE.accent.cyan,
      buttons: [{ id: 'ok', label: okLabel, value: undefined, role: ROLE.COMMIT }],
      fallback: undefined,
    });
  }

  /**
   * One line of typed text.
   *
   * @param {(raw: string) => {ok: boolean, value?: string, message?: string}} [opts.validate]
   * @returns {Promise<string|null>}
   */
  prompt({
    title,
    body = '',
    initial = '',
    placeholder = '',
    maxLength = 32,
    confirmLabel = '확인',
    validate = null,
  }) {
    return this._show({
      title,
      body,
      accent: PALETTE.accent.cyan,
      field: { initial, placeholder, maxLength },
      validate,
      buttons: [
        { id: 'cancel', label: '취소', value: null, role: ROLE.RETREAT },
        // `submit` rather than a sentinel VALUE: this button runs the validator
        // and reads the field, which is a different action from "resolve with
        // this value" and deserves to say so. It replaces a magic string that
        // was also, unnoticed, carrying a NUL byte — which made the whole file
        // register as binary and invisible to grep.
        { id: 'ok', label: confirmLabel, submit: true, role: ROLE.COMMIT },
      ],
      fallback: null,
    });
  }

  // ── the machinery ────────────────────────────────────────────────────────

  _show(spec) {
    // A second question while one is open would leave the first unresolved
    // forever. There is never a legitimate case for it here.
    if (this.open) return Promise.resolve(spec.fallback);
    this._spec = spec;
    this.open = true;
    this.scene.visible = true;
    this.hovered = null;
    this._error = '';
    this._recheck(spec.field ? (spec.field.initial ?? '') : '');
    // 등장 진행도. 0 에서 시작해 `update` 가 민다.
    this._enter = 0;
    this._layout();
    if (spec.field) this._mountInput(spec.field);
    this._attach();
    return new Promise((resolve) => {
      this._resolve = resolve;
    });
  }

  /**
   * Is what is in the field acceptable right now?
   *
   * The SAME validator the submit button runs, so the enabled state and the
   * outcome of pressing it cannot disagree — a button that is lit and then
   * refuses is worse than one that was never lit. A dialog with no field is
   * always valid: there is nothing to be wrong.
   */
  _recheck(raw) {
    const spec = this._spec;
    if (!spec?.field) {
      this._valid = true;
      return;
    }
    if (!spec.validate) {
      this._valid = true;
      return;
    }
    this._valid = spec.validate(String(raw ?? '').trim())?.ok === true;
  }

  _finish(value) {
    if (!this.open) return;
    this.open = false;
    this.scene.visible = false;
    this._detach();
    this._unmountInput();
    const done = this._resolve;
    this._resolve = null;
    this._spec = null;
    done?.(value);
  }

  /**
   * Lay the panel and its buttons out, sized to whatever the text came to.
   *
   * Re-run whenever the body changes — a validation message becomes part of the
   * panel rather than a separate line, so the dialog grows to hold it and the
   * buttons move down with it.
   */
  _layout() {
    const spec = this._spec;
    if (!spec) return;
    const scale = this.config.ui?.textureScale ?? 1;

    const k = frameScale();
    const PANEL_WIDTH = panelWidth();
    const btnH = Math.round(BUTTON.height * k);
    const drop = Math.round(BUTTON_DROP * k);
    const gap = Math.round(BUTTON_GAP * k);
    const padIn = Math.round(SPACE.lg * k);
    const FIELD = { width: PANEL_WIDTH - padIn * 2, height: Math.round(FIELD_HEIGHT * k) };
    this._field = FIELD;
    const body = [spec.body, this._error].filter(Boolean).join('\n');

    /**
     * 판은 입력 칸과 버튼 줄까지 담는다.
     *
     * 예전에는 판 · 홈 · 버튼이 각각 떠 있었고, 어두운 스크림 위에서 서로 관계없는
     * 네 물체로 보였다. 판이 셋을 다 담으면 그게 하나의 질문으로 읽힌다.
     */
    const fieldH = spec.field ? FIELD.height + Math.round(SPACE.md * k) : 0;
    /**
     * 판이 자기 안에 비워 두어야 하는 두 공간이, 이제 둘로 나뉜다.
     *
     * `extra` 는 **내용**이고(입력 칸), `footerHeight` 는 구분선 아래의 **푸터**다.
     * 예전에는 하나였고, 그래서 구분선을 그릴 자리를 아무도 몰랐다.
     */
    const footerH = padIn + btnH + drop;

    const tex = modalTexture({
      title: spec.title,
      body,
      width: PANEL_WIDTH,
      scale,
      extra: fieldH,
      footerHeight: footerH,
      k,
      accent: this._error ? PALETTE.ui.danger : spec.accent,
    });
    const panelH = tex.userData?.height ?? 80;
    this.panel.material.uniforms.uMap.value = tex;
    this._panelW = PANEL_WIDTH;
    this._panelH = panelH;
    // 배율은 `_applyEnter` 가 넣는다. 여기서는 텍스처와 쉬는 크기만 정한다.
    this.panel.position.set(0, 0, 0);

    // 판 안쪽 아래에서 위로 쌓는다: 버튼 줄이 가장 아래, 그 위가 입력 칸.
    const inner = -panelH / 2 + padIn;
    const rowY = inner + btnH / 2;
    let y = inner + btnH + drop;

    if (spec.field) {
      const fy = y + FIELD.height / 2;
      // 쉬는 자리만 적어 둔다. 실제 배율·위치는 `_applyEnter` 가 등장 곡선과 함께
      // 넣는다 — 판만 커지고 안의 것들은 처음부터 제 크기였던 것이 이 분리가 없어서였다.
      this._fieldHome = { w: FIELD.width, h: FIELD.height, y: fy };
      this.field.material.uniforms.uMap.value = slotTexture(FIELD.width, FIELD.height, {
        focused: true,
        scale,
        accent: this._error ? PALETTE.ui.danger : PALETTE.accent.cyan,
      });
      this.field.visible = true;
      this._fieldY = fy;
      y = fy + FIELD.height / 2;
    } else {
      this.field.visible = false;
      this._fieldHome = null;
    }

    const row = spec.buttons;
    /**
     * 버튼 폭은 판 안에 들어가야 한다.
     *
     * 토큰의 160 짜리 버튼 두 개는 간격까지 336 이라 440 짜리 판에는 들어가지만
     * 421 프레임에서 판이 377 로 줄면 넘친다. 판을 기준으로 나눠 가지면 판이
     * 얼마가 되든 안에 있다.
     */
    const btnW = Math.min(
      Math.round(BUTTON.width * k),
      Math.floor((PANEL_WIDTH - padIn * 2 - (row.length - 1) * gap) / Math.max(1, row.length)),
    );
    const span = row.length * btnW + (row.length - 1) * gap;
    this.buttons.forEach((b, i) => {
      const def = row[i];
      if (!def) {
        b.mesh.visible = false;
        b.id = null;
        b.home = null;
        return;
      }
      b.id = def.id;
      b.value = def.value;
      b.submit = !!def.submit;
      // A submit button is dead until the field is acceptable. Everything else
      // — 취소, 확인 on a plain message — is always live.
      b.disabled = !!def.submit && !this._valid;
      b.baseTone = b.disabled ? 'disabled' : (def.tone ?? 'idle');
      b.role = def.role ?? null;
      const x = -span / 2 + btnW / 2 + i * (btnW + gap);
      b.home = { w: btnW, h: btnH, x, y: rowY };
      b.mesh.visible = true;
      const tone = !b.disabled && this.hovered === def.id ? 'hover' : b.baseTone;
      const stale =
        b.label !== def.label || b.tone !== tone || b.width !== btnW
        || b.height !== btnH || b.baked !== b.role;
      if (stale) {
        b.label = def.label;
        b.tone = tone;
        b.width = btnW;
        b.height = btnH;
        b.baked = b.role;
        b.mesh.material.uniforms.uMap.value = buttonTexture(def.label, tone, {
          width: btnW,
          height: btnH,
          scale,
          role: b.role,
        });
      }
    });

    this._applyEnter(overshoot(this._enter ?? 1));

    if (this._input) this._placeInput();
  }

  /**
   * 등장 곡선을 판과 **판 안의 모든 것**에 넣는다.
   *
   * ── 예전에는 판만 커졌다 ────────────────────────────────────────────────────
   * `update` 가 `panel.scale` 에만 `k` 를 곱하고, 버튼과 입력 칸에는 `uOpacity` 만
   * 줬다. 그래서 판이 0 에서 자라 오르는 0.24 초 동안 버튼 두 개는 처음부터 제
   * 크기·제 자리에 앉아 있었고 — 작은 판보다 크게 — 판 밖으로 삐져나와 있었다.
   * 판이 커지는 게 아니라 판만 따로 노는 것으로 보인 이유가 그것이다.
   *
   * 원점 기준 배율이라 **위치도 같이** 곱한다. 크기만 곱하면 버튼이 제자리에서
   * 작아졌다 커질 뿐, 판과 함께 모여들었다 퍼지지 않는다. 모달은 전부 원점을
   * 중심으로 배치돼 있으므로(판이 (0,0)) 이 곱 하나가 곧 원점 기준 스케일이다.
   *
   * `_layout` 끝에서도 부르는 것은 스냅 때문이다. 타이핑이 유효성을 바꾸거나
   * 호버가 바뀌면 등장 도중에도 `_layout` 이 돌고, 그때 쉬는 크기를 그대로 넣으면
   * 한 프레임 튄다.
   *
   * 글자가 리샘플되는 것은 등장 동안만이고, 판 자신이 이미 그렇게 하고 있다.
   */
  _applyEnter(k) {
    if (this._panelW === undefined) return;
    this.panel.scale.set(this._panelW * k, this._panelH * k, 1);
    for (const b of this.buttons) {
      if (!b.home) continue;
      b.mesh.scale.set(b.home.w * k, b.home.h * k, 1);
      b.mesh.position.set(b.home.x * k, b.home.y * k, 1);
    }
    const f = this._fieldHome;
    if (f) {
      this.field.scale.set(f.w * k, f.h * k, 1);
      this.field.position.set(0, f.y * k, 1);
      this.field.visible = true;
    }
  }

  // ── the one DOM element ──────────────────────────────────────────────────

  /**
   * A bare field, positioned over the panel's drawn slot.
   *
   * No border, no background, no font of its own beyond a monospace that
   * matches the plates — the box around it is geometry. What is left is a caret
   * and the glyphs the IME is composing, which is the part that cannot be
   * drawn here.
   */
  _mountInput({ initial, placeholder, maxLength }) {
    const el = document.createElement('input');
    el.type = 'text';
    el.value = initial ?? '';
    el.placeholder = placeholder ?? '';
    el.maxLength = maxLength ?? 32;
    el.autocomplete = 'off';
    el.spellcheck = false;
    el.setAttribute('autocapitalize', 'off');
    Object.assign(el.style, {
      position: 'fixed',
      margin: '0',
      padding: '0',
      border: 'none',
      outline: 'none',
      background: 'transparent',
      color: PALETTE.ui.text,
      textAlign: 'center',
      letterSpacing: '0.08em',
      zIndex: '30',
      caretColor: PALETTE.accent.cyan,
      // 등장 곡선과 함께 떠오른다. `update` 가 민다.
      opacity: '0',
    });
    el.addEventListener('input', () => {
      /**
       * The submit button follows the field, keystroke by keystroke.
       *
       * Cheaper than it looks: `_layout` only rebuilds a button's texture when
       * its label or tone actually changed, so typing inside a valid value
       * re-runs the validator and touches nothing else.
       */
      const had = this._error;
      this._error = '';
      const before = this._valid;
      this._recheck(el.value);
      if (had || before !== this._valid) this._layout();
    });
    document.body.appendChild(el);
    this._input = el;
    this._placeInput();
    el.focus();
    el.select();
  }

  /**
   * Map the drawn slot to CSS pixels.
   *
   * `Viewport` letterboxes the CANVAS ELEMENT itself to 4:3, so the canvas rect
   * IS the virtual frame — no letterbox arithmetic, and it stays correct when
   * the window is resized because the rect is re-read every time.
   */
  _placeInput() {
    const el = this._input;
    if (!el) return;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1) return;
    const sx = rect.width / FRAME.width;
    const sy = rect.height / FRAME.height;
    const field = this._field ?? { width: panelWidth() - SPACE.lg * 2, height: FIELD_HEIGHT };
    const w = (field.width - SPACE.md) * sx;
    const h = field.height * sy;
    el.style.left = `${rect.left + rect.width / 2 - w / 2}px`;
    el.style.top = `${rect.top + (FRAME.height / 2 - this._fieldY) * sy - h / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    // Sized to the frame, so the typed text is the size the panel around it was
    // drawn for however large the window is.
    /**
     * 화면의 나머지와 같은 서체.
     *
     * `ui-monospace` 였다. 이 프로젝트에서 남아 있던 마지막 시스템 폰트 참조이자,
     * 사용자가 자기 닉네임을 타이핑하는 유일한 곳이었다 — 입력하는 동안에는
     * 고정폭이고 확정하면 `MSA Sans` 로 바뀌니, 같은 글자가 두 번 다르게 보였다.
     *
     * 크기는 프레임에 맞춘다. `TYPE.body` 는 프레임 픽셀이고 `sy` 가 CSS 로 옮긴다.
     */
    const px = Math.max(11, Math.round(TYPE.body.size * sy));
    el.style.font = `${TYPE.body.weight} ${px}px ${FONT_FAMILY}`;
  }

  _unmountInput() {
    this._input?.remove();
    this._input = null;
  }

  // ── input ────────────────────────────────────────────────────────────────

  _attach() {
    /**
     * Capture phase, and every one stops propagation.
     *
     * That is the whole of "modal": the router and the menu keep their own
     * listeners and simply never see these events, so neither of them needs a
     * `if (dialogOpen)` branch and neither can act on a board that is currently
     * behind a question.
     */
    const stop = (e) => {
      e.stopPropagation();
      e.preventDefault();
    };
    const down = (e) => {
      stop(e);
      const hit = this.pick(e.clientX, e.clientY);
      if (hit) this._press(hit.id);
    };
    const move = (e) => {
      stop(e);
      const hit = this.pick(e.clientX, e.clientY);
      const id = hit?.id ?? null;
      if (id === this.hovered) return;
      this.hovered = id;
      this._cursor(id ? 'pointer' : 'default');
      this._layout();
    };
    const key = (e) => {
      if (e.key === 'Escape') {
        stop(e);
        this._press(this._spec?.buttons.find((b) => b.id === 'cancel')?.id ?? 'cancel');
      } else if (e.key === 'Enter' && !e.isComposing) {
        // Never mid-composition: Enter is how an IME commits a syllable, and
        // taking it as a submit would swallow the last character of every
        // Korean word typed into the field.
        stop(e);
        this._press('ok');
      }
    };

    this._bound = { down, move, key, stop };
    this.canvas.addEventListener('pointerdown', down, true);
    this.canvas.addEventListener('pointermove', move, true);
    this.canvas.addEventListener('pointerup', stop, true);
    window.addEventListener('keydown', key, true);
  }

  /**
   * The pointer's shape, set inline.
   *
   * ── it has to be set HERE, and inline is why ────────────────────────────
   * The menu drives its cursor by toggling classes on the canvas and the game
   * page sets `grab` in the stylesheet, and neither of them can help: this layer
   * swallows `pointermove` at the capture phase, so the screen underneath never
   * learns the pointer moved and never updates the cursor it owns. The pointer
   * sat as whatever it had been when the dialog opened, over buttons that were
   * plainly buttons.
   *
   * An inline style beats both the class rules and the stylesheet without this
   * file having to know either vocabulary, and clearing it on close hands the
   * cursor straight back to whichever of them was in charge.
   */
  _cursor(value) {
    this.canvas.style.cursor = value === 'default' ? '' : value;
  }

  _detach() {
    const b = this._bound;
    if (!b) return;
    this._cursor('default');
    this.canvas.removeEventListener('pointerdown', b.down, true);
    this.canvas.removeEventListener('pointermove', b.move, true);
    this.canvas.removeEventListener('pointerup', b.stop, true);
    window.removeEventListener('keydown', b.key, true);
    this._bound = null;
    this.hovered = null;
  }

  _press(id) {
    // Reachable from the keyboard as well as the pointer — `pick` already skips
    // a dead button, but Enter does not go through `pick`, so the guard has to
    // be here or a disabled 확인 would still fire on Enter.
    if (this.buttons.find((b) => b.id === id)?.disabled) return;
    const def = this._spec?.buttons.find((b) => b.id === id);
    if (!def) return;
    if (def.submit) {
      const raw = (this._input?.value ?? '').trim();
      const res = this._spec.validate ? this._spec.validate(raw) : { ok: true, value: raw };
      if (!res.ok) {
        // The message becomes part of the panel and the dialog grows to hold it,
        // rather than appearing in a slot that is empty the rest of the time.
        this._error = res.message ?? '사용할 수 없는 값입니다';
        this._layout();
        this._input?.focus();
        return;
      }
      this._finish(res.value ?? raw);
      return;
    }
    this._finish(def.value);
  }

  /** @returns {{id: string}|null} */
  pick(clientX, clientY) {
    if (!this.open) return null;
    const rect = this.canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, this.camera);
    this.scene.updateMatrixWorld(true);
    for (const b of this.buttons) {
      if (!b.mesh.visible || !b.id || b.disabled) continue;
      if (this._ray.intersectObject(b.mesh, false).length) return { id: b.id };
    }
    return null;
  }

  // ── frame ────────────────────────────────────────────────────────────────

  setResolution(_resolution) {
    // The frame can change shape now, so the ortho box has to follow. The
    // dialog itself is centred on the origin and needs no relayout; the DOM
    // input does, because it is positioned in CSS pixels off the canvas rect.
    refitFrameCamera(this.camera);
    if (this._input) this._placeInput();
  }

  /**
   * 등장. 판이 살짝 작은 데서 올라오고 가림막이 함께 짙어진다.
   *
   * ── 왜 등장이 필요한가 ────────────────────────────────────────────────────
   * 예전에는 즉시였다. 모달은 화면에서 가장 갑작스러운 것이고 — 뒤의 모든 것을
   * 막는다 — 갑작스러운 것이 갑자기 나타나면 무엇이 일어났는지 읽을 시간이 없다.
   * 0.24초(`MOTION.panel`) 짜리 오버슛 하나면 눈이 판을 따라가고, 따라간 눈은
   * 이미 판 위에 있다.
   *
   * 사라지는 것에는 대칭이 없다. 모달이 닫히는 것은 답을 골랐다는 뜻이고, 답을
   * 고른 뒤에 화면이 0.24초 더 붙잡고 있으면 그건 응답이 느린 것으로 느껴진다.
   */
  update(dt) {
    if (!this.open) return;
    const before = this._enter ?? 1;
    this._enter = approach(before, 1, dt, MOTION.panel);
    if (before === this._enter) return;

    const k = overshoot(this._enter);
    this._applyEnter(k);
    for (const b of this.buttons) b.mesh.material.uniforms.uOpacity.value = k;
    this.field.material.uniforms.uOpacity.value = k;
    this.panel.material.uniforms.uOpacity.value = k;
    this.veil.material.uniforms.uOpacity.value = VEIL_ALPHA * easeOut(this._enter);
    /**
     * DOM 입력만은 **크기가 아니라 불투명도**로 따라온다.
     *
     * 그려지는 홈은 판과 함께 자라지만, 그 위의 `<input>` 은 제자리·제 크기로
     * 남는다. 배율을 넣지 않는 이유는 포커스다 — `_mountInput` 이 붙자마자
     * `focus()` 를 부르는데 그 순간 `_enter` 는 0 이고, 0x0 짜리 요소에 포커스를
     * 주면 iOS 가 키보드를 올려 주지 않는다. 커서 하나와 글자 몇 개가 자라는 홈
     * 위로 **떠오르는** 것으로 충분하고, 그동안 칸은 대개 비어 있다.
     */
    if (this._input) this._input.style.opacity = String(easeOut(this._enter));
  }

  render(renderer) {
    if (!this.open) return;
    // In front by definition rather than by being nearer — the same three lines
    // as every other overlay in this project.
    renderer.clearDepth();
    renderer.autoClear = false;
    renderer.render(this.scene, this.camera);
    renderer.autoClear = true;
  }

  dispose() {
    this._detach();
    this._unmountInput();
    this._quad.dispose();
    this.materials.dispose();
    this.scene.clear();
  }
}
