import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { params, status } from './params.js';
import { StateMachine, RandomMachine } from './stateMachine.js';
import { buildPlate } from './plates.js';
import { SaucePainter } from './sauce.js';
import { Peas } from './peas.js';
import { Parallax } from './parallax.js';
import { makeCard, drawUtensil } from './cards.js';
import { loadModels, geometryFromModel, hasNoMaterial } from './models.js';
import { createGui, loadPreset } from './gui.js';
import { Look } from './look.js';
import { createMetalTray } from './tray3d.js';
import { PlatePrint } from './intro.js';

// The room light: a 360° HDR photo of a real space. Both the table and
// the metal tray are lit by it. To swap it, shrink a Poly Haven HDRI to
// 512x256 (so it's ~400 KB, not 25 MB), put it in assets/hdri/ and change this.
//   'assets/hdri/monochrome_studio_02_512.hdr'  grey photo studio (current)
//   'assets/hdri/lebombo_512.hdr'               bright room with windows
const HDRI_URL = 'assets/hdri/monochrome_studio_02_512.hdr';

// The locked-in look: if final/assets/preset.json exists, its values
// replace the defaults in params.js for every visitor.
await loadPreset(params);

// ------------------------------------------------------------------
// WHICH MODE IS THIS? One codebase, one index.html, two modes:
//   final/              -> 'project'   (the ongoing final project)
//   final/?minigame     -> 'minigame'  (the mini game assignment;
//                                       final/minigame.html forwards here)
// Everything in js/*.js is SHARED by both. Mode-only code lives in
// js/project/ and js/minigame/ and plugs in through the `game` API at
// the bottom of this file.
// ------------------------------------------------------------------
const MODE = new URLSearchParams(location.search).has('minigame') ? 'minigame' : 'project';
document.body.dataset.mode = MODE; // lets style.css style each mode separately if needed
// the mini game can have its own saved look on top of the shared one
if (MODE === 'minigame') await loadPreset(params, 'assets/minigame/preset.json');

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
const badge = document.getElementById('badge');
badge.textContent = `rendering with ${status.backend}`;

// if the GPU gives up (e.g. a compute shader takes too long), say so on screen
renderer.onDeviceLost = (info) => {
    badge.textContent = `GPU device lost: ${info.message || info.reason || 'unknown'}. try turning off pea "collide"`;
};

// ------------------------------------------------------------------
// scene: a table in a bright room
// ------------------------------------------------------------------
const scene = new THREE.Scene();
scene.background = new THREE.Color('#e2ded5');

// The room light (HDRI_URL above). Every surface picks up soft light and
// reflections from it.
const hdri = await new HDRLoader().loadAsync(HDRI_URL);
hdri.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = hdri;

// looking straight down at the table, so the plate looks flat and round.
// a narrow lens (24°) from further away keeps perspective distortion low.
const camera = new THREE.PerspectiveCamera(24, window.innerWidth / window.innerHeight, 0.1, 50);
camera.up.set(0, 0, -1); // "up" on screen = away from you across the table
// aimed at the plate's centre, so the plate sits dead centre on screen
const parallax = new Parallax(camera, { target: new THREE.Vector3(0, 0, 0), distance: 6.4, tilt: 0.0001 });

// how far back the camera sits: as close as possible (big plate) while
// still showing the utensils on the right, whatever shape the window is
// (params.view.plateSize = how much of the screen's height the plate fills)
const RIGHT_EDGE = 1.93;    // the utensils reach this far right of the plate's centre
function fitCamera() {
    const halfFov = THREE.MathUtils.degToRad(camera.fov / 2);
    const forHeight = 1 / (params.view.plateSize * Math.tan(halfFov));  // plate radius is 1
    const forWidth = RIGHT_EDGE / (Math.tan(halfFov) * camera.aspect);  // keep utensils on screen
    parallax.base.radius = Math.max(forHeight, forWidth);
}
fitCamera();
const look = new Look(renderer, scene, camera, params.look);

