import * as THREE from 'three/webgpu';

// ------------------------------------------------------------------
// THE INTRO: instructions "printed" on the dinner plate like a ceramic
// pattern, one slide at a time. Each slide stays for a few seconds,
// then fades to the next. Space skips to the next slide.
//
// Edit the slides here. Each slide is a list of lines. Every line uses the
// same font, weight and size (set in INTRO below), centred, and long lines
// wrap onto the next line by themselves (INTRO.wrap sets how wide a line
// may get). Mode code can add slides: game.intro.slides.splice(...)
// A slide can also be an image you made (transparent PNG; it's tinted to
// the print colour, or add tint: false to keep its colours):
//     { image: 'assets/intro/slide1.png' }
// ------------------------------------------------------------------
export const SLIDES = [
    { lines: ['Candice Lee, 2026', 'Coding For Graphics & Interfaces'] },
    { lines: ['move the plate with WASD or Arrows'] },
];

export const INTRO = {
    seconds: 4.5,          // how long each slide stays
    fade: 0,               // seconds to fade between slides (0 = switch instantly)
    color: '#000000',      // black ink
    font: 'Figtree',       // or 'Commissioner' or Figtree
    weight: 600,           // heavy, so it holds up under the photo filter's blur
    size: 54,              // text size for ALL plate text (print pixels; the plate is ~1000 across)
    wrap: 0.56,            // how much of the plate's width a line may use before wrapping
    lineHeight: 1.1,      // space between lines, as a multiple of the size
};

const SIZE = 1024; // print texture resolution

const fontAt = (px) => `${INTRO.weight} ${px}px "${INTRO.font}", sans-serif`;

// break each line into shorter lines that fit `maxW`, at the spaces
function wrapLines(g, lines, maxW) {
    const out = [];
    for (const line of lines) {
        let current = '';
        for (const word of line.split(' ')) {
            const tryLine = current ? `${current} ${word}` : word;
            if (current && g.measureText(tryLine).width > maxW) {
                out.push(current);
                current = word;
            } else {
                current = tryLine;
            }
        }
        if (current) out.push(current);
    }
    return out;
}

// The print layer: a see-through skin that hugs the plate's surface just
// under the sauce, with a clear glaze over the ink so it reads as part of
// the ceramic rather than a sticker.
export class PlatePrint {
    constructor() {
        this.canvas = document.createElement('canvas');
        this.canvas.width = this.canvas.height = SIZE;
        this.ctx = this.canvas.getContext('2d');
        this.texture = new THREE.CanvasTexture(this.canvas);
        this.texture.colorSpace = THREE.SRGBColorSpace;
        this.texture.anisotropy = 4;
        // no mipmaps: the smaller, blurrier copies the GPU normally uses when a
        // texture is shown smaller than its size would wash thin black
        // strokes out to grey
        this.texture.generateMipmaps = false;
        this.texture.minFilter = THREE.LinearFilter;
        this.material = new THREE.MeshPhysicalMaterial({
            map: this.texture,
            transparent: true,
            opacity: 0,
            depthWrite: false,
            // matte ink that reflects nothing, so black stays black
            // (a glossy coat over it reflected the room and turned it grey)
            roughness: 1,
            metalness: 0,
            envMapIntensity: 0,
            polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
        });
        this.mesh = null;
        this.wellPx = SIZE * 0.36;
        this.images = {};
        this.slides = [...SLIDES]; // this run's slides (modes may add to it)
        this.index = -1;
        this.timer = 0;
        this.state = 'idle'; // idle -> in -> hold -> out -> (next) ... -> done
        this.onDone = null;
    }

    // put the print on a plate (call again when the plate changes)
    attach(plate) {
        if (this.mesh) this.mesh.removeFromParent();
        // same shape as the plate's sauce layer, a hair below it
        const geo = plate.decal.geometry.clone();
        geo.translate(0, -0.0015, 0);
        this.mesh = new THREE.Mesh(geo, this.material);
        this.mesh.receiveShadow = true;
        plate.tilt.add(this.mesh);
        this.mesh.visible = this.state !== 'idle' && this.state !== 'done';

        // find the edge of the plate's flat well (where the surface starts
        // to rise toward the rim) so the border rings sit right on it
        const h = plate.heights;
        const n = h.length;
        let edge = n - 1;
        for (let i = 1; i < n; i++) { if (h[i] > h[0] + 0.006) { edge = i; break; } }
        const wellR = (edge / (n - 1)) * 1.3; // HEIGHT_RANGE in plates.js
        // canvas: the middle is the plate centre, the edge is plate.radius
        this.wellPx = Math.min(wellR / plate.radius, 0.95) * (SIZE / 2);
        if (this.index >= 0 && this.running && this.state !== 'message') this.draw(this.slides[this.index]);
    }

