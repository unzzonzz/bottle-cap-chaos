import { Color, DoubleSide, FrontSide, ShaderMaterial, Vector2, Vector3 } from 'three';

/**
 * The PS1 material.
 *
 * Three things happen here that no stock three.js material will do for you:
 *
 *  1. Vertex snapping. The console had no sub-pixel rasteriser, so transformed
 *     vertices were rounded onto the framebuffer grid. That is the wobble.
 *  2. Affine UV interpolation. The console had no perspective-correct texture
 *     mapping, so texels swim across a polygon as it turns away from you.
 *  3. Gouraud lighting. Lighting was computed per vertex and interpolated, never
 *     per pixel — so shading bands across large triangles instead of curving.
 *     The gloss term is part of that, not a departure from it: the console's
 *     geometry unit did compute specular per vertex, and doing it here rather
 *     than per fragment is what gives the highlight its faceted, sliding edge.
 *
 * Every material shares one set of uniform objects for the global knobs, so the
 * debug GUI moves the whole scene at once rather than one mesh at a time.
 */

const VERT = /* glsl */ `
  uniform vec2  uTargetRes;
  uniform float uSnapAmount;
  uniform float uSnapGrid;
  uniform float uSnapScale;
  uniform vec3  uLightDir;      // world space, pointing towards the light
  uniform vec3  uLightColor;
  uniform vec3  uFillDir;
  uniform vec3  uFillColor;
  uniform vec3  uAmbientColor;
  uniform float uFogDensity;
  uniform float uGloss;
  uniform float uShininess;
  uniform float uGlossScale;
  uniform vec2  uUvScale;
  uniform vec2  uUvOffset;

  varying vec2  vUv;
  varying vec2  vUvW;
  varying float vW;
  varying vec3  vLight;
  varying vec3  vSpec;
  varying float vFog;

  void main() {
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mvPosition;

    // ── 1. vertex snapping ────────────────────────────────────────────────
    // The w guard is not optional: vertices behind the camera have w <= 0 and
    // dividing by it throws them to infinity, which tears the whole mesh apart.
    // uSnapScale is this surface's share of the global switch, the same way
    // uGlossScale is. It exists for one case: a large flat FLOOR. The wobble is
    // per-vertex, so an object made of many spans across the screen has each of
    // its vertices land on a different pixel boundary and the spans shear
    // against each other — on a ground plane that reads as the whole surface
    // swimming, measured at ten times the pixel churn of the same scene with the
    // snap off. On an object it is the character of the thing; on the floor
    // under it, it is just noise.
    float snap = uSnapAmount * uSnapScale;
    if (clip.w > 0.0001 && snap > 0.0) {
      // uSnapGrid = 1.0 snaps to the render target's own pixel grid, which is
      // the authentic setting but is only really visible in motion. Below 1.0
      // the grid gets coarser than the framebuffer and the wobble becomes
      // obvious on a still frame — useful for judging it while tuning.
      vec2 grid = uTargetRes * 0.5 * uSnapGrid;
      vec3 ndc = clip.xyz / clip.w;
      ndc.xy = mix(ndc.xy, floor(ndc.xy * grid) / grid, snap);
      clip.xyz = ndc * clip.w;   // z round-trips unchanged
    }
    gl_Position = clip;

    // ── 2. affine UV setup ────────────────────────────────────────────────
    // The GPU interpolates a varying V as sum(l*V/w) / sum(l/w). Feeding it
    // uv*w makes the numerator sum(l*uv); dividing by the separately
    // interpolated w (which lands on 1/sum(l/w)) leaves plain sum(l*uv) —
    // screen-space linear, exactly what the console did.
    vec2 uvT = uv * uUvScale + uUvOffset;
    vUv  = uvT;
    vUvW = uvT * clip.w;
    vW   = clip.w;

    // ── 3. gouraud lighting ───────────────────────────────────────────────
    // World space, so the light direction is a constant and never needs a
    // per-frame CPU update. Assumes uniform scale on the model matrix.
    vec3 n = normalize(mat3(modelMatrix) * normal);

    // Key from above, fill from below. The fill is not decoration: with one
    // overhead light every downward-facing surface collapses to a flat ambient
    // wash, and the whole inside of the cap — the liner's seal ring, the flutes
    // on the inner wall, the sheet's edge at the hem — becomes one silhouette
    // with no shape in it. Two opposed lights is also cheaper than it looks,
    // being one more dot product on a mesh this size.
    vLight = uAmbientColor
      + uLightColor * max(dot(n, uLightDir), 0.0)
      + uFillColor * max(dot(n, uFillDir), 0.0);

    // ── 3b. gloss ─────────────────────────────────────────────────────────
    // Blinn-Phong, per vertex, kept OUT of vLight: a highlight is light
    // reflected off the surface rather than light coming back through the paint,
    // so it must be added after the base colour and the map, never multiplied by
    // them. Folded in, a white highlight on a red cap would come out red and
    // read as nothing more than a bright patch of paint.
    float gloss = uGloss * uGlossScale;
    if (gloss > 0.0) {
      vec3 worldPos = (modelMatrix * vec4(position, 1.0)).xyz;
      // Not named "half": that is a reserved word in GLSL ES 1.00, which is what
      // three compiles a ShaderMaterial as, and the shader will not link.
      vec3 hv = normalize(uLightDir + normalize(cameraPosition - worldPos));
      // Gated on the diffuse term so a facet turned away from the light cannot
      // pick up a highlight through its own back.
      float lit = step(0.0, dot(n, uLightDir));
      vSpec = uLightColor * (pow(max(dot(n, hv), 0.0), uShininess) * gloss * lit);
    } else {
      vSpec = vec3(0.0);
    }

    // exp2 fog, per vertex — matching the era, and free here
    float d = -mvPosition.z;
    vFog = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  }
`;

