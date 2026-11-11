import * as THREE from 'three/webgpu';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { params, status } from './params.js';
import { StateMachine, RandomMachine } from './stateMachine.js';
import { buildPlate, PLATE_TYPES } from './plates.js';
import { SaucePainter } from './sauce.js';
import { Peas } from './peas.js';
import { Parallax } from './parallax.js';
import { makeCard, drawUtensil } from './cards.js';
import { loadModels, geometryFromModel } from './models.js';
import { createGui, loadPreset } from './gui.js';
import { Look } from './look.js';

// The locked-in look: if final/assets/preset.json exists, its values
// replace the defaults in params.js for every visitor.
await loadPreset(params);

// ------------------------------------------------------------------
// renderer
// WebGPURenderer uses WebGPU when the browser has it (Chrome, Edge,
// Safari 26+ on your M2) and falls back to WebGL2 otherwise.
// ------------------------------------------------------------------
const canvas = document.getElementById('stage');
// add ?webgl to the URL to test the fallback path on purpose
const forceWebGL = new URLSearchParams(location.search).has('webgl');
const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, forceWebGL });
await renderer.init();
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// AgX rolls off bright whites gently (ACES crushed the white plate flat)
renderer.toneMapping = THREE.AgXToneMapping;

status.backend = renderer.backend.isWebGPUBackend ? 'WebGPU' : 'WebGL2';
document.getElementById('badge').textContent = `rendering with ${status.backend}`;

// if the GPU gives up (e.g. a compute shader takes too long), say so on screen
renderer.onDeviceLost = (info) => {
    const b = document.getElementById('badge');
    b.textContent = `GPU device lost: ${info.message || info.reason || 'unknown'}. try turning off pea "collide"`;
};

// ------------------------------------------------------------------
// scene: white "museum wall" table, soft light
// ------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e2ded5');

const pmrem = new THREE.PMREMGenerator(renderer);
// blur the room a lot (0.35) so the glossy plate shows soft studio light,
// not the sharp edges of the room's light panels
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.35).texture;

const camera = new THREE.PerspectiveCamera(35, window.innerWidth / window.innerHeight, 0.1, 50);
const parallax = new Parallax(camera);
const look = new Look(renderer, scene, camera, params.look);

// press F to flip the photo filter on/off
window.addEventListener('keydown', (e) => {
    if (e.key === 'f' && !e.metaKey && !e.ctrlKey) {
        params.look.enabled = !params.look.enabled;
        pane.refresh();
    }
});

const table = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#e2ded5', roughness: 1 }),
);
table.receiveShadow = true;
scene.add(table);

const hemi = new THREE.HemisphereLight('#ffffff', '#d9d4ca', 0.5);
scene.add(hemi);
const sun = new THREE.DirectionalLight('#fffaf0', 2.4);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = sun.shadow.camera.bottom = -2;
sun.shadow.camera.right = sun.shadow.camera.top = 2;
sun.shadow.bias = -0.0005;
sun.shadow.radius = 4;
scene.add(sun);

function applyLight() {
    const az = THREE.MathUtils.degToRad(params.light.azimuth);
    const el = THREE.MathUtils.degToRad(params.light.elevation);
    sun.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(5);
    sun.intensity = params.light.intensity;
    hemi.intensity = params.light.ambient;
    scene.environmentIntensity = params.light.environment;
    renderer.toneMappingExposure = params.light.exposure;
}

// ------------------------------------------------------------------
// food + plate
// ------------------------------------------------------------------
const sauce = new SaucePainter();
const peas = new Peas(4000);
scene.add(peas.mesh);

let plate = null;
const used = new Set(); // what's on the plate, for the gallery caption

// your Blender models (js/models.js). Missing ones keep the placeholders.
const { models, problems } = await loadModels();
if (problems.length) {
    document.getElementById('badge').textContent += ` · could not load: ${problems.join(', ')}`;
}

// a modelled pea replaces the plain sphere
if (models.pea) {
    const pea = geometryFromModel(models.pea);
    if (pea) peas.setGeometry(pea.geometry);
}

function setPlate(type) {
    if (plate) { scene.remove(plate.group); plate.dispose(); }
    plate = buildPlate(type, sauce, models[type]?.clone());
    scene.add(plate.group);
    sauce.reset(plate.def.color, plate.def.roughness);
    peas.setPlate(plate.def);
    peas.reset(renderer);
    used.clear();
}