// press F to flip the photo filter on/off (a mode can switch this key off
// with game.filterKey.enabled = false), Escape to put a utensil down
const filterKey = { enabled: true };
window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return; // typing in the panel
    if (e.key === 'f' && !e.metaKey && !e.ctrlKey && filterKey.enabled) {
        params.look.enabled = !params.look.enabled;
        pane.refresh();
        metalTray?.draw();
    }
    if (e.key === 'Escape') putDownUtensil();
    if (MOVE_KEYS[e.key]) {
        held.add(e.key);
        e.preventDefault();
        // step mode: each press (not the key's auto-repeat) tips one notch further
        if (params.controls.mode === 'step' && !e.repeat) stepTilt(TILT_KEYS[e.key]);
    }
    if (e.code === 'Space' && intro.running) { intro.skip(); e.preventDefault(); }
});
window.addEventListener('keyup', (e) => held.delete(e.key));
window.addEventListener('blur', () => held.clear());

// ------------------------------------------------------------------
// tilting the plate: the only thing that moves the scene is the player.
// Hold a key to tip the plate; let go and it settles back to level.
//   W / up arrow     tip the far edge down     S / down arrow   near edge down
//   A / left arrow   tip the left edge down    D / right arrow  right edge down
// Tip it far enough and the food slides and rolls off.
// ------------------------------------------------------------------
const TILT_KEYS = {
    //                [pitch (around x), roll (around z)]
    w: [-1, 0], W: [-1, 0], ArrowUp: [-1, 0],
    s: [1, 0], S: [1, 0], ArrowDown: [1, 0],
    a: [0, 1], A: [0, 1], ArrowLeft: [0, 1],
    d: [0, -1], D: [0, -1], ArrowRight: [0, -1],
};
const MOVE_KEYS = TILT_KEYS; // (keydown handler above checks this)
const held = new Set();
// speeds and limit come from params.controls (sliders in the panel)
const deg = THREE.MathUtils.degToRad;
const tiltAngles = new THREE.Vector2(); // x = pitch, y = roll
const tiltTarget = new THREE.Vector2(); // step mode: the angle the plate is heading to

// step mode (params.controls.mode = 'step'): every key press tips the plate
// one notch (stepDegrees) further that way, and it stays there.
// hold mode (the default): hold a key to tip, let go and it settles level.
function stepTilt([pitch, roll]) {
    const { stepDegrees, maxTilt } = params.controls;
    const clampTilt = (a) => THREE.MathUtils.clamp(a, -deg(maxTilt), deg(maxTilt));
    tiltTarget.x = clampTilt(tiltTarget.x + pitch * deg(stepDegrees));
    tiltTarget.y = clampTilt(tiltTarget.y + roll * deg(stepDegrees));
}

// put the plate back to level straight away (the mini game does this on restart)
function resetTilt() {
    tiltAngles.set(0, 0);
    tiltTarget.set(0, 0);
}

// copy the panel's "plate material" settings onto the current plate
// (only its own built-in ceramic: a material made in Blender is kept as is)
function applyPlateMaterial() {
    if (!plate) return;
    const s = params.plates[plate.type];
    const m = plate.bodyMat;
    m.color.set(s.color);
    m.roughness = s.roughness;
    m.clearcoat = Math.max(s.glaze, 0.0001); // never exactly 0, so the shader doesn't rebuild
    m.clearcoatRoughness = s.glazeRoughness;
}

