# Play With Your Food

pick a plate > pick a food > pick a utensil > place and shape > serve

## Two modes, one codebase

The same site runs as two things:

| | URL | what it is |
| --- | --- | --- |
| **project** | `final/` | the ongoing final project |
| **minigame** | `final/?minigame` (or `final/minigame.html`) | the mini game assignment |

Every edit goes in one of three places:

| edit for | where | affects |
| --- | --- | --- |
| **both** | `js/*.js` (main, plates, peas, sauce, look, tray, intro...) and `assets/` | both modes |
| **project only** | `js/project/` | only `final/` |
| **minigame only** | `js/minigame/` and `assets/minigame/` | only `final/?minigame` |

Mode code gets a `game` object (defined at the bottom of `js/main.js`) with
the scene, peas, sauce, plate, params, `onFrame(fn)` and `setPrompt(text)`.
If a mode needs something new from the shared scene, add it to `game`.

The mini game can have its own look: export a preset while on
`final/?minigame` and save it as `assets/minigame/preset.json`.

Commit messages: start them with `[both]`, `[project]` or `[minigame]`.

## Running it

ES modules don't load from `file://`, so run a tiny local server from the repo root:

```
cd ~/Documents/GitHub/CandiceLee_cfgi
python3 -m http.server 8000
```

Then open http://localhost:8000/final/

On GitHub Pages it just works (no build step). After you push, it's at
`https://clee30-collab.github.io/CandiceLee_cfgi/final/`.

## Stack

- **three.js r180 (WebGPURenderer)**, loaded from a CDN via the import map in `index.html`.
  Uses WebGPU on your M2 (Chrome / Edge / Safari 26+), falls back to WebGL2 elsewhere.
- **TSL**: three.js's way of writing shaders in JS. Used for the pea compute shader.
- **Tweakpane 4.0.5**: `lib/tweakpane-4.0.5.min.js`, imported in `js/gui.js`.

## Files

| file | what it does |
| --- | --- |
| `js/main.js` | scene, lights, input, game-flow + mood state machines, render loop |
| `js/params.js` | every tunable value (Tweakpane edits this object) |
| `js/stateMachine.js` | `StateMachine` (event driven) + `RandomMachine` (weighted, timed) |
| `js/peas.js` | **compute shader**: pea physics on the GPU (bowl slope, rim, utensils, collisions) |
| `js/sauce.js` | sauce paint tool: paints color + height canvases |
| `js/normalmap.js` | height → **normal map** (Sobel), and image → normal map for 2D art |
| `js/cards.js` | 2D images placed in 3D with normal maps + fake drop shadow |
| `js/parallax.js` | camera swings with the mouse → **parallax depth** |
| `js/plates.js` | dinner plate / bowl / paper plate (lathe geometry) |
| `js/models.js` | loads your Blender `.glb` models (see `assets/models/README.md`) |
| `js/gui.js` | Tweakpane panel + asset buttons (export/load preset, bake normal map PNG) |

## Using Tweakpane to build assets

1. Tune sliders until a food looks/behaves right.
2. **export preset** downloads a JSON → save it in `assets/presets/`.
3. **bake sauce normal map** downloads the current normal map PNG.
4. Drop your own drawings (transparent PNGs) in `assets/` and use
   `loadCard('assets/your-thing.png', { width: 0.3 })` from `cards.js` to put them in the scene with an auto normal map.

## Next foods (from the proposal)

- **rice**: same compute pattern as peas, smaller oval grains, add a "stickiness" force toward neighbours so it clumps.
- **noodles**: chain of points (verlet rope) in a compute shader, with a minimum bend angle constraint.
- **jello**: spring-mass cube, or a vertex shader wobble driven by a `RandomMachine` (still / wobble / jiggle).
- **anchovy**: a 2D card (`cards.js`) bent along a curve, high metalness for the shine.
- **sprinkles/scallions**: spawn like peas, random rotation per instance via `hash(instanceIndex)`.
- **knife cutting food**: right now the knife cuts sauce; for peas/jello, mark instances as "cut" in the compute shader.
- **performance**: pea collisions are brute force (every pea checks every pea). A spatial grid would scale to 50k+ grains for rice.

## Credits

- The paint effects in the photo filter (`js/look.js`): wobble, row jitter, soft ink edges and the cream paper colour, are adapted from the Shadertoy [Xt2GWc](https://www.shadertoy.com/view/Xt2GWc) by **104** (carlco@gmail.com).
- Room lighting: the HDRI [Monochrome Studio 02](https://polyhaven.com/a/monochrome_studio_02) by Grzegorz Wronkowski, [Poly Haven](https://polyhaven.com) (CC0), shrunk to 512×256 in `assets/hdri/`.
- Alternative room light (kept in `assets/hdri/`): [Lebombo](https://polyhaven.com/a/lebombo) by Greg Zaal, [Poly Haven](https://polyhaven.com) (CC0).
- Plate print fonts: [Figtree](https://fonts.google.com/specimen/Figtree) by Erik Kennedy and [Commissioner](https://fonts.google.com/specimen/Commissioner) by Kostas Bartsokas (both SIL Open Font License), via Google Fonts.
- [three.js](https://threejs.org) (MIT license)
- [Tweakpane](https://tweakpane.github.io/docs/) by cocopon (MIT license)
