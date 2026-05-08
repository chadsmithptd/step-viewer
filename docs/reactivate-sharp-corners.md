# Sharp Corner Detection — Disabled for Performance

## Why it was disabled

`detectSharpCorners()` was removed from the model-load path because it was causing browser crashes on large models. It runs synchronously on the main thread using a triple-nested 3×3×3 spatial hash loop that scales badly with mesh density, consuming 100ms–1s+ and potentially exhausting memory on complex geometry. The three watchers that re-ran it on prop changes were also removed.

It has no effect on hole detection, face classification (planar, conical, toroidal), bosses, fillets, or any other feature detection.

## What it does

Detects edges where two faces meet at a non-90° dihedral angle and classifies them as **acute** (<90° − tolerance) or **obtuse** (>90° + tolerance). Results are rendered as colored line overlays on the model and exposed as the `sharpCorners` internal variable.

**Output object (`cornerResult`):**
```js
{
  data: [
    {
      meshName:   'Mesh_0',
      objectName: 'Part',
      angle:      74.3,          // dihedral angle in degrees
      type:       'acute',       // 'acute' | 'obtuse'
      g1, g2,                    // geometry group indices of the two faces
      v1, v2,                    // endpoint vertices of the shared edge
    },
    // ...
  ],
  rawEdges: []
}
```

This fed into:
- The `sharpCorners` internal variable (exposed to NoCode workflows)
- `buildFeatureModel()` → `corners.acute` / `corners.obtuse` arrays
- `featureModel.summary.acuteCornerCount` / `obtuseCornerCount`
- The `sharp-corners-detected` trigger event
- The corner line overlays rendered on the model (colored by `acuteCornerColor` / `obtuseCornerColor`)
- Design rules targeting `corner` feature type

## How to reactivate

**Step 1** — In `src/wwElement.vue`, find the comment near the model-load section (search for `"Sharp corner detection disabled"`):

```js
// Sharp corner detection disabled for performance — see docs/reactivate-sharp-corners.md
const cornerResult = null
```

Replace with:

```js
// Detect and render sharp / non-90° corners
const cornerResult = detectSharpCorners(props.content?.cornerAngleTolerance ?? 10)
cornersData = cornerResult.data
setSharpCornersVar(cornersData)
buildCornerOverlays(cornersData)
emit('trigger-event', {
  name:  'sharp-corners-detected',
  event: {
    corners:     cornersData,
    acuteCount:  cornersData.filter(c => c.type === 'acute').length,
    obtuseCount: cornersData.filter(c => c.type === 'obtuse').length,
  },
})
```

**Step 2** — Find the comment `// Corner watchers disabled` in the watchers section and replace it with:

```js
// Re-detect when tolerance changes; rebuild lines when toggle or colors change
watch(() => props.content?.cornerAngleTolerance, () => {
  if (!libsReady.value || !loadedModel) return
  const result = detectSharpCorners(props.content?.cornerAngleTolerance ?? 10)
  cornersData = result.data
  setSharpCornersVar(cornersData)
  buildCornerOverlays(cornersData)
  emit('trigger-event', {
    name:  'sharp-corners-detected',
    event: {
      corners:     cornersData,
      acuteCount:  cornersData.filter(c => c.type === 'acute').length,
      obtuseCount: cornersData.filter(c => c.type === 'obtuse').length,
    },
  })
})

watch(() => props.content?.showCorners, () => {
  if (libsReady.value && loadedModel) buildCornerOverlays(cornersData)
})

watch(() => [props.content?.acuteCornerColor, props.content?.obtuseCornerColor], () => {
  if (libsReady.value && loadedModel) buildCornerOverlays(cornersData)
})
```

**Step 3** — That's it. `detectSharpCorners()`, `buildCornerOverlays()`, and all related state are still fully defined in the component and will work immediately.

## Where the function lives

Search for `const detectSharpCorners` in `src/wwElement.vue` — approximately line 1561. It is ~240 lines long. `buildCornerOverlays` follows it at approximately line 1814.

## If you want to move it off the main thread instead

`detectSharpCorners` is a good Web Worker candidate — it only needs the mesh geometry data (positions + indices), the world matrix per mesh, and the tolerance value. It has no Three.js renderer, scene, or DOM dependencies. To do that:

1. Extract the spatial-hash logic into `src/workers/sharpCorners.worker.js`, passing serialized geometry buffers via `postMessage`
2. Receive the corner array asynchronously after model load
3. Call `buildCornerOverlays(cornersData)` and emit `sharp-corners-detected` in the worker's `onmessage` handler

This would restore the feature with zero impact on model-load time.
