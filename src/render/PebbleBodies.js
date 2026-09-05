import { BackSide, Mesh, MeshBasicMaterial } from 'three';
import { buildPebbleGeometry } from '../pebble/pebbleGeometry.js';
import { pebbleColor } from '../pebble/pebbleColor.js';
import { applyPebbleTexture, makePebbleTexture } from '../pebble/pebbleTexture.js';
import { pebbleRng } from '../pebble/pebbleRng.js';
import { PLAYER_COLORS } from './playerColors.js';

/**
 * 판 위의 몸통을 병뚜껑 대신 자연석으로 그린다.
 *
 * 시험판(`?view=pebble`)에서 판단한 그 돌을 경기판에 올리는 것이 전부이고, 여기서
 * 새로 정하는 것은 셋이다: **콜라이더와 같은 치수로 굽는 것**, **팀을 외곽선이
 * 지는 것**, 그리고 **`apply()` 가 지우지 못하게 재질을 적는 것**.
 *
 * ── 왜 팀 색이 몸통이 아니라 선인가 ────────────────────────────────────────
 * `pebbleColor` 는 플레이어 색을 이미 버렸다. 자연석은 회색·모래색·청회색 사이를
 * 오가야 조약돌로 읽히고, 그 위에 팀의 빨강과 파랑을 얹으면 칠한 돌이 된다.
 * 그래서 "1P 와 2P 는 색과 명도로 구별한다" 는 조항을 몸통이 아니라 외곽선이
 * 진다. 두 팀 색의 상대휘도는 0.260(`#e8604a`)과 0.0796(`#1f4f92`), 간격 0.181
 * 이고 — 팔레트 감사의 `PLAYER_LUM_GAP` 0.15 를 넘는다 — 그 간격은 돌의 명도
 * 편차와 **무관하게** 유지된다. 선이 색을 전부 갖고 있기 때문이다. 뚜껑 시절에는
 * 몸통이 그 일을 했고, 그래서 돌의 명도 편차 22% 가 그 조항과 정면으로 충돌했다.
 * 선으로 옮기면서 둘이 서로를 놓아준다.
 *
 * ── 다만 선과 **돌** 의 대비는 돌마다 다르다. 화면에서 잰 값 ────────────────
 * 기본 줌·1280x960·픽셀비 2 에서 고리 픽셀과 그 안쪽 돌 픽셀을 읽으면:
 *
 *              고리 대 나무      고리 대 자기 돌 (밝은 돌 → 어두운 돌)
 *     1P       1.33~1.35 : 1     1.03 : 1  ..  2.74 : 1
 *     2P       3.13~3.20 : 1     3.36 : 1  ..  1.19 : 1
 *
 * 고리가 실제로 읽히게 하는 것은 **바깥쪽**, 즉 나무와의 대비다. 그쪽은 돌과
 * 무관하게 일정하다. 안쪽이 1.03(밝은 돌 위의 빨강)이나 1.19(어두운 돌 위의
 * 파랑)까지 내려가도 고리가 사라지지 않는 이유가 그것이다 — 다만 그 두 경우는
 * 색상만으로 버티고 있으므로, 돌의 명도 편차를 더 넓히려는 사람은 이 표를 다시
 * 재고 넓혀야 한다.
 *
 * ── 외곽선은 뒤집힌 껍질이다. 포스트 패스가 아니다 ─────────────────────────
 * 이 문서의 체인은 블룸 하나뿐이고, 전역 엣지 패스를 하나 더 세우면 카드와 조준
 * furniture 까지 같은 자를 지나게 된다. 대신 같은 형상을 법선 방향으로
 * `OUTLINE_WIDTH` 만큼 밀어낸 사본을 `BackSide` 로 그린다. 껍질의 앞면은 돌이
 * 가리고 뒷면만 실루엣 둘레에 남는다 — 조약돌 생성기가 **볼록성을 보장**하기
 * 때문에 성립하는 방법이다. 오목한 곳이 있으면 껍질이 스스로를 뚫는다.
 *
 * 껍질은 형제가 아니라 **자식**이다. 부모의 위치·회전만이 아니라 `fx.capVisual`
 * 의 흔들림과 배율까지 따라와야 하고, 형제로 두면 `ArenaView.update` 가 그 셋을
 * 프레임마다 두 번씩 쓰게 된다. 자식이면 행렬 하나가 두 메시를 다 옮긴다.
 *
 * 껍질의 아랫입술은 y = −`OUTLINE_WIDTH` 까지 내려가 판 밑으로 들어간다. 판이
 * 그 부분을 가리므로 화면에 남는 것은 접지선 위쪽뿐이고, 그래서 돌이 판에 닿는
 * 자리에 팀 색 띠가 생긴다 — 위에서 내려다보는 이 게임에서 그건 손해가 아니다.
 *
 * ── 왜 회전을 지오메트리에 굽는가 ──────────────────────────────────────────
 * `ArenaView._place` 가 프레임마다 `mesh.quaternion` 을 물리에서 덮어쓴다. 시험판
 * 처럼 `mesh.rotation.y` 에 적으면 첫 프레임에 사라진다. 그래서 시드에서 나온
 * 각도는 `geometry.rotateY` 로 정점에 굽는다. 돌마다 지오메트리가 어차피 따로다.
 */

