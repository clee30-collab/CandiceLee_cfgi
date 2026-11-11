import * as THREE from 'three/webgpu';
import {
    pass, renderOutput, uniform, vec2, vec3, vec4, float, hash, dot, mix, smoothstep,
    luminance, saturation, floor, clamp, time, screenUV, screenCoordinate, distance,
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
            levels: uniform(64),
            grain: uniform(0),
            grainSize: uniform(1),
            vignette: uniform(0),
        };

        // 1. blur (direction uniform scales the blur radius)
        const sceneColor = this.scenePass.getTextureNode('output');
        const blurred = gaussianBlur(sceneColor, u.blur, 2);

        // 2. tone map + convert to screen colour, so the grading below
        //    works on the colours you actually see
        const shown = renderOutput(blurred);
        let c = shown.rgb;

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

        // 5. low quality: fewer colour steps (a little banding)
        c = floor(c.mul(u.levels)).div(u.levels);

        // 6. grain: a new random value per pixel cell every frame,
        //    strongest in the mid tones like real film/sensor noise
        const cell = floor(screenCoordinate.xy.div(u.grainSize));
        const n = hash(dot(cell, vec2(12.9898, 78.233)).add(time.mul(60).floor().mul(7.13))).sub(0.5);
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
