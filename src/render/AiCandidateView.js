import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  LineBasicMaterial,
  LineSegments,
  Sprite,
  SpriteMaterial,
} from 'three';
import { scoreTagTexture } from './aiTextures.js';
import { PALETTE } from '../core/palette.js';

/**
 * What the AI considered, and what it thought of each.
 *
 * ── it is the only way to read a decision ──────────────────────────────────
 * "AI 후보 평가 시각화: 상위 N개 후보의 궤적과 점수를 화면에 표시. 이게 있어야
 * AI가 왜 그 수를 뒀는지 알 수 있다. 반드시 넣어라."
 *
 * The search evaluates dozens of exact rollouts and throws all but one away. A
 * move that looks stupid is completely unreadable from the outside — you cannot
 * tell a bad evaluation from a good evaluation of a bad position, and those need
 * opposite fixes. Drawing the runners-up with their scores answers it in one
 * glance: if the chosen line scores 66 and the obvious-looking alternative
 * scores -140, the weights are right and the position was a trap.
 *
 * ── the best line is BRIGHT and the rest fade back ─────────────────────────
 * Rank, not score, drives the colour: scores are unbounded and mostly negative,
 * so a value ramp would put every line in a crowded position at the same end of
 * it. Rank spreads them evenly by construction, and rank is the thing being
 * communicated — this one was chosen, these were not, in this order.
 *
 * ── in the world, `depthTest: false`, like `TrackPathView` ─────────────────
 * And for the same reason it gives: the moment that matters most is a cap going
 * over the rim, where the line runs below the table's own surface and would
 * otherwise be hidden by the thing it is explaining.
 */

/** Board-plane height for the lines. Above the markings, clear of the caps. */
const Y = 0.14;

/**
 * Best to worst. Warm and bright at the top, cold and dim at the bottom.
 *
 * Five, matching `candidateCount`'s default. A sixth line reuses the last
 * colour, which is honest — it says "also-ran" — and is better than generating
 * a ramp that would put two adjacent ranks a quantiser step apart.
 */
const RANK_COLORS = PALETTE.debug.rank;

export class AiCandidateView {
  constructor() {
    /**
     * A `Group`, unlike `TrackPathView`'s bare pair of objects.
     *
     * That one has exactly two lines and knows it, so handing them to the caller
     * to add is simpler than a container. This builds its lines LAZILY — a
     * session that never switches the toggle on allocates nothing — so there is
     * no fixed set to hand over at construction, and a root the caller adds once
     * is what lets new ranks appear without the scene being touched again.
     */
    this.root = new Group();
    this.geometries = [];
    this.materials = [];
    this.lines = [];
    this.tags = [];
    this._built = 0;
  }

  /** Build up to `n` line/label pairs, once. Reused every turn after that. */
  _ensure(n) {
    for (let i = this._built; i < n; i++) {
      const geometry = new BufferGeometry();
      geometry.setAttribute('position', new Float32BufferAttribute([], 3));
      const color = RANK_COLORS[Math.min(i, RANK_COLORS.length - 1)];
      const material = new LineBasicMaterial({
        color,
        fog: false,
        depthTest: false,
        transparent: true,
        // The best line is fully opaque and the rest recede, so the chosen move
        // is legible against four others crossing the same board.
        opacity: i === 0 ? 0.95 : 0.5,
      });
      const line = new LineSegments(geometry, material);
      line.renderOrder = 7;
      line.frustumCulled = false;
      line.visible = false;

      const tag = new Sprite(
        new SpriteMaterial({ depthTest: false, transparent: true, fog: false }),
      );
      tag.renderOrder = 8;
      tag.visible = false;
      tag.frustumCulled = false;

      this.geometries.push(geometry);
      this.materials.push(material);
      this.lines.push(line);
      this.tags.push(tag);
      this.root.add(line, tag);
      this._built++;
    }
  }

  /**
   * @param {{score: number, candidate: object, result: {path: number[]|null}}[]} scored
   *   already ranked, best first
   * @param {boolean} on  the panel's switch
   * @param {number} count
   * @param {number} scale  world units per frame pixel, for the label size
   */
  update(scored, on, count, scale = 1) {
    const n = on && scored ? Math.min(count, scored.length) : 0;
    this._ensure(n);

    for (let i = 0; i < this._built; i++) {
      const entry = i < n ? scored[i] : null;
      const path = entry?.result?.path;
      if (!entry || !path || path.length < 6) {
        this.lines[i].visible = false;
        this.tags[i].visible = false;
        continue;
      }
      this._write(i, path);

      // The label sits at the END of the line — where the cap came to rest,
      // which is the position the score is ABOUT.
      const at = path.length - 3;
      const tag = this.tags[i];
      const tex = scoreTagTexture(entry.score, entry.candidate.intent, i);
      tag.material.map = tex;
      tag.material.needsUpdate = true;
      tag.position.set(path[at], Y + 1.6, path[at + 2]);
      tag.scale.set(tex.userData.width * scale, tex.userData.height * scale, 1);
      tag.visible = true;
    }
  }

  /** Consecutive samples joined as segments, exactly as `TrackPathView` does. */
  _write(i, path) {
    const points = path.length / 3;
    const pairs = points - 1;
    const pos = new Float32Array(pairs * 6);
    for (let s = 0; s < pairs; s++) {
      const a = s * 3;
      pos[s * 6 + 0] = path[a];
      pos[s * 6 + 1] = Y;
      pos[s * 6 + 2] = path[a + 2];
      pos[s * 6 + 3] = path[a + 3];
      pos[s * 6 + 4] = Y;
      pos[s * 6 + 5] = path[a + 5];
    }
    this.geometries[i].setAttribute('position', new Float32BufferAttribute(pos, 3));
    this.geometries[i].computeBoundingSphere();
    this.lines[i].visible = true;
  }

  dispose() {
    for (const g of this.geometries) g.dispose();
    for (const m of this.materials) m.dispose();
    for (const t of this.tags) t.material.dispose();
  }
}
