import * as THREE from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

// ------------------------------------------------------------------
// YOUR BLENDER MODELS
//
// 1. In Blender: File > Export > glTF 2.0, Format: glTF Binary (.glb)
// 2. Save the file in final/assets/models/
// 3. Uncomment its line below (or fill in the file name)
//
// Anything left as null keeps the built-in placeholder.
//
// Options for each model:
//   file      path to the .glb (relative to final/)
//   scale     make it bigger/smaller without re-exporting
//   rotation  [x, y, z] in degrees, to fix a model that faces the wrong way
//   fit       resize so it's this many units wide (a plate is 2), and
//             centre it on the origin sitting on the ground. Handy when
//             a Blender model is huge or far from Blender's origin.
// ------------------------------------------------------------------
export const MODELS = {
    // UTENSILS: model them lying flat on the ground, tip (tines / bowl /
    // blade) pointing toward Blender's +Y. Any size: `fit` sets the length.
    // No material in Blender = polished steel.
    // Only utensils listed in UTENSILS in main.js appear on the table.
    fork: { file: 'assets/models/fork1.glb', fit: 1.6 },
    spoon: { file: 'assets/models/spoon1.glb', fit: 1.6 },
    knife: null,  // { file: 'assets/models/knife.glb', fit: 0.8 },   (add to UTENSILS in main.js too)
    napkin: null, // { file: 'assets/models/napkin.glb', fit: 0.66 }, (add to UTENSILS in main.js too)

    // ONE PEA: any size, it gets scaled to the "size" slider.
    // The compute shader draws thousands of copies of it.
    pea: null,    // { file: 'assets/models/pea.glb' },

    // PLATE BODIES: the rim + underside. Model 2 m wide (radius 1),
    // sitting on the ground. Sauce still paints onto the built-in eating
    // surface, so keep the flat/curved middle the same height as the
    // placeholder (see PLATE_TYPES in plates.js).
    dinner: { file: 'assets/models/plate2.glb', fit: 2 },
    bowl: null,   // { file: 'assets/models/bowl.glb' },
    paper: null,  // { file: 'assets/models/paper-plate.glb' },
};

const loader = new GLTFLoader();

// Load one .glb and return it wrapped in a Group, with shadows on.
export async function loadModel(file, { scale = 1, rotation = [0, 0, 0], fit = null } = {}) {
    const gltf = await loader.loadAsync(file);
    const model = gltf.scene;
    model.scale.multiplyScalar(scale);
    model.rotation.set(...rotation.map(THREE.MathUtils.degToRad));
    if (fit) {
        // resize to `fit` units wide, then centre it and sit it on the ground
        model.updateMatrixWorld(true);
        let box = new THREE.Box3().setFromObject(model);
        const size = box.getSize(new THREE.Vector3());
        model.scale.multiplyScalar(fit / Math.max(size.x, size.z));
        model.updateMatrixWorld(true);
        box = new THREE.Box3().setFromObject(model);
        const c = box.getCenter(new THREE.Vector3());
        model.position.x -= c.x;
        model.position.z -= c.z;
        model.position.y -= box.min.y;
    }
    model.traverse((o) => {
        if (o.isMesh) {
            o.castShadow = true;
            o.receiveShadow = true;
        }
    });
    const wrapper = new THREE.Group(); // so the app can move it without undoing your scale/rotation
    wrapper.add(model);
    wrapper.name = file;
    return wrapper;
}

// True for a mesh that had no material in Blender. glTF then falls back
// to a grey "metal" (metalness 1, roughness 1), which looks dark.
export function hasNoMaterial(mesh) {
    const m = mesh.material;
    return m && !m.map && m.metalness === 1 && m.roughness === 1;
}

// Load everything listed in MODELS. A missing or broken file is skipped
// (and reported) so the site still works with the placeholder.
export async function loadModels(manifest = MODELS) {
    const out = {};
    const problems = [];
    await Promise.all(Object.entries(manifest).map(async ([name, entry]) => {
        out[name] = null;
        if (!entry) return;
        try {
            out[name] = await loadModel(entry.file, entry);
        } catch (err) {
            problems.push(`${entry.file} (${err.message ?? err})`);
            console.warn(`could not load model "${name}" from ${entry.file}`, err);
        }
    }));
    return { models: out, problems };
}

// For instancing (peas): take the first mesh's geometry, centred and
// scaled so it fits in a sphere of radius 1.
export function geometryFromModel(model) {
    let mesh = null;
    model.traverse((o) => { if (!mesh && o.isMesh) mesh = o; });
    if (!mesh) return null;
    model.updateMatrixWorld(true);
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    geo.computeBoundingSphere();
    const { center, radius } = geo.boundingSphere;
    geo.translate(-center.x, -center.y, -center.z);
    geo.scale(1 / radius, 1 / radius, 1 / radius);
    return { geometry: geo, material: mesh.material };
}