/**
 * 돌 하나의 시드 기준값. 시험판의 기본 시드와 같은 숫자다.
 *
 * 그래서 판에 올라오는 여섯 개는 `?view=pebble` 격자의 **처음 여섯 개와 같은
 * 돌**이다. 시험판에서 고른 것이 경기에 그대로 나오는 편이 판단을 두 번 하지
 * 않는 길이고, 매 경기 같은 돌이 나오는 것도 의도다 — 두 스크린샷을 비교할 수
 * 없으면 이 단계의 판단이 성립하지 않는다. `Math.random` 이 없는 것과 같은 이유.
 */
const BODY_SEED = 20260905;

/**
 * 외곽선 두께, 월드 단위. 1.6 mm — 돌 반경(16 mm)의 정확히 10분의 1.
 *
 * 화면에서 확인한 값이다: 1280x960·픽셀비 2·기본 줌에서 고리를 가로지르는 픽셀
 * 줄을 읽으면 팔레트 색 그대로인 픽셀이 **3~4개** 나온다. CSS 픽셀로 2 남짓이고,
 * 선으로 읽히는 하한이 대략 거기다. 보드는 반폭 29 유닛이라 화면에 담기는 범위가
 * 넓어서, 이보다 얇게 잡으면 한 픽셀 밑으로 내려가 색이 번진 것으로 보인다.
 *
 * 두께가 월드 고정이므로 줌을 당기면 선도 함께 굵어진다. 최대 줌에서는 확실히
 * 굵다. 화면 고정 두께로 만들려면 정점 셰이더에서 뷰 거리를 곱해야 하는데, 그건
 * 이 실험이 답하려는 질문이 아니다 — 필요해지면 그때 한 줄로 바뀐다.
 */
const OUTLINE_WIDTH = 0.16;

/**
 * 마른 돌. **`roughness` 를 직접 주지 않는다.**
 *
 * `GlossMaterials.apply()` 는 살아 있는 모든 재질의 roughness 를
 * `userData.gloss` 에서 다시 계산한다. 즉 생성자에 명시한 roughness 는 패널의
 * 유광 스위치나 품질 티어 변경 한 번에 조용히 지워진다 — 시험판은 그때마다
 * 재질을 새로 만들어 피했지만, 경기 중에는 그럴 자리가 없다.
 *
 * 그래서 램프에 얹는다: `0.85 + (0.22 − 0.85) · gloss` 이므로 시험판이 고른
 * 0.82 는 gloss 0.048 이다. 부수 효과로 유광 스위치를 꺼도 돌은 0.85 로 거의
 * 움직이지 않는데, 젖은 금속과 달리 돌에는 그게 맞다.
 */
const STONE_GLOSS = 0.048;

/** 시험판이 고른 표면 값. 여기서 다시 판단하지 않는다. */
const STONE_LOOK = { textureStrength: 1, bumpStrength: 0.012, textureScale: 0.3 };

/** 마른 돌의 얕은 코트. 0 이면 종이가 되고 0.8 이면 사탕이 된다. */
const STONE_CLEARCOAT = 0.06;

export class PebbleBodies {
  /**
   * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
   * @param {number} radius  수평 반경, 월드 단위 — 콜라이더가 쓰는 바로 그 값
   * @param {number} height  총 높이, 월드 단위 — 마찬가지
   */
  constructor({ retro, radius, height }) {
    this.retro = retro;
    /**
     * 치수를 인자로 받는 것이 이 클래스의 핵심 계약이다.
     *
     * 콜라이더는 `capDimensions(capGeometry)` 즉 뚜껑의 `userData` 에서 나왔고,
     * 여기에 그 값을 그대로 넣으면 그려지는 돌과 부딪히는 원기둥이 정의상 같은
     * 크기가 된다. 돌의 기본 치수(16 / 6.2 mm)를 여기 다시 적으면 두 숫자가
     * 언젠가 갈라지고, 갈라진 날 증상은 "판정이 눈보다 조금 크다" 다.
     *
     * mm 로 되돌리는 것은 `buildPebbleGeometry` 의 입력이 mm 이기 때문이다.
     */
    this.shape = { radius: radius * 10, height: height * 10 };
    // 25개가 한 장을 공유하던 것과 같다. 돌마다 다른 것은 시드가 옮기는 위치뿐.
    this.texture = makePebbleTexture();
    this.meshes = [];
  }