const FRAG = /* glsl */ `
  uniform vec3  uColor;
  uniform float uAffineAmount;
  uniform vec3  uFogColor;

  #ifdef USE_RETRO_MAP
  uniform sampler2D uMap;
  #endif

  varying vec2  vUv;
  varying vec2  vUvW;
  varying float vW;
  varying vec3  vLight;
  varying vec3  vSpec;
  varying float vFog;

  void main() {
    vec3 base = uColor;

    #ifdef USE_RETRO_MAP
    // vUv is the GPU's perspective-correct interpolation; vUvW / vW is the
    // affine one. Blend so the warp can be dialled back — 1.0 is the authentic
    // "no perspective correction at all" the spec asks for.
    vec2 uv = mix(vUv, vUvW / vW, uAffineAmount);
    base *= texture2D(uMap, uv).rgb;
    #endif

    vec3 c = base * vLight + vSpec;
    c = mix(c, uFogColor, clamp(vFog, 0.0, 1.0));

    gl_FragColor = vec4(c, 1.0);
  }
`;

export class RetroMaterials {
  constructor({ resolution }) {
    /** Uniform objects shared by every material this factory makes. */
    this.shared = {
      uTargetRes: { value: new Vector2().copy(resolution) },
      uSnapAmount: { value: 1.0 },
      uSnapGrid: { value: 1.0 },
      // Full affine: no perspective correction, which is what the spec asks for.
      uAffineAmount: { value: 1.0 },
      // The gloss switch. 0 is a dead matte cap; painted crown stock is not
      // matte, so this is on by default.
      uGloss: { value: 0.55 },
      // Tight. A broad lobe on a mesh this coarse smears into a second ambient
      // term and the flutes lose the contrast the highlight was meant to add.
      uShininess: { value: 26.0 },
      // Low and well off to the side. A key light near the camera axis lights
      // every flute the same and the crimp disappears into a flat wash; raking
      // it across the skirt is what makes 21 separate bands of light and shadow.
      uLightDir: { value: new Vector3(-0.71, 0.44, 0.55).normalize() },
      // Roughly opposed to the key and below the horizon, so it reaches exactly
      // the surfaces the key cannot: the underside and everything inside.
      uFillDir: { value: new Vector3(0.5, -0.68, 0.54).normalize() },
      uFillColor: { value: new Color() },
      uLightColor: { value: new Color() },
      uAmbientColor: { value: new Color() },
      // The void is pure black and there is nothing to lose in it, so fog is off
      // by default — the uniforms stay because the game modes will want them.
      uFogColor: { value: new Color('#000000') },
      uFogDensity: { value: 0.0 },
    };

    // Unmultiplied hue + separate intensity, so a retint never fights the
    // intensity sliders.
    this.keyBase = new Color('#fff4e2');
    this.fillBase = new Color('#7d90b4');
    this.ambientBase = new Color('#59627a');
    this.keyIntensity = 1.15;
    this.fillIntensity = 0.42;
    // Ambient adds no shape at all — it is the same everywhere on the object —
    // so it is kept to the minimum that stops the unlit side going pure black
    // against the void, and the fill carries the rest.
    this.ambientIntensity = 0.28;
    this.applyLighting();

    this._materials = new Set();
  }

