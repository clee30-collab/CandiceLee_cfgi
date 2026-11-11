import * as THREE from 'three/webgpu';
import {
    pass, renderOutput, uniform, vec2, vec3, vec4, float, hash, dot, mix, smoothstep,
    luminance, saturation, floor, clamp, time, screenUV, screenCoordinate, distance,
    screenSize, cos, fract, length,
} from 'three/tsl';
import { gaussianBlur } from 'three/addons/tsl/display/GaussianBlurNode.js';

// The "found photo" look: a post-processing shader that runs on the
// finished image, after the 3D scene is rendered.
//
//   scene -> lower resolution -> gaussian blur -> tone map / sRGB
//         -> split tone (green shadows, cool yellow highlights)
//         -> faded blacks + soft contrast -> posterize -> grain -> vignette
//
// All the numbers are uniforms, so the Tweakpane "look" tab can change
// them live without rebuilding the shader.

export class Look {
    constructor(renderer, scene, camera, settings) {
        this.settings = settings;
        this.scenePass = pass(scene, camera);

        const u = this.u = {
            blur: uniform(new THREE.Vector2(1, 1)),
            shadowTint: uniform(new THREE.Color()),
            highlightTint: uniform(new THREE.Color()),
            shadowAmt: uniform(0),
            highlightAmt: uniform(0),
            fade: uniform(0),
            contrast: uniform(1),
            saturation: uniform(1),
            levels: uniform(255),
            grain: uniform(0),
            grainSize: uniform(1),
            vignette: uniform(0),
            // shadertoy port
            wobble: uniform(0),
            rowJitter: uniform(0),
            ink: uniform(0),
            inkWidth: uniform(1.5),
            inkThreshold: uniform(0.04),
            inkColor: uniform(new THREE.Color()),
            paper: uniform(0),
            paperColor: uniform(new THREE.Color()),
        };

        // 0. paint wobble (ported from the shadertoy). We bend the
        //    coordinates we read the scene with, so straight edges
        //    waver like they were painted or badly printed.
        //    `st` is shadertoy's space: uv = fragCoord / iResolution.y * 2 - 1
        const st = vec2(screenUV.x.mul(screenSize.x.div(screenSize.y)), screenUV.y).mul(2).sub(1);
        //    shadertoy: uv.x += cos(uv.y * (uv.x + 1.) * 3.) * 0.003
        //               uv.y += cos(uv.x * 6.) * 0.00007
        const wobble = vec2(
            cos(st.y.mul(st.x.add(1)).mul(3)),
            cos(st.x.mul(6)).mul(0.1),
        ).mul(u.wobble);
        //    shadertoy: uv.x += rand(uv.y) * 0.006  (each row shifts a bit)
        //    its rand(float n) = fract(cos(n * 89.42) * 343.42)
        const row = floor(screenCoordinate.y.div(2));
        const rowRand = fract(cos(row.mul(89.42)).mul(343.42)).sub(0.5);
        const offsetPx = wobble.add(vec2(rowRand.mul(u.rowJitter), 0));
        const warpedUV = screenUV.add(offsetPx.div(screenSize));

        // 1. blur (direction uniform scales the blur radius)
        const sceneColor = this.scenePass.getTextureNode('output').sample(warpedUV);
        const blurred = gaussianBlur(sceneColor, u.blur, 2);

        // 1b. soft ink edges (the shadertoy's dtoa idea): find where the
        //     image changes sharply (an edge) and paint a soft dark line.
        //     Instead of distance to one shape, we measure the brightness
        //     difference between neighbouring pixels.
        const tex = blurred.getTextureNode();
        const step = vec2(u.inkWidth).div(screenSize);
        const L = (dx, dy) => {
            const l = luminance(tex.sample(screenUV.add(step.mul(vec2(dx, dy)))).rgb);
            return l.div(l.add(1)); // squash bright values so edges are even
        };
        const grad = vec2(L(1, 0).sub(L(-1, 0)), L(0, 1).sub(L(0, -1)));
        const edge = smoothstep(u.inkThreshold, u.inkThreshold.add(0.08), length(grad)).mul(u.ink);
        const inked = mix(blurred.rgb, vec3(u.inkColor), edge);

        // 2. tone map + convert to screen colour, so the grading below
        //    works on the colours you actually see
        const shown = renderOutput(vec4(inked, 1));
        let c = shown.rgb;

        // 2b. paper: tint toward the shadertoy's cream background vec3(1., 1., .86)
        c = c.mul(mix(vec3(1), vec3(u.paperColor), u.paper));

        // 3. split toning: push dark areas toward one colour, bright
        //    areas toward another. Subtracting each tint's own brightness
        //    shifts the hue without making everything darker/lighter.
        const lum = luminance(c);
        const shadowW = float(1).sub(smoothstep(0.0, 0.55, lum));
        const highW = smoothstep(0.45, 1.0, lum);
        const shadowShift = vec3(u.shadowTint).sub(luminance(vec3(u.shadowTint)));
        const highShift = vec3(u.highlightTint).sub(luminance(vec3(u.highlightTint)));
        c = c.add(shadowShift.mul(shadowW).mul(u.shadowAmt));
        c = c.add(highShift.mul(highW).mul(u.highlightAmt));

        // 4. cheap-camera tone: lower contrast, lifted (milky) blacks
        c = c.sub(0.5).mul(u.contrast).add(0.5);
        c = mix(vec3(u.fade), vec3(1), c);
        c = saturation(c, u.saturation);

        // 5. colour steps, with dithering: a tiny per-pixel random offset
        //    before rounding turns hard bands into fine noise. At 255 it
        //    just smooths gradients; lower it for a deliberate cheap look.
        //
        //    NOTE: three's hash() rounds its input down to a whole number,
        //    so every pixel needs its OWN whole number (x + y * 4096).
        //    Feeding it fractional math made rows of pixels share values,
        //    which showed up as faint diagonal lines.
        const px = floor(screenCoordinate.xy);
        const pixelId = px.x.add(px.y.mul(4096));
        const dither = hash(pixelId);
        c = floor(c.mul(u.levels).add(dither)).div(u.levels);

        // 6. grain: a new random value per pixel cell, 24 times a second,
        //    strongest in the mid tones like real film/sensor noise
        const cell = floor(screenCoordinate.xy.div(u.grainSize));
        const cellSeed = floor(hash(cell.x.add(cell.y.mul(4096)).add(0.5)).mul(16000000));
        const frame = time.mul(24).floor().mod(65536);
        const n = hash(cellSeed.add(frame)).sub(0.5);
        const midW = float(1).sub(lum.sub(0.5).abs().mul(1.4));
        c = c.add(n.mul(u.grain).mul(clamp(midW, 0.3, 1)));

        // 7. soft dark corners
        const v = smoothstep(0.35, 0.85, distance(screenUV, vec2(0.5)));
        c = c.mul(float(1).sub(v.mul(u.vignette)));

        this.post = new THREE.PostProcessing(renderer);
        this.post.outputColorTransform = false; // we already did it in step 2
        this.post.outputNode = vec4(clamp(c, 0, 1), 1);
    }

