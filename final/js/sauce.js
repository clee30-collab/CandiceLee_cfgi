import * as THREE from 'three/webgpu';
import { heightToNormal } from './normalmap.js';

// Sauce is a paint tool. We paint into two canvases:
//   color  - what you see
//   height - how thick the sauce is (stored in alpha)
// Every frame something changed, height -> normal map + roughness map,
// so the sauce gets real-looking ridges and shine under the light.

function makeCanvas(size) {
    const c = document.createElement('canvas');
    c.width = c.height = size;
    return c;
}

function hexToRgba(hex, a) {
    const c = new THREE.Color(hex);
    return `rgba(${Math.round(c.r * 255)},${Math.round(c.g * 255)},${Math.round(c.b * 255)},${a})`;
}

export class SaucePainter {
    constructor({ colorSize = 1024, heightSize = 512 } = {}) {
        this.colorCanvas = makeCanvas(colorSize);
        this.heightCanvas = makeCanvas(heightSize);
        this.normalCanvas = makeCanvas(heightSize);
        this.roughCanvas = makeCanvas(heightSize);

        this.color = this.colorCanvas.getContext('2d');
        this.height = this.heightCanvas.getContext('2d', { willReadFrequently: true });

        this.colorTexture = new THREE.CanvasTexture(this.colorCanvas);
        this.colorTexture.colorSpace = THREE.SRGBColorSpace;
        this.colorTexture.anisotropy = 4;
        this.normalTexture = new THREE.CanvasTexture(this.normalCanvas);
        this.roughTexture = new THREE.CanvasTexture(this.roughCanvas);

        this.base = '#ffffff';
        this.baseRoughness = 0.3;
        this.dirty = true;
        this.lastStrength = -1;
        this.lastGloss = -1;
    }

    reset(baseColor, baseRoughness) {
        this.base = baseColor;
        this.baseRoughness = baseRoughness;
        this.color.globalCompositeOperation = 'source-over';
        this.color.fillStyle = baseColor;
        this.color.fillRect(0, 0, this.colorCanvas.width, this.colorCanvas.height);
        this.height.clearRect(0, 0, this.heightCanvas.width, this.heightCanvas.height);
        this.dirty = true;
    }

    // draw dabs along a line from a to b (uv coords, 0..1)
    line(a, b, opts) {
        const dist = Math.hypot(b.x - a.x, b.y - a.y);
        const steps = Math.max(1, Math.ceil(dist / (opts.radius * 0.3)));
        for (let i = 1; i <= steps; i++) {
            const t = i / steps;
            this.stamp(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, opts);
        }
    }

    // opts: { mode: 'paint' | 'erase', color, radius (uv), thickness }
    stamp(u, v, { mode, color, radius, thickness = 0.3 }) {
        // color canvas
        let S = this.colorCanvas.width;
        let x = u * S, y = (1 - v) * S, r = radius * S;
        const paintColor = mode === 'erase' ? this.base : color;
        let g = this.color.createRadialGradient(x, y, 0, x, y, r);
        g.addColorStop(0, hexToRgba(paintColor, 0.95));
        g.addColorStop(0.65, hexToRgba(paintColor, 0.9));
        g.addColorStop(1, hexToRgba(paintColor, 0));
        this.color.fillStyle = g;
        this.color.beginPath();
        this.color.arc(x, y, r, 0, Math.PI * 2);
        this.color.fill();

        // height canvas
        S = this.heightCanvas.width;
        x = u * S; y = (1 - v) * S; r = radius * S;
        g = this.height.createRadialGradient(x, y, 0, x, y, r);
        if (mode === 'erase') {
            this.height.globalCompositeOperation = 'destination-out';
            g.addColorStop(0, 'rgba(0,0,0,1)');
            g.addColorStop(1, 'rgba(0,0,0,0)');
        } else {
            this.height.globalCompositeOperation = 'source-over';
            g.addColorStop(0, `rgba(255,255,255,${thickness * 0.35})`);
            g.addColorStop(1, 'rgba(255,255,255,0)');
        }
        this.height.fillStyle = g;
        this.height.beginPath();
        this.height.arc(x, y, r, 0, Math.PI * 2);
        this.height.fill();
        this.height.globalCompositeOperation = 'source-over';

        this.dirty = true;
    }

    // paper plate: sauce slowly bleeds outward and soaks in
    soak(amount) {
        const c = this.color;
        c.save();
        c.filter = 'blur(1.5px)';
        c.globalAlpha = 0.15 * amount;
        c.drawImage(this.colorCanvas, 0, 0);
        c.restore();

        const h = this.height;
        h.save();
        h.globalCompositeOperation = 'destination-out';
        h.fillStyle = `rgba(0,0,0,${0.03 * amount})`;
        h.fillRect(0, 0, this.heightCanvas.width, this.heightCanvas.height);
        h.restore();
        this.dirty = true;
    }

    update(normalStrength, gloss) {
        if (normalStrength !== this.lastStrength || gloss !== this.lastGloss) this.dirty = true;
        if (!this.dirty) return;
        heightToNormal(this.heightCanvas, this.normalCanvas, normalStrength, {
            canvas: this.roughCanvas, base: this.baseRoughness, gloss,
        });
        this.colorTexture.needsUpdate = true;
        this.normalTexture.needsUpdate = true;
        this.roughTexture.needsUpdate = true;
        this.lastStrength = normalStrength;
        this.lastGloss = gloss;
        this.dirty = false;
    }
}
