import * as THREE from 'three/webgpu';

// Each plate is:
//   body  - a LatheGeometry (a 2D side profile spun around the centre)
//   inner - the eating surface, a disc we paint sauce onto
// surfaceY(r) = top + curve * r^2 describes the eating surface, and the
// pea compute shader uses the same formula so peas sit on the plate.

export const PLATE_TYPES = {
    dinner: {
        label: 'dinner plate',
        top: 0.06, curve: 0, innerR: 0.72,
        color: '#f7f5f0', roughness: 0.32,
        // [radius, height] points, from the bottom centre outward and back over the rim
        profile: [[0, 0], [0.55, 0], [0.6, 0.03], [0.98, 0.115], [1.0, 0.13], [0.97, 0.14], [0.72, 0.06]],
    },
    bowl: {
        label: 'bowl',
        top: 0.04, curve: 0.6, innerR: 0.82,
        color: '#f5f2ea', roughness: 0.32,
        profile: [[0, 0], [0.42, 0], [0.45, 0.04], [0.93, 0.43], [0.97, 0.47], [0.93, 0.48], [0.82, 0.04 + 0.6 * 0.82 * 0.82]],
    },
    paper: {
        label: 'paper plate',
        top: 0.015, curve: 0, innerR: 0.7,
        color: '#f1ece0', roughness: 0.95,
        scallops: 32, soaks: true,
        profile: [[0, 0], [0.7, 0], [0.97, 0.07], [1.0, 0.075], [0.98, 0.08], [0.7, 0.015]],
    },
};

export function buildPlate(type, sauce) {
    const def = PLATE_TYPES[type];
    const group = new THREE.Group();

    // ---- body ----
    const points = def.profile.map(([r, y]) => new THREE.Vector2(r, y));
    const bodyGeo = new THREE.LatheGeometry(points, 160);
    if (def.scallops) {
        // wobble the rim radius to get a scalloped paper plate edge
        const p = bodyGeo.attributes.position;
        for (let i = 0; i < p.count; i++) {
            const x = p.getX(i), z = p.getZ(i);
            const r = Math.hypot(x, z);
            if (r > def.innerR + 0.01) {
                const t = (r - def.innerR) / (1 - def.innerR);
                const k = 1 + 0.025 * Math.sin(Math.atan2(z, x) * def.scallops) * t;
                p.setX(i, x * k);
                p.setZ(i, z * k);
            }
        }
        bodyGeo.computeVertexNormals();
    }
    const bodyMat = new THREE.MeshStandardMaterial({
        color: def.color, roughness: def.roughness, side: THREE.DoubleSide,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.castShadow = true;
    body.receiveShadow = true;
    group.add(body);

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
    const contactGeo = new THREE.PlaneGeometry(2.6, 2.6).rotateX(-Math.PI / 2);
    const contactMat = new THREE.MeshBasicMaterial({
        color: '#2b2a22', alphaMap: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false,
    });
    const contact = new THREE.Mesh(contactGeo, contactMat);
    contact.position.y = 0.002;
    group.add(contact);

    // ---- inner eating surface (sauce lives here) ----
    const innerGeo = new THREE.RingGeometry(0, def.innerR, 160, 48);
    innerGeo.rotateX(-Math.PI / 2);
    const p = innerGeo.attributes.position;
    for (let i = 0; i < p.count; i++) {
        const r = Math.hypot(p.getX(i), p.getZ(i));
        p.setY(i, def.top + def.curve * r * r);
    }
    innerGeo.computeVertexNormals();
    innerGeo.computeBoundingSphere();

    const innerMat = new THREE.MeshStandardMaterial({
        map: sauce.colorTexture,
        normalMap: sauce.normalTexture,
        roughnessMap: sauce.roughTexture,
        roughness: 1,
    });
    const inner = new THREE.Mesh(innerGeo, innerMat);
    inner.receiveShadow = true;
    group.add(inner);

    return {
        type, def, group, inner,
        dispose() {
            bodyGeo.dispose(); bodyMat.dispose();
            innerGeo.dispose(); innerMat.dispose();
            contactGeo.dispose(); contactMat.dispose();
        },
    };
}
