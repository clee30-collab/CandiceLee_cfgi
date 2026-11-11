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
// ------------------------------------------------------------------
export const MODELS = {
    // UTENSILS: model them lying flat on the ground, origin in the middle,
    // tip (tines / bowl / blade) pointing toward Blender's +Y.
    // About 0.7 m long matches the placeholders.
    fork: null,   // { file: 'assets/models/fork.glb' },
    spoon: null,  // { file: 'assets/models/spoon.glb' },
    knife: null,  // { file: 'assets/models/knife.glb' },
    napkin: null, // { file: 'assets/models/napkin.glb' },

    // ONE PEA: any size, it gets scaled to the "size" slider.
    // The compute shader draws thousands of copies of it.
    pea: null,    // { file: 'assets/models/pea.glb' },

    // PLATE BODIES: the rim + underside. Model 2 m wide (radius 1),
    // sitting on the ground. Sauce still paints onto the built-in eating
    // surface, so keep the flat/curved middle the same height as the
    // placeholder (see PLATE_TYPES in plates.js).
    dinner: null, // { file: 'assets/models/dinner-plate.glb' },
    bowl: null,   // { file: 'assets/models/bowl.glb' },
    paper: null,  // { file: 'assets/models/paper-plate.glb' },
};

const loader = new GLTFLoader();

// Load one .glb and return it wrapped in a Group, with shadows on.
export async function loadModel(file, { scale = 1, rotation = [0, 0, 0] } = {}) {
    const gltf = await loader.loadAsync(file);
    const model = gltf.scene;
    model.scale.multiplyScalar(scale);
    model.rotation.set(...rotation.map(THREE.MathUtils.degToRad));
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
