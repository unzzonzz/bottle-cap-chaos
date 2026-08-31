import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';
import { toMarkTexture } from '../marks/markTextures.js';
import { PALETTE } from '../core/palette.js';

/**
 * 설정 — a heading, the things it holds, and a way back.
 *
 * It was empty on purpose for a long time: "설정 화면 내용은 스코프 밖. 진입만
 * 되면 된다" was the whole brief, and filling it with plausible-looking sliders
 * would have invented scope. It still exists as a real scene rather than a stub
 * because it is what proves the transition end to end WITHOUT a page
 * navigation: cap covers, scene swaps underneath, cap flies out and reveals
 * something that was already there.
 *
 * 내 마크 is its first actual contents, and it is a LIST rather than the marks
 * themselves — the grid needs the whole frame, so it is its own screen and this
 * one points at it. That also keeps the brief's "유일한 진입점" honest: there is
 * one door into the mark editor and it is this row.
 *
 * ── the sound rows, and why the volume is STEPPED ───────────────────────────
 * This screen has exactly one control idiom — a 256x52 plate that answers a
 * press — and the brief asks for the existing style to be followed rather than
 * for a new one to be designed. A continuous drag slider is a new one: it needs
 * a track, a thumb, a grab, a drag that survives leaving the plate, and a
 * pointer protocol this page does not have (nothing on the menu is draggable
 * except the mark editor's turntable, which is why `bootMenu` says so in its
 * cursor table).
 *
 * Ten chips is the same control the page already has, ten times. It reads at a
 * glance, it is one press per change, it needs no new gesture, and it is exactly
 * the arrangement `MarkEditor` uses for its palette — a row of small quads whose
 * selected state is recomputed from the model on every refresh rather than
 * stored. The percentage is on the plate above it, so the value is legible as a
 * number as well as as a bar.
 *
 * ── 음소거 is the eraser ────────────────────────────────────────────────────
 * The mute row is the editor's eraser button in plate form: a boolean flipped on
 * press, drawn by re-deriving the label and the skin in `refresh`. Nothing about
 * its state is held here; the settings model owns it and this subscribes, so a
 * change made from the debug panel repaints this screen without either of them
 * knowing about the other.
 *
 * A 브러시 소리 row sat below it until the stroke tick was removed on the
 * player's instruction. Its absence is why the two link rows moved up.
 */

/** Frame pixels. The whole layout, in one place. */
const L = {
  titleY: 176,
  /** 58 is the plate height plus a six-pixel gutter. */
  pitch: 58,
  plate: { width: 256, height: 52 },
  /** The volume chips, and the row they sit on. */
  chip: { width: 22, height: 22, gap: 5 },
  chipY: 70,
  steps: 10,
};

/**
 * Row order, top to bottom.
 *
 * 닉네임 is an `action`: a row this screen handles itself, like the audio rows,
 * rather than a `link` that `bootMenu` turns into a navigation. It is not gated
 * on `audioSettings` — see the filter in the constructor — because a player with
 * no audio model still has a name.
 */
const ROWS = [
  { id: 'volume', kind: 'readout', y: 124 },
  // The chip row lives between these two; see `chipY`.
  { id: 'mute', kind: 'toggle', y: 22 },
  { id: 'nickname', kind: 'action', y: -36 },
  { id: 'server', kind: 'action', y: -94 },
  { id: 'marks', kind: 'link', y: -152 },
  { id: 'back', kind: 'link', y: -210 },
];