  /**
   * 몸통 하나. 자식으로 달린 외곽선까지 묶어서 돌려준다.
   *
   * @param {number} index  뚜껑 슬롯. 시드가 여기서 나오므로 자리마다 다른 돌이다
   * @param {number} owner  0 또는 1
   */
  meshFor(index, owner) {
    const seed = (BODY_SEED + index) >>> 0;

    const geometry = buildPebbleGeometry({ ...this.shape, seed });
    // 정점에 굽는다. 머리말의 마지막 문단을 보라.
    geometry.rotateY(pebbleRng(seed, 30) * Math.PI * 2);
    geometry.computeBoundingSphere();

    const material = this.retro.create({
      color: pebbleColor(seed),
      gloss: STONE_GLOSS,
      metalness: 0,
      clearcoat: STONE_CLEARCOAT,
      clearcoatRoughness: 0.5,
      /**
       * 림을 끈다. 시험판의 판단이고, 여기서는 근거가 하나 더 있다: 실루엣을
       * 배경에서 떼어내는 것이 림의 일인데 이제 외곽선이 그 일을 훨씬 분명하게
       * 한다. 둘 다 켜면 돌 가장자리에 차가운 띠와 팀 색 띠가 겹친다.
       */
      rim: false,
    });
    applyPebbleTexture(material, this.texture, seed, STONE_LOOK);

    const mesh = new Mesh(geometry, material);
    mesh.add(this._outline(geometry, owner));
    this.meshes.push(mesh);
    return mesh;
  }

  /** 돌 하나가 그리는 삼각형. 껍질까지 포함한 실제 숫자다. */
  get triangles() {
    const mesh = this.meshes[0];
    if (!mesh) return 0;
    return mesh.geometry.userData.triangles * 2;
  }

  setWireframe(on) {
    for (const mesh of this.meshes) {
      mesh.material.wireframe = on;
      /**
       * 껍질은 와이어프레임에서 **사라진다**. 선을 그리라고 만든 것을 다시 선으로
       * 그리면 돌의 격자와 껍질의 격자가 1.6 mm 어긋난 채 겹쳐, 확인하려던 형상이
       * 바로 그 겹침에 묻힌다.
       */
      for (const child of mesh.children) child.visible = !on;
    }
  }

  dispose() {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.material.dispose();
      for (const child of mesh.children) {
        child.geometry.dispose();
        child.material.dispose();
      }
    }
    this.meshes.length = 0;
    this.texture.dispose();
  }

  _outline(source, owner) {
    const geometry = source.clone();
    const position = geometry.attributes.position;
    const normal = geometry.attributes.normal;
    for (let i = 0; i < position.count; i++) {
      position.setXYZ(
        i,
        position.getX(i) + normal.getX(i) * OUTLINE_WIDTH,
        position.getY(i) + normal.getY(i) * OUTLINE_WIDTH,
        position.getZ(i) + normal.getZ(i) * OUTLINE_WIDTH,
      );
    }
    position.needsUpdate = true;
    // 사본은 원본의 경계구를 그대로 들고 온다. 다시 재지 않으면 실루엣이 프레임
    // 가장자리에 걸릴 때 껍질만 컬링돼 선이 한쪽에서 끊긴다.
    geometry.computeBoundingSphere();

    /**
     * 조명을 받지 않는 재질이다. `GlossMaterials` 를 거치지 않는 유일한 몸통
     * 재질이고, 그래야 하는 이유는 이것이 표면이 아니라 **그래픽**이기 때문이다.
     * 물리 재질로 만들면 선의 밝기가 돌이 놓인 각도에 따라 변하고, 팀을 읽는
     * 신호가 조명에 흔들리게 된다.
     *
     * 블룸은 타지 않는다. 임계값은 선형 휘도 0.72 이고 두 팀 색은 0.260 · 0.0796
     * 이라 절반에도 못 미친다 — 팀 색을 바꾸는 사람은 그 자를 다시 대 볼 것.
     */
    const material = new MeshBasicMaterial({ color: PLAYER_COLORS[owner], side: BackSide });

    const mesh = new Mesh(geometry, material);
    // 껍질은 그림자에 관여하지 않는다. 던지면 돌보다 1.6 mm 큰 그림자가 돌의
    // 그림자를 덮고, 받으면 자기 안쪽이 어두워져 선의 색이 자리마다 달라진다.
    mesh.castShadow = false;
    mesh.receiveShadow = false;
    return mesh;
  }
}
