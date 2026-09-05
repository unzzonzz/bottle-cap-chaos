import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, panelTexture, titleTexture } from './menuTextures.js';
import { OnlineSession, SESSION_PHASE } from '../net/OnlineSession.js';
import { defaultServerUrl } from '../net/Transport.js';
import { ERR, isValidCode, normaliseCode } from '../net/protocol.js';
import { ROLE } from '../core/tokens.js';
import { anchorHead, anchorTopLeft, solvePanel, stackRows } from './panelLayout.js';

/**
 * Finding somebody to play.
 *
 * ── it owns the session, and `bootMenu` owns the navigation ───────────────
 * The same division every other screen here uses: this screen decides what to
 * ask the relay for, and the one thing it cannot do is change screens. When a
 * match is made it stashes what the game document will need and calls
 * `onMatched`; `bootMenu` runs the cap wipe and the navigation, exactly as it
 * does for the two local modes.
 *
 * ── five plates, one layout, labels derived from the phase ────────────────
 * There is no second layout for "waiting". The three action rows grey out and
 * the bottom row becomes 취소, which is the whole difference — building a second
 * arrangement of meshes for a state that lasts a few seconds would be two
 * layouts to keep in step for no gain. Everything on screen is re-derived in
 * `refresh` from `session.phase`, so there is one place that decides what this
 * screen says, which is the rule `SettingsScene._labelFor` sets.
 *
 * ── the code is the READOUT, and the readout is the first row ─────────────
 * A six-character code that somebody has to read out loud over a phone is the
 * most important thing on the screen while it is on it, and a 15px plate label
 * is not the place for it. `titleTexture` sizes to fit and is twice the height,
 * so the top row of the content is drawn with it: the code when there is one,
 * and what the relay is doing when there is not.
 *
 * 부록 B 전에는 이것이 화면의 **제목**이었다. 제목 자리가 상태에 따라 바뀌면
 * 그건 제목이 아니다 — 화면의 이름은 언제나 `온라인` 이고, 그건 이제 탭에 있다.
 */

const L = {
  /** 상태 줄은 두 배 높다. 초대 코드가 여기 들어온다. */
  readoutHeight: 84,
  rows: [
    { id: 'status', kind: 'readout' },
    { id: 'create' },
    { id: 'join' },
    { id: 'random' },
  ],
  /** 푸터. 이 화면에 COMMIT 은 없다 — 세 줄이 각각 스스로 실행된다. */
  footer: [
    { id: 'back', role: ROLE.RETREAT, side: -1 },
  ],
};

