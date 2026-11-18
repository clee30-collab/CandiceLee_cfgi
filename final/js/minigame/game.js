import { StateMachine, RandomMachine } from '../stateMachine.js';
import { INTRO } from '../intro.js';

export const RULES = {
    peas: 60,              // how many peas you start with
    timeLimit: 120,        // seconds
    away: [2.5, 6],        // seconds the eyes stay away (random in this range)
    watching: [1.5, 3.5],  // seconds the eyes watch
    eyes: 'assets/minigame/eyes.jpg',
    eyesWidth: 'min(44vw, 560px)', // how big the eyes are on screen
    eyesPadding: '28px',           // gap between the eyes and the top of the screen
    // while the eyes watch, the game screen switches to this look
    // (any photo filter setting from the panel's look tab can go here)
    // (looks like an over-compressed video frame: soft blocks, colour blotches)
    watchedLook: {
        jpeg: 32,
        jpegDetail: 0.71,
        jpegChroma: 0.05,
        blur: 4.43,
        resolution: 1,
        pixelate: 22,
        mosaicSharpen: 9.57,
        shadows: "#ff1400",
        shadowAmount: 0,       // red shadow tint off: the shadows go black instead
        blackPoint: 0.22,      // everything darker than this turns pure black
        multiplyColor: "#ff2a1a", // the whole image multiplied by red
        multiplyAmount: 1,
        highlights: "#000000",
        highlightAmount: 1.37,
        contrast: 2,
        saturation: 0.33,
        fade: 0,
        levels: 140,
        grain: 0.09,
        opacity: 0.91,
    },
    // tilting: each press of WASD / an arrow tips the plate one notch
    tiltStep: 12,          // degrees per key press
    maxTilt: 28,           // the steepest it can tip, in degrees (28 = the first version's limit)
    tiltSpeed: 260,        // degrees per second it swings to the new notch
    // the game over screen: one line of text repeated as a pattern
    // the game over text: styled exactly like the intro text (font, weight,
    // size, line spacing, wrapping come from INTRO in js/intro.js), but as
    // page text over the screen, so it isn't on the plate and the filters
    // don't touch it
    gameOverLines: ['Game over', 'press space to start'],
    gameOverColor: '#8a8a8a', // grey
    gameOverWeight: 240,     // null = same weight as the intro text; or a number, 300 (light) to 900 (heaviest)
};

// the mini game's story, shown before the "move the plate" slide
export const STORY = [
    { lines: ['you don\'t want to eat your peas but you have to get rid of them somehow'] },
    { lines: ["just don't get caught or you will get more peas"] },
];