    async start() {
        // wait for the font and any slide images, so nothing pops in late
        try { await document.fonts.load(`${INTRO.weight} 40px "${INTRO.font}"`); } catch { /* fallback font */ }
        await Promise.all(this.slides.filter((s) => s.image).map(async (s) => {
            const img = new Image();
            img.src = s.image;
            try { await img.decode(); this.images[s.image] = img; } catch { console.warn('intro image missing', s.image); }
        }));
        this.show(0);
    }

    show(i) {
        if (i >= this.slides.length) { this.finish(); return; }
        this.index = i;
        this.draw(this.slides[i]);
        this.state = 'in';
        this.timer = 0;
        if (this.mesh) this.mesh.visible = true;
    }

    // Space: fade out now and move on
    skip() {
        if (this.state === 'in' || this.state === 'hold') { this.state = 'out'; this.timer = 0; }
    }

    finish() {
        this.state = 'done';
        this.material.opacity = 0;
        if (this.mesh) this.mesh.visible = false;
        this.onDone?.();
    }

    // print a message on the plate (same look as the intro) until clear()
    // is called. Used by the mini game: say(['caught.', 'space to try again'])
    say(lines) {
        this.state = 'message';
        this.draw({ lines });
        this.material.opacity = 1;
        if (this.mesh) this.mesh.visible = true;
    }

    clear() {
        if (this.state !== 'message') return;
        this.state = 'done';
        this.material.opacity = 0;
        if (this.mesh) this.mesh.visible = false;
    }

    get running() { return this.state !== 'idle' && this.state !== 'done'; }


    update(dt) {
        if (!this.running) return;
        this.timer += dt;
        if (this.state === 'in') {
            this.material.opacity = INTRO.fade > 0 ? Math.min(this.timer / INTRO.fade, 1) : 1;
            if (this.timer >= INTRO.fade) { this.state = 'hold'; this.timer = 0; }
        } else if (this.state === 'hold') {
            if (this.timer >= INTRO.seconds) { this.state = 'out'; this.timer = 0; }
        } else if (this.state === 'out') {
            this.material.opacity = INTRO.fade > 0 ? Math.max(1 - this.timer / INTRO.fade, 0) : 0;
            if (this.timer >= INTRO.fade) this.show(this.index + 1);
        }
    }

    // draw one slide into the print texture. The texture covers the whole
    // plate (edge to edge), so the middle of the canvas is the plate's centre.
    draw(slide) {
        const g = this.ctx;
        const c = SIZE / 2;
        g.clearRect(0, 0, SIZE, SIZE);
        g.save();
        g.fillStyle = INTRO.color;
        g.textBaseline = 'middle';
        const maxWidth = SIZE * INTRO.width;

        if (slide.image && this.images[slide.image]) {
            const img = this.images[slide.image];
            const k = Math.min(maxWidth / img.width, maxWidth / img.height);
            const w = img.width * k, h = img.height * k;
            if (slide.tint === false) {
                g.drawImage(img, c - w / 2, c - h / 2, w, h);
            } else {
                // tint the picture to the print colour
                const t = document.createElement('canvas');
                t.width = w; t.height = h;
                const tg = t.getContext('2d');
                tg.drawImage(img, 0, 0, w, h);
                tg.globalCompositeOperation = 'source-in';
                tg.fillStyle = INTRO.color;
                tg.fillRect(0, 0, w, h);
                g.drawImage(t, c - w / 2, c - h / 2);
            }
        } else {
            // ONE size for all plate text (intro slides and messages), centred,
            // long lines wrapped onto the next line
            const px = INTRO.size;
            g.font = fontAt(px);
            const lines = wrapLines(g, slide.lines ?? [], SIZE * INTRO.wrap);
            g.textAlign = 'center';
            // a hairline outline in the same black thickens the strokes a touch
            g.strokeStyle = INTRO.color;
            g.lineWidth = Math.max(1, px * 0.03);
            g.lineJoin = 'round';
            const lineH = px * INTRO.lineHeight;
            let y = c - ((lines.length - 1) * lineH) / 2;
            for (const t of lines) {
                g.strokeText(t, c, y);
                g.fillText(t, c, y);
                y += lineH;
            }
        }
        g.restore();
        this.texture.needsUpdate = true;
    }
}
