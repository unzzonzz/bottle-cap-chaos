/**
 * 철벽's balance, measured rather than argued.
 *
 * ── why this exists as a file rather than as a note ─────────────────────────
 * The whole claim the card makes is arithmetic — a mass multiplier that exactly
 * cancels 강타's impulse multiplier — and arithmetic that is only ever checked
 * once is arithmetic that stops being true the next time somebody moves a
 * slider. This fires real shots through the real `Arena` at the real compound
 * collider and reports the ratios the card's face is promising.
 *
 * Run: `node tools/balance/resist.mjs`
 */
import { initRapier } from '../../src/physics/rapier.js';
import { PhysicsWorld } from '../../src/physics/PhysicsWorld.js';
import { Match, MATCH_STATE } from '../../src/game/Match.js';
import { modeByKey } from '../../src/game/modes.js';
import { replayConfig } from '../../src/replay/ReplayRunner.js';
import { capDimsHeadless } from '../determinism/capDims.mjs';
import { seedRun } from '../../src/physics/rng.js';

await initRapier();
const capDims = await capDimsHeadless();
const config = replayConfig();

/**
 * One shot, from a freshly built knockout board.
 *
 * The brace is armed straight on `CardEffects` and the turn is then re-opened,
 * so the mass reaches the world down `Match._syncCapMass` exactly as it does in
 * a real turn — this measures the wiring, not a hand-poked body.
 */
function shot({ braceTarget, boost, armMine, power = 1, measure = 'target' }) {
  seedRun(0x51ee7000);
  const physics = new PhysicsWorld({
    solverIterations: config.physics.solverIterations,
    ccdSubsteps: config.physics.ccdSubsteps,
  });
  const match = new Match({
    physics,
    capDims,
    config,
    mode: modeByKey('knockout'),
    seed: 0xba1a4ce,
  });
  match.start();

  const shooter = match.rules.shooterFor(match.rules.currentPlayer);
  const me = match.arena.capOwner[shooter];

  // The nearest cap on the other side: the one the shot is aimed at.
  const from = match.arena.capCom(shooter);
  let target = -1;
  let best = Infinity;
  for (let i = 0; i < match.arena.capCount; i++) {
    if (match.arena.capOwner[i] === me) continue;
    const c = match.arena.capCom(i);
    const d = Math.hypot(c.x - from.x, c.z - from.z);
    if (d < best) {
      best = d;
      target = i;
    }
  }

  if (braceTarget) match.cards.resist[match.arena.capOwner[target]] = {};
  // Armed on MY OWN side. Under §2-A this must change nothing about my shot: the
  // brace is live only while it is not my turn, and it is my turn.
  if (armMine) match.cards.resist[me] = {};
  match._beginAim();

  const watched = measure === 'shooter' ? shooter : target;
  const before = match.arena.capCom(watched);
  const to = match.arena.capCom(target);
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  const len = Math.hypot(dx, dz) || 1;

  match.fire({
    capIndex: shooter,
    dirX: dx / len,
    dirZ: dz / len,
    power,
    seed: 0x51ee0042,
    impulseMul: boost ? config.cards.smashImpulseMul : 1,
    // Closed. See `sweep` — the cone is 강타's own price and it swamps the
    // mechanism this file is measuring.
    spreadMul: 0,
  });

  /**
   * The fastest the watched cap ever gets, and how far it ends up.
   *
   * Both, because they answer different questions and only one of them is clean.
   * Peak speed is what the mechanism DIRECTLY sets — `v = J/m`, one division —
   * so the cancellation shows up in it exactly. Displacement is what a player
   * sees, and on a real knockout board it is contaminated by everything the cap
   * runs into on the way: a hit that starts a chain travels until the chain
   * stops, and one that walks a cap over the rim travels thirty units down into
   * the pit. Reporting only the second would make the arithmetic look wrong;
   * reporting only the first would be measuring a formula rather than a game.
   */
  let guard = 0;
  let peak = 0;
  let window = -1;
  while (match.state === MATCH_STATE.LIVE && guard++ < 4000) {
    match.update(1 / 120);
    const v = physics.body(match.arena.capBodies[watched]).linvel();
    const sp = Math.hypot(v.x, v.z);
    /**
     * A WINDOW around the first contact, not the whole turn.
     *
     * Peak over the whole turn measured the wrong thing and measured it badly:
     * a cap that is struck once and then hit again by the chain reports the
     * second hit, and a cap that walks over the rim reports the RUN-OFF SLOPE,
     * which is gravity accelerating it down a ramp and has nothing to do with
     * any impulse. Both were pulling the ratios away from the arithmetic — the
     * boosted shot read 2.12x where the impulse multiplier is 1.5, because a
     * boosted shot is far more likely to send the target over the edge.
     *
     * The response to the impulse is over in a handful of steps: the cap is at
     * its fastest on the step the contact resolves and is being slowed by
     * friction from the next one. So the window opens when the cap first moves
     * and closes 24 steps later, a fifth of a second, which is comfortably
     * longer than the contact and comfortably shorter than the trip to the rim.
     */
    if (window < 0 && sp > 1) window = 24;
    if (window > 0) {
      if (sp > peak) peak = sp;
      window--;
    }
  }

  const after = match.arena.capCom(watched);
  physics.free();
  return { moved: Math.hypot(after.x - before.x, after.z - before.z), peak };
}

