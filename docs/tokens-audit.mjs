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
 * 같은 이유로 `MOTION` / `RADIUS` / `ELEVATION` 도 검사한다. 정적 검사로 잡을 수
 * 있는 유일한 종류의 오타이고, 잡지 못하면 화면을 열어야만 알 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { ELEVATION, MOTION, RADIUS, SIZE, SPACE, TYPE } from '../src/core/tokens.js';

const GROUPS = { SIZE, SPACE, TYPE, RADIUS, ELEVATION, MOTION };

/** 그룹 이름과 같은 이름의 지역 변수를 쓰는 파일은 오탐의 원천이므로 제외한다. */
const SKIP = new Set(['src/core/tokens.js']);

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) return walk(p);
    return e.name.endsWith('.js') ? [p] : [];
  });
}

const bad = new Set();
let refs = 0;
for (const file of walk('src')) {
  if (SKIP.has(file)) continue;
  const src = fs.readFileSync(file, 'utf8');
  for (const group of Object.keys(GROUPS)) {
    const re = new RegExp(`\\b${group}\\.([A-Za-z_][A-Za-z0-9_]*)`, 'g');
    for (const m of src.matchAll(re)) {
      refs++;
      if (!(m[1] in GROUPS[group])) bad.add(`${file} -> ${group}.${m[1]}`);
    }
  }
}

console.log(`checked ${refs} token references across src/`);
if (bad.size) {
  console.log('\nUNDEFINED TOKEN REFERENCES:');
  for (const b of bad) console.log('  ' + b);
  process.exit(1);
}
console.log('every token reference resolves');
