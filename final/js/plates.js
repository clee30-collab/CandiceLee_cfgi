import * as THREE from 'three/webgpu';
import { hasNoMaterial } from './models.js';

// Each plate is:
//   body    - a LatheGeometry (a 2D side profile spun around the centre),
//             or your Blender model (js/models.js)
//   heights - the plate's surface height at each distance from the centre,
//             measured by shooting rays straight down at the body. The pea
//             physics uses this, so peas roll in the well, climb the rim
//             and can fall off the edge onto the table.
//   decal   - a see-through layer just above the surface that the sauce
//             is painted onto. It follows `heights`, so sauce sits on
//             any plate shape.

export const PLATE_TYPES = {
    dinner: {
        label: 'dinner plate',
        color: '#f7f5f0', roughness: 0.32,
        // [radius, height] points from the bottom centre, out, over the rim and back to the centre
        profile: [[0, 0], [0.55, 0], [0.6, 0.03], [0.98, 0.115], [1.0, 0.13], [0.97, 0.14], [0.72, 0.06], [0.36, 0.06], [0, 0.06]],
    },
    bowl: {
        label: 'bowl',
        color: '#f5f2ea', roughness: 0.32,
        profile: [[0, 0], [0.42, 0], [0.45, 0.04], [0.93, 0.43], [0.97, 0.47], [0.93, 0.48],
            // the curved inside: y = 0.04 + 0.6 r^2
            ...Array.from({ length: 9 }, (_, i) => { const r = 0.82 * (1 - i / 8); return [r, 0.04 + 0.6 * r * r]; })],
    },
    paper: {
        label: 'paper plate',
        color: '#f1ece0', roughness: 0.95,
        scallops: 32, soaks: true,
        profile: [[0, 0], [0.7, 0], [0.97, 0.07], [1.0, 0.075], [0.98, 0.08], [0.7, 0.015], [0, 0.015]],
    },
};

// heights are sampled out to this radius (beyond = table, height 0)
export const HEIGHT_SAMPLES = 128;
export const HEIGHT_RANGE = 1.3;

