import * as THREE from 'three/webgpu';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { imageToNormalMap } from './normalmap.js';
import { Look } from './look.js';

// The instrument tray as real polished metal.
//
// A web page can't reflect anything with CSS, so the tray surface is a
// small 3D render behind the buttons: a flat metal plane lit by the same
// room photo (HDRI) as the table. Its normal map is flat except for a
// thin raised lip at the edge, which catches the light as a rim.
// The reflections only move while the tray slides in or out.
// The panel's light settings (room brightness and rotation, exposure,
// spotlight, window light) light the tray too, so it matches the table.

// settings = { rimDepth, rimWidth } (params.tray), editable in the panel
// light = params.light (the same object the table's lights read)
// steel = params.steel (the same metal as the fork and spoon)
// lookSettings = params.look (the photo filter), so the tray gets the same
// grain, colour toning, blur, ink and paper tint as the table
export async function createMetalTray(tray, hdriUrl, settings = { rimDepth: 1.2, rimWidth: 3 }, light = null, steel = { color: '#d4d7db', roughness: 0.22 }, lookSettings = null) {
    const canvas = document.createElement('canvas');
    canvas.id = 'tray-metal';
    tray.prepend(canvas);

    const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
    await renderer.init();
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.1;

    const scene = new THREE.Scene();
    const hdri = await new HDRLoader().loadAsync(hdriUrl);
    hdri.mapping = THREE.EquirectangularReflectionMapping;
    scene.environment = hdri;
    scene.background = new THREE.Color('#9a9ea3');

    // a perspective camera (in pixel units) so each part of the tray
    // reflects a different part of the room, like a real mirror. (a flat
    // camera would reflect the same spot everywhere: one flat colour)
    const FOV = 45;
    const camera = new THREE.PerspectiveCamera(FOV, 1, 1, 20000);

    // the same polished steel as the fork and spoon
    const material = new THREE.MeshPhysicalMaterial({
        color: steel.color,
        metalness: 1,
        roughness: steel.roughness,
    });
    function applySteel() {
        material.color.set(steel.color);
        material.roughness = steel.roughness;
    }
    // a flat plane facing the camera, exactly the size of the tray
    const mesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    scene.add(mesh);

    // the same lights as the table: a spotlight shining down onto the tray
    // from above and in front (it shows as a soft sheen on the metal), and
    // the side window light
    const spot = new THREE.SpotLight('#fff6e8');
    spot.decay = 0;
    scene.add(spot, spot.target);
    const windowLight = new THREE.DirectionalLight('#fffaf0');
    scene.add(windowLight, windowLight.target);

    // copy the panel's light settings onto the tray's scene
    function applyLighting() {
        if (!light) return;
        const h = tray.clientHeight || 600;
        // exactly the table's room light and exposure, so the tray's steel
        // matches the fork and spoon
        scene.environmentIntensity = light.hdri;
        renderer.toneMappingExposure = light.exposure;
        // spotlight: hangs in front of the tray, near the top, pointing in
        spot.intensity = light.spot.intensity;
        spot.angle = THREE.MathUtils.degToRad(Math.min(light.spot.angle * 1.6, 80));
        spot.penumbra = light.spot.softness;
        spot.position.set(0, h * 0.35, camera.position.z * (0.25 + light.spot.height * 0.08));
        spot.target.position.set(0, 0, 0);
        // window light: same direction as on the table
        const az = THREE.MathUtils.degToRad(light.azimuth);
        const el = THREE.MathUtils.degToRad(light.elevation);
        windowLight.intensity = light.shadowLight;
        windowLight.position.set(Math.sin(az), Math.sin(el), Math.cos(el)).multiplyScalar(1000);
    }

    // the normal map: flat everywhere, except a thin raised lip right at
    // the rectangle's edge that catches the light like a rim.
    // (height map: a soft white band along the border, nothing inside)
    function rimNormalMap(w, h) {
        const c = document.createElement('canvas');
        const s = 0.5; // half resolution is plenty for a soft lip
        c.width = Math.max(8, Math.round(w * s));
        c.height = Math.max(8, Math.round(h * s));
        const g = c.getContext('2d');
        const lip = settings.rimWidth * s; // how far in from the edge the rise goes
        g.filter = `blur(${lip * 0.6}px)`;
        g.strokeStyle = '#fff';
        g.lineWidth = lip * 2; // centred on the edge, so half of it is inside
        g.strokeRect(0, 0, c.width, c.height);
        // rimDepth = how steep the lip is: lower = shallower
        return new THREE.CanvasTexture(imageToNormalMap(c, settings.rimDepth, 1));
    }

    function resize() {
        const w = tray.clientWidth;
        const h = tray.clientHeight;
        if (!w || !h) return;
        renderer.setSize(w, h, false);
        // back the camera off until the tray's height exactly fills the view
        camera.aspect = w / h;
        camera.position.z = (h / 2) / Math.tan(THREE.MathUtils.degToRad(FOV / 2));
        camera.updateProjectionMatrix();
        mesh.scale.set(w, h, 1);
        material.normalMap?.dispose();
        material.normalMap = rimNormalMap(w, h);
        material.needsUpdate = true;
        lightForSlide();
    }

    let TRAY_TILT = -Math.PI / 2;

    // the same photo filter as the table. The vignette is left off here:
    // it darkens the corners of whatever it draws, and the tray's corners
    // aren't the screen's corners.
    const trayLook = lookSettings
        ? new Look(renderer, scene, camera, new Proxy(lookSettings, {
            get: (target, key) => (key === 'vignette' ? 0 : target[key]),
        }))
        : null;
    function render() {
        if (trayLook) trayLook.render(renderer, scene, camera);
        else renderer.render(scene, camera);
    }

    // only render when something changes (it's a still image otherwise)
    let queued = false;
    function draw() {
        if (queued) return;
        queued = true;
        requestAnimationFrame(() => { queued = false; render(); });
    }

    // the reflections shift only while the tray slides in or out: the
    // room turns with the tray's position, as if the light moves across
    // the metal as it travels. Otherwise the lighting stays still.
    function lightForSlide() {
        const x = tray.getBoundingClientRect().left; // ~16 open, very negative closed
        const roomTurn = light ? THREE.MathUtils.degToRad(light.hdriRotation) : 0;
        // TRAY_TILT turns the room so the tray (which faces you) reflects the
        // ceiling, the same part of the room the fork and spoon reflect
        // lying flat under a camera that looks straight down
        scene.environmentRotation.set(TRAY_TILT, x * 0.004 + roomTurn, 0);
        applyLighting();
        applySteel();
        draw();
    }
    let sliding = false;
    function followSlide() {
        lightForSlide();
        if (sliding) requestAnimationFrame(followSlide);
    }
    tray.addEventListener('transitionrun', () => { if (!sliding) { sliding = true; followSlide(); } });
    tray.addEventListener('transitionend', () => { sliding = false; lightForSlide(); });

    new ResizeObserver(resize).observe(tray);
    resize();

    // call after changing settings.rimDepth / rimWidth
    function updateRim() { resize(); }
    // call after changing any light setting in the panel
    function updateLighting() { lightForSlide(); }
    // call after changing the steel colour / roughness
    function updateMaterial() { lightForSlide(); }

    // called every frame by main.js: while the filter is on, the tray is
    // redrawn so its film grain flickers along with the table's
    function tick() {
        if (lookSettings?.enabled && lookSettings.grain > 0) render();
    }

    return { renderer, scene, draw, tick, updateRim, updateLighting, updateMaterial, setTilt: (a) => { TRAY_TILT = a; lightForSlide(); } };
}