// 2D utensil images that hover over the plate (parallax + normal maps)
const cards = {};
for (const type of ['fork', 'spoon', 'knife', 'napkin']) {
    cards[type] = makeCard(drawUtensil(type), {
        width: type === 'napkin' ? 0.55 : 0.2,
        metalness: type === 'napkin' ? 0 : 0.6,
        roughness: type === 'napkin' ? 0.9 : 0.3,
    });
    // a Blender model replaces the 2D card. Real 3D casts real shadows,
    // so it doesn't need the fake drop shadow.
    if (models[type]) {
        cards[type] = models[type];
        cards[type].userData.shadow = null;
    }
    cards[type].visible = false;
    scene.add(cards[type]);
    if (cards[type].userData.shadow) scene.add(cards[type].userData.shadow);
}

// what the player is holding
const hand = { kind: null, id: null, color: null };

// ------------------------------------------------------------------
// STATE MACHINE 1: game flow  plate > food > utensil > play > served
// ------------------------------------------------------------------
const PROMPTS = {
    plate: 'pick a plate.',
    food: 'pick a food.',
    utensil: 'pick a utensil.',
    play: 'play with your food.',
    served: 'served.',
};

const flow = new StateMachine({
    initial: 'plate',
    states: {
        plate: { on: { pickPlate: 'food' } },
        food: { on: { pickPlate: 'food', pickFood: 'utensil' } },
        utensil: { on: { pickPlate: 'utensil', pickFood: 'utensil', pickUtensil: 'play' } },
        play: {
            on: { pickPlate: 'play', pickFood: 'play', pickUtensil: 'play', serve: 'served' },
        },
        served: {
            on: { again: 'plate' },
            enter: () => serve(),
            exit: () => { document.getElementById('served').hidden = true; },
        },
    },
});

// which tray steps are usable in each state (the rest get `disabled`)
const OPEN_STEPS = {
    plate: ['plate'],
    food: ['plate', 'food'],
    utensil: ['plate', 'food', 'utensil'],
    play: ['plate', 'food', 'utensil', 'serve'],
    served: [],
};

function updateUI() {
    const open = OPEN_STEPS[flow.state];
    document.querySelectorAll('#tray [data-step]').forEach((section) => {
        section.querySelectorAll('button:not([data-soon])').forEach((b) => {
            b.disabled = !open.includes(section.dataset.step);
        });
    });
    document.getElementById('serve').disabled = !open.includes('serve');

    const holding = hand.id ? ` holding: ${status.hand}` : '';
    document.getElementById('prompt').textContent = PROMPTS[flow.state] + holding;
}

flow.onChange((state) => {
    status.flow = state;
    updateUI();
});

// ------------------------------------------------------------------
// STATE MACHINE 2: the table's "mood" (structured randomness)
// still most of the time, sometimes the peas fidget, rarely the
// table gets bumped. Weights + duration ranges, not pure noise.
// ------------------------------------------------------------------
const mood = new RandomMachine({
    initial: 'still',
    states: {
        still: {
            duration: [3, 8],
            next: { still: 1, fidget: 3, bump: 0.6 },
            enter: () => { peas.u.jitter.value = 0; peas.u.nudge.value.set(0, 0); },
        },
        fidget: {
            duration: [0.8, 2.5],
            next: { still: 3, fidget: 1 },
            enter: () => { peas.u.jitter.value = params.mood.jitter; },
        },
        bump: {
            duration: [0.12, 0.3],
            next: { still: 1 },
            enter: () => {
                const a = Math.random() * Math.PI * 2;
                peas.u.nudge.value.set(Math.cos(a), Math.sin(a)).multiplyScalar(params.mood.nudge);
                parallax.kick(1);
            },
            exit: () => peas.u.nudge.value.set(0, 0),
        },
    },
});
mood.onChange((state) => { status.mood = state; });

// ------------------------------------------------------------------
// tray buttons
// ------------------------------------------------------------------
function press(selector, el) {
    document.querySelectorAll(selector).forEach((b) => b.setAttribute('aria-pressed', String(b === el)));
}

document.querySelectorAll('[data-plate]').forEach((b) => b.addEventListener('click', () => {
    setPlate(b.dataset.plate);
    press('[data-plate]', b);
    flow.send('pickPlate');
}));

