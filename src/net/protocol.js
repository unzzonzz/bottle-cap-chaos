/**
 * The wire contract. One file, imported verbatim by both the client and the
 * server.
 *
 * ── why one file and not two that agree ─────────────────────────────────────
 * A relay protocol is a pair of programs that must hold identical beliefs about
 * a dozen string constants. Written twice they agree on the day they are
 * written; the failure mode afterwards is not a crash but a message silently
 * ignored by one side, which in a lockstep game means the two players quietly
 * stop playing the same match. So the constants exist once and the server
 * imports them out of `src/` — the server is not a separate project that happens
 * to talk to this one.
 *
 * ── what crosses the wire, and what must never ──────────────────────────────
 * INPUTS ONLY. A shot is a direction, a power and a seed; a card is an id. No
 * position, no velocity, no snapshot. Both clients own a full simulation and
 * step it from the same seed, which is the only arrangement in which a
 * disagreement can be DETECTED — two peers exchanging state converge by
 * overwriting each other and a divergence never surfaces.
 *
 * The hashes are the audit, not the sync. They are compared, never applied.
 *
 * ── versioning ─────────────────────────────────────────────────────────────
 * `PROTOCOL_VERSION` is checked in the handshake and a mismatch is refused with
 * a message a human can act on. Two builds that differ by one card's tuning are
 * not interoperable here — a lockstep peer is running the same physics or it is
 * running a different game — which is what `CONFIG_HASH` is for below.
 */

/**
 * ── 2, because curling gained the flip ──────────────────────────────────────
 * A client that does not know `INPUT_KIND.FLIP` will be relayed one and either
 * refuse it or ignore it; either way its world stops matching the sender's from
 * that cap onward, and the mismatch surfaces as a desync — a report that the
 * physics diverged, about two builds that were never playing the same game. The
 * handshake refusing the match up front is the whole reason this number exists.
 */
export const PROTOCOL_VERSION = 2;

// ── message types ──────────────────────────────────────────────────────────

/** Client → server. */
export const C2S = {
  /** First message on every socket. Carries nickname, versions, config hash. */
  HELLO: 'c:hello',

  /** Make a private room and get an invite code back. */
  ROOM_CREATE: 'c:room.create',
  /** Join someone's room by code. */
  ROOM_JOIN: 'c:room.join',
  /** Leave a room that has not started. */
  ROOM_LEAVE: 'c:room.leave',

  /** Enter the random-matching queue for a mode. */
  QUEUE_JOIN: 'c:queue.join',
  /** Leave it. */
  QUEUE_LEAVE: 'c:queue.leave',

  /**
   * Re-attach to a matched room from the GAME document.
   *
   * The menu and the match are two documents — entering a match is a real
   * navigation — so the socket that did the matchmaking cannot survive into the
   * game. The server hands out a token with `MATCH_FOUND` and the game document
   * comes back with it. See `ROOM_PHASE.HANDOFF`.
   */
  RESUME: 'c:resume',

  /** Both sides have their opponent's mark and the cutscene is done. */
  READY: 'c:ready',

  /**
   * A shot, a card, or a flip. The payload is an `InputEvent` — see
   * `replay/InputLog.js`, which is the definition of what may be in it.
   */
  INPUT: 'c:input',

  /** This client's state hash for a finished turn. */
  HASH: 'c:hash',

  /** Deliberately conceding — the exit button, confirmed. */
  FORFEIT: 'c:forfeit',

  /** Heartbeat reply. */
  PONG: 'c:pong',
};

/** Server → client. */
export const S2C = {
  HELLO_OK: 's:hello.ok',
  /** Anything refused. `{code, message}` — `message` is shown to the player. */
  ERROR: 's:error',

  ROOM_CREATED: 's:room.created',
  ROOM_LEFT: 's:room.left',
  QUEUED: 's:queued',
  QUEUE_LEFT: 's:queue.left',

  /**
   * Two players are paired. Carries everything the match needs to start:
   * the seed, the seat assignment, who goes first, and the opponent's identity.
   */
  MATCH_FOUND: 's:match.found',

  /** Both clients have re-attached from their game documents. Play begins. */
  MATCH_START: 's:match.start',

  /** A relayed `INPUT` from the other player. */
  INPUT: 's:input',

  /** A turn opened. Carries the server's deadline — the timer is server-owned. */
  TURN_BEGIN: 's:turn.begin',
  /** Nobody moved in time. The turn is forfeit; NOTHING is played. */
  TURN_SKIP: 's:turn.skip',
  /** The timer is paused (card effect, cutscene) or resumed. */
  TURN_CLOCK: 's:turn.clock',

  /** The two clients disagreed about the world. The match stops here. */
  DESYNC: 's:desync',

  /** The other side vanished or conceded. */
  OPPONENT_GONE: 's:opponent.gone',

  /** Final. `reason` distinguishes a played-out win from a forfeit. */
  MATCH_OVER: 's:match.over',

  /** Heartbeat. */
  PING: 's:ping',
};

