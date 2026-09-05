import RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rapier's WASM, loaded once.
 *
 * The `-compat` build inlines the module as base64 and hands it to
 * `WebAssembly.instantiate` itself, so there is no .wasm asset to serve, no Vite
 * plugin, and no top-level await in the bundle. It costs about 400 kB of source
 * for a ~1.5 MB decoded module — a trade worth making to keep the build config
 * at zero.
 *
 * Nothing in `physics/` may be constructed before this resolves: every
 * `RAPIER.World`, `ColliderDesc` and `RigidBodyDesc` is a thin JS shim over WASM
 * memory that does not exist yet.
 */

let ready = null;

export function initRapier() {
  ready ??= RAPIER.init().then(() => RAPIER);
  return ready;
}

export { RAPIER };
