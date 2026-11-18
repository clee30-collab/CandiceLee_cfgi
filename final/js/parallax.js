import * as THREE from 'three/webgpu';

// Parallax depth: the camera swings a little around the plate as the
// mouse moves. Things that are higher up (a utensil hovering, a 2D card)
// shift more than things on the table, which is what makes flat 2D
// images read as 3D.

export class Parallax {
    constructor(camera, { target = new THREE.Vector3(0, 0.05, 0), distance = 4.0, tilt = 0.55 } = {}) {
        this.camera = camera;
        this.target = target;
        this.base = new THREE.Spherical(distance, tilt, 0); // distance, tilt from straight down, angle
        this.goal = new THREE.Vector2();
        this.cur = new THREE.Vector2();
        this.shake = 0;
        this.sph = new THREE.Spherical();
    }

    // nx, ny in -1..1 (screen space)
    setPointer(nx, ny) {
        this.goal.set(nx, ny);
    }

    kick(amount = 1) {
        this.shake = Math.max(this.shake, amount);
    }

    // put `cam` where the camera sits when the mouse is centred
    restPose(cam) {
        cam.position.setFromSpherical(this.base).add(this.target);
        cam.lookAt(this.target);
        cam.updateMatrixWorld(true);
    }

    update(dt, strength, smoothing) {
        const k = 1 - Math.exp(-smoothing * dt);
        this.cur.lerp(this.goal, k);
        this.shake *= Math.exp(-6 * dt);

        const s = this.sph.copy(this.base);
        s.theta += this.cur.x * strength * 0.35 + (Math.random() - 0.5) * this.shake * 0.02;
        s.phi += this.cur.y * strength * 0.25 + (Math.random() - 0.5) * this.shake * 0.02;
        s.phi = THREE.MathUtils.clamp(s.phi, 0.0001, 1.2); // 0 = straight down

        this.camera.position.setFromSpherical(s).add(this.target);
        this.camera.lookAt(this.target);
    }
}