// ── error codes ────────────────────────────────────────────────────────────

export const ERR = {
  BAD_MESSAGE: 'bad_message',
  PROTOCOL_MISMATCH: 'protocol_mismatch',
  CONFIG_MISMATCH: 'config_mismatch',
  NICKNAME_INVALID: 'nickname_invalid',
  NICKNAME_TAKEN: 'nickname_taken',
  NOT_REGISTERED: 'not_registered',
  ROOM_NOT_FOUND: 'room_not_found',
  ROOM_FULL: 'room_full',
  ROOM_EXPIRED: 'room_expired',
  ALREADY_IN_ROOM: 'already_in_room',
  BAD_MODE: 'bad_mode',
  BAD_TOKEN: 'bad_token',
  NOT_YOUR_TURN: 'not_your_turn',
  OUT_OF_ORDER: 'out_of_order',
  RATE_LIMITED: 'rate_limited',
};

/** What the player is told. Korean, because the UI is. */
export const ERR_TEXT = {
  [ERR.BAD_MESSAGE]: '알 수 없는 요청입니다',
  [ERR.PROTOCOL_MISMATCH]: '서버와 버전이 다릅니다 — 새로고침 해주세요',
  [ERR.CONFIG_MISMATCH]: '상대와 게임 설정이 다릅니다 — 같은 빌드에서만 대전할 수 있습니다',
  [ERR.NICKNAME_INVALID]: '사용할 수 없는 닉네임입니다',
  [ERR.NICKNAME_TAKEN]: '이미 사용 중인 닉네임입니다',
  [ERR.NOT_REGISTERED]: '닉네임을 먼저 등록해주세요',
  [ERR.ROOM_NOT_FOUND]: '그런 방이 없습니다',
  [ERR.ROOM_FULL]: '이미 시작된 방입니다',
  [ERR.ROOM_EXPIRED]: '만료된 초대 코드입니다',
  [ERR.ALREADY_IN_ROOM]: '이미 다른 방에 있습니다',
  [ERR.BAD_MODE]: '알 수 없는 모드입니다',
  [ERR.BAD_TOKEN]: '연결이 만료되었습니다',
  [ERR.NOT_YOUR_TURN]: '지금은 당신의 차례가 아닙니다',
  [ERR.OUT_OF_ORDER]: '입력 순서가 어긋났습니다',
  [ERR.RATE_LIMITED]: '너무 빠릅니다',
};

// ── room lifecycle ─────────────────────────────────────────────────────────

/**
 * ── the phases exist because entering a match is a NAVIGATION ──────────────
 * `HANDOFF` is the whole reason this is a state machine rather than a boolean.
 * The menu document matches two players, then both browsers navigate to the game
 * URL — which drops both sockets. A disconnect is a forfeit ONLY from `PLAYING`;
 * in `HANDOFF` it is expected and the room waits for the token to come back.
 *
 * It is also what makes "매칭 대기 중 끊김은 그냥 큐에서 제거" true without a
 * special case: in `OPEN` and `QUEUED` a dropped socket takes the player out and
 * nothing is forfeited, because there is no match yet to forfeit.
 */
export const ROOM_PHASE = {
  /** Created, waiting for a second player. */
  OPEN: 'open',
  /** Paired. Both clients are navigating from the menu to the game. */
  HANDOFF: 'handoff',
  /** Both re-attached; marks exchanged; cutscene running. */
  READYING: 'readying',
  /** Turns are being played. A disconnect here is a forfeit. */
  PLAYING: 'playing',
  /** Finished, for any reason. */
  OVER: 'over',
};