export class SettingsScene {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} unitsPerPixel
   * @param {import('../audio/AudioSettings.js').AudioSettingsBook} [audioSettings]
   *   The sound rows are only built when there is a model behind them, so a
   *   caller that has no audio gets exactly the screen this used to be.
   */
  constructor({ retro, unitsPerPixel, audioSettings = null, profile = null, modal = null }) {
    this.root = new Group();
    this.audioSettings = audioSettings;
    /**
     * The nickname model, or null.
     *
     * Injected exactly as `audioSettings` is, and for the same reason: this
     * screen subscribes and repaints, so a name changed from anywhere else —
     * the online menu asks for one too — shows up here without either side
     * knowing about the other.
     */
    this.profile = profile;
    /** The scene's questions, drawn as geometry. See `ui/ModalLayer.js`. */
    this.modal = modal;
    const u = unitsPerPixel;
    this._u = u;
    this._retro = retro;

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: titleTexture('설정', '') }),
    );
    // Same 1:1 texel-to-pixel rule as the menu's plates — see `MenuItems`.
    this.title.scale.set(256 * u, 80 * u, 1);
    this.title.position.set(0, L.titleY * u, 0);
    this.root.add(this.title);

    /** @type {Array<{id: string, kind: string, mesh: object, maps: object, label: string}>} */
    this.items = [];
    for (const def of ROWS) {
      // The audio rows need a model behind them; 닉네임 and the two links do not.
      if (!audioSettings && def.kind !== 'link' && def.kind !== 'action') continue;
      // Both profile rows need a model behind them, the same way the audio rows
      // need theirs.
      if ((def.id === 'nickname' || def.id === 'server') && !profile) continue;
      this.items.push(this._buildRow(def));
    }

    /** @type {Array<{index: number, mesh: object}>} */
    this.chips = [];
    if (audioSettings) this._buildChips();

    this._ray = new Raycaster();
    this._ndc = new Vector2();
    this._hovered = null;

    this._off = audioSettings?.onChange(() => this.refresh());
    this._offProfile = profile?.onChange(() => this.refresh());
    this.refresh();
  }

  _buildRow(def) {
    const u = this._u;
    const maps = { idle: null, hover: null };
    const mesh = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(this._retro, { map: null }),
    );
    mesh.scale.set(L.plate.width * u, L.plate.height * u, 1);
    mesh.position.set(0, def.y * u, 0);
    this.root.add(mesh);
    return { ...def, mesh, maps, label: null };
  }

  /**
   * The volume chips.
   *
   * Ten of them, so one press is ten percent and the whole range is two presses
   * from either end. Zero is not a chip: that is what 음소거 is for, and a slider
   * that can be dragged to silence AND a mute toggle are two controls for one
   * state, which is how they end up disagreeing.
   */
  _buildChips() {
    const u = this._u;
    const span = L.steps * L.chip.width + (L.steps - 1) * L.chip.gap;
    for (let i = 0; i < L.steps; i++) {
      const x = -span / 2 + L.chip.width / 2 + i * (L.chip.width + L.chip.gap);
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(this._retro, { map: chipTexture(false, 'idle') }),
      );
      mesh.scale.set(L.chip.width * u, L.chip.height * u, 1);
      mesh.position.set(x * u, L.chipY * u, 0);
      this.root.add(mesh);
      this.chips.push({ index: i, mesh });
    }
  }

  // ── state ─────────────────────────────────────────────────────────────────

  /** What each row says right now. Derived, never stored. */
  _labelFor(id) {
    const s = this.audioSettings;
    switch (id) {
      case 'volume':
        return `마스터 볼륨   ${Math.round((s?.volume ?? 0) * 100)}%`;
      case 'mute':
        return `음소거   ${s?.muted ? '켬' : '끔'}`;
      case 'nickname':
        // '없음' rather than a blank: an empty right-hand column reads as a
        // broken row, and "you have not chosen one" is the thing worth saying.
        return `닉네임   ${this.profile?.nickname || '없음'}`;
      case 'server':
        /**
         * '자동' is a real answer, not an empty one.
         *
         * Unset means the address is derived from wherever this page came from
         * — which is what makes two devices on one network work with nothing
         * typed. Showing a blank there would read as broken; showing the
         * derived URL would read as a setting somebody had chosen.
         */
        return `서버   ${this.profile?.server || '자동'}`;
      case 'marks':
        return '내 마크';
      case 'back':
        return '◀ 메뉴로';
      default:
        return id;
    }
  }

  /**
   * Re-derive every control from the model.
   *
   * One function pushes the whole screen, exactly as `MarkEditor.refresh` does —
   * handlers mutate and call this rather than updating at the point of change,
   * so there is one place where what is on screen is decided.
   *
   * `menuPlateTexture` allocates a fresh texture per call and nothing caches it,
   * so a row whose text changed disposes its old pair before building the new
   * one. A row whose text did not change is left entirely alone.
   */
  refresh() {
    for (const item of this.items) {
      const label = this._labelFor(item.id);
      if (label !== item.label) {
        item.maps.idle?.dispose();
        item.maps.hover?.dispose();
        item.maps.idle = menuPlateTexture(label, 'idle', L.plate);
        item.maps.hover = menuPlateTexture(label, 'hover', L.plate);
        item.label = label;
      }
      const hot = this._hovered === item.id;
      item.mesh.material.uniforms.uMap.value = hot ? item.maps.hover : item.maps.idle;
    }

    const volume = this.audioSettings?.volume ?? 0;
    const muted = !!this.audioSettings?.muted;
    for (const chip of this.chips) {
      // Recomputed rather than stored, so there is one source of truth — the
      // same rule `MarkEditor`'s swatches follow.
      const filled = !muted && volume >= (chip.index + 1) / L.steps - 1e-6;
      const hot = this._hovered === `vol:${chip.index}`;
      chip.mesh.material.uniforms.uMap.value = chipTexture(filled, hot ? 'hover' : 'idle');
    }
  }

  // ── pointer ───────────────────────────────────────────────────────────────

  /** @returns {{id: string}|null} */
  pick(canvas, camera, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);
    // The chips are asked first: they are small and they sit between two plates,
    // and registration order is pick order.
    for (const chip of this.chips) {
      if (this._ray.intersectObject(chip.mesh, false).length) return { id: `vol:${chip.index}` };
    }
    for (const item of this.items) {
      // A readout is not a control. It must not answer a press, or the row
      // showing the volume would swallow one aimed at the chips below it.
      if (item.kind === 'readout') continue;
      if (this._ray.intersectObject(item.mesh, false).length) return { id: item.id };
    }
    return null;
  }

  /**
   * @param {{id: string}|boolean|null} hit
   *   A boolean is still accepted because that is what this took when there was
   *   one row to hover, and `bootMenu` has more than one caller shape.
   */
  setHover(hit) {
    const id = hit && typeof hit === 'object' ? hit.id : hit ? 'back' : null;
    if (id === this._hovered) return;
    this._hovered = id;
    this.refresh();
  }

  /**
   * Act on a press this screen owns.
   *
   * @returns {boolean} true when it was consumed. `marks` and `back` are
   *   navigation and are deliberately NOT consumed — they belong to `bootMenu`,
   *   which owns every screen change.
   */
  activate(hit) {
    const id = hit?.id;
    if (!id) return false;

    // ABOVE the audio guard, deliberately: the nickname has nothing to do with
    // sound, and a build with no audio model must still be able to set a name.
    if (id === 'server' && this.profile) {
      this._editServer().catch((err) => console.error('[settings] server entry failed', err));
      return true;
    }

    if (id === 'nickname' && this.profile) {
      // Reported rather than dropped. `activate` must return a boolean now, so
      // this cannot be awaited — and an unawaited rejection is invisible: a
      // syntax error in the entry module made this row do nothing at all, with
      // no console output and no failed press, which took far longer to find
      // than it should have.
      this._editNickname().catch((err) => console.error('[settings] nickname entry failed', err));
      return true;
    }

    if (!this.audioSettings) return false;

    if (id.startsWith('vol:')) {
      const step = Number(id.slice(4)) + 1;
      this.audioSettings.setVolume(step / L.steps);
      // Choosing a volume is choosing to hear something. Leaving mute on would
      // make the chips move and nothing happen — the same argument the editor
      // makes for a colour press clearing the eraser.
      this.audioSettings.setMuted(false);
      return true;
    }
    if (id === 'mute') {
      this.audioSettings.toggleMuted();
      return true;
    }
    return false;
  }

  /**
   * Open the text field, and put whatever comes back into the model.
   *
   * Async and unawaited: `activate` is called from a pointer handler that has to
   * return a boolean immediately, and the overlay lives for as long as somebody
   * is typing into it. The row repaints through the model's own change
   * notification rather than from here, so the two paths into a nickname — this
   * and the online menu — cannot repaint differently.
   */
  async _editNickname() {
    if (!this.modal) return;
    const { validateNickname } = await import('../net/protocol.js');
    const value = await this.modal.prompt({
      title: '닉네임',
      body: '한글 또는 영문 2~10자. 숫자·공백·특수문자는 쓸 수 없습니다.',
      initial: this.profile.nickname,
      maxLength: 10,
      // The SAME rule the server enforces, imported rather than restated — a
      // second copy is how the two come to disagree about a name.
      validate: (raw) => validateNickname(raw),
    });
    if (value === null) return;
    this.profile.setNickname(value);
    this.refresh();
  }

  /**
   * Where the relay is.
   *
   * Blank clears it back to automatic. Validated only for being a WebSocket URL
   * — whether anything is listening there is a question only connecting can
   * answer, and refusing an address because it is not up yet would be worse than
   * letting the connection fail with a message.
   */
  async _editServer() {
    if (!this.modal) return;
    const value = await this.modal.prompt({
      title: '서버 주소',
      body: '비워두면 접속한 주소에서 자동으로 찾습니다. 예: ws://192.168.0.9:8787',
      initial: this.profile.server,
      placeholder: '자동',
      maxLength: 120,
      validate: (raw) => {
        if (!raw) return { ok: true, value: '' };
        if (!/^wss?:\/\/.+/i.test(raw)) {
          return { ok: false, message: 'ws:// 또는 wss:// 로 시작해야 합니다' };
        }
        return { ok: true, value: raw };
      },
    });
    if (value === null) return;
    this.profile.setServer(value);
    this.refresh();
  }

  update() {}

  dispose() {
    this._off?.();
    this._offProfile?.();
    this.title.geometry.dispose();
    this.title.material.uniforms.uMap.value.dispose();
    this.title.material.dispose();
    for (const item of this.items) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      // Safe to dispose: `menuTextures` has no cache and allocated these for us.
      item.maps.idle?.dispose();
      item.maps.hover?.dispose();
    }
    for (const chip of this.chips) {
      chip.mesh.geometry.dispose();
      chip.mesh.material.dispose();
    }
    this.root.clear();
  }
}

