import { Group, Mesh, PlaneGeometry, Raycaster, Vector2 } from 'three';
import { createSpriteMaterial } from './menuMaterials.js';
import { menuPlateTexture, titleTexture } from './menuTextures.js';
import { OnlineSession, SESSION_PHASE } from '../net/OnlineSession.js';
import { defaultServerUrl } from '../net/Transport.js';
import { ERR, isValidCode, normaliseCode } from '../net/protocol.js';

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
 * ── the code is the TITLE ─────────────────────────────────────────────────
 * A six-character code that somebody has to read out loud over a phone is the
 * most important thing on the screen while it is on it, and a 15px plate label
 * is not the place for it. `titleTexture` sizes to fit and is already twice the
 * height, so the heading becomes the code and the sub-line says what it is.
 */

const L = {
  titleY: 168,
  plate: { width: 256, height: 52 },
  rows: [
    { id: 'status', y: 74, kind: 'readout' },
    { id: 'create', y: 8 },
    { id: 'join', y: -50 },
    { id: 'random', y: -108 },
    { id: 'back', y: -174 },
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
    this._titleText = null;

    this.title = new Mesh(
      new PlaneGeometry(1, 1),
      createSpriteMaterial(retro, { map: titleTexture('온라인', this.modeName) }),
    );
    this.title.scale.set(256 * u, 80 * u, 1);
    this.title.position.set(0, L.titleY * u, 0);
    this.root.add(this.title);
    this._titleText = `온라인|${this.modeName}`;

    this.items = L.rows.map((row) => this._plate(row));

    this._ray = new Raycaster();
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
    const u = this._u;
    const mesh = new Mesh(new PlaneGeometry(1, 1), createSpriteMaterial(this._retro, { map: null }));
    mesh.scale.set(L.plate.width * u, L.plate.height * u, 1);
    mesh.position.set(0, def.y * u, 0);
    this.root.add(mesh);
    return { ...def, mesh, maps: {}, label: null };
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
        return this._waiting ? '취소' : '◀ 뒤로';
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
    // The heading carries the invite code while there is one, because reading it
    // out is the only thing the player is doing at that moment.
    const wantTitle =
      this.session.phase === SESSION_PHASE.WAITING_CODE && this.session.code
        ? `${this.session.code}|초대 코드`
        : `온라인|${this.modeName}`;
    if (wantTitle !== this._titleText) {
      const [t, s] = wantTitle.split('|');
      this.title.material.uniforms.uMap.value.dispose();
      this.title.material.uniforms.uMap.value = titleTexture(t, s);
      this._titleText = wantTitle;
    }

    for (const item of this.items) {
      const label = this._labelFor(item.id);
      if (label !== item.label) {
        item.maps.idle?.dispose();
        item.maps.hover?.dispose();
        item.maps.disabled?.dispose();
        item.maps.idle = menuPlateTexture(label, 'idle', L.plate);
        item.maps.hover = menuPlateTexture(label, 'hover', L.plate);
        // `dimmed`, not `disabled`: these rows are unavailable for a moment
        // because a room or a queue is already pending, which is not the same
        // claim as "준비 중" — see the skin table in `menuTextures`.
        item.maps.disabled = menuPlateTexture(label, 'dimmed', L.plate);
        item.label = label;
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
      const flat = item.kind === 'readout';
      const hot = !dead && !flat && this._hovered === item.id;
      item.mesh.material.uniforms.uMap.value =
        !flat && dead ? item.maps.disabled : hot ? item.maps.hover : item.maps.idle;
    }
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
    for (const item of this.items) {
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
    this.title.geometry.dispose();
    this.title.material.uniforms.uMap.value.dispose();
    this.title.material.dispose();
    for (const item of this.items) {
      item.mesh.geometry.dispose();
      item.mesh.material.dispose();
      item.maps.idle?.dispose();
      item.maps.hover?.dispose();
      item.maps.disabled?.dispose();
    }
    this.root.clear();
  }
}
