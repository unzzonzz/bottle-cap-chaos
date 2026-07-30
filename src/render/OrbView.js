import {
  AdditiveBlending,
  Color,
  Group,
  IcosahedronGeometry,
  Mesh,
  PlaneGeometry,
  NormalBlending,
  RingGeometry,
  ShaderMaterial,
} from 'three';
import { orbShellTexture, orbMarkTexture } from './orbTextures.js';

/**
 * The mystery orbs, drawn.
 *
 * ── PS1 glass is two blends and a baked highlight ──────────────────────────
 * No refraction, no transmission, no real-time specular — all three are ruled
 * out and all three would look wrong here anyway. What a sphere of glass is on
 * this hardware:
 *
 *   AN ALPHA-BLENDED SHELL, dark at the middle and brighter at the rim, so you
 *     read the curvature. The rim term is per-vertex, like the bottle's.
 *   A BAKED HIGHLIGHT scrolling round it as it spins. It is in the texture, so
 *     it costs nothing and it cannot be "correct" — which is the point: a real
 *     specular on a 42-triangle sphere lands on one facet and reads as a bug.
 *   AN ADDITIVE PASS on top for the glow, which is what makes it look lit from
 *     inside rather than painted.
 *
 * ── the shell spins, the "?" does not ──────────────────────────────────────
 * The mark is a billboard INSIDE the sphere and always faces the camera, so it
 * stays readable from every angle — that is the whole reason it is a sprite and
 * not geometry. The shell turning around a mark that does not is what sells the
 * mark as floating in there rather than being painted on the glass.
 *
 * ── the colour cycles ──────────────────────────────────────────────────────
 * A palette rotation on a tint uniform, stepped rather than smooth. It is on
 * the brief's list of allowed techniques and it is what the era actually did;
 * a smooth hue sweep would read as a modern shader no matter how slow.
 */

const SHELL_VERT = /* glsl */ `
  uniform vec2  uTargetRes;
  uniform float uSnapAmount;
  uniform float uSnapGrid;
  uniform float uRimPower;

  varying vec2  vUv;
  varying float vRim;

  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 clip = projectionMatrix * mv;
    if (clip.w > 0.0001 && uSnapAmount > 0.0) {
      vec2 grid = uTargetRes * 0.5 * uSnapGrid;
      vec3 ndc = clip.xyz / clip.w;
      ndc.xy = mix(ndc.xy, floor(ndc.xy * grid) / grid, uSnapAmount);
      clip.xyz = ndc * clip.w;
    }
    gl_Position = clip;

    vUv = uv;
    vec3 n = normalize(mat3(modelMatrix) * normal);
    vec3 v = normalize(cameraPosition - (modelMatrix * vec4(position, 1.0)).xyz);
    // 1 at the silhouette, 0 face on. Per vertex, so it facets across the
    // icosahedron exactly as Gouraud does — which is correct for the era and is
    // most of why the sphere reads as low-poly rather than as a bad sphere.
    vRim = pow(1.0 - abs(dot(n, v)), uRimPower);
  }
`;

const SHELL_FRAG = /* glsl */ `
  uniform sampler2D uMap;
  uniform vec3      uTint;
  uniform float     uOpacity;
  uniform float     uRimBoost;

  varying vec2  vUv;
  varying float vRim;

  void main() {
    vec3 baked = texture2D(uMap, vUv).rgb;
    vec3 c = uTint * (baked + vRim * uRimBoost);
    gl_FragColor = vec4(c, clamp((0.42 + vRim * 0.58) * uOpacity, 0.0, 1.0));
  }
`;

const SPRITE_VERT = /* glsl */ `
  uniform vec2  uTargetRes;
  uniform float uSnapAmount;
  uniform float uSnapGrid;
  varying vec2 vUv;
  void main() {
    vUv = uv;
    vec4 clip = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    if (clip.w > 0.0001 && uSnapAmount > 0.0) {
      vec2 grid = uTargetRes * 0.5 * uSnapGrid;
      vec3 ndc = clip.xyz / clip.w;
      ndc.xy = mix(ndc.xy, floor(ndc.xy * grid) / grid, uSnapAmount);
      clip.xyz = ndc * clip.w;
    }
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
    if (gl_FragColor.a < 0.01) discard;
  }
`;