function tiltPlate(dt) {
    const input = new THREE.Vector2();
    for (const k of held) input.add(new THREE.Vector2(...TILT_KEYS[k]));
    if (params.controls.mode === 'step') {
        // ease toward the notch the key presses have set
        const maxStep = deg(params.controls.tiltSpeed) * dt;
        for (const i of [0, 1]) {
            const a = tiltAngles.getComponent(i);
            const d = tiltTarget.getComponent(i) - a;
            tiltAngles.setComponent(i, a + Math.sign(d) * Math.min(Math.abs(d), maxStep));
        }
    } else for (const i of [0, 1]) {
        const want = input.getComponent(i);
        let a = tiltAngles.getComponent(i);
        const { tiltSpeed, settleSpeed, maxTilt } = params.controls;
        if (want !== 0) {
            // tipping back the other way is extra snappy: the settle speed
            // helps it through level
            const reversing = a !== 0 && Math.sign(want) !== Math.sign(a);
            a += Math.sign(want) * deg(tiltSpeed + (reversing ? settleSpeed : 0)) * dt;
        } else {
            a -= Math.sign(a) * Math.min(Math.abs(a), deg(settleSpeed) * dt); // settle back to level
        }
        tiltAngles.setComponent(i, THREE.MathUtils.clamp(a, -deg(maxTilt), deg(maxTilt)));
    }
    // tip around the centre, then lift so the lowest edge rests on the table
    const lift = (plate?.radius ?? 1) * Math.sin(Math.min(Math.hypot(tiltAngles.x, tiltAngles.y), Math.PI / 2));
    if (plate) {
        plate.tilt.rotation.set(tiltAngles.x, 0, tiltAngles.y);
        plate.tilt.position.y = lift;
        plate.group.updateMatrixWorld(); // so clicks hit it where it is now
    }
    // the pea physics tilts its copy of the surface the same way:
    // height changes by sin(roll) per unit of x and -sin(pitch) per unit of z
    peas.u.plateCenter.value.set(0, lift, 0);
    peas.u.tiltSlope.value.set(Math.sin(tiltAngles.y), -Math.sin(tiltAngles.x));
}

const table = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30).rotateX(-Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: '#e2ded5', roughness: 1 }),
);
table.receiveShadow = true;
scene.add(table);

// a soft "window" light, only there so food casts shadows.
// (the HDRI does the actual lighting; set "shadow light" to 0 to remove it)
const windowLight = new THREE.DirectionalLight('#fffaf0', 0.8);
windowLight.castShadow = true;
windowLight.shadow.mapSize.set(2048, 2048);
windowLight.shadow.camera.left = windowLight.shadow.camera.bottom = -2.6;
windowLight.shadow.camera.right = windowLight.shadow.camera.top = 2.6;
windowLight.shadow.bias = -0.0005;
windowLight.shadow.radius = 4;
scene.add(windowLight);

// the spotlight hanging over the plate: a soft-edged pool of light on the
// plate, falling off into shadow toward the edges of the table
const spot = new THREE.SpotLight('#fff6e8');
spot.castShadow = true;
spot.decay = 0;                 // same brightness however high it hangs
spot.shadow.mapSize.set(2048, 2048);
spot.shadow.bias = -0.0004;
spot.shadow.radius = 6;
spot.target.position.set(0, 0, 0);
scene.add(spot, spot.target);

function applyLight() {
    const s = params.light.spot;
    // hang it a little off to one side (north = the far side of the table)
    // and aim it back at the plate, so it shines in at a slight angle
    const lean = Math.tan(THREE.MathUtils.degToRad(s.tilt)) * s.height;
    const dir = THREE.MathUtils.degToRad(s.direction);
    spot.position.set(Math.sin(dir) * lean, s.height, -Math.cos(dir) * lean);
    spot.intensity = s.intensity;
    spot.angle = THREE.MathUtils.degToRad(s.angle);
    spot.penumbra = s.softness;
    const az = THREE.MathUtils.degToRad(params.light.azimuth);
    const el = THREE.MathUtils.degToRad(params.light.elevation);
    windowLight.position.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).multiplyScalar(5);
    windowLight.intensity = params.light.shadowLight;
    windowLight.castShadow = params.light.shadowLight > 0;
    scene.environmentIntensity = params.light.hdri;
    scene.environmentRotation.y = THREE.MathUtils.degToRad(params.light.hdriRotation);
    renderer.toneMappingExposure = params.light.exposure;
}

// ------------------------------------------------------------------
// food + plate
// ------------------------------------------------------------------
const sauce = new SaucePainter();
const peas = new Peas(4000);
scene.add(peas.mesh);

let plate = null;
const intro = new PlatePrint(); // the instructions printed on the plate at the start
const used = new Set(); // what's on the plate, for the gallery caption

