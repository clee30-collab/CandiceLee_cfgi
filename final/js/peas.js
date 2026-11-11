import * as THREE from 'three/webgpu';
import {
    Fn, If, instancedArray, instanceIndex, uniform, vec2, vec3, float,
    hash, length, max, dot, mix, time, positionLocal, Loop, uint,
} from 'three/tsl';

// Peas: thousands of little spheres simulated by a COMPUTE SHADER.
//
// The positions and velocities live in GPU memory (instancedArray).
// Every frame `update` runs once per pea, in parallel, on the GPU.
// The CPU never loops over the peas: it only changes a few uniforms
// (pointer position, friction, ...).
//
// This uses three.js TSL ("three shading language"): you write shader
// logic in JavaScript and three.js turns it into WGSL (WebGPU) for you.

export class Peas {
    constructor(count = 4000) {
        this.count = count;
        this.next = 0; // ring-buffer index for spawning

        // GPU buffers. pos.xyz = position, vel.xz = velocity, vel.y = alive (1/0)
        this.pos = instancedArray(count, 'vec3');
        this.vel = instancedArray(count, 'vec3');

        const u = this.u = {
            dt: uniform(0),
            friction: uniform(2),
            radius: uniform(0.032),
            // plate shape (same formula as plates.js)
            top: uniform(0.06), curve: uniform(0), innerR: uniform(0.72),
            bowlPull: uniform(4),
            collide: uniform(1), bounce: uniform(20),
            // utensil
            pointer: uniform(new THREE.Vector2(99, 99)),
            pushOn: uniform(0), eraseOn: uniform(0),
            push: uniform(10), pushR: uniform(0.16),
            // spawning
            spawnStart: uniform(0, 'uint'), spawnEnd: uniform(0, 'uint'),
            spawnPos: uniform(new THREE.Vector2()), seed: uniform(0),
            // structured randomness (driven by the mood state machine)
            jitter: uniform(0), nudge: uniform(new THREE.Vector2()),
            color: uniform(new THREE.Color('#6fae3a')),
        };

        const id = float(instanceIndex);

        this.update = Fn(() => {
            const p = this.pos.element(instanceIndex);
            const v = this.vel.element(instanceIndex);

            // --- spawn: indices in [spawnStart, spawnEnd) come alive at the pointer ---
            If(instanceIndex.greaterThanEqual(u.spawnStart).and(instanceIndex.lessThan(u.spawnEnd)), () => {
                const off = vec2(hash(id.add(u.seed)), hash(id.add(u.seed).add(17.31))).sub(0.5).mul(0.12);
                const s = u.spawnPos.add(off);
                p.assign(vec3(s.x, 0, s.y));
                v.assign(vec3(0, 1, 0));
            });

            If(v.y.greaterThan(0.5), () => {
                const xz = vec2(p.x, p.z).toVar();
                const vxz = vec2(v.x, v.z).toVar();
                const alive = float(1).toVar();

                // bowl: slope of y = curve*r^2 pulls everything to the centre
                const r = length(xz);
                const dir = xz.div(max(r, 0.0001));
                const acc = dir.mul(r.mul(u.curve).mul(u.bowlPull).mul(-2)).toVar();

                // table bump + per-pea fidget (each pea gets its own random)
                acc.addAssign(u.nudge);
                const n = vec2(hash(id.add(time.mul(97.0))), hash(id.mul(1.37).add(time.mul(131.0)))).sub(0.5);
                acc.addAssign(n.mul(u.jitter));

                // utensil pushes peas away / napkin wipes them up
                const d = xz.sub(u.pointer);
                const dist = length(d);
                If(dist.lessThan(u.pushR), () => {
                    const falloff = float(1).sub(dist.div(u.pushR));
                    acc.addAssign(d.div(max(dist, 0.0001)).mul(u.push).mul(falloff).mul(u.pushOn));
                    If(u.eraseOn.greaterThan(0.5), () => { alive.assign(0); });
                });

                // pea vs pea: check every other pea (brute force).
                // 4000 x 4000 = 16 million checks a frame. Fine on an M2
                // GPU; a spatial grid would be the next optimisation.
                If(u.collide.greaterThan(0.5), () => {
                    const minD = u.radius.mul(2);
                    Loop({ start: uint(0), end: uint(count), type: 'uint' }, ({ i }) => {
                        const o = this.pos.element(i);
                        If(this.vel.element(i).y.greaterThan(0.5).and(i.notEqual(instanceIndex)), () => {
                            const dd = xz.sub(vec2(o.x, o.z));
                            const dl = length(dd);
                            If(dl.lessThan(minD), () => {
                                const nrm = dd.div(max(dl, 0.0001));
                                const overlap = minD.sub(dl);
                                xz.addAssign(nrm.mul(overlap.mul(0.5)));
                                vxz.addAssign(nrm.mul(overlap.mul(u.bounce)));
                            });
                        });
                    });
                });

                // integrate
                vxz.addAssign(acc.mul(u.dt));
                vxz.mulAssign(max(float(0), float(1).sub(u.friction.mul(u.dt))));
                xz.addAssign(vxz.mul(u.dt));

                // keep inside the rim, bounce a little
                const limit = u.innerR.sub(u.radius);
                const rn = length(xz);
                If(rn.greaterThan(limit), () => {
                    const nrm = xz.div(rn);
                    xz.assign(nrm.mul(limit));
                    const vn = dot(vxz, nrm);
                    If(vn.greaterThan(0), () => { vxz.subAssign(nrm.mul(vn.mul(1.4))); });
                });

                // sit on the plate surface
                const rr = length(xz);
                const y = u.top.add(u.curve.mul(rr.mul(rr))).add(u.radius.mul(0.8));
                p.assign(vec3(xz.x, y, xz.y));
                v.assign(vec3(vxz.x, alive, vxz.y));
            });
        })().compute(count);

        this.clear = Fn(() => {
            this.vel.element(instanceIndex).assign(vec3(0));
        })().compute(count);

        // --- drawing: one sphere mesh, instanced `count` times ---
        const geo = new THREE.IcosahedronGeometry(1, 2);
        const mat = new THREE.MeshStandardNodeMaterial({ roughness: 0.45 });
        const posAttr = this.pos.toAttribute();
        const velAttr = this.vel.toAttribute();
        // per-pea size + colour variation = less "computer generated"
        const sizeVar = hash(id.add(3.3)).mul(0.3).add(0.85);
        mat.positionNode = positionLocal.mul(u.radius).mul(sizeVar).mul(velAttr.y).add(posAttr);
        mat.colorNode = mix(u.color, u.color.mul(0.7), hash(id.add(9.1)));

        this.mesh = new THREE.Mesh(geo, mat);
        this.mesh.count = count;
        this.mesh.frustumCulled = false;
        this.mesh.castShadow = true;
        this.mesh.receiveShadow = true;
    }

    // swap the sphere for your own pea shape (radius ~1, centred)
    setGeometry(geometry) {
        this.mesh.geometry.dispose();
        this.mesh.geometry = geometry;
    }

    setPlate(def) {
        this.u.top.value = def.top;
        this.u.curve.value = def.curve;
        this.u.innerR.value = def.innerR;
    }

    // queue `n` new peas at (x, z); they appear on the next step()
    spawn(x, z, n) {
        const start = this.next >= this.count ? 0 : this.next;
        const end = Math.min(this.count, start + n);
        this.u.spawnStart.value = start;
        this.u.spawnEnd.value = end;
        this.u.spawnPos.value.set(x, z);
        this.u.seed.value = Math.random() * 1000;
        this.next = end;
    }

    step(renderer) {
        renderer.compute(this.update);
        this.u.spawnStart.value = 0;
        this.u.spawnEnd.value = 0;
    }

    reset(renderer) {
        renderer.compute(this.clear);
        this.next = 0;
    }
}