  applyLighting() {
    this.shared.uLightColor.value.copy(this.keyBase).multiplyScalar(this.keyIntensity);
    this.shared.uFillColor.value.copy(this.fillBase).multiplyScalar(this.fillIntensity);
    this.shared.uAmbientColor.value
      .copy(this.ambientBase)
      .multiplyScalar(this.ambientIntensity);
  }

  /** @param {{azimuth: number, elevation: number}} deg */
  setLightAngles({ azimuth, elevation }) {
    const az = (azimuth * Math.PI) / 180;
    const el = (elevation * Math.PI) / 180;
    this.shared.uLightDir.value
      .set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az))
      .normalize();
  }

  /**
   * @param {object}  [opts]
   * @param {import('three').Texture|null} [opts.map]
   * @param {string|number} [opts.color]  multiplied with the map
   * @param {boolean} [opts.doubleSided]
   * @param {number}  [opts.gloss]  this surface's share of the global gloss;
   *   the switch is shared, how shiny each material is under it is not
   * @param {number}  [opts.snap]  the same, for the vertex wobble. 1 everywhere
   *   except large flat floors — see the note in the vertex shader
   * @param {[number, number]} [opts.uvScale]
   * @param {[number, number]} [opts.uvOffset]
   */
  create(opts = {}) {
    const {
      map = null,
      color = '#ffffff',
      doubleSided = false,
      gloss = 1,
      snap = 1,
      uvScale = [1, 1],
      uvOffset = [0, 0],
    } = opts;

    const material = new ShaderMaterial({
      vertexShader: VERT,
      fragmentShader: FRAG,
      side: doubleSided ? DoubleSide : FrontSide,
      fog: false, // fog is handled by hand in the shader above
      defines: map ? { USE_RETRO_MAP: '' } : {},
      uniforms: {
        // shared by reference — one GUI slider moves every material
        ...this.shared,
        // per-material
        uColor: { value: new Color(color) },
        uMap: { value: map },
        uGlossScale: { value: gloss },
        uSnapScale: { value: snap },
        uUvScale: { value: new Vector2().fromArray(uvScale) },
        uUvOffset: { value: new Vector2().fromArray(uvOffset) },
      },
    });

    // The registry exists so teardown can catch anything still alive, but it is
    // a strong reference: without this, a material disposed by its owner stays
    // reachable here forever and drags its CanvasTexture along with it.
    this._materials.add(material);
    const dispose = material.dispose.bind(material);
    material.dispose = () => {
      this._materials.delete(material);
      dispose();
    };

    return material;
  }

  setResolution(resolution) {
    this.shared.uTargetRes.value.copy(resolution);
  }

  dispose() {
    for (const m of this._materials) m.dispose();
    this._materials.clear();
  }
}
