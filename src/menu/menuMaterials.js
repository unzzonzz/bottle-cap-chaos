

import { AdditiveBlending, Color, DoubleSide, NormalBlending, ShaderMaterial, Vector2, Vector3 } from 'three';
import { PALETTE } from '../core/palette.js';

/**
 * Two materials the menu needs and `RetroMaterial` deliberately does not have.
 *
 * ── why not just extend RetroMaterial ───────────────────────────────────────
 * Its fragment stage ends `gl_FragColor = vec4(c, 1.0)`. That is not an
 * oversight — it is a statement that everything in the world is opaque, and the
 * whole game so far is. Glass is not, and `CardMaterial` already set the
 * precedent for how this codebase handles that: repeat the PS1 VERTEX stage
 * verbatim, change only the part that has to change, and say why in the file.
 * The alternative — an opacity uniform on the shared material — would put a
 * blend mode and a sorting problem on every cap in every match to serve one
 * bottle on one screen.
 *
 * The vertex stage below is the same snap, the same affine UV setup and the
 * same per-vertex lighting as `RetroMaterial`, and it takes that file's SHARED
 * uniform objects by reference. One vertex-snap slider still moves the whole
 * scene, glass included.
 *
 * ── the glass, and what is not in it ────────────────────────────────────────
 * Forbidden by the brief and absent here: refraction, physically-based
 * transmission, a smooth gradient, a real specular pass. What is here instead:
 *
 *   ALPHA BLENDING with a fixed base opacity.
 *   A BAKED TINT in the vertex colour — dark at the heel, clearing up the neck.
 *   A RIM term, per vertex, from 1 - |n . v|. It both darkens and thickens the
 *     glass toward the silhouette, which is the one optical fact about a
 *     cylinder of glass that reads at 320x240: you are looking through more of
 *     it at the edges. Per VERTEX, not per fragment — it interpolates across
 *     the triangle exactly as Gouraud does, and on a 30-column lathe you can
 *     see the facets in it, which is correct.
 *   A HIGHLIGHT MAP, added rather than multiplied, because a reflection is
 *     light coming off the surface and not light coming through the tint. Same
 *     argument `RetroMaterial` makes about its gloss term, and the reason the
 *     highlight can be white on brown glass instead of coming out brown.
 *
 * ── two draws, not one ──────────────────────────────────────────────────────
 * `createGlassMaterial` is called twice per bottle, once with BackSide and once
 * with FrontSide, and the drink is drawn between them. Alpha blending has no
 * opinion about depth, so a single double-sided pass composites the far wall
 * over the near one wherever the index buffer happens to reach it first — which
 * on a lathe walked bottom-to-top is most of the object. Splitting the pass is
 * the cheap, era-appropriate fix: back, contents, front, in that order, every
 * frame, with no sorting.
 */

const VERT = /* glsl */ `
  uniform vec3  uLightDir;
  uniform vec3  uLightColor;
  uniform vec3  uFillDir;
  uniform vec3  uFillColor;
  uniform vec3  uAmbientColor;
  uniform float uRimPower;
  uniform float uRimDark;
  uniform float uRimAlpha;
  uniform float uBaseAlpha;

  varying vec2  vUv;
  varying vec2  vUvW;
  varying float vW;
  varying vec3  vTint;
  varying float vAlpha;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;

    gl_Position = clip;

    vUv  = uv;
    vUvW = uv * clip.w;
    vW   = clip.w;

    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
    vec3 viewDir = normalize(cameraPosition - worldPos);

    // 1 at the silhouette, 0 face on. abs() so the inside of the far wall —
    // drawn by the BackSide pass, where the normal points away — gets the same
    // edge as the near one instead of a flat wash.
    float rim = pow(1.0 - abs(dot(n, viewDir)), uRimPower);

    vec3 lit = uAmbientColor
      + uLightColor * max(dot(n, uLightDir), 0.0)
      + uFillColor  * max(dot(n, uFillDir), 0.0);

    vTint  = color * lit * (1.0 - uRimDark * rim);
    vAlpha = clamp(uBaseAlpha + uRimAlpha * rim, 0.0, 1.0);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3      uColor;
  uniform sampler2D uMap;
  uniform float     uAffineAmount;
  uniform float     uHighlight;

  varying vec2  vUv;
  varying vec2  vUvW;
  varying float vW;
  varying vec3  vTint;
  varying float vAlpha;

  void main() {
    vec2 uvA = mix(vUv, vUvW / vW, uAffineAmount);
    vec3 c = uColor * vTint;

    // The highlight map is white strips on black. Added, and it raises the
    // alpha with it — a reflection you can see through is not a reflection.
    vec3 hl = texture2D(uMap, uvA).rgb * uHighlight;
    c += hl;

    float a = clamp(vAlpha + max(max(hl.r, hl.g), hl.b), 0.0, 1.0);
    gl_FragColor = vec4(c, a);
  }
`;