export class OnlineScene {
  /**
   * @param {object} opts
   * @param {import('../core/GlossMaterial.js').GlossMaterials} opts.retro
   * @param {number} opts.unitsPerPixel
   * @param {string} opts.mode          which mode a match will be played in
   * @param {string} opts.modeName      for the heading only
   * @param {import('../profile/NicknameStorage.js').Profile} opts.profile
   * @param {object} opts.config        for the config fingerprint
   * @param {() => object} opts.markOf  this player's mark, as a wire payload
   * @param {(session: OnlineSession) => void} opts.onMatched
   */
  constructor({
    retro,
    unitsPerPixel,
    mode,
    modeName,
    profile,
    config,
    markOf,
    onMatched,
    modal = null,
    session = null,
  }) {
    this.root = new Group();
    this.mode = mode;
    this.modeName = modeName ?? '';
    this.profile = profile;
    this.markOf = markOf;
    this.onMatched = onMatched;
    /** The screen's questions, drawn as geometry. See `ui/ModalLayer.js`. */
    this.modal = modal;
    const u = unitsPerPixel;
    this._u = u;
    this._retro = retro;

    this.session = session ?? new OnlineSession({ config });
    this.notice = '';

    /**
     * 화면의 바탕. 모든 줄보다 뒤에 그려진다 — `SettingsScene` 의 같은 줄에
     * `renderOrder` 로 정하는 이유가 적혀 있다.
     */
    this.panel = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: null }),
    );
    this.panel.renderOrder = -1;
    this.root.add(this.panel);

    this.items = L.rows.map((row) => this._plate(row));
    this.footer = L.footer.map((row) => this._plate(row));
    this.layout(u);

    this._ray = new Raycaster();
    // 모든 레이어를 본다. `MenuItems` 의 같은 줄에 왜 필요한지 적혀 있다 —
    // 판은 `asUiLayer` 때문에 레이어 1 에 있고, 광선의 기본은 레이어 0 뿐이다.
    this._ray.layers.enableAll();
    this._ndc = new Vector2();
    this._hovered = null;

    this._unsubs = [
      this.session.on('ready', () => this.refresh()),
      this.session.on('roomCreated', () => this.refresh()),
      this.session.on('queued', () => this.refresh()),
      this.session.on('queueLeft', () => this.refresh()),
      this.session.on('error', (e) => {
        this.notice = e.message;
        // A refused nickname is the one error worth acting on rather than only
        // reporting: the player can fix it, and they are standing right here.
        if (e.code === ERR.NICKNAME_TAKEN || e.code === ERR.NICKNAME_INVALID) this._askName();
        this.refresh();
      }),
      this.session.on('matched', () => {
        this.notice = '';
        this.refresh();
        this.onMatched?.(this.session);
      }),
      this.session.on('closed', () => this.refresh()),
    ];

    this.refresh();
    this._connect();
  }

  _plate(def) {
    const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(this._retro, { map: null }));
    this.root.add(mesh);
    return { ...def, mesh, maps: {}, label: null, size: null };
  }

  /** 열과 푸터를 한 줄로. */
  get _all() {
    return [...this.items, ...this.footer];
  }

  /**
   * 제목과 다섯 줄을 하나의 열로 쌓는다. `columnLayout.js` 가 푼다.
   *
   * 예전에는 y 가 168 / 74 / 8 / -50 / -108 / -174 로 고정이었고, 316 짜리
   * 프레임에서는 제목과 마지막 줄이 화면 밖이었다 — 대기열에 들어간 뒤 상태 줄과
   * "뒤로" 를 동시에 볼 수 없다는 뜻이다.
   */
  layout(unitsPerPixel) {
    const u = unitsPerPixel ?? this._u;
    this._u = u;

    const box = solvePanel({
      title: true,
      caption: !!this.modeName,
      rows: L.rows.map((r) => ({ id: r.id, h: r.kind === 'readout' ? L.readoutHeight : undefined })),
      footer: L.footer.length,
    });
    // 모든 목록 화면이 같은 리듬을 쓴다 — `panelLayout.stackRows`.
    stackRows(box);
    this._box = box;
    const at = (id) => box.rows.find((r) => r.id === id);

    this.panel.scale.set(box.panel.w * u, box.panel.texH * u, 1);
    // 난외 표제의 자리는 아래 `anchorHead` 가 정한다 — 프레임의 여백에 직접 붙는다.

    for (const item of this.items) {
      const row = at(item.id);
      item.size = { width: box.plate.width, height: row.h, scale: box.scale };
      item.mesh.scale.set(box.plate.width * u, row.h * u, 1);
      item.mesh.position.set(0, row.y * u, 0);
    }

    const fb = box.footer.button;
    for (const item of this.footer) {
      item.size = { width: fb.w, height: fb.h, scale: box.scale };
      item.mesh.scale.set(fb.w * u, fb.h * u, 1);
      const x = item.side < 0 ? box.footer.left : box.footer.right;
      item.mesh.position.set(x * u, box.footer.y * u, 0);
    }

    const key = `${box.panel.w}x${box.panel.texH}`;
    if (key !== this._panelKey) {
      this._panelKey = key;
      for (const item of this._all) item.label = null;
      const old = this.panel.material.uniforms.uMap.value;
      this.panel.material.uniforms.uMap.value = panelTexture({
        w: box.panel.w,
        h: box.panel.h,
        tabHeight: box.panel.tabHeight,
        title: '온라인',
        caption: this.modeName,
        footerHeight: box.footer.height,
        padTop: box.pad.top,
        padX: box.pad.x,
        scale: box.scale,
      });
      old?.dispose();
    }
    this.refresh();
  
    anchorTopLeft(this.root, box, u);
    anchorHead(this.panel, box, this.root, u);
  }

  // ── the session ──────────────────────────────────────────────────────────

  async _connect() {
    const url = this.profile.server || defaultServerUrl();
    this.notice = '서버에 연결하는 중…';
    this.refresh();
    try {
      await this.session.connect(url);
    } catch {
      this.notice = '서버에 연결할 수 없습니다';
      this.refresh();
      return;
    }
    // A name is required before anything else can be asked for, and a player who
    // has never set one is asked here rather than being refused with an error
    // they cannot act on from this screen.
    const name = this.profile.nickname || (await this._askName());
    if (!name) {
      this.notice = '닉네임이 필요합니다';
      this.refresh();
      return;
    }
    this.notice = '';
    this.session.hello(name);
    this.refresh();
  }

  async _askName() {
    if (!this.modal) return null;
    const { validateNickname } = await import('../net/protocol.js');
    const value = await this.modal.prompt({
      title: '닉네임',
      body: '한글 또는 영문 2~10자. 숫자·공백·특수문자는 쓸 수 없습니다.',
      initial: this.profile.nickname,
      maxLength: 10,
      validate: (raw) => validateNickname(raw),
    });
    if (!value) return null;
    this.profile.setNickname(value);
    // Re-announced, because the previous one was refused or never sent.
    if (this.session.transport.connected) this.session.hello(value);
    this.refresh();
    return value;
  }

  // ── state ────────────────────────────────────────────────────────────────

  get _waiting() {
    const p = this.session.phase;
    return p === SESSION_PHASE.WAITING_CODE || p === SESSION_PHASE.QUEUED;
  }

  /** How long the random queue has been running, as `m:ss`. */
  _elapsed() {
    if (!this.session.queuedAt) return '0:00';
    const s = Math.max(0, Math.floor((Date.now() - this.session.queuedAt) / 1000));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  }

  _labelFor(id) {
    switch (id) {
      case 'status':
        if (this.notice) return this.notice;
        if (this.session.phase === SESSION_PHASE.WAITING_CODE) return '상대를 기다리는 중';
        if (this.session.phase === SESSION_PHASE.QUEUED) {
          // Short, because the elapsed time is the part that matters and the
          // plate shrinks its type to fit rather than dropping the tail. Both
          // halves now survive at a readable size.
          return `상대 찾는 중   ${this._elapsed()}`;
        }
        if (this.session.phase === SESSION_PHASE.MATCHED) return '상대를 찾았습니다';
        if (this.session.phase === SESSION_PHASE.READY) return `${this.session.nickname} 님`;
        return '연결 중…';
      case 'create':
        return '방 만들기';
      case 'join':
        return '코드로 참가';
      case 'random':
        return '랜덤 매칭';
      case 'back':
        return this._waiting ? '취소' : '뒤로';
      default:
        return id;
    }
  }

  /** A row that cannot be pressed right now. */
  _deadFor(id) {
    if (id === 'status' || id === 'back') return false;
    // Nothing may be asked for until the relay has accepted a name, and nothing
    // new may be started while a room or a queue is already pending.
    return this.session.phase !== SESSION_PHASE.READY;
  }

  refresh() {
    for (const item of this._all) {
      /**
       * 상태 줄은 판이 아니라 **큰 글자**다.
       *
       * 초대 코드는 전화기 너머로 소리 내어 읽는 여섯 글자이고, 그 순간 화면에서
       * 가장 중요한 것이다. 15픽셀 판 라벨에 들어갈 것이 아니라서 예전에는 화면의
       * 제목 자리를 썼다 — 부록 B 가 제목을 탭으로 못박았으므로, 이제 내용의 첫
       * 줄로 내려왔다. 그리는 함수는 그대로다.
       */
      if (item.kind === 'readout') {
        const want = this._readout();
        if (want !== item.label) {
          item.maps.idle?.dispose();
          const [t, sub] = want.split('|');
          item.maps.idle = titleTexture(t, sub, {
            width: item.size.width,
            height: item.size.height,
            scale: item.size.scale,
            withPlate: false,
          });
          item.label = want;
        }
        item.mesh.material.uniforms.uMap.value = item.maps.idle;
        continue;
      }

      const label = this._labelFor(item.id);
      const role = item.role ?? ROLE.CHOICE;
      const key = `${label}|${role}`;
      if (key !== item.label) {
        item.maps.idle?.dispose();
        item.maps.hover?.dispose();
        item.maps.disabled?.dispose();
        item.maps.idle = menuPlateTexture(label, { role, state: 'idle' }, item.size);
        item.maps.hover = menuPlateTexture(label, { role, state: 'hover' }, item.size);
        // `dimmed`, not `disabled`: these rows are unavailable for a moment
        // because a room or a queue is already pending, which is not the same
        // claim as "준비 중" — see the skin table in `menuTextures`.
        item.maps.disabled = menuPlateTexture(label, { role, state: 'dimmed' }, item.size);
        item.label = key;
      }
      const dead = this._deadFor(item.id);
      /**
       * The status line wears the IDLE skin, not the disabled one.
       *
       * The disabled skin stamps "준비 중" right-aligned onto the plate
       * (`menuTextures.js`), which is this menu's way of saying a feature is not
       * built yet. On a row that reads "네오 님" or "상대를 찾는 중 0:12" that is
       * simply false, and it collided with the status text besides — the same
       * overlap `OpponentScene` hit when it tried to put a suffix on the AI row.
       *
       * Nothing is lost: `pick` skips readouts entirely, so the row cannot be
       * pressed regardless of what it looks like.
       */
      const hot = !dead && this._hovered === item.id;
      item.mesh.material.uniforms.uMap.value =
        dead ? item.maps.disabled : hot ? item.maps.hover : item.maps.idle;
    }
  }

  /**
   * 상태 줄의 내용. `큰 글자|작은 글자` 로 돌려준다.
   *
   * 한 문자열인 것은 이것이 캐시 키이기도 하기 때문이다 — `titleTexture` 는
   * 호출마다 캔버스와 텍스처를 새로 만들고 아무도 캐시하지 않으므로, 같은 것을
   * 다시 굽지 않는 유일한 방법이 이 비교다.
   */
  _readout() {
    if (this.session.phase === SESSION_PHASE.WAITING_CODE && this.session.code) {
      return `${this.session.code}|초대 코드`;
    }
    return `${this._labelFor('status')}|`;
  }

  // ── pointer ──────────────────────────────────────────────────────────────

  pick(canvas, camera, clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return null;
    this._ndc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this._ray.setFromCamera(this._ndc, camera);
    this.root.updateMatrixWorld(true);
    for (const item of this._all) {
      if (item.kind === 'readout') continue;
      if (this._ray.intersectObject(item.mesh, false).length) return { id: item.id };
    }
    return null;
  }

  setHover(hit) {
    const id = hit && typeof hit === 'object' ? hit.id : null;
    if (id === this._hovered) return;
    this._hovered = id;
    this.refresh();
  }

  /**
   * @returns {boolean} true when consumed. `back` is only NOT consumed when it
   *   really means "leave this screen" — while waiting it means "cancel", which
   *   is this screen's own business and must not also navigate.
   */
  activate(hit) {
    const id = hit?.id;
    if (!id) return false;

    if (id === 'back') {
      if (!this._waiting) {
        // Leaving for real. The socket goes with the screen.
        return false;
      }
      if (this.session.phase === SESSION_PHASE.QUEUED) this.session.leaveQueue();
      else this.session.leaveRoom();
      this.notice = '';
      this.refresh();
      return true;
    }

    if (this._deadFor(id)) return true;

    if (id === 'create') {
      this.session.createRoom(this.mode, this.markOf?.() ?? { kind: 'none' });
      this.notice = '';
      this.refresh();
      return true;
    }
    if (id === 'random') {
      this.session.joinQueue(this.mode, this.markOf?.() ?? { kind: 'none' });
      this.notice = '';
      this.refresh();
      return true;
    }
    if (id === 'join') {
      this._promptCode().catch((err) => console.error('[online] code entry failed', err));
      return true;
    }
    return false;
  }

  async _promptCode() {
    if (!this.modal) return;
    const code = await this.modal.prompt({
      title: '초대 코드',
      body: '상대가 만든 방의 6자리 코드를 입력하세요.',
      maxLength: 8,
      confirmLabel: '입장',
      validate: (raw) => {
        const value = normaliseCode(raw);
        return isValidCode(value)
          ? { ok: true, value }
          : { ok: false, message: '6자리 코드를 확인해주세요' };
      },
    });
    if (!code) return;
    this.notice = '';
    this.session.joinRoom(code, this.markOf?.() ?? { kind: 'none' });
    this.refresh();
  }

  /**
   * The queue's elapsed readout is the only thing on this screen that changes on
   * its own, so it is the only thing this ticks — and it repaints at 1 Hz rather
   * than per frame, because `menuPlateTexture` allocates a canvas and a texture
   * on every call and nothing caches them. A per-frame rebuild here would leak a
   * texture every frame for as long as somebody sat in the queue.
   */
  update() {
    /**
     * 호버 배율을 밀던 자리다. 버튼이 상호작용에 반응하지 않기로 했으므로 —
     * `glass.skinFor` 의 호버 분기 참조 — 남은 것은 대기 시간 표시뿐이다.
     */
    if (this.session.phase !== SESSION_PHASE.QUEUED) return;
    const now = Math.floor(Date.now() / 1000);
    if (now === this._lastTick) return;
    this._lastTick = now;
    this.refresh();
  }

  dispose() {
    for (const un of this._unsubs) un();
    this._unsubs = [];
    this.session.dispose();
    this.panel.geometry.dispose();
    this.panel.material.uniforms.uMap.value?.dispose();
    this.panel.material.dispose();
    for (const item of this._all) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      item.maps.idle?.dispose();
      item.maps.hover?.dispose();
      item.maps.disabled?.dispose();
    }
    this.root.clear();
  }
}
