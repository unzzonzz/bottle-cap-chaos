import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';
import { toMarkTexture } from '../marks/markTextures.js';
import { PALETTE } from '../core/palette.js';
import { PLATE_TEXEL_SCALE, solveColumn } from './columnLayout.js';
import { gelButton, roundRectPath } from '../ui/glass.js';
import { hoverPlates } from '../ui/motion.js';

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

/**
 * 이 화면만의 크기. 세로 배치는 `columnLayout.solveColumn` 이 푼다.
 *
 * ── 좌표가 아니라 순서를 저술한다 ───────────────────────────────────────────
 * 예전에는 titleY 176, 행 y 가 124 / 22 / -36 / -94 / -152 / -210 이었다. 위에서
 * 아래까지 452 픽셀이고 480 짜리 프레임에서는 들어간다. 800x459 창의 프레임은
 * 316 이라 제목도 마지막 두 줄도 화면 밖이었다. 이유와 해법은 `columnLayout.js`
 * 머리말에 있다.
 */
const L = {
  chip: { width: 22, height: 22, gap: 5 },
  steps: 10,
  titleHeight: 64,
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
  { id: 'volume', kind: 'readout' },
  // 칩 줄은 이 바로 아래에 들어간다. `_place` 를 보라.
  { id: 'mute', kind: 'toggle' },
  { id: 'nickname', kind: 'action' },
  /**
   * 서버 주소는 `?debug=1` 뒤로 접었다 (PHASE 5 승인 항목 3).
   *
   * LAN 개발용이다 — 비워 두면 이 페이지가 온 곳에서 주소를 유도하고, 그게 같은
   * 네트워크의 두 기기가 아무것도 입력하지 않고 붙는 이유다. 그러니 평소에는
   * 고를 것이 없는 줄이고, 세로 화면에서는 그 한 줄 때문에 다른 줄이 잘렸다.
   */
  { id: 'server', kind: 'action', debugOnly: true },
  { id: 'marks', kind: 'link' },
  { id: 'back', kind: 'link' },
];

