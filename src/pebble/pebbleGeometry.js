import { BufferGeometry, Float32BufferAttribute } from 'three';

/**
 * 물에 닳은 돌을 만드는 순수 생성기. 입력 치수는 mm, 출력은 cm다.
 * UV 구의 극점 밀집을 피하려고 ballGeometry의 정이십면체 표를 복사했다.
 * 모서리 중점을 공유해야 computeVertexNormals가 면 사이를 매끈하게 잇는다.
 * 세분 2회는 320면으로 800면 예산 안이고, 3회(1280)는 비교용으로만 열어 둔다.
 *
 * 경기에서 이것을 부르는 곳은 `render/PebbleBodies.js` 하나뿐이고, 치수를
 * **콜라이더의 것**으로 넘긴다 — 아래 기본값이 아니다. 그 이유는 그쪽에 있다.
 *
 * 혹은 셋만 둔다. 더 많은 고주파 요철은 마모보다 손으로 빚은 감자로 읽히므로
 * 총 진폭을 9%로 제한한다. 주파수 길이는 1.1~2.6의 비정수이고 방향도 시드로
 * 흩는다. 축 지터 ±10%가 큰 비대칭을, 혹이 그 사이의 작은 차이를 담당한다.
 *
 * 바닥은 음의 y만 15%까지 완만하게 압축한다. 작은 진폭이라도 모든 시드에서
 * 볼록하다는 보장은 없으므로 인접 면의 반공간을 검사하고 변형을 줄여 재시도한다.
 * 면을 잘라 평평하게 만드는 방식은 실루엣에 각을 만들므로 쓰지 않는다.
 * 마지막에 수평 반경과 총 높이를 맞춰 형태 지터가 콜라이더 크기를 바꾸지 않게 한다.
 */
/**
 * 인자로 주지 않은 것들의 값. **export 하지 않는다** — 시험판이 슬라이더로 이
 * 표를 통째로 들고 다녔지만 그 화면은 없어졌고, 지금 유일한 호출부는 치수 둘만
 * 넘기고 나머지는 여기 맡긴다. 밖에서 읽을 것이 없는 표를 내보내 두면 다음 사람이
 * 이 값들이 어딘가에서 조절되고 있다고 읽는다.
 */
const PEBBLE_DEFAULTS = {
  radius: 16, // 16 mm는 기존 병뚜껑 반경 1.6 월드 유닛이다.
  // 병뚜껑과 같은 높이. 실제로 쓰이는 값은 호출부가 콜라이더에서 읽어 넘긴다.
  height: 6.2,
  subdivisions: 2,
  axisJitter: 0.10,
  bumpAmplitude: 0.09,
  bumpFrequency: 1, // 배수 1에서 명세의 주파수 구간 전체를 사용한다.
  bottomFlatten: true,
  seed: 1, // 기본 호출도 재현 가능해야 하므로 명시적인 정수다.
};
const TAU = Math.PI * 2;
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const norm = (v) => { const l = Math.hypot(...v); return v.map(x => x / l); };

// three 외의 import를 없애기 위한 pebbleRng의 동일한 사본. 채널 계약도 같다.
function random(seed, channel) {
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h ^ channel, 0xc2b2ae35) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function icosahedron() {
  const t = (1 + Math.sqrt(5)) / 2;
  const vertices = [
    [-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0],
    [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t],
    [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1],
  ].map(norm);
  const faces = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ];
  return { vertices, faces };
}

// 닫힌 구면 위상의 각 변 양쪽을 검사하므로 모든 정점 쌍을 순회할 필요가 없다.
function neighbours(faces) {
  const edges = new Map();
  const pairs = [];
  for (const face of faces) {
    for (let j = 0; j < 3; j++) {
      const a = face[j], b = face[(j + 1) % 3], c = face[(j + 2) % 3];
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (edges.has(key)) pairs.push([...edges.get(key), c]);
      else edges.set(key, [a, b, c]);
    }
  }
  return pairs;
}