    // copy Tweakpane values into the shader
    sync() {
        const s = this.settings;
        this.scenePass.setResolution(s.resolution);
        this.u.blur.value.set(s.blur, s.blur);
        this.u.shadowTint.value.set(s.shadows);
        this.u.highlightTint.value.set(s.highlights);
        this.u.shadowAmt.value = s.shadowAmount;
        this.u.highlightAmt.value = s.highlightAmount;
        this.u.fade.value = s.fade;
        this.u.contrast.value = s.contrast;
        this.u.saturation.value = s.saturation;
        this.u.levels.value = s.levels;
        this.u.grain.value = s.grain;
        this.u.grainSize.value = s.grainSize;
        this.u.vignette.value = s.vignette;
        const p = s.paint;
        this.u.wobble.value = p.wobble;
        this.u.rowJitter.value = p.rowJitter;
        this.u.ink.value = p.ink;
        this.u.inkWidth.value = p.inkWidth;
        this.u.inkThreshold.value = p.inkThreshold;
        this.u.inkColor.value.set(p.inkColor);
        this.u.paper.value = p.paper;
        this.u.paperColor.value.set(p.paperColor);
    }

    render(renderer, scene, camera) {
        if (!this.settings.enabled) {
            renderer.render(scene, camera);
            return;
        }
        this.sync();
        this.post.render();
    }
}