/**
 * The cycle, as a short list of hard steps.
 *
 * Few entries and no interpolation between them: this is a CLUT rotation, which
 * is what the hardware could actually do. Cool to warm and back rather than a
 * hue wheel — a full rainbow reads as a modern effect however few steps it has.
 */
const PALETTE = [
  [0.55, 0.80, 1.00],
  [0.72, 0.70, 1.00],
  [0.95, 0.66, 0.95],
  [0.80, 0.88, 0.78],
  [0.60, 0.92, 0.95],
];

export class OrbView {
  /**
   * @param {import('../core/RetroMaterial.js').RetroMaterials} retro
   *   its shared uniforms are borrowed by reference, so the global vertex-snap
   *   slider reaches the orbs too
   */
  constructor({ retro, config }) {
    this.config = config;
    this.retro = retro;
    this.root = new Group();

    this.shellMap = orbShellTexture();
    this.markMap = orbMarkTexture();

    // Icosahedron rather than a UV sphere: at this triangle count a UV sphere
    // has a dense pole and a coarse equator, and the pole is the first thing
    // you see on something that spins.
    this.shellGeometry = new IcosahedronGeometry(1, 1);
    this.markGeometry = new PlaneGeometry(1, 1);
    this.ringGeometry = new RingGeometry(0.98, 1.0, 24);

    /** @type {Map<number, object>} live orb id -> its meshes and animation state. */
    this.byId = new Map();
    this._clock = 0;
    /** Pickup bursts, which outlive the orb that started them. */
    this._bursts = [];
  }