export function buildPlate(type, sauce, model = null) {
    const def = PLATE_TYPES[type];
    const group = new THREE.Group(); // sits on the table (holds the contact shadow)
    const tilt = new THREE.Group();  // the plate itself: the player tilts this
    group.add(tilt);

    // glazed ceramic: a coloured body with a clear glossy coat on top
    // ("clearcoat"). The panel's "plate material" sliders edit this live.
    const bodyMat = new THREE.MeshPhysicalMaterial({
        color: def.color, roughness: def.roughness, side: THREE.DoubleSide,
        clearcoat: 0.6, clearcoatRoughness: 0.08,
    });

    // ---- body ----
    let bodyGeo = null;
    let body;
    if (model) {
        body = model;
        // a model with no material in Blender gets the ceramic one
        body.traverse((o) => {
            if (o.isMesh && hasNoMaterial(o)) o.material = bodyMat;
        });
    } else {
        const points = def.profile.map(([r, y]) => new THREE.Vector2(r, y));
        bodyGeo = new THREE.LatheGeometry(points, 160);
        if (def.scallops) {
            // wobble the rim radius to get a scalloped paper plate edge
            const p = bodyGeo.attributes.position;
            for (let i = 0; i < p.count; i++) {
                const x = p.getX(i), z = p.getZ(i);
                const r = Math.hypot(x, z);
                if (r > 0.71) {
                    const t = (r - 0.7) / 0.3;
                    const k = 1 + 0.025 * Math.sin(Math.atan2(z, x) * def.scallops) * t;
                    p.setX(i, x * k);
                    p.setZ(i, z * k);
                }
            }
            bodyGeo.computeVertexNormals();
        }
        body = new THREE.Mesh(bodyGeo, bodyMat);
        body.castShadow = true;
        body.receiveShadow = true;
    }
    tilt.add(body);

    // ---- measure the surface: height at each radius ----
    const heights = measureHeights(body);

    // a model with a hole in the middle (no floor in the well): fill it
    // with a flat disc at the well's height so food has something to sit on.
    // Better fix in Blender: select the inner edge loop and press F.
    let holePatched = false;
    let capGeo = null;
    // (a hole = the middle rings, starting from the centre, where rays
    // found at most one surface AND it was down near the ground: the
    // underside, or nothing at all. A bowl's low middle still has a top
    // and an underside, so it isn't mistaken for a hole.)
    const maxH = Math.max(...heights);
    let first = 0;
    while (first < HEIGHT_SAMPLES && heights.thin[first] && heights[first] < maxH * 0.3) first++;
    if (first > 2 && first < HEIGHT_SAMPLES) {
        const capR = (first / (HEIGHT_SAMPLES - 1)) * HEIGHT_RANGE + 0.02;
        const capY = heights[first];
        for (let i = 0; i < first; i++) heights[i] = capY;
        capGeo = new THREE.CircleGeometry(capR, 96).rotateX(-Math.PI / 2);
        const cap = new THREE.Mesh(capGeo, bodyMat);
        cap.position.y = capY - 0.002;
        cap.receiveShadow = true;
        tilt.add(cap);
        holePatched = true;
    }
    let radius = 0; // how far the plate reaches
    for (let i = 0; i < HEIGHT_SAMPLES; i++) {
        if (heights[i] > 0.005) radius = (i / (HEIGHT_SAMPLES - 1)) * HEIGHT_RANGE;
    }
    const heightAt = (r) => sampleHeights(heights, r);

    // ---- contact shadow ----
    // a soft dark blur right under the plate. Real shadow maps can't make
    // this soft "sitting on the table" darkness, so we paint it.
    const sc = document.createElement('canvas');
    sc.width = sc.height = 256;
    const sg = sc.getContext('2d');
    // alphaMap reads brightness (green channel), not transparency:
    // grey = how dark the shadow is
    const grad = sg.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgb(115,115,115)');
    grad.addColorStop(0.55, 'rgb(90,90,90)');
    grad.addColorStop(0.8, 'rgb(25,25,25)');
    grad.addColorStop(1, 'rgb(0,0,0)');
    sg.fillStyle = grad;
    sg.fillRect(0, 0, 256, 256);
    const contactGeo = new THREE.PlaneGeometry(radius * 2.6, radius * 2.6).rotateX(-Math.PI / 2);
    const contactMat = new THREE.MeshBasicMaterial({
        color: '#2b2a22', alphaMap: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false,
    });
    const contact = new THREE.Mesh(contactGeo, contactMat);
    contact.position.y = 0.002;
    group.add(contact);

    // ---- sauce layer: see-through, hugging the whole top of the plate ----
    const decalGeo = new THREE.RingGeometry(0, radius, 160, 64);
    decalGeo.rotateX(-Math.PI / 2);
    const p = decalGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        p.setY(i, heightAt(Math.hypot(p.getX(i), p.getZ(i))) + 0.003);
    }
    decalGeo.computeVertexNormals();
    decalGeo.computeBoundingSphere();
    const decalMat = new THREE.MeshStandardMaterial({
        map: sauce.colorTexture,
        normalMap: sauce.normalTexture,
        roughnessMap: sauce.roughTexture,
        roughness: 1,
        transparent: true,
        depthWrite: false,
        polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const decal = new THREE.Mesh(decalGeo, decalMat);
    decal.receiveShadow = true;
    tilt.add(decal);

    return {
        type, def, group, tilt, body, decal, bodyMat, heights, radius, heightAt, holePatched,
        dispose() {
            bodyGeo?.dispose(); bodyMat.dispose(); capGeo?.dispose();
            decalGeo.dispose(); decalMat.dispose();
            contactGeo.dispose(); contactMat.dispose();
        },
    };
}

// Shoot rays straight down at several angles around the plate and
// average what they hit, for each distance from the centre.
function measureHeights(body) {
    body.updateMatrixWorld(true);
    const ray = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const from = new THREE.Vector3();
    const heights = new Float32Array(HEIGHT_SAMPLES);
    // "thin" = rays here passed through at most one surface. A real plate
    // has a top and an underside (2 hits); a hole only shows the underside.
    const thin = new Array(HEIGHT_SAMPLES).fill(false);
    const ANGLES = 6;
    for (let i = 0; i < HEIGHT_SAMPLES; i++) {
        const r = (i / (HEIGHT_SAMPLES - 1)) * HEIGHT_RANGE;
        let sum = 0;
        let thinRays = 0;
        for (let a = 0; a < ANGLES; a++) {
            const t = (a / ANGLES) * Math.PI * 2 + 0.3;
            ray.set(from.set(Math.cos(t) * r, 5, Math.sin(t) * r), down);
            const hits = ray.intersectObject(body, true);
            if (hits[0]) sum += hits[0].point.y;
            if (hits.length <= 1) thinRays++;
        }
        heights[i] = sum / ANGLES;
        thin[i] = thinRays > ANGLES / 2;
    }
    heights.thin = thin;
    return heights;
}

export function sampleHeights(heights, r) {
    const t = Math.min(Math.max(r / HEIGHT_RANGE, 0), 1) * (HEIGHT_SAMPLES - 1);
    const i = Math.floor(t);
    const j = Math.min(i + 1, HEIGHT_SAMPLES - 1);
    return heights[i] + (heights[j] - heights[i]) * (t - i);
}