// your Blender models (js/models.js). Missing ones keep the placeholders.
const { models, problems } = await loadModels();
if (problems.length) badge.textContent += ` · could not load: ${problems.join(', ')}`;

// a modelled pea replaces the plain sphere
if (models.pea) {
    const pea = geometryFromModel(models.pea);
    if (pea) peas.setGeometry(pea.geometry);
}

function setPlate(type) {
    if (plate) { scene.remove(plate.group); plate.dispose(); }
    plate = buildPlate(type, sauce, models[type]?.clone());
    scene.add(plate.group);
    if (intro.running) intro.attach(plate); // keep the print on whichever plate is out
    if (plate.holePatched && !badge.textContent.includes('hole')) {
        badge.textContent += ` · the ${type} model has a hole in the middle (patched for now; fill it in Blender)`;
    }
    sauce.reset(plate.def.color, plate.def.roughness);
    peas.setPlate(plate);
    peas.reset(renderer);
    used.clear();
}

// ------------------------------------------------------------------
// utensils: objects lying on the table to the right of the plate.
// click one to pick it up, click the table on the right (or Escape)
// to put it back.
// ------------------------------------------------------------------
const REST = {
    // where each utensil lies to the right of the plate (the plate is
    // 2 units across). knife and napkin are kept for when you add yours.
    fork: { pos: new THREE.Vector3(1.3, 0.005, 0.03), rotY: -0.03 },
    spoon: { pos: new THREE.Vector3(1.62, 0.005, 0.03), rotY: -0.05 },
    knife: { pos: new THREE.Vector3(1.8, 0.005, 0.06), rotY: 0.02 },
    napkin: { pos: new THREE.Vector3(1.42, 0.002, 0.05), rotY: 0.04 },
};
const UTENSIL_WIDTH = 0.24; // 2D placeholder card width (if a model is missing)
const NAPKIN_WIDTH = 0.66;
// the utensils on the table. Add 'knife' / 'napkin' back here when you
// have models for them (and list the files in js/models.js)
const UTENSILS = ['fork', 'spoon'];
const UTENSIL_HALF_LENGTH = 0.72; // models are 1.6 long (fit in models.js); tip sits a bit in from the end

// polished steel for utensil models that have no material from Blender.
// double-sided, because a flat cut-out (like fork1) has only one face.
// colour/roughness come from params.steel, shared with the tray
const steel = new THREE.MeshPhysicalMaterial({
    color: params.steel.color, metalness: 1, roughness: params.steel.roughness, side: THREE.DoubleSide,
});
function applySteel() {
    steel.color.set(params.steel.color);
    steel.roughness = params.steel.roughness;
}

const cards = {};
for (const type of UTENSILS) {
    cards[type] = makeCard(drawUtensil(type), {
        width: type === 'napkin' ? NAPKIN_WIDTH : UTENSIL_WIDTH,
        metalness: type === 'napkin' ? 0 : 0.6,
        roughness: type === 'napkin' ? 0.9 : 0.3,
    });
    // a Blender model replaces the 2D card. Real 3D casts real shadows,
    // so it doesn't need the fake drop shadow.
    if (models[type]) {
        cards[type] = models[type];
        cards[type].userData.shadow = null;
        cards[type].traverse((o) => { if (o.isMesh && hasNoMaterial(o)) o.material = steel; });
    }
    const card = cards[type];
    card.position.copy(REST[type].pos);
    card.rotation.y = REST[type].rotY;
    card.traverse((o) => { o.userData.utensil = type; }); // so a click knows what it hit
    scene.add(card);
    if (card.userData.shadow) scene.add(card.userData.shadow);
}

// what the player is holding
const hand = { kind: null, id: null, color: null };

// ------------------------------------------------------------------
// STATE MACHINE 1: game flow  plate > food > utensil > play > served
// ------------------------------------------------------------------
const PROMPTS = {
    plate: 'pick a plate.',
    food: 'pick a food.',
    utensil: 'pick up a utensil from the right.',
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
    utensil: ['plate', 'food'],
    play: ['plate', 'food', 'serve'],
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
            },
            exit: () => peas.u.nudge.value.set(0, 0),
        },
    },
});
mood.onChange((state) => { status.mood = state; });