/** How a match ended. The client shows a different screen for each. */
export const OVER_REASON = {
  /** Somebody won by the rules of the mode. */
  PLAYED: 'played',
  /** The other side disconnected. A win, but announced rather than celebrated. */
  DISCONNECT: 'disconnect',
  /** The other side pressed exit. */
  FORFEIT: 'forfeit',
  /** The two simulations disagreed. Nobody wins. */
  DESYNC: 'desync',
};

// ── nicknames ──────────────────────────────────────────────────────────────

export const NICKNAME_MIN = 2;
export const NICKNAME_MAX = 10;

/**
 * Hangul syllables and Latin letters. Nothing else.
 *
 * ── digits are NOT allowed, and that is a decision ─────────────────────────
 * The brief says "한글 또는 영문만" and then asks for the digit question to be
 * settled explicitly, so: no digits. The plain reading of the rule excludes
 * them, and they buy nothing here — a nickname is shown at 15 px through a hard
 * alpha threshold (`hudTextures.js` ALPHA_CUT), where `1` / `l` / `I` are the
 * same handful of pixels. The invite code has the same confusable problem and
 * solves it by deleting those characters from its alphabet; this solves it by
 * not having them at all.
 *
 * ── Jamo are excluded too ──────────────────────────────────────────────────
 * `가-힣` is the composed-syllable block only. Standalone jamo (`ㄱ`, `ㅏ`) are
 * legal Unicode and legal Korean text, but they are what an IME leaves behind
 * mid-composition, so accepting them means accepting half-typed input as a name.
 *
 * ── and everything is normalised to NFC first ──────────────────────────────
 * This is the one that would have been found in testing on somebody else's
 * machine. macOS hands out DECOMPOSED Hangul — `한` as `ᄒ` + `ᅡ` + `ᆫ`, three
 * code points in the Jamo block — so a name typed on a Mac fails a `가-힣` test
 * that the identical name typed on Windows passes. Normalising first makes the
 * rule about the name rather than about the keyboard.
 */
const NICKNAME_RE = /^[가-힣a-zA-Z]+$/u;

/**
 * Canonical form. Call before storing, comparing, or validating.
 *
 * Trimmed and NFC-composed. Composition matters for uniqueness as well as for
 * validation: decomposed and composed `한별` are different strings and the same
 * name, so a registry that skipped this would happily hand the same nickname to
 * two players.
 */
export function normaliseNickname(raw) {
  return String(raw ?? '')
    .normalize('NFC')
    .trim();
}

/**
 * @param {string} raw
 * @returns {{ok: true, value: string} | {ok: false, code: string, message: string}}
 */
export function validateNickname(raw) {
  const value = normaliseNickname(raw);
  const fail = (message) => ({ ok: false, code: ERR.NICKNAME_INVALID, message });

  if (!value) return fail('닉네임을 입력해주세요');
  // Counted in code points, so a Hangul syllable is one character rather than
  // the two UTF-16 units `.length` would report for anything outside the BMP.
  const chars = [...value];
  if (chars.length < NICKNAME_MIN) return fail(`${NICKNAME_MIN}자 이상이어야 합니다`);
  if (chars.length > NICKNAME_MAX) return fail(`${NICKNAME_MAX}자까지 쓸 수 있습니다`);
  if (/\s/u.test(value)) return fail('공백은 쓸 수 없습니다');
  if (!NICKNAME_RE.test(value)) return fail('한글과 영문만 쓸 수 있습니다');

  return { ok: true, value };
}

/**
 * The key a registry stores uniqueness under.
 *
 * Case-folded, so `Neo` cannot sit beside `neo` and leave two players unable to
 * tell each other apart. Hangul is unaffected by case folding; this is entirely
 * about the Latin half.
 */
export function nicknameKey(value) {
  return normaliseNickname(value).toLocaleLowerCase('en');
}

// ── invite codes ───────────────────────────────────────────────────────────

/**
 * The alphabet, minus everything that gets misread aloud or in a low-res font.
 *
 * Gone: `0`/`O`, `1`/`I`/`L`. Kept: `2-9` and the remaining 21 letters, which is
 * 31 symbols and 31^6 ≈ 887 million codes — far more than a room table that
 * lives in one process's memory will ever hold.
 */
export const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const CODE_LENGTH = 6;

