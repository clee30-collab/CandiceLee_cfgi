// Normal maps from height.
//
// A normal map is an image where each pixel's RGB stores which way the
// surface "faces" (x, y, z -> r, g, b). The renderer uses it to fake bumps
// in the lighting without adding any geometry. We make one by reading a
// height image (here: the alpha channel) and measuring the slope with a
// Sobel filter.

export function heightToNormal(heightCanvas, normalCanvas, strength = 3, rough = null) {
    const w = heightCanvas.width;
    const h = heightCanvas.height;
    const src = heightCanvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, w, h).data;

    const nctx = normalCanvas.getContext('2d');
    const out = nctx.createImageData(w, h);
    const o = out.data;

    let r = null, rctx = null;
    if (rough) {
        rctx = rough.canvas.getContext('2d');
        r = rctx.createImageData(w, h);
    }

    const s = strength / 255;
    for (let y = 0; y < h; y++) {
        const y0 = y > 0 ? y - 1 : 0;
        const y1 = y < h - 1 ? y + 1 : h - 1;
        for (let x = 0; x < w; x++) {
            const x0 = x > 0 ? x - 1 : 0;
            const x1 = x < w - 1 ? x + 1 : w - 1;
            // alpha values of the 3x3 neighbourhood
            const tl = src[(y0 * w + x0) * 4 + 3], t = src[(y0 * w + x) * 4 + 3], tr = src[(y0 * w + x1) * 4 + 3];
            const l = src[(y * w + x0) * 4 + 3], rr = src[(y * w + x1) * 4 + 3];
            const bl = src[(y1 * w + x0) * 4 + 3], b = src[(y1 * w + x) * 4 + 3], br = src[(y1 * w + x1) * 4 + 3];

            const dx = (tr + 2 * rr + br) - (tl + 2 * l + bl);
            const dy = (bl + 2 * b + br) - (tl + 2 * t + tr); // canvas y points down

            let nx = -dx * s;
            let ny = dy * s;   // flipped because texture v points up
            let nz = 1;
            const len = Math.hypot(nx, ny, nz);
            nx /= len; ny /= len; nz /= len;

            const i = (y * w + x) * 4;
            o[i] = (nx * 0.5 + 0.5) * 255;
            o[i + 1] = (ny * 0.5 + 0.5) * 255;
            o[i + 2] = (nz * 0.5 + 0.5) * 255;
            o[i + 3] = 255;

            if (r) {
                // thicker = glossier (roughness lives in the green channel)
                const height = src[i + 3] / 255;
                const g = Math.max(0.05, rough.base - Math.min(1, height * 2) * rough.gloss) * 255;
                r.data[i] = g; r.data[i + 1] = g; r.data[i + 2] = g; r.data[i + 3] = 255;
            }
        }
    }
    nctx.putImageData(out, 0, 0);
    if (r) rctx.putImageData(r, 0, 0);
}

// Make a normal map for any 2D image (a drawing, a PNG of food...).
// The image's alpha is blurred into a soft "dome" so flat cut-outs
// pick up light on their edges like a puffy sticker.
export function imageToNormalMap(image, strength = 4, blur = 8) {
    const w = image.width, h = image.height;
    const height = document.createElement('canvas');
    height.width = w; height.height = h;
    const ctx = height.getContext('2d', { willReadFrequently: true });
    ctx.filter = `blur(${blur}px)`;
    ctx.drawImage(image, 0, 0);

    const normal = document.createElement('canvas');
    normal.width = w; normal.height = h;
    heightToNormal(height, normal, strength);
    return normal;
}
