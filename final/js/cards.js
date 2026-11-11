import * as THREE from 'three/webgpu';
import { imageToNormalMap } from './normalmap.js';

// "Cards" = flat 2D images placed in 3D space, with an auto-generated
// normal map so they catch the light. Combined with parallax they feel
// sculpted instead of flat. Use loadCard('assets/my-drawing.png') for
// your own drawn assets (transparent PNGs work best).

export function makeCard(image, { width = 0.5, normalStrength = 4, blur = 8, roughness = 0.35, metalness = 0 } = {}) {
    const map = new THREE.CanvasTexture(image);
    map.colorSpace = THREE.SRGBColorSpace;
    const normalMap = new THREE.CanvasTexture(imageToNormalMap(image, normalStrength, blur));

    const mat = new THREE.MeshStandardMaterial({
        map, normalMap, roughness, metalness,
        transparent: true, alphaTest: 0.5, side: THREE.DoubleSide,
    });
    const geo = new THREE.PlaneGeometry(width, width * image.height / image.width);
    geo.rotateX(-Math.PI / 2); // lie flat on the table
    const mesh = new THREE.Mesh(geo, mat);

    // fake drop shadow: the same silhouette, dark and soft, that we keep
    // on the plate while the card floats above it. The gap between card
    // and shadow is a big part of the depth illusion.
    const sil = document.createElement('canvas');
    sil.width = image.width; sil.height = image.height;
    const sg = sil.getContext('2d');
    sg.filter = 'blur(6px)';
    sg.drawImage(image, 0, 0);
    sg.filter = 'none';
    sg.globalCompositeOperation = 'source-in'; // keep the shape, make it white
    sg.fillStyle = '#fff';
    sg.fillRect(0, 0, sil.width, sil.height);
    const shadowMat = new THREE.MeshBasicMaterial({
        color: '#000', alphaMap: new THREE.CanvasTexture(sil), transparent: true, opacity: 0.22, depthWrite: false,
    });
    mesh.userData.shadow = new THREE.Mesh(geo, shadowMat);
    return mesh;
}

export async function loadCard(url, opts) {
    const img = new Image();
    img.src = url;
    await img.decode();
    const c = document.createElement('canvas');
    c.width = img.naturalWidth; c.height = img.naturalHeight;
    c.getContext('2d').drawImage(img, 0, 0);
    return makeCard(c, opts);
}

// Placeholder utensil drawings. Swap these for your own art later.
export function drawUtensil(type) {
    const square = type === 'napkin';
    const c = document.createElement('canvas');
    c.width = square ? 512 : 192;
    c.height = square ? 512 : 640;
    const g = c.getContext('2d');
    const steel = g.createLinearGradient(0, 0, c.width, 0);
    steel.addColorStop(0, '#9da1a8');
    steel.addColorStop(0.5, '#e4e6ea');
    steel.addColorStop(1, '#a5a9b0');
    g.fillStyle = steel;

    const round = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); g.fill(); };

    if (type === 'fork') {
        for (let i = 0; i < 4; i++) round(42 + i * 30, 20, 14, 150, 7);
        round(40, 140, 112, 90, 30);
        round(78, 220, 36, 400, 18);
    } else if (type === 'spoon') {
        g.beginPath(); g.ellipse(96, 150, 72, 120, 0, 0, Math.PI * 2); g.fill();
        round(80, 250, 32, 370, 16);
    } else if (type === 'knife') {
        g.beginPath();
        g.moveTo(80, 330); g.lineTo(80, 40);
        g.quadraticCurveTo(84, 14, 110, 20);
        g.quadraticCurveTo(128, 180, 116, 330);
        g.closePath(); g.fill();
        g.fillStyle = '#3b3631';
        round(74, 330, 46, 290, 20);
    } else if (type === 'napkin') {
        g.fillStyle = '#efe9dc';
        round(24, 24, 464, 464, 18);
        g.strokeStyle = '#c94b3a';
        g.lineWidth = 10;
        g.strokeRect(56, 56, 400, 400);
        g.strokeStyle = 'rgba(0,0,0,0.12)';
        g.lineWidth = 4;
        g.beginPath(); g.moveTo(24, 256); g.lineTo(488, 256); g.stroke();
    }
    return c;
}