/**
 * A sweep over POWER rather than over cone seeds.
 *
 * ── the error cone had to come out of the measurement ───────────────────────
 * The first version drew a fresh cone seed per sample and the numbers were
 * unusable: σ 23 on a mean of 17. A boosted shot is fired through a cone half
 * again as wide and therefore MISSES more often, and a miss travels the whole
 * board while a hit stops dead. That is a real and intended property of 강타 —
 * it is the card's entire price — but it is not what this file measures, and
 * mixing the two lets the accuracy cost drown the mechanism.
 *
 * So `spreadMul: 0` closes the cone and the sample varies the draw strength
 * instead. Every shot lands, each impact geometry is repeatable, and what is
 * left in the spread is the honest variation between a glancing contact and a
 * square one.
 */
function sweep(f, n = 24) {
  const rows = [];
  for (let i = 0; i < n; i++) rows.push(f(0.42 + (i / (n - 1)) * 0.58));
  const stat = (key) => {
    const v = rows.map((r) => r[key]);
    const m = v.reduce((a, b) => a + b, 0) / v.length;
    return { m, sd: Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length) };
  };
  return { moved: stat('moved'), peak: stat('peak'), n: rows.length };
}

const CASES = [
  ['평범한 샷 → 맨 뚜껑      ', (p) => shot({ power: p })],
  ['강타 샷   → 맨 뚜껑      ', (p) => shot({ power: p, boost: true })],
  ['강타 샷   → 철벽 뚜껑 ★  ', (p) => shot({ power: p, boost: true, braceTarget: true })],
  ['평범한 샷 → 철벽 뚜껑    ', (p) => shot({ power: p, braceTarget: true })],
  ['내 발사 (철벽 없음)      ', (p) => shot({ power: p, measure: 'shooter' })],
  ['내 발사 (내가 철벽 보유) ', (p) => shot({ power: p, armMine: true, measure: 'shooter' })],
];

const k = config.cards.smashImpulseMul;
console.log(`k = smashImpulseMul = ${k}   (콘 닫음: spreadMul = 0, power 0.42..1.00 x24)\n`);
console.log('                              최고 속도 (cm/s)        이동 거리 (units)');
const peak = [];
const moved = [];
for (const [label, f] of CASES) {
  const r = sweep(f);
  peak.push(r.peak.m);
  moved.push(r.moved.m);
  console.log(
    `${label}  ${r.peak.m.toFixed(2).padStart(8)} ±${r.peak.sd.toFixed(2).padStart(6)}` +
      `    ${r.moved.m.toFixed(2).padStart(7)} ±${r.moved.sd.toFixed(2).padStart(6)}`,
  );
}

const pr = (i) => peak[i] / peak[0];
const invK = 1 / k;
console.log('\n── 기전: 최고 속도의 비 ──');
console.log(`  강타 → 맨 뚜껑      ${pr(1).toFixed(4)}`);
console.log(`  평범 → 철벽 뚜껑    ${pr(3).toFixed(4)}   ← 1/k = ${invK.toFixed(4)} — 카드 면이 약속하는 값`);
console.log(`  강타 → 철벽 뚜껑    ${pr(2).toFixed(4)}   = ${pr(1).toFixed(3)} x ${pr(3).toFixed(3)}`);
console.log(`  내 발사 배율        ${(peak[5] / peak[4]).toFixed(4)}   ← 1 (§2-A: 내 발사는 영향 없음)`);

/**
 * The same measurement with the board taken away.
 *
 * The knockout arena is where the card is actually played and it is a terrible
 * place to read a ratio off: the shooter crosses most of the board to arrive, so
 * 강타's own RANGE amplification is folded into every number above — a boosted
 * cap arrives at 2.12x an unboosted one there, not 1.5x, because friction takes
 * energy per unit distance and the boosted one keeps more of it over the trip.
 *
 * So the law is read here instead, on two caps and a floor, at three separations.
 * `2/(1+a)` is what a collision actually hands the struck body; `1/a` is what a
 * fixed impulse would, and a braced cap is hit rather than shot.
 */
