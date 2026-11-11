// Every tunable number in the project lives here.
// Tweakpane binds directly to this object, so moving a slider changes
// the value here and the rest of the code just reads it every frame.
// When you find values you like, use "export preset" in the panel and
// save the JSON into /final/assets/presets/.

export const params = {
    light: {
        azimuth: 35,       // degrees around the plate
        elevation: 40,     // degrees above the table
        intensity: 3.2,
        ambient: 0.2,
        environment: 0.6, // soft reflections (makes ceramic + sauce shine)
        exposure: 1.15,    // overall brightness; too high = white plate goes flat
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
        friction: 2.2,     // low friction = they roll around a lot
        push: 10,          // utensil push force
        pushRadius: 0.16,
        bowlPull: 4,       // how hard the bowl drags things to the centre
        collide: true,     // peas bump into each other (costs GPU time)
        bounce: 20,        // how springy pea-pea hits are
    },
    // the "found photo" filter (js/look.js)
    look: {
        enabled: true,
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
