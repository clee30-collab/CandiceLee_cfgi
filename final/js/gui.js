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

export function createGui({ params, status, sauce }) {
    const pane = new Pane({ title: 'controls', container: document.getElementById('pane') });
    const tabs = pane.addTab({ pages: [{ title: 'kitchen' }, { title: 'look' }] });
    const kitchen = tabs.pages[0];
    const look = tabs.pages[1];

    const light = kitchen.addFolder({ title: 'light' });
    light.addBinding(params.light, 'azimuth', { min: -180, max: 180 });
    light.addBinding(params.light, 'elevation', { min: 5, max: 89 });
    light.addBinding(params.light, 'intensity', { min: 0, max: 6 });
    light.addBinding(params.light, 'ambient', { min: 0, max: 2 });
    light.addBinding(params.light, 'environment', { min: 0, max: 2 });
    light.addBinding(params.light, 'exposure', { min: 0.3, max: 2 });

    const par = kitchen.addFolder({ title: 'parallax' });
    par.addBinding(params.parallax, 'strength', { min: 0, max: 1.5 });
    par.addBinding(params.parallax, 'smoothing', { min: 1, max: 15 });

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
    p.addBinding(params.peas, 'friction', { min: 0, max: 8 });
    p.addBinding(params.peas, 'push', { min: 0, max: 30 });
    p.addBinding(params.peas, 'pushRadius', { min: 0.05, max: 0.5 });
    p.addBinding(params.peas, 'bowlPull', { min: 0, max: 10 });
    p.addBinding(params.peas, 'collide');
    p.addBinding(params.peas, 'bounce', { min: 0, max: 60 });

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