/**
 * ── the UV transform is done by hand, and it has to be ─────────────────────
 * three applies `texture.offset` and `texture.repeat` through a `uvTransform`
 * uniform that only its OWN shader chunks declare. A ShaderMaterial that writes
 * `texture2D(uMap, vUv)` ignores both, silently: the burst sprite's two-frame
 * sheet was being sampled whole into one quad and the frame counter did
 * nothing. So the scale and offset are uniforms here and are applied where they
 * can be seen.
 */
const SPRITE_VERT = /* glsl */ `
  uniform vec2  uUvScale;
  uniform vec2  uUvOffset;

  varying vec2 vUv;

  void main() {
    vUv = uv * uUvScale + uUvOffset;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = clip;
  }
`;

const SPRITE_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3      uTint;
  uniform float     uOpacity;

  varying vec2 vUv;

  void main() {
    vec4 t = texture2D(uMap, vUv);
    gl_FragColor = vec4(t.rgb * uTint, t.a * uOpacity);
    if (gl_FragColor.a < 0.004) discard;
  }
`;

/**
 * @param {import('../core/GlossMaterial.js').GlossMaterials} retro
 *   its `shared` uniforms are taken BY REFERENCE, so the panel's global
 *   vertex-snap and light-angle controls reach the glass too
 * @param {object} opts
 * @param {import('three').Texture} opts.map  the baked highlight strips
 * @param {'front'|'back'} opts.face
 */
/**
 * The menu shaders' own lighting, no longer borrowed from the material factory.
 *
 * These two shaders — the bottle's glass and the flat sprite — do their own
 * vertex lighting, and they used to take the direction and colour uniforms BY
 * REFERENCE out of `RetroMaterials.shared`, so one debug slider moved the bottle
 * and the board together. `GlossMaterials` has no such uniforms: it is a
 * `MeshPhysicalMaterial` factory and its lighting comes from the scene.
 *
 * So the glass carries its own copy, read from the palette at construction. It
 * is a stopgap with a known end date — the bottle redesign replaces this shader
 * with a real `transmission` material, at which point the whole set goes.
 */
function menuLightUniforms() {
  return {
    uLightDir: { value: new Vector3(-0.71, 0.44, 0.55).normalize() },
    uLightColor: { value: new Color(PALETTE.light.sun).multiplyScalar(1.15) },
    uFillDir: { value: new Vector3(0.5, -0.68, 0.54).normalize() },
    uFillColor: { value: new Color(PALETTE.light.fill).multiplyScalar(0.42) },
    uAmbientColor: { value: new Color(PALETTE.light.ambientSky).multiplyScalar(0.28) },
  };
}

/**
 * Unlit, textured, snapped. The shadow ellipse, the light pool on the floor and
 * the two-frame burst at the mouth are all this.
 *
 * @param {'alpha'|'add'} [opts.blend]
 * @param {boolean} [opts.depthTest]
 *   off for anything that must be drawn OVER solid geometry rather than in
 *   amongst it. Every sprite here already has `depthWrite: false`, so it never
 *   stamps depth; this is about whether depth already in the buffer is allowed
 *   to reject it. A modal veil says no — see `ConfirmDialog`.
 */
export function createSpriteMaterial(
  retro,
  {
    map,
    blend = 'alpha',
    tint = PALETTE.untinted,
    opacity = 1,
    uvScale = [1, 1],
    uvOffset = [0, 0],
    side = DoubleSide,
    depthTest = true,
  } = {},
) {
  return new ShaderMaterial({
    vertexShader: SPRITE_VERT,
    fragmentShader: SPRITE_FRAG,
    transparent: true,
    depthWrite: false,
    depthTest,
    side,
    blending: blend === 'add' ? AdditiveBlending : NormalBlending,
    uniforms: {
      uMap: { value: map },
      uTint: { value: new Color(tint) },
      uOpacity: { value: opacity },
      uUvScale: { value: new Vector2().fromArray(uvScale) },
      uUvOffset: { value: new Vector2().fromArray(uvOffset) },
    },
  });
}