/**
 * One volume chip, cached.
 *
 * Module-private with its own map, which is the pattern `MarkEditor.swatchTexture`
 * sets: a screen owns its one-off control art rather than adding a one-screen
 * entry to the shared `markIcons` module — where `clearIconCache()` would
 * dispose it out from under this screen.
 *
 * The palette is `markIcons`' SKINS, quoted rather than re-invented. Two colours
 * closer than about a thirty-second apart on every channel arrive identical
 * through the 5-bit quantiser, so a new accent is not free.
 */
const chipCache = new Map();

function chipTexture(filled, state) {
  const key = `${filled}:${state}`;
  const hit = chipCache.get(key);
  if (hit) return hit;

  const skin = filled
    ? { bg: PALETTE.button.active.bg, edge: PALETTE.button.active.edge }
    : state === 'hover'
      ? { bg: PALETTE.button.hover.bg, edge: PALETTE.button.hover.edge }
      : { bg: PALETTE.button.idle.bg, edge: PALETTE.button.idle.edge };

  const canvas = document.createElement('canvas');
  canvas.width = L.chip.width;
  canvas.height = L.chip.height;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = skin.edge;
  ctx.fillRect(0, 0, L.chip.width, L.chip.height);
  ctx.fillStyle = skin.bg;
  ctx.fillRect(1, 1, L.chip.width - 2, L.chip.height - 2);
  if (filled) {
    ctx.fillStyle = PALETTE.menu.meterOn;
    ctx.fillRect(4, 4, L.chip.width - 8, L.chip.height - 8);
  }

  const tex = toMarkTexture(canvas);
  chipCache.set(key, tex);
  return tex;
}