document.querySelectorAll('[data-food]').forEach((b) => b.addEventListener('click', () => {
    hand.kind = 'food'; hand.id = b.dataset.food; hand.color = b.dataset.color ?? null;
    press('[data-food], [data-utensil]', b);
    status.hand = hand.color ? `${hand.color} sauce` : hand.id;
    flow.send('pickFood');
    updateUI();
}));

document.querySelectorAll('[data-utensil]').forEach((b) => b.addEventListener('click', () => {
    hand.kind = 'utensil'; hand.id = b.dataset.utensil; hand.color = null;
    press('[data-food], [data-utensil]', b);
    status.hand = hand.id;
    flow.send('pickUtensil');
    updateUI();
}));

document.getElementById('serve').addEventListener('click', () => flow.send('serve'));
document.getElementById('again').addEventListener('click', () => {
    document.querySelectorAll('[aria-pressed]').forEach((b) => b.setAttribute('aria-pressed', 'false'));
    hand.kind = hand.id = null;
    status.hand = '-';
    flow.send('again');
});
updateUI();

// "serve" = screenshot to gallery
function serve() {
    for (const c of Object.values(cards)) {
        c.visible = false;
        if (c.userData.shadow) c.userData.shadow.visible = false;
    }
    look.render(renderer, scene, camera); // snapshot keeps the photo filter
    // jpeg: smaller than png with grain, and a bit of compression fits the look
    const url = renderer.domElement.toDataURL('image/jpeg', 0.75);

    const img = document.getElementById('served-img');
    img.src = url;
    const what = used.size ? [...used].join(', ') : 'nothing';
    document.getElementById('served-caption').textContent =
        `Untitled (${what}), ${new Date().getFullYear()}. ${plate.def.label}, food.`;

    const thumb = new Image();
    thumb.src = url;
    document.getElementById('gallery').prepend(thumb);
    document.getElementById('served').hidden = false;
}

// ------------------------------------------------------------------
// pointer -> plate
// ------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = { inside: false, down: false, hit: null, lastUV: null, lastDir: new THREE.Vector2(1, 0) };

canvas.addEventListener('pointermove', (e) => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return; // hidden tab: avoid dividing by 0
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    parallax.setPointer(ndc.x, -ndc.y);
    pointer.inside = true;
});
canvas.addEventListener('pointerdown', (e) => {
    pointer.down = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    pointer.lastUV = null;
});
canvas.addEventListener('pointerup', () => { pointer.down = false; pointer.lastUV = null; });
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

const worldToUV = (r) => r / (2 * plate.def.innerR); // world radius -> uv radius

let spawnTimer = 0;

function interact(dt) {
    peas.u.pushOn.value = 0;
    peas.u.eraseOn.value = 0;
    peas.u.pointer.value.set(99, 99);

    const canPlay = flow.state === 'utensil' || flow.state === 'play';
    if (!plate || !canPlay || !pointer.inside) { pointer.hit = null; return; }

    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObject(plate.inner)[0] ?? null;
    pointer.hit = hit;
    if (!hit || !pointer.down || !hand.kind) { pointer.lastUV = null; return; }

    const uv = hit.uv.clone();
    const last = pointer.lastUV ?? uv;
    if (uv.distanceTo(last) > 1e-5) pointer.lastDir.subVectors(uv, last).normalize();
    peas.u.pointer.value.set(hit.point.x, hit.point.z);

    if (hand.kind === 'food' && hand.id === 'peas') {
        spawnTimer += dt;
        while (spawnTimer > 1 / 30) { peas.spawn(hit.point.x, hit.point.z, 3); spawnTimer -= 1 / 30; }
        used.add('peas');
    }

    if (hand.kind === 'food' && hand.id === 'sauce') {
        sauce.line(last, uv, {
            mode: 'paint',
            color: params.sauce.colors[hand.color],
            radius: worldToUV(params.sauce.brush),
            thickness: params.sauce.thickness,
        });
        used.add(hand.color);
    }

    if (hand.kind === 'utensil') {
        const { push, pushRadius } = params.peas;
        const tool = {
            //          push strength   push radius        what it does to sauce
            spoon: { push: push * 0.6, r: pushRadius * 1.4 },
            fork: { push: push * 1.2, r: pushRadius * 0.8, tines: 4 },
            knife: { push: push * 1.5, r: pushRadius * 0.35, cut: 0.008 },
            napkin: { push: 0, r: pushRadius * 1.6, wipe: 0.14, erase: true },
        }[hand.id];

        peas.u.pushOn.value = 1;
        peas.u.push.value = tool.push;
        peas.u.pushR.value = tool.r;
        peas.u.eraseOn.value = tool.erase ? 1 : 0;

        if (tool.tines) {
            // fork drags 4 grooves through the sauce
            const perp = new THREE.Vector2(-pointer.lastDir.y, pointer.lastDir.x);
            const gap = worldToUV(0.025);
            for (let i = 0; i < tool.tines; i++) {
                const o = perp.clone().multiplyScalar((i - 1.5) * gap);
                sauce.line(last.clone().add(o), uv.clone().add(o), { mode: 'erase', radius: worldToUV(0.007) });
            }
        }
        if (tool.cut) sauce.line(last, uv, { mode: 'erase', radius: worldToUV(tool.cut) });
        if (tool.wipe) sauce.line(last, uv, { mode: 'erase', radius: worldToUV(tool.wipe) });
    }

    pointer.lastUV = uv;
}