// ------------------------------------------------------------------
// the tray: click it (anywhere that isn't a button) to open / close
// ------------------------------------------------------------------
const tray = document.getElementById('tray');
function toggleTray(open = !tray.classList.contains('open')) {
    tray.classList.toggle('open', open);
}
tray.addEventListener('click', (e) => {
    if (e.target.closest('button')) return; // a food/plate button
    toggleTray();
});

// open the tray as wide as possible without covering the plate
const restCam = new THREE.PerspectiveCamera();
function fitTray() {
    restCam.copy(camera);
    parallax.restPose(restCam);
    const r = plate ? plate.radius : 1;
    const edge = new THREE.Vector3(-r - 0.06, 0.1, 0).project(restCam);
    const px = (edge.x * 0.5 + 0.5) * window.innerWidth;
    const width = THREE.MathUtils.clamp(px - 16 - 16, 180, 340);
    tray.style.setProperty('--open', `${width}px`);
}

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
    press('[data-food]', b);
    status.hand = hand.color ? `${hand.color} sauce` : hand.id;
    flow.send('pickFood');
    updateUI();
}));

function takeUtensil(type) {
    if (!flow.can('pickUtensil')) return; // pick a plate and food first
    hand.kind = 'utensil'; hand.id = type; hand.color = null;
    press('[data-food]', null);
    status.hand = type;
    flow.send('pickUtensil');
    updateUI();
}

function putDownUtensil() {
    if (hand.kind !== 'utensil') return;
    hand.kind = hand.id = null;
    status.hand = '-';
    updateUI();
}

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
// pointer -> plate / table / utensils
// ------------------------------------------------------------------
const raycaster = new THREE.Raycaster();
const ndc = new THREE.Vector2();
const pointer = {
    inside: false, down: false, hit: null, lastUV: null, lastDir: new THREE.Vector2(1, 0),
    lastXZ: null, vel: new THREE.Vector2(),
};

function setNdc(e) {
    const rect = canvas.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false; // hidden tab: avoid dividing by 0
    ndc.set(((e.clientX - rect.left) / rect.width) * 2 - 1, -((e.clientY - rect.top) / rect.height) * 2 + 1);
    return true;
}

// which resting utensil (if any) is under the pointer
function utensilUnderPointer() {
    raycaster.setFromCamera(ndc, camera);
    const resting = UTENSILS.filter((t) => !(hand.kind === 'utensil' && hand.id === t)).map((t) => cards[t]);
    const hit = raycaster.intersectObjects(resting, true)[0];
    return hit ? hit.object.userData.utensil : null;
}

canvas.addEventListener('pointermove', (e) => {
    if (!setNdc(e)) return;
    pointer.inside = true;
});
canvas.addEventListener('pointerdown', (e) => {
    if (!setNdc(e)) return;
    // clicking a utensil on the table picks it up (no stroke)
    const t = utensilUnderPointer();
    if (t) { takeUtensil(t); return; }
    // clicking the table to the right of the plate puts the utensil back
    if (hand.kind === 'utensil' && pointer.hit?.object === table && pointer.hit.point.x > (plate?.radius ?? 1) + 0.2) {
        putDownUtensil();
        return;
    }
    pointer.down = true;
    try { canvas.setPointerCapture(e.pointerId); } catch { /* not a real pointer */ }
    pointer.lastUV = null;
});
canvas.addEventListener('pointerup', () => { pointer.down = false; pointer.lastUV = null; });
canvas.addEventListener('pointerleave', () => { pointer.inside = false; });

const worldToUV = (r) => r / (2 * plate.radius); // world radius -> sauce-layer uv radius

let spawnTimer = 0;

