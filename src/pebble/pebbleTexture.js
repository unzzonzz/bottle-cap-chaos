import { NoColorSpace, Vector3 } from 'three';
import { makeCanvasTexture } from '../core/textures.js';
import { pebbleRng } from './pebbleRng.js';

/**
 * 돌을 단색 고무처럼 보이게 하던 매끈한 표면 대신, 광물 얼룩·작은 입자·옅은
 * 석영 결을 코드로 굽는다. 사진 에셋과 새 의존성은 필요하지 않다.
 * 캔버스 하나의 RGB에 각각 큰 얼룩, 미세 입자, 결을 담는다. 색이 아닌 데이터라
 * NoColorSpace로 읽고, 실제 돌 색은 팔레트에서 만든 material.color가 담당한다.
 *
 * 구면 UV는 극에서 늘어나고 이음매가 생긴다. 물체 좌표의 세 평면에 같은 타일을
 * 투영해 노멀로 섞으면 아이코스피어의 공유 정점을 쪼개지 않고도 무늬가 이어진다.
 * 물체 좌표를 사용하므로 회전할 때 무늬가 표면에서 미끄러지지 않는다.
 * 512 타일 **한 장**을 판 위의 모든 돌이 공유하되 시드별로 위치를 옮긴다. 돌을
 * 다시 만들어도 GPU 텍스처는 늘지 않으며, 밉맵이 멀리 있는 미세 입자의 깜빡임도
 * 줄여 준다.
 */
function noise(u, v, cells, channel) {
  const x = u * cells, y = v * cells;
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = x - ix, fy = y - iy;
  const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
  const at = (a, b) => pebbleRng(((a % cells + cells) % cells) + ((b % cells + cells) % cells) * cells, channel);
  const a = at(ix, iy) * (1 - sx) + at(ix + 1, iy) * sx;
  const b = at(ix, iy + 1) * (1 - sx) + at(ix + 1, iy + 1) * sx;
  return a * (1 - sy) + b * sy;
}

export function makePebbleTexture() {
  const texture = makeCanvasTexture(512, (ctx, size) => {
    const image = ctx.createImageData(size, size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const u = x / size, v = y / size;
      const cloud = 0.55 * noise(u, v, 4, 201) + 0.3 * noise(u, v, 8, 202) + 0.15 * noise(u, v, 16, 203);
      const grain = 0.65 * noise(u, v, 128, 204) + 0.35 * noise(u, v, 64, 205);
      // 얇은 등고선만 추려 석영 결을 만든다. 굵은 줄은 대리석 무늬가 되어 피한다.
      const vein = Math.max(0, 1 - Math.abs(noise(u, v, 8, 206) - 0.5) / 0.035);
      const i = (y * size + x) * 4;
      image.data[i] = Math.round(cloud * 255);
      image.data[i + 1] = Math.round(grain * 255);
      image.data[i + 2] = Math.round(vein * 255);
      image.data[i + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  });
  texture.colorSpace = NoColorSpace;
  return texture;
}

/** GlossMaterials가 만든 재질에만 붙여 조명과 출력 경로는 게임의 것을 유지한다. */
export function applyPebbleTexture(material, texture, seed, look) {
  const originalCompile = material.onBeforeCompile;
  material.onBeforeCompile = function(shader, renderer) {
    originalCompile.call(this, shader, renderer);
    shader.uniforms.uStoneMap = { value: texture };
    shader.uniforms.uStoneOffset = { value: new Vector3(...[210, 211, 212].map(c => pebbleRng(seed, c) * 20)) };
    shader.uniforms.uStoneDetail = { value: look.textureStrength };
    shader.uniforms.uStoneBump = { value: look.bumpStrength };
    shader.uniforms.uStoneScale = { value: look.textureScale };
    shader.vertexShader = shader.vertexShader.replace('#include <common>', `
      #include <common>
      varying vec3 vStonePosition;
      varying vec3 vStoneNormal;
    `).replace('#include <begin_vertex>', `
      #include <begin_vertex>
      vStonePosition = position;
      vStoneNormal = normal;
    `);
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', `
      #include <common>
      uniform sampler2D uStoneMap;
      uniform vec3 uStoneOffset;
      uniform float uStoneDetail;
      uniform float uStoneBump;
      uniform float uStoneScale;
      varying vec3 vStonePosition;
      varying vec3 vStoneNormal;
      vec3 stoneSample() {
        vec3 p = vStonePosition * uStoneScale + uStoneOffset;
        vec3 w = pow(abs(normalize(vStoneNormal)), vec3(4.0));
        w /= max(w.x + w.y + w.z, 0.0001);
        return texture2D(uStoneMap, p.yz).rgb * w.x
             + texture2D(uStoneMap, p.zx).rgb * w.y
             + texture2D(uStoneMap, p.xy).rgb * w.z;
      }
    `).replace('#include <color_fragment>', `
      #include <color_fragment>
      vec3 stone = stoneSample();
      float minerals = smoothstep(0.58, 0.76, stone.g);
      float pores = 1.0 - smoothstep(0.22, 0.42, stone.g);
      float mottling = (stone.r - 0.5) * 0.8 + (stone.g - 0.5) * 0.32;
      diffuseColor.rgb *= 1.0 + uStoneDetail * (mottling - pores * 0.3);
      diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.55,
        clamp(uStoneDetail * (minerals * 0.5 + stone.b * 0.16), 0.0, 1.0));
    `).replace('#include <roughnessmap_fragment>', `
      #include <roughnessmap_fragment>
      roughnessFactor = clamp(roughnessFactor + (stone.g - 0.5) * 0.18 * uStoneDetail, 0.2, 1.0);
    `).replace('#include <normal_fragment_maps>', `
      #include <normal_fragment_maps>
      float stoneHeight = uStoneBump * ((stone.g - 0.5) + stone.r * 0.2);
      vec3 dx = dFdx(-vViewPosition);
      vec3 dy = dFdy(-vViewPosition);
      vec3 r1 = cross(dy, normal);
      vec3 r2 = cross(normal, dx);
      float det = dot(dx, r1);
      vec3 gradient = sign(det) * (dFdx(stoneHeight) * r1 + dFdy(stoneHeight) * r2);
      normal = normalize(abs(det) * normal - gradient);
    `);
  };
  material.customProgramCacheKey = () => 'pebble-minerals-v1';
}
