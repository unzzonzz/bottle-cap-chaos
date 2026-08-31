import { Group, Mesh } from 'three';
import { buildCapGeometry, CAP_DEFAULTS, CAP_GROUP } from '../cap/capGeometry.js';
import { makeCapTopTexture } from '../cap/capTexture.js';
import { PALETTE } from '../core/palette.js';

/**
 * One cap in the scene: the mesh, its materials, and the ability to throw the
 * geometry away and build a new one when a slider moves.
 *
 * Three materials, not one, in the order CAP_GROUP names them. The body is
 * painted metal; the panel carries the artwork slot; the liner is the plastic
 * pad inside. They are separate so a player's artwork can be swapped without
 * touching the skirt, so the skirt is not paying for a texture fetch it does not
 * use, and so the liner keeps its own colour when the cap is repainted — a real
 * liner is not painted with the cap, and tinting it with the shell is the fastest
 * way to make the inside look like moulded plastic instead of a fitted seal.
 *
 * The mesh is parked so the cap's mid-height sits on the origin, because the
 * origin is what the viewer rotates about — building it hem-at-zero (which is
 * what the game modes want) and then spinning about that would swing the cap
 * around a point below itself.
 */

/** Bottle-cap red. The debug panel starts its colour picker here too. */
export const CAP_COLOR = PALETTE.player[0];

/** Off-white PVC, the usual liner stock. */
const LINER_COLOR = PALETTE.metal.liner;

export class Cap {
  /** @param {import('../core/GlossMaterial.js').GlossMaterials} retro */
  constructor({ retro, color = CAP_COLOR }) {
    this.retro = retro;
    this.params = { ...CAP_DEFAULTS };

    this.root = new Group();

    this.topTexture = makeCapTopTexture();
    this.bodyMaterial = retro.create({ color, preset: 'wetMetal' });
    this.panelMaterial = retro.create({ map: this.topTexture, color, preset: 'wetMetal' });
    // Soft plastic under the same gloss switch as the paint, but at a fraction
    // of it: a liner as shiny as the lacquer reads as a second metal disc.
    this.linerMaterial = retro.create({ color: LINER_COLOR, preset: 'plastic' });

    this.materials = [];
    this.materials[CAP_GROUP.BODY] = this.bodyMaterial;
    this.materials[CAP_GROUP.PANEL] = this.panelMaterial;
    this.materials[CAP_GROUP.LINER] = this.linerMaterial;

    this.geometry = buildCapGeometry(this.params);
    this.mesh = new Mesh(this.geometry, this.materials);
    this.root.add(this.mesh);
    this._recentre();
  }

  get triangles() {
    return this.geometry.userData.triangles;
  }

  /** What these parameters would cost without the interior. The budgeted number. */
  get gameTriangles() {
    return this.geometry.userData.gameTriangles;
  }

  /** Rebuild from the current params object. Cheap enough to run per slider tick. */
  rebuild() {
    const next = buildCapGeometry(this.params);
    this.mesh.geometry = next;
    this.geometry.dispose();
    this.geometry = next;
    this._recentre();
  }

  /** The paint. Not the liner — see the note at the top. */
  setColor(hex) {
    this.bodyMaterial.color.set(hex);
    this.panelMaterial.color.set(hex);
  }

  setWireframe(on) {
    for (const m of this.materials) m.wireframe = on;
  }

  _recentre() {
    this.mesh.position.y = -this.geometry.userData.height * 0.5;
  }

  dispose() {
    this.geometry.dispose();
    this.topTexture.dispose();
    for (const m of this.materials) m.dispose();
    this.root.clear();
  }
}
