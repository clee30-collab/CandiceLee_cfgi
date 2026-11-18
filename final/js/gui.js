import { Pane } from '../lib/tweakpane-4.0.5.min.js';

// Tweakpane = a panel of sliders bound to the params object.
// Use it as your "asset workshop": tune how a food looks/behaves,
// then export the values as a JSON preset (or bake the sauce normal
// map to a PNG) and keep it in /final/assets.

function download(filename, blobOrUrl) {
    const a = document.createElement('a');
    a.href = typeof blobOrUrl === 'string' ? blobOrUrl : URL.createObjectURL(blobOrUrl);
    a.download = filename;
    a.click();
}

export function createGui({ params, status, sauce, onTrayChange = () => {}, onLightChange = () => {}, onViewChange = () => {}, onSteelChange = () => {} }) {
    const pane = new Pane({ title: 'controls', container: document.getElementById('pane'), expanded: false });
    const tabs = pane.addTab({ pages: [{ title: 'kitchen' }, { title: 'look' }] });
    const kitchen = tabs.pages[0];
    const look = tabs.pages[1];

    const light = kitchen.addFolder({ title: 'light' });
    light.on('change', () => onLightChange()); // the tray is lit by these too
    light.addBinding(params.light, 'hdri', { label: 'room (hdri)', min: 0, max: 3 });
    light.addBinding(params.light, 'hdriRotation', { label: 'room rotation', min: 0, max: 360 });
    light.addBinding(params.light.spot, 'intensity', { label: 'spotlight', min: 0, max: 20 });
    light.addBinding(params.light.spot, 'angle', { label: 'spot size', min: 5, max: 60 });
    light.addBinding(params.light.spot, 'softness', { label: 'spot softness', min: 0, max: 1 });
    light.addBinding(params.light.spot, 'height', { label: 'spot height', min: 1.5, max: 8 });
    light.addBinding(params.light.spot, 'tilt', { label: 'spot tilt', min: 0, max: 45 });
    light.addBinding(params.light.spot, 'direction', { label: 'spot from (0=N)', min: 0, max: 360 });
    light.addBinding(params.light, 'shadowLight', { label: 'window light', min: 0, max: 4 });
    light.addBinding(params.light, 'azimuth', { label: 'window azimuth', min: -180, max: 180 });
    light.addBinding(params.light, 'elevation', { label: 'window elevation', min: 5, max: 89 });
    light.addBinding(params.light, 'exposure', { min: 0.3, max: 2 });


    const s = kitchen.addFolder({ title: 'sauce', expanded: false });
    s.addBinding(params.sauce, 'brush', { min: 0.02, max: 0.2 });
    s.addBinding(params.sauce, 'thickness', { min: 0.05, max: 1 });
    s.addBinding(params.sauce, 'normalStrength', { label: 'normal map', min: 0, max: 10 });
    s.addBinding(params.sauce, 'gloss', { min: 0, max: 1 });
    s.addBinding(params.sauce.colors, 'ketchup');
    s.addBinding(params.sauce.colors, 'mustard');
    s.addBinding(params.sauce.colors, 'pesto');

    const p = kitchen.addFolder({ title: 'peas (compute shader)', expanded: false });
    p.addBinding(params.peas, 'color');
    p.addBinding(params.peas, 'size', { min: 0.015, max: 0.06 });
    p.addBinding(params.peas, 'damping', { min: 0, max: 15 });
    p.addBinding(params.peas, 'gravity', { min: 0, max: 30 });
    p.addBinding(params.peas, 'push', { min: 0, max: 30 });
    p.addBinding(params.peas, 'pushRadius', { min: 0.05, max: 0.5 });
    p.addBinding(params.peas, 'drag', { label: 'utensil drag', min: 0, max: 60 });
    p.addBinding(params.peas, 'collide');
    p.addBinding(params.peas, 'stiffness', { min: 0, max: 30 });

    const m = kitchen.addFolder({ title: 'mood (state machine)', expanded: false });
    m.addBinding(params.mood, 'enabled');
    m.addBinding(params.mood, 'jitter', { min: 0, max: 3 });
    m.addBinding(params.mood, 'nudge', { min: 0, max: 6 });
    m.addBinding(status, 'mood', { readonly: true });

    const st = kitchen.addFolder({ title: 'status' });
    st.addBinding(status, 'flow', { readonly: true });
    st.addBinding(status, 'hand', { readonly: true });
    st.addBinding(status, 'backend', { readonly: true });

    // ---- look tab: the photo filter (js/look.js) ----
    const L = params.look;
    look.addBinding(L, 'enabled', { label: 'filter on' });
    look.addBinding(L, 'opacity', { label: 'filter opacity', min: 0, max: 1 });
    const tone = look.addFolder({ title: 'color' });
    tone.addBinding(L, 'shadows');
    tone.addBinding(L, 'highlights');
    tone.addBinding(L, 'shadowAmount', { label: 'shadow tint', min: 0, max: 2 });
    tone.addBinding(L, 'highlightAmount', { label: 'highlight tint', min: 0, max: 2 });
    tone.addBinding(L, 'fade', { label: 'faded blacks', min: 0, max: 0.3 });
    tone.addBinding(L, 'contrast', { min: 0.5, max: 1.5 });
    tone.addBinding(L, 'saturation', { min: 0, max: 1.5 });
    const lofi = look.addFolder({ title: 'low quality' });
    lofi.addBinding(L, 'resolution', { min: 0.15, max: 1 });
    lofi.addBinding(L, 'blur', { label: 'gaussian blur', min: 0, max: 4 });
    lofi.addBinding(L, 'levels', { label: 'color steps', min: 8, max: 255, step: 1 });
    lofi.addBinding(L, 'grain', { min: 0, max: 0.3 });
    lofi.addBinding(L, 'grainSize', { label: 'grain size', min: 1, max: 4 });
    lofi.addBinding(L, 'vignette', { min: 0, max: 1 });
    const paint = look.addFolder({ title: 'paint (shadertoy)' });
    paint.addBinding(L.paint, 'wobble', { min: 0, max: 8 });
    paint.addBinding(L.paint, 'rowJitter', { label: 'row jitter', min: 0, max: 6 });
    paint.addBinding(L.paint, 'ink', { label: 'ink edges', min: 0, max: 1 });
    paint.addBinding(L.paint, 'inkWidth', { label: 'ink width', min: 0.5, max: 5 });
    paint.addBinding(L.paint, 'inkThreshold', { label: 'ink threshold', min: 0, max: 0.2 });
    paint.addBinding(L.paint, 'inkColor', { label: 'ink color' });
    paint.addBinding(L.paint, 'paper', { min: 0, max: 1 });
    paint.addBinding(L.paint, 'paperColor', { label: 'paper color' });

    // ---- asset tools ----
    // the ceramic for each plate: colour, how matte the body is, and the
    // clear glaze on top
    const mat = kitchen.addFolder({ title: 'plate material', expanded: false });
    for (const [type, label] of [['dinner', 'dinner plate'], ['bowl', 'bowl'], ['paper', 'paper plate']]) {
        const f = mat.addFolder({ title: label, expanded: type === 'dinner' });
        f.addBinding(params.plates[type], 'color');
        f.addBinding(params.plates[type], 'roughness', { label: 'body roughness', min: 0, max: 1 });
        f.addBinding(params.plates[type], 'glaze', { min: 0, max: 1 });
        f.addBinding(params.plates[type], 'glazeRoughness', { label: 'glaze roughness', min: 0, max: 1 });
    }

    const view = kitchen.addFolder({ title: 'view', expanded: false });
    view.addBinding(params.view, 'plateSize', { label: 'plate size', min: 0.4, max: 1.2 });
    view.on('change', () => onViewChange());

    const ctl = kitchen.addFolder({ title: 'plate tilt (WASD)', expanded: false });
    ctl.addBinding(params.controls, 'tiltSpeed', { label: 'tilt speed', min: 10, max: 400 });
    ctl.addBinding(params.controls, 'settleSpeed', { label: 'settle speed', min: 10, max: 400 });
    ctl.addBinding(params.controls, 'maxTilt', { label: 'max tilt', min: 5, max: 60 });

    const steelFolder = kitchen.addFolder({ title: 'steel (utensils + tray)', expanded: false });
    steelFolder.addBinding(params.steel, 'color');
    steelFolder.addBinding(params.steel, 'roughness', { min: 0, max: 1 });
    steelFolder.on('change', () => onSteelChange());

    const tr = kitchen.addFolder({ title: 'tray', expanded: false });
    tr.addBinding(params.tray, 'rimDepth', { label: 'rim depth', min: 0, max: 6 });
    tr.addBinding(params.tray, 'rimWidth', { label: 'rim width', min: 1, max: 20 });
    tr.on('change', () => onTrayChange());

    const a = kitchen.addFolder({ title: 'assets' });
    // the published look = whatever was loaded at startup (assets/preset.json)
    const published = structuredClone(params);

    a.addButton({ title: 'export preset (.json)' }).on('click', () => {
        // save as "preset.json" into final/assets/ to make it the site default
        const json = JSON.stringify(params, null, 2);
        download('preset.json', new Blob([json], { type: 'application/json' }));
    });

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (file) {
            mergeInto(params, JSON.parse(await file.text()));
            pane.refresh();
            onTrayChange();
        }
        fileInput.value = '';
    });
    a.addButton({ title: 'load preset' }).on('click', () => fileInput.click());

    a.addButton({ title: 'bake sauce normal map (.png)' }).on('click', () => {
        download('sauce-normal.png', sauce.normalCanvas.toDataURL('image/png'));
    });
    a.addButton({ title: 'reset to published' }).on('click', () => {
        mergeInto(params, published);
        pane.refresh();
        onTrayChange();
    });

    return pane;
}

// Copy values from `src` into `target`, but only for keys `target`
// already has. So an old preset still works after you add new sliders,
// and a typo in the JSON can't break anything.
export function mergeInto(target, src) {
    for (const key of Object.keys(target)) {
        if (!(key in src)) continue;
        const t = target[key], s = src[key];
        if (t && typeof t === 'object') {
            if (s && typeof s === 'object') mergeInto(t, s);
        } else if (typeof s === typeof t) {
            target[key] = s;
        }
    }
}

// Load the locked-in look for the whole site. If the file doesn't
// exist yet, the defaults in params.js are used.
export async function loadPreset(params, url = 'assets/preset.json') {
    try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (!res.ok) return false;
        mergeInto(params, await res.json());
        return true;
    } catch {
        return false;
    }
}
