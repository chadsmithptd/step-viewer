# Body of Revolution Analysis — Disabled for Performance

## Why it was disabled

`analyzeBodyOfRevolution()` was removed from the model-load path because it runs 2–5 seconds of synchronous computation on the main thread, causing visible UI lag on every model load. It has zero effect on face classification, feature detection, holes, bosses, planes, cones, fillets, or corners.

## What it does

Determines whether a part is a **body of revolution** (lathe / turned part) by performing a voxel IoU (Intersection over Union) test: it rasterizes the part's XY footprint into a 48-grid voxel space, rotates it 180° around a candidate axis, and measures how much the two voxel sets overlap. ≥90% overlap → `isBodyOfRevolution: true`.

**Output object:**
```js
{
  isBodyOfRevolution: true,       // boolean — true when overlapPercent >= 90
  axis:           { x, y, z },   // detected symmetry axis (unit vector)
  axisOrigin:     { x, y, z },   // centroid of the part
  overlapPercent: 94.5,           // 0–100 confidence score
  axisSource:     'cylinder',     // 'pca' | 'cylinder' — how the axis was found
  pcaEigenvalues: [a, b, c],      // PCA eigenvalues (diagnostic)
  candidatesTested: [             // all axes tested with their scores
    { source, axis, overlapPercent }
  ]
}
```

This result was exposed as the **`bodyOfRevolution` internal variable** in the WeWeb editor, and also populated `featureModel.symmetry` and `featureModel.summary.isBodyOfRevolution`.

## How to reactivate

**Step 1** — In `src/wwElement.vue`, find the comment at approximately line 2219 (search for `"Body of Revolution analysis disabled"`):

```js
// Body of Revolution analysis disabled for performance — see docs/reactivate-body-of-revolution.md
// ── Phase 1: Build structured feature model ───────────────────────────
currentFeatureModel = buildFeatureModel(mergedCylinders, allFaces, cornerResult, null, partProps.boundingBox)
```

Replace with:

```js
// Body of Revolution test — voxel IoU against a 180°-rotated copy
const bor = analyzeBodyOfRevolution(mergedCylinders)
setBodyOfRevolutionVar(bor)

// ── Phase 1: Build structured feature model ───────────────────────────
currentFeatureModel = buildFeatureModel(mergedCylinders, allFaces, cornerResult, bor, partProps.boundingBox)
```

**Step 2** — That's it. `analyzeBodyOfRevolution()` and `setBodyOfRevolutionVar()` are still defined in the component and will work immediately. No other changes needed.

## Where the function lives

Search for `const analyzeBodyOfRevolution` in `src/wwElement.vue` — approximately line 1175. The function is ~120 lines long and is entirely self-contained (no external dependencies beyond Three.js geometry data passed in as arguments).

## If you want to move it off the main thread instead

The function is pure math — it receives plain JS arrays of cylinder face data and returns a plain object. It has no Three.js, DOM, or Vue dependencies. It is a good candidate for a Web Worker. To do that:

1. Extract the function body into `src/workers/bodyOfRevolution.worker.js`
2. Post `mergedCylinders` to the worker after model load
3. Receive the result asynchronously and call `setBodyOfRevolutionVar(bor)` + re-run `buildFeatureModel` with the result

This would eliminate the main-thread block entirely while keeping the feature active.