function interact(dt) {
    peas.u.pushOn.value = 0;
    peas.u.eraseOn.value = 0;
    peas.u.paintOn.value = 0;
    peas.u.pointer.value.set(99, 99);

    if (!plate || !pointer.inside || flow.state === 'served') { pointer.hit = null; return; }

    // what's under the pointer: the plate's sauce layer, or the table
    raycaster.setFromCamera(ndc, camera);
    const hit = raycaster.intersectObjects([plate.decal, table], false)[0] ?? null;
    pointer.hit = hit;

    // hover feedback: grab cursor over a utensil you can pick up
    canvas.style.cursor = hand.kind === 'utensil' ? 'grabbing' : (utensilUnderPointer() ? 'grab' : '');

    // utensil speed (for flicking food), smoothed
    if (hit) {
        const xz = new THREE.Vector2(hit.point.x, hit.point.z);
        if (pointer.lastXZ) pointer.vel.lerp(xz.clone().sub(pointer.lastXZ).divideScalar(Math.max(dt, 1e-3)), 0.5);
        pointer.lastXZ = xz;
    } else {
        pointer.lastXZ = null;
        pointer.vel.set(0, 0);
    }

    const canPlay = flow.state === 'utensil' || flow.state === 'play';
    if (!hit || !canPlay || !pointer.down || !hand.kind) { pointer.lastUV = null; return; }

    const onPlate = hit.object === plate.decal;
    peas.u.pointer.value.set(hit.point.x, hit.point.z);
    peas.u.pointerVel.value.copy(pointer.vel);

    if (hand.kind === 'food' && hand.id === 'peas') {
        spawnTimer += dt;
        while (spawnTimer > 1 / 30) { peas.spawn(hit.point.x, hit.point.z, 3); spawnTimer -= 1 / 30; }
        used.add('peas');
    }

    // sauce paints only on the plate (uv = position on the sauce layer)
    if (!onPlate) { pointer.lastUV = null; }
    const uv = onPlate ? hit.uv.clone() : null;
    const last = pointer.lastUV ?? uv;
    if (uv && uv.distanceTo(last) > 1e-5) pointer.lastDir.subVectors(uv, last).normalize();

    if (hand.kind === 'food' && hand.id === 'sauce' && uv) {
        const color = params.sauce.colors[hand.color];
        sauce.line(last, uv, {
            mode: 'paint', color,
            radius: worldToUV(params.sauce.brush),
            thickness: params.sauce.thickness,
        });
        // layering: sauce painted over peas coats them
        peas.u.paintOn.value = 1;
        peas.u.paintPos.value.set(hit.point.x, hit.point.z);
        peas.u.paintR.value = params.sauce.brush;
        peas.u.paintColor.value.set(color);
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

        if (uv) {
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
    }

    pointer.lastUV = uv;
}

// utensils: the one in your hand follows the pointer, the rest lie on the table
const tmp = new THREE.Vector3();
const lightDir = new THREE.Vector3();
function updateCards(dt) {
    for (const type of UTENSILS) {
        const card = cards[type];
        const shadow = card.userData.shadow;
        const held = hand.kind === 'utensil' && hand.id === type && flow.state !== 'served';
        let groundY = REST[type].pos.y - 0.01;
        let rotY = REST[type].rotY;

        if (held && pointer.hit) {
            const lift = pointer.down ? 0.04 : 0.3; // press down when clicking
            tmp.copy(pointer.hit.point);
            // hold it by the handle: tip at the cursor (half its length back)
            if (type !== 'napkin') tmp.z += UTENSIL_HALF_LENGTH;
            groundY = tmp.y;
            tmp.y += lift;
            rotY = -pointer.lastDir.x * 0.3;
        } else if (held) {
            tmp.copy(card.position); // pointer is off the table: stay put
            groundY = 0;
        } else {
            tmp.copy(REST[type].pos);
        }
        card.position.lerp(tmp, 1 - Math.exp(-(held ? 18 : 10) * dt));
        card.rotation.y = THREE.MathUtils.lerp(card.rotation.y, rotY, 1 - Math.exp(-6 * dt));

        // fake shadow for 2D cards, pushed away from the window light by
        // the height (3D models cast real ones)
        if (!shadow) continue;
        const height = Math.max(card.position.y - groundY, 0);
        lightDir.copy(windowLight.position).normalize();
        shadow.position.set(
            card.position.x - lightDir.x / lightDir.y * height,
            groundY + 0.004,
            card.position.z - lightDir.z / lightDir.y * height,
        );
        shadow.rotation.copy(card.rotation);
        shadow.material.opacity = Math.max(0.28 - height * 0.4, 0.05); // lighter the higher it is
    }
}

// ------------------------------------------------------------------
// tweakpane + loop
// ------------------------------------------------------------------
let metalTray = null; // set once the tray's 3D render has started
const pane = createGui({
    params, status, sauce,
    onTrayChange: () => { metalTray?.updateRim(); metalTray?.updateLighting(); },
    onLightChange: () => metalTray?.updateLighting(),
    onSteelChange: () => metalTray?.updateMaterial(),
    onViewChange: () => { fitCamera(); fitTray(); },
});
// any panel change (the photo filter included) redraws the tray
pane.on('change', () => metalTray?.draw());

window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    fitCamera();
    fitTray();
});

