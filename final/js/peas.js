import * as THREE from 'three/webgpu';
import {
    Fn, If, instancedArray, instanceIndex, uniform, uniformArray, vec2, vec3, vec4, float, int,
    hash, length, max, min, mix, clamp, exp, time, positionLocal, Loop, uint, select, dot,
} from 'three/tsl';
import { HEIGHT_SAMPLES, HEIGHT_RANGE } from './plates.js';

// Peas: thousands of little spheres simulated by a COMPUTE SHADER.
//
// The positions and velocities live in GPU memory (instancedArray).
// Every frame `update` runs once per pea, in parallel, on the GPU.
// The CPU never loops over the peas: it only changes a few uniforms
// (pointer position, damping, ...).
//
// Peas live in 3D now:
//   - they roll downhill on the plate's measured surface (`heights`)
//   - climbing the rim fast enough launches them, and past the edge
//     they fall onto the table with gravity
//   - steep walls (the plate's outer edge seen from the table) block them
//   - sauce painted over a pea coats it (`coat` buffer)
//
// This uses three.js TSL ("three shading language"): you write shader
// logic in JavaScript and three.js turns it into WGSL (WebGPU) for you.

export class Peas {
    constructor(count = 4000) {
        this.count = count;
        this.next = 0; // ring-buffer index for spawning

        // GPU buffers
        this.pos = instancedArray(count, 'vec4');  // xyz = position, w = alive (1/0)
        this.vel = instancedArray(count, 'vec4');  // xyz = velocity, w = 1 when resting on something
        this.coat = instancedArray(count, 'vec4'); // rgb = sauce colour on the pea, a = how covered

        // the plate's surface height at each distance from the centre
        this.heights = new Array(HEIGHT_SAMPLES).fill(0);
        const H = uniformArray(this.heights, 'float');

        const u = this.u = {
            dt: uniform(0),
            radius: uniform(0.032),
            damping: uniform(4),       // how quickly rolling peas slow down
            gravity: uniform(9),       // pulls peas downhill and down off the edge
            collide: uniform(1),
            stiffness: uniform(6),     // how hard peas push apart when they overlap
            // utensil
            pointer: uniform(new THREE.Vector2(99, 99)),
            pointerVel: uniform(new THREE.Vector2()),
            pushOn: uniform(0), eraseOn: uniform(0),
            push: uniform(10), pushR: uniform(0.16), drag: uniform(18),
            // sauce coating
            paintOn: uniform(0), paintPos: uniform(new THREE.Vector2()), paintR: uniform(0.07),
            paintColor: uniform(new THREE.Color()),
            // spawning
            spawnStart: uniform(0, 'uint'), spawnEnd: uniform(0, 'uint'),
            spawnPos: uniform(new THREE.Vector2()), seed: uniform(0),
            // structured randomness (driven by the mood state machine)
            jitter: uniform(0), nudge: uniform(new THREE.Vector2()),
            color: uniform(new THREE.Color('#6fae3a')),
            // the plate's centre (lifted when tilted) and how steeply the
            // player has tipped it: height change per unit of x and z
            plateCenter: uniform(new THREE.Vector3()),
            tiltSlope: uniform(new THREE.Vector2()),
        };

        // surface height at distance r from the centre (0 = table)
        const STEP = HEIGHT_RANGE / (HEIGHT_SAMPLES - 1);
        const surface = Fn(([r]) => {
            const t = clamp(r.div(HEIGHT_RANGE), 0, 1).mul(HEIGHT_SAMPLES - 1);
            const i0 = int(t.floor());
            const i1 = min(i0.add(1), int(HEIGHT_SAMPLES - 1));
            return mix(H.element(i0), H.element(i1), t.fract());
        });

        // surface height at world position xz: the (tilted) plate where it
        // is, the table (0) everywhere else
        const C = u.plateCenter;
        const surfaceAt = Fn(([xz]) => {
            const rel = xz.sub(C.xz);
            const h = surface(length(rel));
            return select(h.greaterThan(0.0005), max(h.add(C.y).add(dot(u.tiltSlope, rel)), 0), float(0));
        });

        const id = float(instanceIndex);
        const TABLE_EDGE = 3.2; // peas can't roll further than this

        this.update = Fn(() => {
            const p = this.pos.element(instanceIndex);
            const v = this.vel.element(instanceIndex);
            const coat = this.coat.element(instanceIndex);

            // --- spawn: indices in [spawnStart, spawnEnd) drop in at the pointer ---
            If(instanceIndex.greaterThanEqual(u.spawnStart).and(instanceIndex.lessThan(u.spawnEnd)), () => {
                const off = vec2(hash(id.add(u.seed)), hash(id.add(u.seed).add(17.31))).sub(0.5).mul(0.12);
                const s = u.spawnPos.add(off);
                const drop = hash(id.add(u.seed).add(5.7)).mul(0.1).add(0.12); // fall from a little above
                p.assign(vec4(s.x, surfaceAt(s).add(u.radius).add(drop), s.y, 1));
                v.assign(vec4(0));
                coat.assign(vec4(0));
            });

            If(p.w.greaterThan(0.5), () => {
                const P = vec3(p.x, p.y, p.z).toVar();

                const V = vec3(v.x, v.y, v.z).toVar();
                const alive = float(1).toVar();
                const rest = u.radius.mul(0.85); // centre height above the surface

                // where are we, and which way is downhill?
                const rel = P.xz.sub(C.xz); // position relative to the plate's centre
                const r = length(rel);
                const dir = rel.div(max(r, 0.0001));
                const ground = surfaceAt(P.xz).add(rest);
                const slope = surface(r.add(STEP)).sub(surface(max(r.sub(STEP), 0))).div(STEP * 2);
                const onPlate = surface(r).greaterThan(0.0005);
                // which way is downhill: the plate's own curve, plus the tilt
                const grad = dir.mul(slope).add(select(onPlate, u.tiltSlope, vec2(0)));
                const grounded = P.y.lessThanEqual(ground.add(0.004)).and(v.w.greaterThan(0.5));

                const acc = vec2(0).toVar();
                If(grounded, () => {
                    // roll downhill (a rolling ball gets ~5/7 of gravity along a slope)
                    acc.addAssign(grad.mul(u.gravity).mul(-0.71));
                    // table bump + per-pea fidget (each pea gets its own random)
                    acc.addAssign(u.nudge);
                    const n = vec2(hash(id.add(time.mul(97.0))), hash(id.mul(1.37).add(time.mul(131.0)))).sub(0.5);
                    acc.addAssign(n.mul(u.jitter));
                    // damping: rolling resistance, so peas settle instead of skating
                    V.xz.assign(V.xz.mul(exp(u.damping.negate().mul(u.dt))));
                });

                // utensil: shove peas away and drag them along with the motion.
                // a fast flick drags them fast enough to fly off the plate.
                const d = P.xz.sub(u.pointer);
                const dist = length(d);
                If(dist.lessThan(u.pushR).and(u.pushOn.greaterThan(0.5)), () => {
                    const falloff = float(1).sub(dist.div(u.pushR));
                    acc.addAssign(d.div(max(dist, 0.0001)).mul(u.push).mul(falloff));
                    V.xz.assign(mix(V.xz, u.pointerVel, clamp(u.drag.mul(u.dt).mul(falloff), 0, 1)));
                    If(u.eraseOn.greaterThan(0.5), () => { alive.assign(0); });
                });

                // sauce painted over a pea coats it (layering)
                If(u.paintOn.greaterThan(0.5).and(length(P.xz.sub(u.paintPos)).lessThan(u.paintR)), () => {
                    // first coat takes the sauce colour fully, later coats blend
                    const amount = select(coat.w.lessThan(0.01), float(1), float(0.35));
                    const rgb = mix(coat.xyz, vec3(u.paintColor), amount);
                    coat.assign(vec4(rgb, min(coat.w.add(0.25), 1)));
                });

                // pea vs pea: check every other pea (brute force), only ones
                // at about the same height, so falling peas can pass over.
                If(u.collide.greaterThan(0.5), () => {
                    const minD = u.radius.mul(2);
                    Loop({ start: uint(0), end: uint(count), type: 'uint' }, ({ i }) => {
                        const o = this.pos.element(i);
                        If(o.w.greaterThan(0.5).and(i.notEqual(instanceIndex)), () => {
                            const dd = P.xz.sub(o.xz);
                            const dl = length(dd);
                            If(dl.lessThan(minD).and(P.y.sub(o.y).abs().lessThan(minD)), () => {
                                const nrm = dd.div(max(dl, 0.0001));
                                const overlap = minD.sub(dl);
                                P.xz.addAssign(nrm.mul(overlap.mul(0.5)));
                                V.xz.addAssign(nrm.mul(overlap.mul(u.stiffness)));
                            });
                        });
                    });
                });

                // integrate sideways
                V.xz.addAssign(acc.mul(u.dt));
                const nextXZ = P.xz.add(V.xz.mul(u.dt)).toVar();

                // walls: if the surface ahead is much higher than the pea
                // (the plate's outer edge seen from the table), bounce off it
                const nextGround = surfaceAt(nextXZ).add(rest).toVar();
                const rise = nextGround.sub(P.y);
                const moved = length(nextXZ.sub(P.xz));
                If(rise.greaterThan(max(u.radius.mul(0.6), moved.mul(1.6))), () => {
                    V.xz.assign(V.xz.mul(-0.3));
                    nextXZ.assign(P.xz);
                    nextGround.assign(ground);
                });

                // keep peas on the table
                const rn = length(nextXZ);
                If(rn.greaterThan(TABLE_EDGE), () => {
                    nextXZ.assign(nextXZ.div(rn).mul(TABLE_EDGE));
                    V.xz.assign(V.xz.mul(-0.3));
                });
                P.xz.assign(nextXZ);

                // up and down: fall with gravity, land on whatever is below
                const onGround = float(0).toVar();
                // follow slopes downhill (up to ~50°); a bigger drop is a ledge
                const maxDrop = max(float(0.02), moved.mul(1.2));
                If(grounded.and(P.y.sub(nextGround).lessThan(maxDrop)).and(nextGround.lessThanEqual(P.y)), () => {
                    // rolling along: stick to the surface (no tiny hops going downhill)
                    P.y.assign(nextGround);
                    V.y.assign(0);
                    onGround.assign(1);
                }).Else(() => {
                    V.y.subAssign(u.gravity.mul(3).mul(u.dt));
                    P.y.addAssign(V.y.mul(u.dt));
                    If(P.y.lessThanEqual(nextGround), () => {
                        // climbing a slope keeps the upward speed, so racing up
                        // the rim launches the pea off the lip. (measured from
                        // how much the ground rose under the pea, not from how
                        // deep it landed, or landings would launch it)
                        const climb = max(nextGround.sub(ground), 0).div(max(u.dt, 0.0001));
                        P.y.assign(nextGround);
                        If(V.y.lessThan(-1.2), () => {
                            V.y.assign(V.y.mul(-0.25)); // small bounce on landing
                        }).Else(() => {
                            V.y.assign(min(max(V.y, 0).add(climb.mul(0.6)), 4));
                            onGround.assign(1);
                        });
                    });
                });

                p.assign(vec4(P, alive));
                v.assign(vec4(V, onGround));
            });
        })().compute(count);

        this.clear = Fn(() => {
            this.pos.element(instanceIndex).assign(vec4(0));
            this.vel.element(instanceIndex).assign(vec4(0));
            this.coat.element(instanceIndex).assign(vec4(0));
        })().compute(count);

        // --- drawing: one sphere mesh, instanced `count` times ---
        const geo = new THREE.IcosahedronGeometry(1, 2);
        const mat = new THREE.MeshStandardNodeMaterial();
        const posAttr = this.pos.toAttribute();
        const coatAttr = this.coat.toAttribute();
        // per-pea size + colour variation = less "computer generated"
        const sizeVar = hash(id.add(3.3)).mul(0.3).add(0.85);
        mat.positionNode = positionLocal.mul(u.radius).mul(sizeVar).mul(posAttr.w).add(posAttr.xyz);
        const green = mix(u.color, u.color.mul(0.7), hash(id.add(9.1)));
        mat.colorNode = mix(green, coatAttr.xyz, coatAttr.w.mul(0.9)); // sauce on top covers the green
        mat.roughnessNode = mix(float(0.45), float(0.25), coatAttr.w); // sauce is glossier

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

    // copy the plate's measured surface into the shader
    setPlate(plate) {
        for (let i = 0; i < HEIGHT_SAMPLES; i++) this.heights[i] = plate.heights[i];
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