async function isolated() {
  const { RAPIER } = await import('../../src/physics/rapier.js');
  const { describeCapColliders } = await import('../../src/physics/capCollider.js');
  const desc = describeCapColliders(capDims, config.collider);

  const makeCap = (w, x) => {
    const b = w.createRigidBody(
      RAPIER.RigidBodyDesc.dynamic()
        .setTranslation(x, 0.002, 0)
        .setLinearDamping(config.physics.linearDamping)
        .setAngularDamping(config.physics.angularDamping)
        .setCcdEnabled(true),
    );
    for (const p of desc.parts) {
      const cd =
        p.kind === 'cylinder'
          ? RAPIER.ColliderDesc.cylinder(p.halfHeight, p.radius)
          : p.kind === 'roundCuboid'
            ? RAPIER.ColliderDesc.roundCuboid(
                p.halfExtents.x, p.halfExtents.y, p.halfExtents.z, p.borderRadius)
            : RAPIER.ColliderDesc.cuboid(p.halfExtents.x, p.halfExtents.y, p.halfExtents.z);
      cd.setTranslation(p.translation.x, p.translation.y, p.translation.z)
        .setRotation(p.rotation)
        .setMass(p.mass)
        .setFriction(desc.friction)
        .setRestitution(desc.restitution);
      w.createCollider(cd, b);
    }
    return b;
  };

  const trial = (mul, boost, gap) => {
    const w = new RAPIER.World({ x: 0, y: -981, z: 0 });
    w.integrationParameters.dt = 1 / 120;
    w.integrationParameters.lengthUnit = 100;
    w.integrationParameters.numSolverIterations = config.physics.solverIterations;
    w.integrationParameters.maxCcdSubsteps = config.physics.ccdSubsteps;
    w.createCollider(
      RAPIER.ColliderDesc.cuboid(400, 1, 400)
        .setTranslation(0, -1, 0)
        .setFriction(desc.friction)
        .setRestitution(desc.restitution),
      w.createRigidBody(RAPIER.RigidBodyDesc.fixed()),
    );
    const shooter = makeCap(w, 0);
    const target = makeCap(w, gap);
    for (let i = 0; i < 60; i++) w.step();
    if (mul !== 1) {
      target.setAdditionalMass(target.mass() * (mul - 1), true);
      target.recomputeMassPropertiesFromColliders();
    }
    const start = target.translation();
    shooter.applyImpulse({ x: config.shot.maxImpulse * boost, y: 0, z: 0 }, true);
    let p = 0;
    let win = -1;
    for (let i = 0; i < 1200; i++) {
      w.step();
      const v = target.linvel();
      const sp = Math.hypot(v.x, v.z);
      if (win < 0 && sp > 1) win = 24;
      if (win > 0) {
        if (sp > p) p = sp;
        win--;
      }
    }
    const end = target.translation();
    const d = Math.hypot(end.x - start.x, end.z - start.z);
    w.free();
    return { peak: p, d };
  };

  const a = 2 * k - 1;
  console.log(`\n── 격리 측정: 뚜껑 둘과 바닥. a = 2k-1 = ${a.toFixed(2)} ──`);
  console.log('  간격   강타 증폭   평범→철벽   2/(1+a)   1/k     강타+철벽/평범   거리비');
  for (const gap of [6, 12, 24]) {
    const plain = trial(1, 1, gap);
    const smash = trial(1, k, gap);
    const brace = trial(a, 1, gap);
    const both = trial(a, k, gap);
    console.log(
      `  ${String(gap).padStart(4)}    ${(smash.peak / plain.peak).toFixed(3)}       ` +
        `${(brace.peak / plain.peak).toFixed(3)}       ${(2 / (1 + a)).toFixed(3)}     ` +
        `${invK.toFixed(3)}   ${(both.peak / plain.peak).toFixed(3)}            ` +
        `${(brace.d / plain.d).toFixed(3)}`,
    );
  }
  console.log(
    `\n  · 평범→철벽 이 2/(1+a) 와 맞고 1/k 와도 맞는다 — a 를 그렇게 고른 것이 이유다.\n` +
      `  · 강타+철벽 은 12 단위에서 1.00 이고 짧은 쪽에서 0.96, 먼 쪽에서 1.17 로 벌어진다.\n` +
      `    남는 것은 강타의 사거리 증폭이다: 마찰이 거리당 에너지를 가져가므로 부스트된\n` +
      `    뚜껑은 멀리서 올수록 더 유리해지고 (6단위 1.45배, 24단위 1.77배), 거리를 모르는\n` +
      `    상수 배율로는 지울 수 없다. 그래서 카드 면은 "덜 밀려난다"이지 "상쇄한다"가 아니다.\n` +
      `  · 거리비는 속도비의 제곱에 붙는다 — 마찰 감속 a = μg 는 질량과 무관하기 때문이다.\n` +
      `    AI 의 pushDistanceFor 가 (2/(1+a))² 를 쓰는 근거가 이 열이다.`,
  );
}
await isolated();