export function start(game) {
    const { peas, renderer, intro, params } = game;

    // ---- add the story slides to the intro, just before the WASD slide ----
    const wasd = intro.slides.findIndex((s) => s.lines?.some((l) => l.includes('WASD')));
    intro.slides.splice(wasd >= 0 ? wasd : intro.slides.length, 0, ...STORY);

    // ---- a clean screen: no title text, no control panel, no tray ----
    // TUNING MODE (temporary): open final/?minigame&tune to adjust the eyes'
    // filter live. The panel shows, the eyes and their filter stay on, and
    // nothing can catch you or run out the clock.
    const TUNE = new URLSearchParams(location.search).has('tune');
    for (const id of TUNE ? ['title', 'tray'] : ['title', 'pane', 'tray']) document.getElementById(id).style.display = 'none';
    params.mood.enabled = false; // no random table bumps flinging peas for you
    game.filterKey.enabled = false; // F doesn't turn the filter off in the game

    // ---- tilting: tap to tip one notch at a time, much steeper than the project ----
    Object.assign(params.controls, {
        mode: 'step',
        stepDegrees: RULES.tiltStep,
        maxTilt: RULES.maxTilt,
        tiltSpeed: RULES.tiltSpeed,
    });

    // ---- the HUD: time left and peas left, small in the corner ----
    const hud = document.createElement('div');
    Object.assign(hud.style, {
        position: 'fixed', top: '14px', right: '18px', zIndex: 4,
        font: '600 20px Figtree, sans-serif', color: '#111', textAlign: 'right',
        pointerEvents: 'none', whiteSpace: 'pre',
    });
    document.body.appendChild(hud);

    // ---- the eyes ----
    const eyes = new Image();
    eyes.src = RULES.eyes;
    eyes.alt = '';
    Object.assign(eyes.style, {
        position: 'fixed', top: RULES.eyesPadding, left: '50%', transform: 'translateX(-50%)',
        width: RULES.eyesWidth, zIndex: 5, pointerEvents: 'none', display: 'none',
    });
    document.body.appendChild(eyes);

    // ---- the game over screen ----
    // the intro's text style, as plain page text above everything: not on
    // the plate, and the photo filter / eyes look never touch it.
    // The intro's sizes are in "print pixels" on a 1024-wide picture that
    // covers the plate, so they're converted to screen pixels using how
    // wide the plate is on screen right now.
    const gameOver = document.createElement('div');
    Object.assign(gameOver.style, {
        position: 'fixed', left: '50%', top: '50%', transform: 'translate(-50%, -50%)',
        zIndex: 6, display: 'none', pointerEvents: 'none', textAlign: 'center',
        color: RULES.gameOverColor,
    });
    document.body.appendChild(gameOver);
    function layoutGameOver() {
        const { THREE, camera } = game;
        const r = game.plate?.radius ?? 1;
        const a = new THREE.Vector3(-r, 0, 0).project(camera);
        const b = new THREE.Vector3(r, 0, 0).project(camera);
        const platePx = Math.abs(b.x - a.x) * 0.5 * window.innerWidth; // plate width on screen
        const k = platePx / 1024; // print pixels -> screen pixels
        const px = INTRO.size * k;
        Object.assign(gameOver.style, {
            font: `${RULES.gameOverWeight ?? INTRO.weight} ${px}px/${INTRO.lineHeight} "${INTRO.font}", sans-serif`,
            width: `${INTRO.wrap * 1024 * k}px`, // wraps where the intro would
            webkitTextStroke: `${Math.max(1, px * 0.03)}px ${RULES.gameOverColor}`, // the intro's hairline outline
        });
        gameOver.innerHTML = '';
        for (const line of RULES.gameOverLines) {
            const el = document.createElement('div');
            el.textContent = line;
            gameOver.appendChild(el);
        }
    }
    const showGameOver = (on) => {
        if (on) layoutGameOver();
        gameOver.style.display = on ? 'block' : 'none';
    };
    window.addEventListener('resize', () => { if (gameOver.style.display === 'block') layoutGameOver(); });

    // instant on/off. While the eyes are up, the game screen (not the
    // eyes image, which sits on top of it) gets the "caught" look
    // (remember the normal look first, to switch straight back to it)
    const normalLook = {};
    for (const key of Object.keys(RULES.watchedLook)) {
        const v = RULES.watchedLook[key];
        normalLook[key] = params.look[key] ?? (typeof v === 'string' ? '#ffffff' : 0);
    }
    const showEyes = (on) => {
        eyes.style.display = on ? 'block' : 'none';
        Object.assign(params.look, on ? RULES.watchedLook : normalLook);
    };

    const watcher = new RandomMachine({
        initial: 'away',
        states: {
            away: { duration: RULES.away, next: { watching: 1 }, enter: () => showEyes(false) },
            watching: { duration: RULES.watching, next: { away: 1 }, enter: () => showEyes(true) },
        },
    });

    // ---- counting peas on the plate (read back from the GPU) ----
    let onPlate = 0;
    let lastOnPlate = 0;
    let readGeneration = 0; // ignore answers that arrive after a restart
    let reading = false;
    let readTimer = 0;
    async function countPeas() {
        if (reading || !game.plate) return;
        reading = true;
        const gen = readGeneration;
        const a = new Float32Array(await renderer.getArrayBufferAsync(peas.pos.value));
        reading = false;
        if (gen !== readGeneration) return;
        const r = game.plate.radius;
        let n = 0;
        for (let i = 0; i < a.length; i += 4) {
            if (a[i + 3] > 0.5 && Math.hypot(a[i], a[i + 2]) < r) n++;
        }
        onPlate = n;
    }

    // ---- the round: ready -> spawning -> playing -> caught / won / timeout ----
    let timeLeft = RULES.timeLimit;
    let toSpawn = 0;
    let settle = 0;

    const round = new StateMachine({
        initial: 'ready', // waiting for the intro slides to finish
        states: {
            ready: { on: { begin: 'spawning' } },
            spawning: {
                on: { go: 'playing' },
                enter: () => {
                    intro.clear();
                    game.resetTilt(); // every round starts with the plate level
                    peas.reset(renderer);
                    readGeneration++;
                    onPlate = lastOnPlate = 0;
                    toSpawn = RULES.peas;
                    settle = 1.2; // let them land before the rules apply
                    timeLeft = RULES.timeLimit;
                    watcher.goto('away');
                },
            },
            playing: { on: { caught: 'caught', won: 'won', timeout: 'timeout' } },
            caught: { on: { restart: 'spawning' }, enter: () => { showEyes(true); showGameOver(true); }, exit: () => showGameOver(false) },
            won: { on: { restart: 'spawning' }, enter: () => { showEyes(false); intro.say(['clean plate.', 'space to play again']); } },
            timeout: { on: { restart: 'spawning' }, enter: () => { showEyes(false); showGameOver(true); }, exit: () => showGameOver(false) },
        },
    });

    // start when the intro slides are done (they begin right after this
    // file loads, so wait for the intro to report it has finished)
    intro.onDone = () => round.send('begin');
    if (intro.state === 'done') round.send('begin');

    window.addEventListener('keydown', (e) => {
        if (e.code !== 'Space') return;
        if (['caught', 'won', 'timeout'].includes(round.state)) {
            e.preventDefault();
            round.send('restart');
        }
    });

    game.onFrame((dt) => {
        const s = round.state;

        if (s === 'spawning') {
            // drop the pile in a few peas per frame, around the middle
            if (toSpawn > 0) {
                const a = Math.random() * Math.PI * 2;
                const d = Math.sqrt(Math.random()) * 0.3;
                const n = Math.min(4, toSpawn);
                peas.spawn(Math.cos(a) * d, Math.sin(a) * d, n);
                toSpawn -= n;
            } else {
                settle -= dt;
                readTimer += dt;
                if (readTimer > 0.1) { readTimer = 0; countPeas(); }
                if (settle <= 0) { lastOnPlate = onPlate; round.send('go'); }
            }
        }

        if (s === 'playing') {
            if (!TUNE) timeLeft -= dt;
            watcher.update(dt);
            readTimer += dt;
            if (readTimer > 0.1) { readTimer = 0; countPeas(); }

            // a pea left the plate: fine if no one's looking...
            if (TUNE) {
                // hold the eyes and their look on, and never get caught
                if (watcher.state !== 'watching') { watcher.goto('watching'); watcher.duration = Infinity; }
                Object.assign(params.look, RULES.watchedLook);
                lastOnPlate = onPlate;
            }
            if (onPlate < lastOnPlate) {
                if (watcher.state === 'watching') round.send('caught');
                lastOnPlate = onPlate;
            }
            if (round.state === 'playing' && onPlate === 0) round.send('won');
            if (round.state === 'playing' && timeLeft <= 0) round.send('timeout');
        }

        // HUD
        const t = Math.max(0, Math.ceil(timeLeft));
        const clock = `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
        hud.textContent = round.state === 'ready' ? '' : `${clock}\npeas ${onPlate}`;
    });

    // handy for testing from the console
 // ---- tuning mode: a panel folder for the eyes' look ----
    if (TUNE) {
        const pane = game.pane;
        pane.expanded = true;
        // keep the eyes up the whole time
        watcher.goto('watching');
        watcher.duration = Infinity;
        const W = RULES.watchedLook;
        const f = pane.addFolder({ title: 'EYES FILTER (tuning)', index: 0 });
        // a slider for every setting in watchedLook (anything you add there
        // gets one too, if it's listed here)
        const RANGES = {
            opacity: { label: 'opacity', min: 0, max: 1 },
            jpeg: { label: 'block size', min: 0, max: 48, step: 1 },
            jpegDetail: { label: 'block detail', min: 0, max: 1 },
            jpegChroma: { label: 'colour blotches', min: 0, max: 0.5 },
            blur: { label: 'blur', min: 0, max: 6 },
            resolution: { label: 'resolution', min: 0.1, max: 1 },
            pixelate: { label: 'flat mosaic', min: 0, max: 60, step: 1 },
            mosaicSharpen: { label: 'mosaic sharpen', min: 0, max: 10 },
            shadows: { label: 'shadow color' },
            shadowAmount: { label: 'shadow amount', min: 0, max: 3 },
            highlights: { label: 'highlight color' },
            highlightAmount: { label: 'highlight amount', min: 0, max: 2 },
            contrast: { min: 0.5, max: 2 },
            saturation: { min: 0, max: 2 },
            fade: { label: 'faded blacks', min: 0, max: 0.4 },
            levels: { label: 'color steps', min: 2, max: 255, step: 1 },
            grain: { min: 0, max: 0.5 },
            blackPoint: { label: 'black shadows', min: 0, max: 0.6 },
            multiplyColor: { label: 'multiply color' },
            multiplyAmount: { label: 'multiply amount', min: 0, max: 1 },
        };
        for (const key of Object.keys(W)) f.addBinding(W, key, RANGES[key] ?? {});
        // copy the numbers to paste over watchedLook in game.js
        const copyBtn = f.addButton({ title: 'copy settings for game.js' });
        copyBtn.on('click', async () => {
            const round2 = (v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v);
            const lines = Object.entries(W).map(([k, v]) => `        ${k}: ${JSON.stringify(round2(v))},`);
            const text = `    watchedLook: {\n${lines.join('\n')}\n    },`;
            try { await navigator.clipboard.writeText(text); } catch { /* clipboard blocked */ }
            console.log(text);
            copyBtn.title = 'copied! paste over watchedLook in game.js';
            setTimeout(() => { copyBtn.title = 'copy settings for game.js'; }, 2500);
        });
        hud.style.display = 'none';
    }

    window.minigame = { round, watcher, RULES, get onPlate() { return onPlate; }, get timeLeft() { return timeLeft; } };
}