/** `?debug=1` 인가. 모듈 로드 시 한 번. */
const DEBUG = (() => {
  try {
    return new URLSearchParams(location.search).get('debug') === '1';
  } catch {
    return false;
  }
})();

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

    /** 이번 프레임에서 푼 배치. `layout()` 이 채운다. */
    this._box = null;
    this._chip = L.chip;

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.root.add(this.title);

    /** @type {Array<{id: string, kind: string, mesh: object, maps: object, label: string}>} */
    this.items = [];
    for (const def of ROWS) {
      // The audio rows need a model behind them; 닉네임 and the two links do not.
      if (!audioSettings && def.kind !== 'link' && def.kind !== 'action') continue;
      // Both profile rows need a model behind them, the same way the audio rows
      // need theirs.
      if ((def.id === 'nickname' || def.id === 'server') && !profile) continue;
      if (def.debugOnly && !DEBUG) continue;
      this.items.push(this._buildRow(def));
    }

    /** @type {Array<{index: number, mesh: object}>} */
    this.chips = [];
    if (audioSettings) this._buildChips();
    this.layout(u);

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
    for (let i = 0; i < L.steps; i++) {
      const mesh = new Mesh(
        new PlaneGeometry(1, 1),
        createSpriteMaterial(this._retro, { map: null }),
      );
      this.root.add(mesh);
      this.chips.push({ index: i, mesh });
    }
  }

  /**
   * 제목 · 행 · 칩 줄을 위에서 아래로 쌓고, 덩어리를 프레임 세로 가운데에 놓는다.
   *
   * ── 좌표가 아니라 순서가 저술된 이유 ────────────────────────────────────
   * 행 하나가 사라질 수 있다: 오디오 모델이 없으면 볼륨과 음소거가 없고, 프로필이
   * 없으면 닉네임이 없고, `?debug=1` 이 아니면 서버 줄이 없다. 좌표를 손으로
   * 적어 두면 그 조합마다 구멍이 생긴다. 쌓으면 어떤 조합이든 붙어서 내려온다.
   *
   * 리사이즈에도 다시 불린다 — 프레임이 바뀌면 판 크기와 간격이 둘 다 바뀐다.
   */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;
    const hasChips = this.chips.length > 0;

    const slots = [{ id: '#title', h: L.titleHeight }];
    for (const item of this.items) {
      slots.push({ id: item.id });
      if (hasChips && item.id === 'volume') slots.push({ id: '#chips', h: L.chip.height });
    }

    const box = solveColumn(slots);
    this._box = box;
    const at = (id) => box.rows.find((r) => r.id === id);

    const title = at('#title');
    this.title.scale.set(box.plate.width * u, title.h * u, 1);
    this.title.position.set(0, title.y * u, 0);
    this._titleHeight = title.h;

    for (const item of this.items) {
      const row = at(item.id);
      item.mesh.scale.set(box.plate.width * u, row.h * u, 1);
      item.mesh.position.set(0, row.y * u, 0);
    }

    if (hasChips) {
      const row = at('#chips');
      const cw = Math.round(L.chip.width * box.k);
      const cg = Math.round(L.chip.gap * box.k);
      const span = L.steps * cw + (L.steps - 1) * cg;
      this._chip = { width: cw, height: Math.min(row.h, cw), gap: cg };
      this.chips.forEach((chip, i) => {
        const x = -span / 2 + cw / 2 + i * (cw + cg);
        chip.mesh.scale.set(this._chip.width * u, this._chip.height * u, 1);
        chip.mesh.position.set(x * u, row.y * u, 0);
      });
    }

    // 판 크기가 바뀌었으면 텍스처를 다시 굽는다. `refresh` 는 라벨이 같으면
    // 건너뛰므로, 라벨을 지워서 강제한다.
    const key = `${box.plate.width}x${box.plate.height}`;
    if (key !== this._plateKey) {
      this._plateKey = key;
      for (const item of this.items) item.label = null;
      this._titleKey = null;
      chipCache.clear();
    }
    this.refresh();
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
    const box = this._box;
    const size = { width: box.plate.width, height: box.plate.height, scale: PLATE_TEXEL_SCALE };

    if (this._titleKey !== `${box.plate.width}x${this._titleHeight}`) {
      this._titleKey = `${box.plate.width}x${this._titleHeight}`;
      const old = this.title.material.uniforms.uMap.value;
      this.title.material.uniforms.uMap.value = titleTexture('설정', '', {
        width: box.plate.width,
        height: this._titleHeight,
        scale: PLATE_TEXEL_SCALE,
      });
      old?.dispose();
    }

    for (const item of this.items) {
      const label = this._labelFor(item.id);
      if (label !== item.label) {
        item.maps.idle?.dispose();
        item.maps.hover?.dispose();
        item.maps.idle = menuPlateTexture(label, 'idle', size);
        item.maps.hover = menuPlateTexture(label, 'hover', size);
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
      chip.mesh.material.uniforms.uMap.value = chipTexture(filled, hot ? 'hover' : 'idle', this._chip);
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

  /**
   * 호버 배율. 텍스처 교체는 `refresh` 가 하고, 여기는 **움직임**만 한다.
   *
   * 둘을 나누는 이유는 빈도다. 텍스처는 라벨이 바뀔 때만 다시 구워야 하고 —
   * 매 프레임 구우면 캔버스 호출 수십 번이다 — 배율은 매 프레임 조금씩 움직여야
   * 한다.
   */
  update(dt) {
    const box = this._box;
    if (!box) return;
    const rows = this.items.map((it) => ({
      id: it.id,
      mesh: it.mesh,
      w: box.plate.width,
      h: box.rows.find((r) => r.id === it.id)?.h ?? box.plate.height,
    }));
    hoverPlates(rows, this._hovered, dt, this._u, (this._motion ??= {}));
  }

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
 * 볼륨 칩 하나. 캐시된다.
 *
 * 모듈 사설 캐시를 쓰는 것은 `MarkEditor.swatchTexture` 가 세운 패턴이다: 한
 * 화면에서만 쓰는 컨트롤 그림은 그 화면이 들고 있는다. 공용 `markIcons` 에 넣으면
 * `clearIconCache()` 가 이 화면 아래에서 그걸 없애 버린다.
 *
 * ── 각진 사각형에서 알약으로 ────────────────────────────────────────────────
 * 예전에는 1픽셀 테두리 사각형에 안쪽 사각형을 채운 것이었고, 밖으로 필터가 꺼져
 * 있었다("`imageSmoothingEnabled = false`"). 이 화면에서 유일하게 각진 것이었고,
 * 열 개가 나란히 있으니 유일하다는 사실이 눈에 띄었다.
 *
 * 이제 알약이다. 채워진 칩은 젤 버튼의 `selected` 상태를, 빈 칩은 유리의
 * 가라앉은 바탕을 쓴다 — 같은 어휘라 볼륨 줄이 이 화면의 다른 컨트롤과 한 벌로
 * 읽힌다.
 */
const chipCache = new Map();

function chipTexture(filled, state, size = L.chip) {
  const w = Math.max(4, Math.round(size.width));
  const h = Math.max(4, Math.round(size.height));
  const key = `${filled}:${state}:${w}x${h}`;
  const hit = chipCache.get(key);
  if (hit) return hit;

  const scale = 3;
  const canvas = document.createElement('canvas');
  canvas.width = w * scale;
  canvas.height = h * scale;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = true;
  ctx.scale(scale, scale);

  gelButton(ctx, {
    x: 0,
    y: 0,
    w,
    h,
    radius: Math.min(w, h) / 2,
    state: filled ? 'selected' : state === 'hover' ? 'hover' : 'idle',
    accent: PALETTE.menu.meterOn,
  });

  if (filled) {
    // 채워진 칩의 알맹이. 젤의 광택 아래에서 보여야 하므로 판보다 진하다.
    ctx.fillStyle = PALETTE.menu.meterOn;
    roundRectPath(ctx, w * 0.22, h * 0.22, w * 0.56, h * 0.56, w * 0.28);
    ctx.fill();
  }

  const tex = toMarkTexture(canvas);
  chipCache.set(key, tex);
  return tex;
}
