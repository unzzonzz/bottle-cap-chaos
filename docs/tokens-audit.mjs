/**
 * 토큰 참조 감사. 소스 전체에서 `SIZE.x` / `SPACE.y` / `TYPE.z` 같은 참조가
 * 실제로 존재하는 키를 가리키는지 확인한다.
 *
 * ── 왜 빌드가 이걸 못 잡나 ──────────────────────────────────────────────────
 * `SIZE.tapTarget` 처럼 없는 키를 읽으면 JS 는 `undefined` 를 준다. 번들러는 문제
 * 삼지 않는다 — 오브젝트 프로퍼티 접근은 언제나 문법적으로 옳기 때문이다. 그래서
 * `npm run build` 가 통과하고, 앱을 켜면 그 값이 산술에 들어가 NaN 이 되어
 * `The provided double value is non-finite` 로 캔버스가 죽는다. 실제로 그렇게
 * 죽었고, 그때 잃은 것은 게임 전체 부팅이었다.
 *
 * 같은 이유로 `MOTION` / `RADIUS` / `RULE` / `CTA` / `PANEL` / `ROLE` 도 검사한다.
 * 정적 검사로 잡을 수 있는 유일한 종류의 오타이고, 잡지 못하면 화면을 열어야만 알 수
 * 있다.
 *
 * `ELEVATION` 이 목록에서 빠진 것은 그 그룹이 없어졌기 때문이다 — 새 방향이 무거운
 * 그림자를 금지하고, 그림자가 없으면 높이도 없다. 없는 그룹은 참조도 없으므로 검사할
 * 것이 없다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { CTA, MOTION, PANEL, RADIUS, ROLE, RULE, SIZE, SPACE, TYPE } from '../src/core/tokens.js';

const GROUPS = { SIZE, SPACE, TYPE, RADIUS, RULE, CTA, PANEL, ROLE, MOTION };

/** 그룹 이름과 같은 이름의 지역 변수를 쓰는 파일은 오탐의 원천이므로 제외한다. */
const SKIP = new Set(['src/core/tokens.js']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

/**
 * 어떤 그룹을 이 파일에서 검사할 것인가 — **import 한 것만.**
 *
 * 이름만 보고 검사하면 오탐이 난다. `cap/capTexture.js` 는 자기 지역 상수로
 * `PANEL` 을 들고 있고(뚜껑 패널의 회색들), `PANEL.base` 는 토큰의 오타가 아니라
 * 그 파일의 정상적인 코드다. 예전 감사는 `PANEL` 을 검사하지 않았기 때문에 이
 * 문제를 만나지 않았을 뿐이다.
 *
 * import 목록을 읽으면 그 종류의 오탐이 통째로 사라지고, 덤으로 주석 속 이름도
 * 걸리지 않는다 — 지난 방향을 설명하는 주석이 `TYPE.display` 를 언급하는 것은
 * 참조가 아니라 기록이다.
 */
function importedGroups(src) {
  const m = src.match(/import\s*\{([^}]*)\}\s*from\s*'[^']*core\/tokens\.js'/);
  if (!m) return [];
  return m[1]
    .split(',')
    .map((t) => t.trim().split(/\s+as\s+/)[0].trim())
    .filter((t) => t in GROUPS);
}

const bad = new Set();
let refs = 0;
let scanned = 0;
for (const file of walk('src')) {
  if (SKIP.has(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  const groups = importedGroups(src);
  if (groups.length) scanned++;
  for (const group of groups) {
    const re = new RegExp(`\\b${group}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
    for (const m of src.matchAll(re)) {
      refs++;
      if (!(m[1] in GROUPS[group])) bad.add(`${file} -> ${group}.${m[1]}`);
    }
  }
}

console.log(`checked ${refs} token references across ${scanned} file(s) that import them`);
if (bad.size) {
  console.log('\nUNDEFINED TOKEN REFERENCES:');
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log('every token reference resolves');