function isConvex(vertices, pairs) {
  for (const [ia, ib, ic, id] of pairs) {
    const a = vertices[ia], b = vertices[ib], c = vertices[ic], d = vertices[id];
    const u = b.map((v, i) => v - a[i]), v = c.map((v, i) => v - a[i]);
    const n = [u[1]*v[2]-u[2]*v[1], u[2]*v[0]-u[0]*v[2], u[0]*v[1]-u[1]*v[0]];
    // 단위 형상의 부동소수점 반올림만 허용하고 실제 오목한 모서리는 거른다.
    if (n.reduce((sum, x, i) => sum + x * (d[i] - a[i]), 0) > 1e-12) return false;
  }
  return true;
}

/** @param {Partial<typeof PEBBLE_DEFAULTS>} params 치수는 mm다. */
export function buildPebbleGeometry(params = {}) {
  const p = { ...PEBBLE_DEFAULTS, ...params };
  const radius = Math.max(0.1, p.radius) / 10;
  const height = Math.max(0.1, p.height) / 10;
  let { vertices, faces } = icosahedron();
  for (let level = 0; level < clamp(Math.round(p.subdivisions), 0, 3); level++) {
    const cache = new Map();
    const midpoint = (a, b) => {
      const key = a < b ? `${a}:${b}` : `${b}:${a}`;
      if (!cache.has(key)) {
        cache.set(key, vertices.length);
        vertices.push(norm(vertices[a].map((v, i) => v + vertices[b][i])));
      }
      return cache.get(key);
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = midpoint(a, b), bc = midpoint(b, c), ca = midpoint(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const rng = channel => random(p.seed, channel);
  const jitter = clamp(p.axisJitter, 0, 0.1);
  const sx = 1 + (rng(0) * 2 - 1) * jitter;
  const sz = 1 + (rng(1) * 2 - 1) * jitter;
  const sy = height / (2 * radius); // 눌림과 높이는 같은 치수의 두 표현이다.
  const bumps = Array.from({ length: 3 }, (_, k) => {
    const channel = 10 + k * 5; // 축·회전 채널과 겹치지 않게 다섯 칸씩 쓴다.
    const y = rng(channel) * 2 - 1;
    const angle = rng(channel + 1) * TAU;
    let f = clamp((1.1 + 1.5 * rng(channel + 2)) * p.bumpFrequency, 1.1, 2.6);
    if (Number.isInteger(f)) f += 0.001; // 정수 길이를 패널 배수로 우연히 만들지 않는다.
    const horizontal = Math.sqrt(1 - y * y);
    return { f: [horizontal * Math.cos(angle) * f, y * f, horizontal * Math.sin(angle) * f],
      phase: rng(channel + 3) * TAU, weight: 0.5 + rng(channel + 4) };
  });
  const weight = bumps.reduce((sum, b) => sum + b.weight, 0);
  const amplitude = clamp(p.bumpAmplitude, 0, 0.09);
  const pairs = neighbours(faces);
  let points, attenuation = 1;
  for (;;) {
    points = vertices.map(d => {
      const r = 1 + amplitude * attenuation * bumps.reduce((sum, b) =>
        sum + b.weight / weight * Math.cos(b.f.reduce((dot, f, i) => dot + f*d[i], 0) + b.phase), 0);
      const point = [d[0] * sx * r, d[1] * sy * r, d[2] * sz * r];
      if (p.bottomFlatten && point[1] < 0) {
        const t = clamp(-d[1], 0, 1);
        point[1] *= 1 - 0.15 * attenuation * t*t*(3-2*t);
      }
      return point;
    });
    if (isConvex(points, pairs)) break;
    // 절반씩 줄이면 유한 시간에 볼록한 타원체에 도착한다. 위상·축 차이는 남는다.
    attenuation = attenuation > 1 / 128 ? attenuation * 0.5 : 0;
  }
  const maxRadius = Math.max(...points.map(v => Math.hypot(v[0], v[2])));
  const minY = Math.min(...points.map(v => v[1]));
  const maxY = Math.max(...points.map(v => v[1]));
  const positions = points.flatMap(([x, y, z]) => [
    x * radius / maxRadius, (y - minY) * height / (maxY - minY), z * radius / maxRadius,
  ]);
  const geometry = new BufferGeometry();
  geometry.setAttribute('position', new Float32BufferAttribute(positions, 3));
  geometry.setIndex(faces.flat());
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  geometry.userData = { triangles: faces.length, radius, height, deformationScale: attenuation };
  return geometry;
}
