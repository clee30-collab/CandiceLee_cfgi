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
    const pane = new Pane({ title: 'kitchen', container: document.getElementById('pane') });

    const light = pane.addFolder({ title: 'light' });
    light.addBinding(params.light, 'azimuth', { min: -180, max: 180 });
    light.addBinding(params.light, 'elevation', { min: 5, max: 89 });
    light.addBinding(params.light, 'intensity', { min: 0, max: 6 });
    light.addBinding(params.light, 'ambient', { min: 0, max: 2 });
    light.addBinding(params.light, 'environment', { min: 0, max: 2 });

    const par = pane.addFolder({ title: 'parallax' });
    par.addBinding(params.parallax, 'strength', { min: 0, max: 1.5 });
    par.addBinding(params.parallax, 'smoothing', { min: 1, max: 15 });

    const s = pane.addFolder({ title: 'sauce', expanded: false });
    s.addBinding(params.sauce, 'brush', { min: 0.02, max: 0.2 });
    s.addBinding(params.sauce, 'thickness', { min: 0.05, max: 1 });
    s.addBinding(params.sauce, 'normalStrength', { label: 'normal map', min: 0, max: 10 });
    s.addBinding(params.sauce, 'gloss', { min: 0, max: 1 });
    s.addBinding(params.sauce.colors, 'ketchup');
    s.addBinding(params.sauce.colors, 'mustard');
    s.addBinding(params.sauce.colors, 'pesto');

    const p = pane.addFolder({ title: 'peas (compute shader)', expanded: false });
    p.addBinding(params.peas, 'color');
    p.addBinding(params.peas, 'size', { min: 0.015, max: 0.06 });
    p.addBinding(params.peas, 'friction', { min: 0, max: 8 });
    p.addBinding(params.peas, 'push', { min: 0, max: 30 });
    p.addBinding(params.peas, 'pushRadius', { min: 0.05, max: 0.5 });
    p.addBinding(params.peas, 'bowlPull', { min: 0, max: 10 });
    p.addBinding(params.peas, 'collide');
    p.addBinding(params.peas, 'bounce', { min: 0, max: 60 });

    const m = pane.addFolder({ title: 'mood (state machine)', expanded: false });
    m.addBinding(params.mood, 'enabled');
    m.addBinding(params.mood, 'jitter', { min: 0, max: 3 });
    m.addBinding(params.mood, 'nudge', { min: 0, max: 6 });
    m.addBinding(status, 'mood', { readonly: true });

    const st = pane.addFolder({ title: 'status' });
    st.addBinding(status, 'flow', { readonly: true });
    st.addBinding(status, 'hand', { readonly: true });
    st.addBinding(status, 'backend', { readonly: true });

    // ---- asset tools ----
    const a = pane.addFolder({ title: 'assets' });
    const defaults = pane.exportState();

    a.addButton({ title: 'export preset (.json)' }).on('click', () => {
        const json = JSON.stringify(pane.exportState(), null, 2);
        download('food-preset.json', new Blob([json], { type: 'application/json' }));
    });

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = 'application/json';
    fileInput.addEventListener('change', async () => {
        const file = fileInput.files[0];
        if (file) pane.importState(JSON.parse(await file.text()));
        fileInput.value = '';
    });
    a.addButton({ title: 'load preset' }).on('click', () => fileInput.click());

    a.addButton({ title: 'bake sauce normal map (.png)' }).on('click', () => {
        download('sauce-normal.png', sauce.normalCanvas.toDataURL('image/png'));
    });
    a.addButton({ title: 'reset to defaults' }).on('click', () => pane.importState(defaults));

    return pane;
}
