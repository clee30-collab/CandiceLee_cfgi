// Every tunable number in the project lives here.
// Tweakpane binds directly to this object, so moving a slider changes
// the value here and the rest of the code just reads it every frame.
// When you find values you like, use "export preset" in the panel and
// save the JSON into /final/assets/presets/.

export const params = {
    light: {
        // the room: an HDRI photo of a bright interior lights everything
        hdri: 0.35,        // how bright the room light is (low, so the spotlight stands out)
        hdriRotation: 200, // degrees: turn the room so the windows face another way
        // a soft window light, only so food still casts shadows
        shadowLight: 0,    // extra window light from the side (0 = off; the spotlight casts shadows)
        azimuth: 35,       // degrees around the plate (where the window is)
        elevation: 40,     // degrees above the table
        exposure: 1.0,     // overall brightness; too high = white plate goes flat
        // the spotlight hanging over the plate
        spot: {
            intensity: 5,
            angle: 24,     // degrees: how wide the cone is (bigger = bigger pool of light)
            softness: 0.75, // 0 = hard edge, 1 = very soft edge
            height: 4,     // how high above the table it hangs
            tilt: 14,      // degrees it leans away from straight down (0 = directly overhead)
            direction: 0,  // which side it leans from: 0 = north (far side), 90 = east, 180 = south, 270 = west
        },
    },
    parallax: {
        strength: 0.6,     // how far the camera swings with the mouse
        smoothing: 5,      // higher = snappier
    },
    sauce: {
        brush: 0.07,       // brush radius in world units (plate radius is 1)
        thickness: 0.35,   // how much height each dab adds
        normalStrength: 3, // how "3D" the sauce looks
        gloss: 0.6,        // thick sauce is shinier than the plate
        colors: {
            ketchup: '#c8321e',
            mustard: '#e3b21a',
            pesto: '#4f7a28',
        },
    },
    peas: {
        color: '#6fae3a',
        size: 0.032,
        damping: 4,        // how fast rolling peas slow down (higher = settle sooner)
        gravity: 9,        // pulls peas downhill, and down when they fly off the plate
        push: 10,          // utensil push force
        pushRadius: 0.16,
        drag: 18,          // how much a moving utensil carries peas with it (flicks fling them)
        collide: true,     // peas bump into each other (costs GPU time)
        stiffness: 6,      // how hard overlapping peas push apart (high = jittery)
    },
    // the "found photo" filter (js/look.js)
    look: {
        enabled: true,
        opacity: 1,          // how strong the whole filter is: 1 = full, 0 = the plain scene
        resolution: 0.55,    // render smaller then stretch = soft, low-quality
        blur: 1.2,           // gaussian blur radius
        shadows: '#5e8a4a',  // shadows lean green
        highlights: '#f2f0b0', // highlights lean cool/lemon yellow
        shadowAmount: 0.9,   // how green the shadows get
        highlightAmount: 0.3, // how yellow the highlights get (keep low: the table is a highlight)
        fade: 0.07,          // lifts the blacks (milky, cheap-camera)
        contrast: 0.9,
        saturation: 0.9,
        levels: 255,         // colour steps; 255 = smooth, lower = cheap/banded
        grain: 0.07,
        grainSize: 1.5,      // in screen pixels
        vignette: 0.25,
        // ported from the brushstroke shadertoy
        paint: {
            wobble: 2,              // px: straight edges waver like paint
            rowJitter: 1.2,         // px: each row shifts a little (shaky ink)
            ink: 0.75,              // soft dark outlines around shapes
            inkWidth: 1.5,          // px
            inkThreshold: 0.015,    // lower = more edges get inked
            inkColor: '#2a2618',
            paper: 0.35,            // tint toward the cream paper colour
            paperColor: '#ffffdb',  // shadertoy's vec3(1., 1., .86)
        },
    },
    // each plate's ceramic (used when the plate model has no material of its own)
    plates: {
        dinner: { color: '#f7f5f0', roughness: 0.35, glaze: 0.7, glazeRoughness: 0.06 },
        bowl: { color: '#f5f2ea', roughness: 0.35, glaze: 0.7, glazeRoughness: 0.06 },
        paper: { color: '#f1ece0', roughness: 0.95, glaze: 0, glazeRoughness: 0.5 },
    },
    // the camera
    view: {
        plateSize: 0.85,   // how much of the screen's height the plate fills (0.85 = 85%)
    },
    // tilting the plate with WASD / arrow keys
    controls: {
        mode: 'hold',      // 'hold' = hold a key to tip, let go to settle; 'step' = each press tips one notch
        stepDegrees: 10,   // step mode: how far one key press tips the plate
        tiltSpeed: 130,    // degrees per second while a key is held (higher = snappier)
        settleSpeed: 160,  // degrees per second back to level when you let go
        maxTilt: 30,       // the furthest it tips, in degrees
    },
    // polished steel: the utensils AND the instrument tray use this
    steel: {
        color: '#d4d7db',
        roughness: 0.22,   // 0 = mirror, higher = brushed / satin
    },
    // the metal instrument tray (js/tray3d.js)
    tray: {
        rimDepth: 1.2,     // how steep the raised lip at the edge is (lower = shallower)
        rimWidth: 3,       // how wide the lip is, in pixels
    },
    mood: {
        enabled: true,     // the "structured randomness" state machine
        jitter: 0.8,       // fidget strength
        nudge: 2.5,        // someone bumped the table
    },
};

// read-only values shown in the panel
export const status = {
    flow: 'plate',
    mood: 'still',
    backend: '',
    hand: '-',
};