const clock = new THREE.Clock();
let soakTimer = 0;

// mode code can run something every frame: game.onFrame((dt) => { ... })
const frameHooks = [];

function frame() {
    const dt = Math.min(clock.getDelta(), 1 / 30);
    for (const hook of frameHooks) hook(dt);

    flow.update(dt);
    if (params.mood.enabled) mood.update(dt);
    else { peas.u.jitter.value = 0; peas.u.nudge.value.set(0, 0); }

    applyLight();
    // the camera stays put: no mouse sway, no shake. Only the player moves
    // things (the plate, with the keyboard)
    parallax.update(dt, 0, 1);

    // copy slider values into the compute shader's uniforms
    peas.u.dt.value = dt;
    peas.u.damping.value = params.peas.damping;
    peas.u.gravity.value = params.peas.gravity;
    peas.u.radius.value = params.peas.size;
    peas.u.drag.value = params.peas.drag;
    peas.u.collide.value = params.peas.collide ? 1 : 0;
    peas.u.stiffness.value = params.peas.stiffness;
    peas.u.color.value.set(params.peas.color);
    peas.u.push.value = params.peas.push;
    peas.u.pushR.value = params.peas.pushRadius;

    tiltPlate(dt);
    intro.update(dt);
    applyPlateMaterial();
    applySteel();
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
    metalTray?.tick();                    // the tray's grain flickers along
}
renderer.setAnimationLoop(frame);

// start with an empty dinner plate on the table (not selected yet),
// with the instructions printed on it
setPlate('dinner');
intro.attach(plate); // (it starts below, once the mode code has had a chance to add slides)
// size the tray once (and again only if the window changes size), so it
// never jumps around while you play
fitTray();

// the tray's polished metal (a small 3D render behind the buttons).
// if it can't start, fall back to a plain silver colour
createMetalTray(tray, HDRI_URL, params.tray, params.light, params.steel, params.look).then((t) => { metalTray = t; }).catch((err) => {
    console.warn('metal tray could not start', err);
    tray.style.background = '#c9ccd0';
});

// ------------------------------------------------------------------
// THE GAME API: what mode code (js/project/, js/minigame/) can use.
// Add to this when a mode needs something new from the shared scene.
// ------------------------------------------------------------------
const game = {
    MODE, THREE, scene, camera, renderer, params, status, flow, mood, peas, sauce, pane,
    cards, pointer, hand, intro, table, look, parallax,
    get plate() { return plate; },
    setPlate,
    resetTilt,
    filterKey,
    onFrame: (fn) => frameHooks.push(fn),
    setPrompt: (text) => { document.getElementById('prompt').textContent = text; },
};

// load this page's mode code
if (MODE === 'minigame') (await import('./minigame/game.js')).start(game);
else (await import('./project/project.js')).start(game);

// now play the intro slides (modes may have added some)
intro.start();

// handy for poking at things from the browser console
window.food = { ...game, frame, get plate() { return plate; }, get metalTray() { return metalTray; }, toggleTray };