const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LENGTH}}$`);

/**
 * Fold a typed code into canonical form before looking it up.
 *
 * Uppercased, spaces and hyphens dropped. That is deliberately ALL of it.
 *
 * ── why the confusable characters are not "helpfully" remapped ─────────────
 * The tempting version of this maps a typed `0` to `O` and a typed `l` to `1`,
 * on the theory that somebody misreading the code off a screen should still
 * reach their friend's room. It is wrong here, and quietly so: `0`, `1`, `I`,
 * `L` and `O` are excluded from the alphabet, so there is nothing for them to
 * map TO except characters that are already legitimate and already mean
 * something else. `O → Q` does not rescue a typo, it silently rewrites a code
 * into a DIFFERENT valid code — and the failure is joining a stranger's room
 * rather than being told the code was wrong.
 *
 * The confusables are handled by not existing. A character outside the alphabet
 * is a typo, and a typo is refused with a message, which is the only outcome
 * that cannot put somebody in the wrong game.
 */
export function normaliseCode(raw) {
  return String(raw ?? '')
    .toUpperCase()
    .replace(/[\s-]/g, '');
}

export function isValidCode(raw) {
  return CODE_RE.test(String(raw ?? ''));
}

/**
 * @param {() => number} random  injected so the server can seed it and tests can fix it
 */
export function makeCode(random = Math.random) {
  let out = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[Math.floor(random() * CODE_ALPHABET.length) % CODE_ALPHABET.length];
  }
  return out;
}

// ── the config fingerprint ─────────────────────────────────────────────────

/**
 * Which config values two peers must agree on to be running the same game.
 *
 * ── this list is the difference between lockstep and two separate games ────
 * `CONFIG` is a mutable module singleton and the debug panel writes friction,
 * restitution, damping and slow motion straight into it. Two players with
 * different sliders each run a perfectly deterministic simulation and get
 * different answers, and every hash comparison afterwards reports a desync whose
 * cause is a slider nobody remembers moving.
 *
 * So the handshake carries a fingerprint of exactly the values the SIMULATION
 * reads. Presentation settings are deliberately absent — camera, audio and
 * colours cannot move a cap, and folding them in would refuse matches between
 * two people who merely have different volume settings.
 *
 * ── three blocks were missing, and they are simulation ─────────────────────
 * `ball`, `collider` and `respawn` are all read by code that steps the world,
 * and none of them was on this list. A player who moved one of their sliders
 * matched normally and then ran a different simulation, and the check written
 * to prevent exactly that could not see it:
 *
 *   ball      `Arena` reads `linearDamping`/`angularDamping` when it builds and
 *             re-tunes the ball, `FootballPitch` derives its RADIUS from
 *             `diameterScale`, and `ai/rollout.js` mirrors the damping so a
 *             look-ahead matches the world it is looking ahead in.
 *   collider  `Arena` hands the whole block to `describeCapColliders`, which is
 *             where a cap's SHAPE and MASS come from. There is nothing more
 *             load-bearing in the file than this one.
 *   respawn   `BallRespawn` turns `travelSeconds` into a step count, and
 *             `layout/respawn.js` places the ball from the rest.
 *
 * ── two that stay off, and why ─────────────────────────────────────────────
 * `preview` steps a world of its OWN, built from a snapshot inside
 * `TrajectoryPreview` and thrown away — `stepBudget` and `sampleEvery` buy
 * frames and points on a line, not outcomes. `ai` never runs for a remote seat:
 * online, `OnlineController` holds it, so one player's search depth cannot
 * reach the other's world.
 */
export const SYNCED_CONFIG_PATHS = [
  'physics',
  'shot',
  'turn',
  'cards',
  'orbs',
  'curling',
  'football',
  'knockout',
  'arena',
  'cap',
  'ball',
  'collider',
  'respawn',
];

/**
 * A stable fingerprint of the synchronised half of a config.
 *
 * Keys are sorted at every level, so two objects that differ only in insertion
 * order fingerprint the same — otherwise the check would refuse matches over
 * nothing. Numbers go in as their full-precision decimal form; a rounded
 * rendering would let two genuinely different values agree.
 */
export function configHash(config) {
  const canon = (v) => {
    if (v === null || typeof v !== 'object') {
      if (typeof v === 'number') return Number.isFinite(v) ? v.toPrecision(17) : String(v);
      return JSON.stringify(v);
    }
    if (Array.isArray(v)) return `[${v.map(canon).join(',')}]`;
    const keys = Object.keys(v).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${canon(v[k])}`).join(',')}}`;
  };

  const picked = {};
  for (const path of SYNCED_CONFIG_PATHS) {
    if (config?.[path] !== undefined) picked[path] = config[path];
  }

  const text = canon(picked);
  // FNV-1a over the UTF-16 code units. The same function `PhysicsWorld.hashState`
  // uses, for the same reason: short, stable, and identical in every engine
  // because it is built from `Math.imul` and shifts alone.
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i) & 0xff;
    h = Math.imul(h, 0x01000193) >>> 0;
    h ^= text.charCodeAt(i) >>> 8;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/**
 * Did this client state what it is running at all?
 *
 * ── `''` used to pass the compatibility check ───────────────────────────────
 * The server stores `String(msg.configHash ?? '')` and pairs two clients when
 * their stored values are equal. Two clients that sent nothing therefore both
 * stored `''`, compared equal, and were matched — which is the exact failure the
 * check exists to prevent, reachable by leaving the field out. The defence
 * looked present in the protocol and was not enforceable.
 *
 * ── it tests for a fingerprint, NOT for THIS fingerprint ────────────────────
 * The obvious fix is `/^[0-9a-f]{8}$/`, because that is what `configHash` above
 * returns. It is the wrong fix. The relay deliberately holds no config and has
 * no opinion about what a fingerprint means — see the note on `Hub.onHello` —
 * and pinning the FORMAT here puts the server back in the business of knowing,
 * so that widening the hash later would mean redeploying the relay before a
 * single client could connect. Comparing opaque strings is the whole design.
 *
 * The ceiling is not a format check either. It is there because this string is
 * stored per connection before the connection has proved anything, and an
 * unbounded one is a place to put a megabyte.
 *
 * @param {unknown} v
 */
export function isValidConfigHash(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 64;
}

// ── marks ──────────────────────────────────────────────────────────────────

/**
 * A player's cap art, as it crosses the wire.
 *
 * Three cases and they are genuinely different, which is why this is a tagged
 * value rather than a nullable string:
 *
 *   `{kind:'none'}`    a clean cap. A first-class choice, not a missing mark.
 *   `{kind:'default'}` the built-in logo. There is no data URL for it — the
 *                      receiver draws it locally — so sending one would mean
 *                      inventing a payload for something both sides already have.
 *   `{kind:'png', dataUrl}`  a drawn mark: 128×128 RGBA PNG as a data URL.
 */
export const MARK_KIND = { NONE: 'none', DEFAULT: 'default', PNG: 'png' };

/**
 * The ceiling on a mark payload.
 *
 * A 128×128 RGBA PNG of hand-drawn strokes is a few kB; the cap is 256 kB so
 * that an unusually noisy one still fits, and so that a client cannot push an
 * arbitrarily large string through a relay that keeps rooms in memory.
 */
export const MARK_MAX_BYTES = 256 * 1024;

/** Cheap structural check. NOT a security check — re-draw before use. */
export function isValidMark(mark) {
  if (!mark || typeof mark !== 'object') return false;
  if (mark.kind === MARK_KIND.NONE || mark.kind === MARK_KIND.DEFAULT) return true;
  if (mark.kind !== MARK_KIND.PNG) return false;
  if (typeof mark.dataUrl !== 'string') return false;
  if (!mark.dataUrl.startsWith('data:image/png;base64,')) return false;
  return mark.dataUrl.length <= MARK_MAX_BYTES;
}

// ── timing ─────────────────────────────────────────────────────────────────

/**
 * Defaults. Every one is overridable from the debug panel and from the server's
 * environment, because they are exactly the numbers that need to be wrong once
 * before anybody knows what they should be.
 */
export const TIMING = {
  /** A player's turn. The brief's 15 seconds. */
  turnMs: 15000,
  /** How often the server pings. */
  heartbeatMs: 5000,
  /**
   * Consecutive unanswered pings before a socket is written off.
   *
   * Counted rather than timed, because a count is what the rule actually is:
   * "three pings went out and none came back" is a statement about the peer,
   * where "fifteen seconds elapsed" is also true of a server that was busy.
   * At the 5 s interval this is a 15 s detection, same as before — but now the
   * two numbers move independently, which is what makes the interval tunable
   * without silently changing how tolerant the check is.
   */
  heartbeatMisses: 3,
  /** Belt and braces: a hard ceiling on silence, whatever the miss count says. */
  heartbeatTimeoutMs: 20000,
  /**
   * How long a finished turn may wait for both state hashes.
   *
   * A turn's simulation is a couple of seconds at most and both clients report
   * the moment it settles, so this is enormously generous — it is not a
   * performance budget, it is the outer edge beyond which somebody is not
   * coming back. Without it a turn whose opponent vanished after the shot sits
   * forever: the clock is stopped by then, and nothing else was watching.
   */
  hashTimeoutMs: 30000,
  /**
   * Consecutive turns one player may let expire before being probed.
   *
   * The safety net under the safety net — see `DETECT.SKIPS`. A player who
   * genuinely idles is not punished by it; it only forces the question.
   */
  maxSkips: 3,
  /**
   * A hard ceiling on a room's life, whatever state it is in.
   *
   * The janitor of last resort. A real match runs for minutes; anything still
   * standing after this is wreckage, and leaving it in the table means a
   * nickname and a room id that never come back.
   */
  roomMaxMs: 60 * 60 * 1000,
  /** An unclaimed invite code stops working after this. */
  roomTtlMs: 5 * 60 * 1000,
  /**
   * How long a matched room waits for both game documents to re-attach.
   *
   * Generous, because it covers a full page load — a cold load of the game
   * document parses three megabytes of wasm — and because the cost of being
   * wrong is a forfeit for a player who did nothing wrong.
   */
  handoffMs: 25 * 1000,
  /**
   * The message budget one connection may spend in a burst.
   *
   * A token bucket rather than a count per window, because the traffic this has
   * to survive is bursty by construction and slow on average. A whole match is
   * two messages a turn — an INPUT and a HASH — plus a PONG every five seconds,
   * so the SUSTAINED rate a real client needs is under one a second. What it
   * also does is arrive in clumps: a reconnect replays a handshake, and the
   * headless clients in `server/test/` play forty turns inside one millisecond
   * of wall time because nothing there waits for a real clock.
   *
   * A fixed window sized for the average would cut those; sized for the clump it
   * would let a flooder send a clump every window forever. The bucket answers
   * both — spend the burst as fast as you like, then you are held to the refill.
   *
   * 200 is roughly a hundred turns' worth of traffic taken at once, and the
   * refill is fifty times what a real client sustains. Neither is tight. They do
   * not need to be: the thing on the other side of this is a client sending
   * thousands a second, and the gap between that and legitimate play is four
   * orders of magnitude wide.
   */
  msgBurst: 200,
  /** Tokens refilled per second, i.e. the sustained ceiling. */
  msgPerSecond: 50,
};

/**
 * Which defence noticed. Carried on every drop and written to the log.
 *
 * ── the point of naming them ───────────────────────────────────────────────
 * There are five overlapping ways to notice that somebody has gone, and the
 * only way to know which ones are earning their place — and which are dead code
 * that has never once fired — is for each to say so when it fires. Without this
 * the log records that a match ended, which was never the question.
 */
export const DETECT = {
  /** The socket said so: a `close` or an `error` event. */
  SOCKET: 'socket',
  /** No pong for N consecutive pings. */
  HEARTBEAT: 'heartbeat',
  /** The turn clock ran out and the player whose turn it was is not there. */
  TURN_TIMER: 'turn-timer',
  /** A finished turn's state hash never arrived. */
  HASH_TIMEOUT: 'hash-timeout',
  /** Too many turns in a row let go by. */
  SKIPS: 'skips',
  /** The room outlived any plausible match. */
  ROOM_AGE: 'room-age',
  /** Matched, then never arrived in the game document. */
  HANDOFF: 'handoff',
  /** They pressed the button. */
  FORFEIT: 'forfeit',
  /** The connection spent its message budget. See `TIMING.msgBurst`. */
  RATE_LIMIT: 'rate-limit',
};

// ── framing ────────────────────────────────────────────────────────────────

/**
 * Every message is `{t, ...}` where `t` is one of the constants above.
 *
 * Parsing is total: a message that is not an object with a string `t` is
 * refused rather than partially handled. A relay that half-understands a packet
 * is how one side ends up believing a turn was taken.
 */
export function encode(type, body = {}) {
  return JSON.stringify({ ...body, t: type });
}

export function decode(raw) {
  let msg;
  try {
    msg = JSON.parse(typeof raw === 'string' ? raw : String(raw));
  } catch {
    return null;
  }
  if (!msg || typeof msg !== 'object' || typeof msg.t !== 'string') return null;
  return msg;
}