  _makeShellMaterial() {
    return new ShaderMaterial({
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTargetRes: this.retro.shared.uTargetRes,
        uSnapAmount: this.retro.shared.uSnapAmount,
        uSnapGrid: this.retro.shared.uSnapGrid,
        uMap: { value: this.shellMap },
        uTint: { value: new Color(1, 1, 1) },
        uOpacity: { value: 1 },
        uRimPower: { value: 1.6 },
        uRimBoost: { value: 1.35 },
      },
    });
  }

  _makeSpriteMaterial(map, additive) {
    return new ShaderMaterial({
      vertexShader: SPRITE_VERT,
      fragmentShader: SPRITE_FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? AdditiveBlending : NormalBlending,
      uniforms: {
        uTargetRes: this.retro.shared.uTargetRes,
        uSnapAmount: this.retro.shared.uSnapAmount,
        uSnapGrid: this.retro.shared.uSnapGrid,
        uMap: { value: map },
        uTint: { value: new Color(1, 1, 1) },
        uOpacity: { value: 1 },
      },
    });
  }

  _create(orb) {
    const pivot = new Group();

    const shellMat = this._makeShellMaterial();
    const shell = new Mesh(this.shellGeometry, shellMat);
    // Its own child so the SHELL can spin while the mark below does not.
    const spin = new Group();
    spin.add(shell);

    const markMat = this._makeSpriteMaterial(this.markMap, true);
    const mark = new Mesh(this.markGeometry, markMat);

    const sensorMat = this._makeSpriteMaterial(this.markMap, false);
    sensorMat.uniforms.uTint.value.setRGB(0.2, 1, 0.6);
    const sensor = new Mesh(this.ringGeometry, sensorMat);
    sensor.rotation.x = -Math.PI / 2;
    sensor.visible = false;

    pivot.add(spin, mark, sensor);
    this.root.add(pivot);

    return {
      orb,
      pivot,
      spin,
      shell,
      shellMat,
      mark,
      markMat,
      sensor,
      sensorMat,
      /** 0..1 pop-in. Reaches 1 and stays. */
      born: 0,
      /** Refusal flash, 1 at the moment of refusal and decaying. */
      refuse: 0,
    };
  }

  _destroy(e) {
    this.root.remove(e.pivot);
    e.shellMat.dispose();
    e.markMat.dispose();
    e.sensorMat.dispose();
  }

  /**
   * @param {number} dt        render seconds; never a physics step
   * @param {import('../game/Orbs.js').Orbs} orbs
   * @param {import('three').Camera} camera  for billboarding the mark
   */
  update(dt, orbs, camera) {
    const cfg = this.config.orbs;
    this._clock += dt;

    // ── reconcile ──────────────────────────────────────────────────────────
    const live = new Set(orbs.list.map((o) => o.id));
    for (const [id, e] of this.byId) {
      if (live.has(id)) continue;
      this._destroy(e);
      this.byId.delete(id);
    }
    for (const orb of orbs.list) {
      if (!this.byId.has(orb.id)) this.byId.set(orb.id, this._create(orb));
      else this.byId.get(orb.id).orb = orb;
    }

    // The palette step. Floor, not a lerp — see PALETTE.
    const step = Math.floor(this._clock * Math.max(0, cfg.paletteSpeed) * PALETTE.length);
    const hue = PALETTE[((step % PALETTE.length) + PALETTE.length) % PALETTE.length];

    for (const e of this.byId.values()) {
      // `>= 0`, not truthiness: `refused` holds WHICH player was turned away
      // and player 0 is falsy, so a bare test silently swallowed half the
      // refusals — the ones belonging to the first player. See `Orbs.step`.
      if (e.orb.refused >= 0 && e.refuse <= 0) e.refuse = 1;
      e.refuse = Math.max(0, e.refuse - dt / Math.max(0.05, cfg.refuseSeconds));
      e.born = Math.min(1, e.born + dt / Math.max(0.02, cfg.spawnSeconds));

      // Pop in: overshoot past full size and settle back, so it arrives rather
      // than simply being switched on.
      const t = e.born;
      const pop = t >= 1 ? 1 : Math.sin(t * Math.PI * 0.5) * (1 + 0.28 * (1 - t));
      const bob = Math.sin(this._clock * cfg.floatSpeed + e.orb.id) * cfg.floatAmplitude;

      e.pivot.position.set(e.orb.x, cfg.hover + bob, e.orb.z);
      e.pivot.scale.setScalar(cfg.radius * pop);

      e.spin.rotation.y = this._clock * cfg.spinSpeed * Math.PI * 2;

      // The mark is a billboard: it takes the camera's orientation outright, so
      // it faces the viewer whatever the shell and the camera are doing.
      e.mark.quaternion.copy(camera.quaternion);
      e.mark.scale.setScalar(1.05);

      // Refusal reads as red, and it overrides the cycle rather than blending
      // with it — a hand-is-full flash that came out mauve would not read.
      const r = e.refuse;
      e.shellMat.uniforms.uTint.value.setRGB(
        hue[0] * (1 - r) + 1.6 * r,
        hue[1] * (1 - r) + 0.15 * r,
        hue[2] * (1 - r) + 0.15 * r,
      );
      e.markMat.uniforms.uTint.value.copy(e.shellMat.uniforms.uTint.value);
      // A shake on top of the flash, so the refusal is legible in motion too.
      if (r > 0) e.pivot.position.x += Math.sin(this._clock * 60) * 0.12 * r;

      e.shellMat.uniforms.uOpacity.value = t;
      e.markMat.uniforms.uOpacity.value = t;

      e.sensor.visible = !!cfg.showSensors;
      if (e.sensor.visible) e.sensor.scale.setScalar(cfg.sensorRadius / Math.max(0.01, cfg.radius));
    }

    this._updateBursts(dt, camera);
  }

  /** A pickup: the orb bursts where it stood. The card's flight is the UI's. */
  burst(x, z) {
    const cfg = this.config.orbs;
    const mat = this._makeSpriteMaterial(this.markMap, true);
    const mesh = new Mesh(this.markGeometry, mat);
    mesh.position.set(x, cfg.hover, z);
    this.root.add(mesh);
    this._bursts.push({ mesh, mat, t: 0 });
  }

  _updateBursts(dt, camera) {
    if (!this._bursts.length) return;
    const life = Math.max(0.05, this.config.orbs.pickupSeconds * 0.5);
    for (let i = this._bursts.length - 1; i >= 0; i--) {
      const b = this._bursts[i];
      b.t += dt / life;
      if (b.t >= 1) {
        this.root.remove(b.mesh);
        b.mat.dispose();
        this._bursts.splice(i, 1);
        continue;
      }
      b.mesh.quaternion.copy(camera.quaternion);
      b.mesh.scale.setScalar(this.config.orbs.radius * (1 + b.t * 2.4));
      b.mat.uniforms.uOpacity.value = 1 - b.t;
    }
  }

  dispose() {
    for (const e of this.byId.values()) this._destroy(e);
    this.byId.clear();
    for (const b of this._bursts) {
      this.root.remove(b.mesh);
      b.mat.dispose();
    }
    this._bursts.length = 0;
    this.shellGeometry.dispose();
    this.markGeometry.dispose();
    this.ringGeometry.dispose();
    this.shellMap.dispose();
    this.markMap.dispose();
  }
}