// the utensil image follows the pointer, hovering above the plate
const tmp = new THREE.Vector3();
const lightDir = new THREE.Vector3();
function updateCards(dt) {
    for (const [type, card] of Object.entries(cards)) {
        const shadow = card.userData.shadow;
        const show = Boolean(hand.kind === 'utensil' && hand.id === type && pointer.hit && flow.state !== 'served');
        card.visible = show;
        if (shadow) shadow.visible = show;
        if (!show) continue;

        const lift = pointer.down ? 0.04 : 0.3; // press down when clicking
        tmp.copy(pointer.hit.point);
        if (type !== 'napkin') tmp.z += 0.3; // hold it by the handle: tip at the cursor
        const groundY = tmp.y;
        tmp.y += lift;
        card.position.lerp(tmp, 1 - Math.exp(-18 * dt));
        card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, -pointer.lastDir.x * 0.3, 1 - Math.exp(-4 * dt));

        // shadow lands on the plate, pushed away from the light by the height
        // (only 2D cards have a fake shadow; 3D models cast real ones)
        if (!shadow) continue;
        const height = card.position.y - groundY;
        lightDir.copy(sun.position).normalize();
        shadow.position.set(
            card.position.x - lightDir.x / lightDir.y * height,
            groundY + 0.004,
            card.position.z - lightDir.z / lightDir.y * height,
        );
        shadow.rotation.copy(card.rotation);
        shadow.material.opacity = 0.28 - height * 0.4; // blurrier/lighter the higher it is
    }
}

// ------------------------------------------------------------------
// tweakpane + loop
// ------------------------------------------------------------------
const pane = createGui({ params, status, sauce });

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();
let soakTimer = 0;

function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);

    flow.update(dt);
    if (params.mood.enabled) mood.update(dt);
    else { peas.u.jitter.value = 0; peas.u.nudge.value.set(0, 0); }

    applyLight();
    parallax.update(dt, params.parallax.strength, params.parallax.smoothing);

    // copy slider values into the compute shader's uniforms
    peas.u.dt.value = dt;
    peas.u.friction.value = params.peas.friction;
    peas.u.radius.value = params.peas.size;
    peas.u.bowlPull.value = params.peas.bowlPull;
    peas.u.collide.value = params.peas.collide ? 1 : 0;
    peas.u.bounce.value = params.peas.bounce;
    peas.u.color.value.set(params.peas.color);
    peas.u.push.value = params.peas.push;
    peas.u.pushR.value = params.peas.pushRadius;

    interact(dt);
    updateCards(dt);

    // paper plate soaks up sauce over time
    if (plate?.def.soaks) {
        soakTimer += dt;
        if (soakTimer > 0.5) { sauce.soak(1); soakTimer = 0; }
    }
    sauce.update(params.sauce.normalStrength, params.sauce.gloss);

    peas.step(renderer);          // GPU physics
    look.render(renderer, scene, camera); // scene + photo filter
}
renderer.setAnimationLoop(frame);

// start with an empty dinner plate on the table (not selected yet)
setPlate('dinner');
void PLATE_TYPES;

// handy for poking at things from the browser console
window.food = { scene, camera, renderer, params, flow, mood, peas, sauce, cards, pointer, hand, frame, look };
