import { Mesh, PlaneGeometry, Raycaster, Scene, Vector2 } from 'three';
import { FRAME as SHARED_FRAME, frameCamera, refitFrameCamera } from '../core/frame.js';
import { HudMaterials } from './HudMaterial.js';
import { buttonTexture, modalTexture } from './hudTextures.js';
import { PALETTE } from '../core/palette.js';

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

const PANEL_WIDTH = 320;
const BUTTON = { width: 120, height: 32 };
const BUTTON_GAP = 8;
/** Between the panel's bottom edge and the button row. */
const BUTTON_DROP = 10;
/** The text field's box, when there is one. */
const FIELD = { width: PANEL_WIDTH - 28, height: 30 };

export class ModalLayer {
  /**
   * @param {object} opts
   * @param {HTMLCanvasElement} opts.canvas
   * @param {import('three').Vector2} opts.resolution
   * @param {object} opts.config
   */
  constructor({ canvas, resolution, config }) {
    this.canvas = canvas;
    this.config = config;
    this.open = false;

    this.scene = new Scene();
    this.camera = frameCamera();

    this.materials = new HudMaterials({ resolution });
    this._quad = new PlaneGeometry(1, 1);

    /**
     * The veil.
     *
     * `createSolid` needs no texture, which is what makes it the right thing for
     * a flat dim: a mapped quad would be one more texture to hold for a
     * rectangle of one colour.
     */
    this.veil = new Mesh(this._quad, this.materials.createSolid(0.78));
    this.veil.material.uniforms.uTint.value.set(0.03, 0.04, 0.055);
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
    this.field = new Mesh(this._quad, this.materials.createSolid(1));
    this.field.material.uniforms.uTint.value.set(0.05, 0.07, 0.1);
    this.field.renderOrder = 102;
    this.field.visible = false;
    this.scene.add(this.field);
    this.fieldEdge = new Mesh(this._quad, this.materials.createSolid(1));
    this.fieldEdge.material.uniforms.uTint.value.set(0.85, 0.71, 0.36);
    this.fieldEdge.renderOrder = 101;
    this.fieldEdge.visible = false;
    this.scene.add(this.fieldEdge);

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
      buttons: [
        { id: 'cancel', label: cancelLabel, value: false },
        { id: 'ok', label: confirmLabel, value: true, tone: 'hover' },
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
      buttons: [{ id: 'ok', label: okLabel, value: undefined, tone: 'hover' }],
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
        { id: 'cancel', label: '취소', value: null },
        // `submit` rather than a sentinel VALUE: this button runs the validator
        // and reads the field, which is a different action from "resolve with
        // this value" and deserves to say so. It replaces a magic string that
        // was also, unnoticed, carrying a NUL byte — which made the whole file
        // register as binary and invisible to grep.
        { id: 'ok', label: confirmLabel, submit: true, tone: 'hover' },
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

    const body = [spec.body, this._error].filter(Boolean).join('\n');
    const tex = modalTexture({
      title: spec.title,
      body,
      width: PANEL_WIDTH,
      scale,
      accent: this._error ? PALETTE.ui.danger : spec.accent,
    });
    const panelH = tex.userData?.height ?? 80;
    this.panel.material.uniforms.uMap.value = tex;
    this.panel.scale.set(PANEL_WIDTH, panelH, 1);

    // The whole stack is centred on the frame: panel, then the field, then the
    // button row, measured as one block so it does not drift as the text grows.
    const fieldH = spec.field ? FIELD.height + 10 : 0;
    const stackH = panelH + fieldH + BUTTON_DROP + BUTTON.height;
    const top = stackH / 2;

    const panelY = top - panelH / 2;
    this.panel.position.set(0, panelY, 0);

    let y = panelY - panelH / 2;
    if (spec.field) {
      y -= 10 + FIELD.height / 2;
      this.field.scale.set(FIELD.width, FIELD.height, 1);
      this.field.position.set(0, y, 1);
      this.fieldEdge.scale.set(FIELD.width + 4, FIELD.height + 4, 1);
      this.fieldEdge.position.set(0, y, 0.5);
      this.field.visible = true;
      this.fieldEdge.visible = true;
      this._fieldY = y;
      y -= FIELD.height / 2;
    } else {
      this.field.visible = false;
      this.fieldEdge.visible = false;
    }

    const row = spec.buttons;
    const span = row.length * BUTTON.width + (row.length - 1) * BUTTON_GAP;
    const rowY = y - BUTTON_DROP - BUTTON.height / 2;
    this.buttons.forEach((b, i) => {
      const def = row[i];
      if (!def) {
        b.mesh.visible = false;
        b.id = null;
        return;
      }
      b.id = def.id;
      b.value = def.value;
      b.submit = !!def.submit;
      // A submit button is dead until the field is acceptable. Everything else
      // — 취소, 확인 on a plain message — is always live.
      b.disabled = !!def.submit && !this._valid;
      b.baseTone = b.disabled ? 'disabled' : (def.tone ?? 'idle');
      const x = -span / 2 + BUTTON.width / 2 + i * (BUTTON.width + BUTTON_GAP);
      b.mesh.position.set(x, rowY, 1);
      b.mesh.visible = true;
      const tone = !b.disabled && this.hovered === def.id ? 'hover' : b.baseTone;
      if (b.label !== def.label || b.tone !== tone) {
        b.label = def.label;
        b.tone = tone;
        b.mesh.material.uniforms.uMap.value = buttonTexture(def.label, tone, {
          ...BUTTON,
          scale,
        });
      }
    });

    if (this._input) this._placeInput();
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
    const w = (FIELD.width - 12) * sx;
    const h = FIELD.height * sy;
    el.style.left = `${rect.left + rect.width / 2 - w / 2}px`;
    el.style.top = `${rect.top + (FRAME.height / 2 - this._fieldY) * sy - h / 2}px`;
    el.style.width = `${w}px`;
    el.style.height = `${h}px`;
    // Sized to the frame, so the typed text is the size the panel around it was
    // drawn for however large the window is.
    el.style.fontSize = `${Math.max(9, Math.round(15 * sy))}px`;
    el.style.font = `${Math.max(9, Math.round(15 * sy))}px ui-monospace, Menlo, monospace`;
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

  setResolution(resolution) {
    this.materials.setResolution(resolution);
    // The frame can change shape now, so the ortho box has to follow. The
    // dialog itself is centred on the origin and needs no relayout; the DOM
    // input does, because it is positioned in CSS pixels off the canvas rect.
    refitFrameCamera(this.camera);
    if (this._input) this._placeInput();
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
