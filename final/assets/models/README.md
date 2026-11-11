# models

Put your Blender `.glb` exports here, then list them in `js/models.js`.

## Exporting from Blender

File → Export → **glTF 2.0 (.glb/.gltf)**

- Format: **glTF Binary (.glb)**
- Include: Selected Objects (if you only want one thing)
- Transform: **+Y Up** checked
- Data → Mesh: **Apply Modifiers** checked
- Materials: Export

Use Principled BSDF materials (Base Color, Metallic, Roughness, Normal Map). They come through as-is.

## Size and orientation

1 Blender metre = 1 unit in the scene.

| model | size | how it should sit in Blender |
| --- | --- | --- |
| fork / spoon / knife | ~0.7 m long | lying flat, origin in the middle, tip pointing to **+Y** |
| napkin | ~0.55 m square | lying flat, origin in the middle |
| pea (or one grain) | any | origin in the middle. It's rescaled to the "size" slider |
| dinner plate / bowl / paper plate | 2 m wide | sitting on the ground (z = 0), centred |

If something comes in sideways or too big, fix it in `js/models.js` with
`rotation: [x, y, z]` (degrees) or `scale` instead of re-exporting.

## Keep it light

A few thousand triangles per model is plenty. For detail, sculpt a
high-poly version and **bake a normal map** onto a low-poly one
(Render Properties → Bake → Normal).
