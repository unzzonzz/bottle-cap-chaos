import { BufferAttribute, BufferGeometry, LineBasicMaterial, LineSegments } from 'three';

/**
 * Rapier's own view of the world, drawn over the top of ours.
 *
 * The single most useful debug toggle in the project, because the whole collider
 * design is a claim that cannot be checked any other way: the visual cap is a
 * fluted shell with 21 crests and the physics cap is a lid and ten boxes, and
 * nothing on screen tells you which one the solver is using. Turn this on and
 * the compound is right there — you can see the ring is closed, see that the
 * inside is empty, and see a cap sitting INSIDE another one rather than taking
 * it on faith.
 *
 * `world.debugRender()` walks every collider each call and allocates two typed
 * arrays, so it only runs while the toggle is on.
 */

export class ColliderView {
  constructor() {
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(new Float32Array(0), 3));
    this.geometry.setAttribute('color', new BufferAttribute(new Float32Array(0), 3));

    this.material = new LineBasicMaterial({
      // Rapier colours by state — awake, asleep, sensor — which is worth keeping;
      // a sleeping cap looking different from an awake one is exactly the
      // information the turn-end detector is arguing about.
      vertexColors: true,
      fog: false,
      depthTest: false,
      transparent: true,
      opacity: 0.9,
    });

    this.object = new LineSegments(this.geometry, this.material);
    this.object.frustumCulled = false;
    this.object.renderOrder = 10;
    this.object.visible = false;

    this._capacity = 0;
  }

  /** @param {import('@dimforge/rapier3d-compat').World} world */
  update(world, enabled) {
    this.object.visible = enabled;
    if (!enabled) return;

    const buffers = world.debugRender();
    const verts = buffers.vertices;
    const rgba = buffers.colors;
    const count = verts.length / 3;

    // Grown, never shrunk, and only reallocated when it has to be: the vertex
    // count changes every frame as bodies fall asleep and their contacts go
    // away, and allocating two typed arrays a frame for that is pure churn.
    if (count > this._capacity) {
      this._capacity = Math.ceil(count * 1.5);
      this.geometry.setAttribute(
        'position',
        new BufferAttribute(new Float32Array(this._capacity * 3), 3),
      );
      this.geometry.setAttribute(
        'color',
        new BufferAttribute(new Float32Array(this._capacity * 3), 3),
      );
    }

    const pos = this.geometry.getAttribute('position');
    const col = this.geometry.getAttribute('color');
    pos.array.set(verts);
    for (let i = 0; i < count; i++) {
      // Rapier hands back RGBA; three's vertex colours want RGB.
      col.array[i * 3] = rgba[i * 4];
      col.array[i * 3 + 1] = rgba[i * 4 + 1];
      col.array[i * 3 + 2] = rgba[i * 4 + 2];
    }
    pos.needsUpdate = true;
    col.needsUpdate = true;
    this.geometry.setDrawRange(0, count);
  }

  dispose() {
    this.geometry.dispose();
    this.material.dispose();
  }
}
