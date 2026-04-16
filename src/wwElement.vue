<template>
  <div ref="rootRef" class="step-viewer" :style="rootStyle">
    <!-- Main WebGL canvas -->
    <canvas
      ref="canvasRef"
      class="viewer-canvas"
      @pointerdown="onPointerDown"
      @click="onCanvasClick"
      @contextmenu.prevent
    />

    <!-- Loading overlay (CDN libs + model) -->
    <div v-if="isLoading" class="viewer-overlay loading-overlay">
      <div class="spinner"></div>
      <span class="overlay-text">{{ loadingMsg }}</span>
    </div>

    <!-- Error overlay -->
    <div v-if="errorMsg" class="viewer-overlay error-overlay">
      <span class="overlay-text">⚠ {{ errorMsg }}</span>
    </div>

    <!-- Upload zone — shown whenever no model is loaded -->
    <div
      v-if="!modelLoaded && !isLoading"
      class="viewer-overlay upload-zone"
      @dragover.prevent="onDragOver"
      @dragleave="onDragLeave"
      @drop.prevent="onDrop"
      :class="{ 'drag-active': isDragging }"
      @click="triggerFileUpload"
    >
      <div class="upload-icon">
        <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </div>
      <span class="upload-title">Drop a GLB file here</span>
      <span class="upload-sub">or click to browse</span>
    </div>

    <!-- Hidden file input -->
    <input
      ref="fileInputRef"
      type="file"
      accept=".glb,.gltf"
      class="file-input-hidden"
      @change="onFileSelected"
    />

    <!-- Controls panel (top-right) -->
    <div v-show="libsReady" class="controls-panel">
      <!-- Home / Reset -->
      <button class="ctrl-btn" title="Reset View" @click="resetCamera">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </button>

      <!-- Rotate left / right -->
      <div class="rotate-btns">
        <button class="ctrl-btn" title="Rotate Left" @click="rotateLeft">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="1 4 1 10 7 10"/>
            <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
          </svg>
        </button>
        <button class="ctrl-btn" title="Rotate Right" @click="rotateRight">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <polyline points="23 4 23 10 17 10"/>
            <path d="M20.49 15a9 9 0 1 1-.49-4.5"/>
          </svg>
        </button>
      </div>

      <!-- Upload / replace model -->
      <button class="ctrl-btn" title="Load GLB file" @click="triggerFileUpload">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </button>
    </div>

    <!-- Selection badge -->
    <div v-if="selectionLabel" class="selection-badge">
      {{ selectionLabel }}
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

// ─── CDN URLs (loaded at runtime, bypassing webpack) ─────────────────────────
const CDN = 'https://esm.sh/three@0.162.0'

// Module-level cache so libs are fetched once per page load
let THREE         = null
let OrbitControls = null
let GLTFLoader    = null

const loadLibs = async () => {
  if (THREE) return
  const [t, c, g] = await Promise.all([
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/controls/OrbitControls'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/loaders/GLTFLoader'),
  ])
  THREE         = t
  OrbitControls = c.OrbitControls
  GLTFLoader    = g.GLTFLoader
}

// ─── Document / window helpers (WeWeb-safe) ───────────────────────────────────
const getDoc = () => (typeof wwLib !== 'undefined' ? wwLib.getFrontDocument() : document)
const getWin = () => (typeof wwLib !== 'undefined' ? wwLib.getFrontWindow() : window)

export default {
  props: {
    uid:     { type: String, required: true },
    content: { type: Object, required: true },
    /* wwEditor:start */
    wwEditorState: { type: Object, required: true },
    /* wwEditor:end */
  },
  emits: ['trigger-event'],
  setup(props, { emit }) {
    // ─── DOM refs ────────────────────────────────────────────────────────────
    const rootRef      = ref(null)
    const canvasRef    = ref(null)
    const fileInputRef = ref(null)

    // ─── UI state ────────────────────────────────────────────────────────────
    const isLoading      = ref(false)
    const loadingMsg     = ref('Initializing…')
    const errorMsg       = ref('')
    const selectionLabel = ref('')
    const libsReady      = ref(false)
    const modelLoaded    = ref(false)
    const isDragging     = ref(false)

    /* wwEditor:start */
    const isEditing = computed(() => props.wwEditorState?.isEditing)
    /* wwEditor:end */

    // ─── Formula resolution (WeWeb) ───────────────────────────────────────────
    const resolveMappingFormula = (typeof wwLib !== 'undefined' && wwLib.wwFormula?.useFormula)
      ? wwLib.wwFormula.useFormula().resolveMappingFormula
      : null

    // ─── Internal variable — exposes multi-selection to NoCode flows ──────────
    const _wwVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'multiSelection',
          type:         'array',
          defaultValue: [],
        })
      : null
    const setMultiSelectionVar = (val) => _wwVar?.setValue?.(val)

    const _wwPartPropsVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'partProperties',
          type:         'object',
          defaultValue: null,
        })
      : null
    const setPartPropertiesVar = (val) => _wwPartPropsVar?.setValue?.(val)

    const _wwCenterVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'centerOfRotation',
          type:         'object',
          defaultValue: { x: 0, y: 0, z: 0 },
        })
      : null
    const setCenterOfRotationVar = (val) => _wwCenterVar?.setValue?.(val)

    const _wwFacesVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'faces',
          type:         'array',
          defaultValue: [],
        })
      : null
    const setFacesVar = (val) => _wwFacesVar?.setValue?.(val)

    const _wwBoRVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'bodyOfRevolution',
          type:         'object',
          defaultValue: null,
        })
      : null
    const setBodyOfRevolutionVar = (val) => _wwBoRVar?.setValue?.(val)

    // ─── Three.js objects (plain vars – no Vue reactivity overhead) ───────────
    let renderer       = null
    let scene          = null
    let camera         = null
    let controls       = null
    let raycaster      = null
    let animFrameId    = null
    let resizeObserver = null
    let loadedModel    = null
    let gridHelper     = null
    let facesData      = []   // unified face list for click enrichment

    let clickableMeshes    = []
    // Multi-selection: [{mesh, groupIndex, overlay, faceIndex, point, normal, meshName, objectName, userData}]
    let selections         = []
    // Annotation overlays: [{mesh, groupIndex, overlay, annotation}]
    let annotationOverlays = []

    let modelRadius           = 5
    let snapAnim              = null
    let controlsChangeHandler = null
    let originalMaterials     = new Map()   // mesh → original material(s)
    let overrideMaterials     = []          // disposable override materials
    let pointerDownPos = null
    let isShiftHeld    = false

    let defaultCameraPos     = null
    let defaultTarget        = null
    let focusedHoleOverlays  = []

    // ─── Computed ─────────────────────────────────────────────────────────────
    const rootStyle = computed(() => ({
      width:      '100%',
      height:     '100%',
      position:   'relative',
      overflow:   'hidden',
      background: props.content?.backgroundColor || 'transparent',
    }))

    // Resolved annotation array — handles formula field mapping
    const processedAnnotations = computed(() => {
      const items = props.content?.annotations
      if (!Array.isArray(items) || !items.length) return []
      return items.map(item => {
        let point  = item.point
        let normal = item.normal
        if (resolveMappingFormula) {
          point  = resolveMappingFormula(props.content?.annotationPointFormula,  item) ?? item.point
          normal = resolveMappingFormula(props.content?.annotationNormalFormula, item) ?? item.normal
        }
        return { ...item, point, normal }
      })
    })

    // ─── Helpers ──────────────────────────────────────────────────────────────
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)

    const isDataUrl = (s) => typeof s === 'string' && s.startsWith('data:')
    const isHttpUrl = (s) => typeof s === 'string' &&
      (s.startsWith('http') || s.startsWith('/') || s.startsWith('blob:'))

    const decodeBase64ToBuffer = (b64) => {
      const raw  = atob(b64)
      const buf  = new ArrayBuffer(raw.length)
      const view = new Uint8Array(buf)
      for (let i = 0; i < raw.length; i++) view[i] = raw.charCodeAt(i)
      return buf
    }

    const disposeObject = (obj) => {
      obj.traverse((child) => {
        if (!child.isMesh) return
        child.geometry?.dispose()
        const mats = Array.isArray(child.material) ? child.material : [child.material]
        mats.forEach((m) => m?.dispose())
      })
    }

    // Return the geometry group's materialIndex for a given triangle faceIndex
    const getGroupIndex = (mesh, faceIndex) => {
      const geo = mesh.geometry
      if (geo.groups?.length > 0) {
        const triOffset = faceIndex * 3
        const group = geo.groups.find(g => triOffset >= g.start && triOffset < g.start + g.count)
        if (group) return group.materialIndex ?? 0
      }
      return 0
    }

    // ─── Face geometry analysis ───────────────────────────────────────────────
    // Classifies the clicked face and computes diameter/depth for cylindrical faces.
    const analyzeFaceGeometry = (mesh, faceIndex) => {
      const geo     = mesh.geometry
      const posAttr = geo.attributes.position
      const normAttr = geo.attributes.normal
      if (!posAttr || posAttr.count < 3) return { faceType: 'unknown', diameter: null, depth: null, axis: null }

      // Determine index range for the clicked group
      let idxStart = 0
      let idxCount = geo.index ? geo.index.count : posAttr.count
      if (geo.groups?.length > 0) {
        const triOffset = faceIndex * 3
        const group = geo.groups.find(g => triOffset >= g.start && triOffset < g.start + g.count)
        if (group) { idxStart = group.start; idxCount = group.count }
      }

      // Collect unique vertex indices then sample up to 128
      const raw = []
      if (geo.index) {
        const arr = geo.index.array
        for (let i = idxStart; i < idxStart + idxCount; i++) raw.push(arr[i])
      } else {
        for (let i = idxStart; i < idxStart + idxCount; i++) raw.push(i)
      }
      const unique  = [...new Set(raw)]
      const step    = Math.max(1, Math.floor(unique.length / 128))
      const sampled = unique.filter((_, i) => i % step === 0)

      // World-space positions and normals
      mesh.updateWorldMatrix(true, false)
      const wm = mesh.matrixWorld
      const nm = new THREE.Matrix3().getNormalMatrix(wm)

      const positions = sampled.map(i =>
        new THREE.Vector3(posAttr.getX(i), posAttr.getY(i), posAttr.getZ(i)).applyMatrix4(wm)
      )
      const normals = normAttr
        ? sampled.map(i =>
            new THREE.Vector3(normAttr.getX(i), normAttr.getY(i), normAttr.getZ(i))
              .applyMatrix3(nm).normalize()
          )
        : []

      if (positions.length < 3) return { faceType: 'unknown', diameter: null, depth: null, axis: null }

      // Centroid
      const centroid = new THREE.Vector3()
      positions.forEach(p => centroid.add(p))
      centroid.divideScalar(positions.length)

      const round = v => Math.round(v * 1000) / 1000

      // ── Classify via normal variance ────────────────────────────────────────
      if (normals.length >= 4) {
        const n0 = normals[0].clone().normalize()
        const allParallel = normals.every(n => Math.abs(n.dot(n0)) > 0.97)

        if (!allParallel) {
          // Find cylinder axis: cross product of two non-parallel normals
          let axisVec = null
          for (let i = 1; i < normals.length; i++) {
            const cross = n0.clone().cross(normals[i])
            if (cross.length() > 0.15) { axisVec = cross.normalize(); break }
          }

          if (axisVec) {
            // Dot products of all normals against the axis candidate
            const dots     = normals.map(n => n.dot(axisVec))
            const meanDot  = dots.reduce((a, b) => a + b, 0) / dots.length
            const stdDot   = Math.sqrt(dots.reduce((a, d) => a + (d - meanDot) ** 2, 0) / dots.length)

            // Confirm all normals are perpendicular to the axis (radial)
            const isCylindrical = normals.every(n => Math.abs(n.dot(axisVec)) < 0.3)
            if (isCylindrical) {
              const axialVals = positions.map(p => p.clone().sub(centroid).dot(axisVec))
              const radii = positions.map(p => {
                const v   = p.clone().sub(centroid)
                const axC = axisVec.clone().multiplyScalar(v.dot(axisVec))
                return v.sub(axC).length()
              })
              const radius = radii.reduce((a, b) => a + b, 0) / radii.length
              const depth  = Math.max(...axialVals) - Math.min(...axialVals)

              // Measure angular coverage: project normals onto axis-perpendicular plane,
              // sort angles, find the largest gap — a full 360° surface has no large gaps.
              const refVec = Math.abs(axisVec.x) < 0.9
                ? new THREE.Vector3(1, 0, 0)
                : new THREE.Vector3(0, 1, 0)
              const perp1  = refVec.clone().cross(axisVec).normalize()
              const perp2  = axisVec.clone().cross(perp1).normalize()
              const angles = normals.map(n => Math.atan2(n.dot(perp2), n.dot(perp1))).sort((a, b) => a - b)
              let maxGap   = (angles[0] + 2 * Math.PI) - angles[angles.length - 1]
              for (let i = 1; i < angles.length; i++) maxGap = Math.max(maxGap, angles[i] - angles[i - 1])
              const arcDeg = Math.round((2 * Math.PI - maxGap) * (180 / Math.PI))
              const is360  = maxGap < (35 * Math.PI / 180)   // gap < 35° → full revolution

              return {
                faceType:  'cylindrical',
                diameter:  round(radius * 2),
                depth:     round(depth),
                axis:      { x: round(axisVec.x), y: round(axisVec.y), z: round(axisVec.z) },
                arcDeg,
                is360,
                _centroid: centroid,
              }
            }

            // Normals at a constant non-zero angle to the axis → cone
            if (stdDot < 0.12 && Math.abs(meanDot) > 0.1) {
              const halfAngle = Math.round(Math.acos(Math.min(1, Math.abs(meanDot))) * 180 / Math.PI)
              return {
                faceType:  'conical',
                halfAngle,
                axis:      { x: round(axisVec.x), y: round(axisVec.y), z: round(axisVec.z) },
                _centroid: centroid,
              }
            }

            // Normals vary in angle to a consistent axis → torus (fillet / blend surface)
            return { faceType: 'toroidal', _centroid: centroid }
          }
        }

        if (allParallel) {
          // Planar face — check if boundary is circular
          const dists = positions.map(p => p.distanceTo(centroid))
          const maxD  = Math.max(...dists)
          const avgD  = dists.reduce((a, b) => a + b, 0) / dists.length
          const stdD  = Math.sqrt(dists.reduce((a, d) => a + (d - avgD) ** 2, 0) / dists.length)
          const isCircular = avgD > 0 && (stdD / avgD) < 0.35
          return {
            faceType: 'planar',
            shape:    isCircular ? 'circular' : 'other',
            diameter: isCircular ? round(maxD * 2) : null,
            depth:    null,
            axis:     { x: round(n0.x), y: round(n0.y), z: round(n0.z) },
          }
        }
      }

      return { faceType: 'unknown', diameter: null, depth: null, axis: null }
    }

    // ─── Full-model face scan (runs once on load) ─────────────────────────────
    // Returns every face on every mesh. Cylindrical faces include isConcave/isHole
    // via the concavity test; all other surface types get isHole: false.
    const buildAllFaces = () => {
      const typeLabel = {
        planar:      'Plane',
        cylindrical: 'Cylinder',
        conical:     'Cone',
        toroidal:    'Torus',
        unknown:     'Unknown',
      }
      const round   = v => Math.round(v * 1000) / 1000
      const results = []

      for (const mesh of clickableMeshes) {
        const geo = mesh.geometry
        if (!geo?.attributes?.position) continue

        const groups = geo.groups?.length > 0
          ? geo.groups
          : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count, materialIndex: 0 }]

        for (const group of groups) {
          const faceIndex = Math.floor(group.start / 3)
          const result    = analyzeFaceGeometry(mesh, faceIndex)

          let isConcave = null
          let isHole    = false

          if (result.faceType === 'cylindrical' && result._centroid) {
            const posAttr  = geo.attributes.position
            const normAttr = geo.attributes.normal
            if (posAttr && normAttr) {
              mesh.updateWorldMatrix(true, false)
              const wm = mesh.matrixWorld
              const nm = new THREE.Matrix3().getNormalMatrix(wm)
              const vi  = geo.index ? geo.index.array[group.start] : group.start
              const pos = new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(wm)
              const nor = new THREE.Vector3(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).applyMatrix3(nm).normalize()
              // Concave (normals point toward axis center) → candidate hole piece.
              // A single piece only qualifies as a full hole if it wraps the full 360°;
              // partial arcs are promoted later by mergeCylinders when combined arc ≥ 300°.
              isConcave = result._centroid.clone().sub(pos).dot(nor) > 0
              isHole    = isConcave && (result.is360 === true)
            }
          }

          const c = result._centroid
          results.push({
            meshName:      mesh.name || '',
            objectName:    mesh.parent?.name || mesh.name || '',
            materialIndex: group.materialIndex ?? 0,
            surfaceType:   typeLabel[result.faceType] ?? 'Unknown',
            diameter:      result.diameter  ?? null,
            depth:         result.depth     ?? null,
            halfAngle:     result.halfAngle ?? null,
            arcDeg:        result.arcDeg    ?? null,
            axis:          result.axis      ?? null,
            center:        c ? { x: round(c.x), y: round(c.y), z: round(c.z) } : null,
            isConcave,
            isHole,
          })
        }
      }

      return results
    }

    // ─── Merge split cylinders ────────────────────────────────────────────────
    // B-Rep kernels often split a single cylindrical hole into two 180° half-faces
    // at the parametric seam, or more pieces at feature intersections. This pass
    // groups faces that share the same diameter (±3%), parallel axis (dot > 0.95),
    // and overlapping radial position, then promotes the group to isHole:true when
    // combined arc coverage exceeds 300°.
    const mergeCylinders = (cylinders) => {
      if (!cylinders.length) return cylinders

      const round = v => Math.round(v * 1000) / 1000

      // Flip axis so the largest absolute component is always positive → consistent comparison
      const canonAxis = a => {
        const ax = Math.abs(a.x), ay = Math.abs(a.y), az = Math.abs(a.z)
        const flip = ay >= ax && ay >= az ? a.y < 0
          : ax >= ay && ax >= az         ? a.x < 0
          : a.z < 0
        return flip ? { x: -a.x, y: -a.y, z: -a.z } : { ...a }
      }

      const axisMatch = (a1, a2) => {
        const n1 = canonAxis(a1), n2 = canonAxis(a2)
        return (n1.x*n2.x + n1.y*n2.y + n1.z*n2.z) > 0.95
      }

      // Partial-arc diameters are biased by the centroid-based radius formula
      // (a 180° half reports ~0.82× the true radius). Loosened to 8% to tolerate
      // that bias while still rejecting genuinely different cylinders.
      const diamMatch = (d1, d2) =>
        d1 && d2 && Math.abs(d1 - d2) / Math.max(d1, d2) < 0.08

      // Decompose (c2 - c1) into axial (parallel to axis) and radial (perp) components.
      const decomposeCenters = (c1, c2, ax) => {
        if (!c1 || !c2) return null
        const dx = c2.x-c1.x, dy = c2.y-c1.y, dz = c2.z-c1.z
        const proj = dx*ax.x + dy*ax.y + dz*ax.z
        const rx = dx - proj*ax.x, ry = dy - proj*ax.y, rz = dz - proj*ax.z
        return {
          axial:  Math.abs(proj),
          radial: Math.sqrt(rx*rx + ry*ry + rz*rz),
        }
      }

      const used   = new Set()
      const merged = []

      for (let i = 0; i < cylinders.length; i++) {
        if (used.has(i)) continue
        const base = cylinders[i]
        if (!base.diameter || !base.axis) { merged.push(base); used.add(i); continue }

        const normAx = canonAxis(base.axis)
        const group  = [i]

        for (let j = i + 1; j < cylinders.length; j++) {
          if (used.has(j)) continue
          const cand = cylinders[j]
          if (!cand.diameter || !cand.axis) continue
          if (!diamMatch(base.diameter, cand.diameter)) continue
          if (!axisMatch(base.axis, cand.axis)) continue

          // Same hole = same axial position along the shared axis. Face
          // centroids of split halves sit off-axis (~0.637·R) on opposite
          // sides, so the OLD radial check wrongly rejected true matches —
          // use axial proximity plus a loose radial sanity bound (≤ 1·D)
          // so distant cylinders on the same line aren't merged.
          const d = decomposeCenters(base.center, cand.center, normAx)
          if (!d) continue
          const axialTol = Math.max(base.depth || 0, cand.depth || 0) * 0.6 + base.diameter * 0.1
          if (d.axial  > axialTol)            continue
          if (d.radial > base.diameter * 1.0) continue

          group.push(j)
        }

        group.forEach(idx => used.add(idx))

        if (group.length === 1) { merged.push(base); continue }

        // ── Merge the group ────────────────────────────────────────────────
        const members   = group.map(idx => cylinders[idx])
        const totalArc  = Math.min(360, members.reduce((s, m) => s + (m.arcDeg || 0), 0))
        const avgDiam   = round(members.reduce((s, m) => s + (m.diameter || 0), 0) / members.length)

        // Axial extent: project each center along axis ± half its own depth
        const axialVals = members.flatMap(m => {
          if (!m.center) return []
          const t = m.center.x*normAx.x + m.center.y*normAx.y + m.center.z*normAx.z
          const h = (m.depth || 0) / 2
          return [t - h, t + h]
        })
        const mergedDepth = axialVals.length
          ? round(Math.max(...axialVals) - Math.min(...axialVals))
          : base.depth

        const valid = members.filter(m => m.center)
        const mergedCenter = valid.length ? {
          x: round(valid.reduce((s, m) => s + m.center.x, 0) / valid.length),
          y: round(valid.reduce((s, m) => s + m.center.y, 0) / valid.length),
          z: round(valid.reduce((s, m) => s + m.center.z, 0) / valid.length),
        } : base.center

        // A merged group is a hole when every piece is concave AND combined
        // arc ≥ 300°. Previously this checked `isHole !== false`, but split
        // halves have isHole === false (is360 is false per-piece), so the
        // check was always failing for the exact case it was meant to rescue.
        const allConcave   = members.every(m => m.isConcave === true)
        const isMergedHole = allConcave && totalArc >= 300

        merged.push({
          meshName:    members[0].meshName,
          meshNames:   members.map(m => m.meshName),
          objectName:  base.objectName,
          surfaceType: 'Cylinder',
          diameter:    avgDiam,
          depth:       mergedDepth,
          axis:        { x: round(normAx.x), y: round(normAx.y), z: round(normAx.z) },
          center:      mergedCenter,
          arcDeg:      totalArc,
          isConcave:   allConcave,
          isHole:      isMergedHole,
          merged:      true,
          mergedCount: group.length,
        })
      }

      return merged
    }

    // ─── Part-level geometry analysis (surface area + volume) ────────────────
    // Surface area: sum 0.5|e1×e2| per triangle.
    // Volume: signed-tetrahedra method — v0·(e1×e2)/6 per triangle, then |total|.
    // Requires a closed solid (STEP bodies qualify). Reuses vectors to avoid GC churn.
    const analyzeModelGeometry = (box) => {
      let surfaceArea = 0
      let volume      = 0

      const _v0 = new THREE.Vector3()
      const _v1 = new THREE.Vector3()
      const _v2 = new THREE.Vector3()
      const _e1 = new THREE.Vector3()
      const _e2 = new THREE.Vector3()
      const _cr = new THREE.Vector3()

      for (const mesh of clickableMeshes) {
        mesh.updateWorldMatrix(true, false)
        const wm  = mesh.matrixWorld
        const geo = mesh.geometry
        const pos = geo.attributes.position
        const idx = geo.index
        if (!pos) continue

        const triCount = idx ? idx.count / 3 : pos.count / 3

        for (let t = 0; t < triCount; t++) {
          const i0 = idx ? idx.getX(t * 3)     : t * 3
          const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
          const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2

          _v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(wm)
          _v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(wm)
          _v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(wm)

          _e1.subVectors(_v1, _v0)
          _e2.subVectors(_v2, _v0)
          _cr.crossVectors(_e1, _e2)

          surfaceArea += _cr.length() * 0.5
          volume      += _v0.dot(_cr) / 6
        }
      }

      const round = v => Math.round(v * 100) / 100
      const size  = box.getSize(new THREE.Vector3())

      return {
        surfaceArea: round(surfaceArea),
        volume:      round(Math.abs(volume)),
        boundingBox: {
          min:    { x: round(box.min.x), y: round(box.min.y), z: round(box.min.z) },
          max:    { x: round(box.max.x), y: round(box.max.y), z: round(box.max.z) },
          width:  round(size.x),
          height: round(size.y),
          depth:  round(size.z),
        },
      }
    }

    // ─── Body of Revolution test ──────────────────────────────────────────────
    // Picks the best rotational-symmetry axis (from PCA + dominant cylinder axis
    // candidates) and returns the voxel IoU between the original solid and a
    // copy rotated 180° around that axis. A true body of revolution scores ~100%.

    // Jacobi eigen-decomposition of a 3×3 symmetric matrix. Returns eigenvalues
    // and matching eigenvectors (as Vector3). Used for PCA of vertex positions.
    const jacobi3x3 = (A) => {
      const M = [[A[0][0], A[0][1], A[0][2]], [A[1][0], A[1][1], A[1][2]], [A[2][0], A[2][1], A[2][2]]]
      const V = [[1,0,0],[0,1,0],[0,0,1]]
      for (let iter = 0; iter < 50; iter++) {
        let p = 0, q = 1, maxOff = Math.abs(M[0][1])
        if (Math.abs(M[0][2]) > maxOff) { p = 0; q = 2; maxOff = Math.abs(M[0][2]) }
        if (Math.abs(M[1][2]) > maxOff) { p = 1; q = 2; maxOff = Math.abs(M[1][2]) }
        if (maxOff < 1e-12) break

        let t
        if (M[p][p] === M[q][q]) {
          t = 1
        } else {
          const theta = (M[q][q] - M[p][p]) / (2 * M[p][q])
          t = (theta >= 0 ? 1 : -1) / (Math.abs(theta) + Math.sqrt(1 + theta * theta))
        }
        const c = 1 / Math.sqrt(1 + t * t)
        const s = t * c
        const mpq = M[p][q]
        M[p][p] -= t * mpq
        M[q][q] += t * mpq
        M[p][q] = 0; M[q][p] = 0
        for (let i = 0; i < 3; i++) {
          if (i !== p && i !== q) {
            const mip = M[i][p], miq = M[i][q]
            M[i][p] = c * mip - s * miq; M[p][i] = M[i][p]
            M[i][q] = s * mip + c * miq; M[q][i] = M[i][q]
          }
        }
        for (let i = 0; i < 3; i++) {
          const vip = V[i][p], viq = V[i][q]
          V[i][p] = c * vip - s * viq
          V[i][q] = s * vip + c * viq
        }
      }
      return {
        values: [M[0][0], M[1][1], M[2][2]],
        vectors: [
          new THREE.Vector3(V[0][0], V[1][0], V[2][0]),
          new THREE.Vector3(V[0][1], V[1][1], V[2][1]),
          new THREE.Vector3(V[0][2], V[1][2], V[2][2]),
        ],
      }
    }

    // Solid voxelization via z-column scanline. For each triangle, rasterizes
    // its XY footprint and appends the plane-Z at each cell center to that
    // column's event list. After all triangles, each column's z-events are
    // sorted and odd-parity-filled to mark interior voxels as solid. Optional
    // `rotMatrix` is applied to each vertex before voxelization.
    const voxelizeSolid = (meshes, originVec, halfSize, gridRes, rotMatrix) => {
      const nx = gridRes, ny = gridRes, nz = gridRes
      const minX = originVec.x - halfSize
      const minY = originVec.y - halfSize
      const minZ = originVec.z - halfSize
      const cell = (2 * halfSize) / gridRes
      const invCell = 1 / cell

      const columns = new Array(nx * ny)
      for (let i = 0; i < nx * ny; i++) columns[i] = []

      const v0 = new THREE.Vector3()
      const v1 = new THREE.Vector3()
      const v2 = new THREE.Vector3()

      for (const mesh of meshes) {
        mesh.updateWorldMatrix(true, false)
        const wm = mesh.matrixWorld
        const geo = mesh.geometry
        const pos = geo?.attributes?.position
        const idx = geo?.index
        if (!pos) continue

        const triCount = idx ? idx.count / 3 : pos.count / 3

        for (let t = 0; t < triCount; t++) {
          const i0 = idx ? idx.getX(t * 3)     : t * 3
          const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
          const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2

          v0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(wm)
          v1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(wm)
          v2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(wm)

          if (rotMatrix) {
            v0.applyMatrix4(rotMatrix)
            v1.applyMatrix4(rotMatrix)
            v2.applyMatrix4(rotMatrix)
          }

          const xMin = Math.min(v0.x, v1.x, v2.x)
          const xMax = Math.max(v0.x, v1.x, v2.x)
          const yMin = Math.min(v0.y, v1.y, v2.y)
          const yMax = Math.max(v0.y, v1.y, v2.y)

          const ix0 = Math.max(0,      Math.floor((xMin - minX) * invCell))
          const ix1 = Math.min(nx - 1, Math.floor((xMax - minX) * invCell))
          const iy0 = Math.max(0,      Math.floor((yMin - minY) * invCell))
          const iy1 = Math.min(ny - 1, Math.floor((yMax - minY) * invCell))
          if (ix1 < ix0 || iy1 < iy0) continue

          const ax = v1.x - v0.x, ay = v1.y - v0.y
          const bx = v2.x - v0.x, by = v2.y - v0.y
          const denom = ax * by - bx * ay
          if (Math.abs(denom) < 1e-14) continue // XY-degenerate (edge-on)
          const invDen = 1 / denom
          const z0 = v0.z, dz1 = v1.z - v0.z, dz2 = v2.z - v0.z

          for (let iy = iy0; iy <= iy1; iy++) {
            const py = minY + (iy + 0.5) * cell
            const ryB = py - v0.y
            for (let ix = ix0; ix <= ix1; ix++) {
              const px = minX + (ix + 0.5) * cell
              const rx = px - v0.x
              const u = (rx * by - bx * ryB) * invDen
              const w = (ax * ryB - rx * ay) * invDen
              if (u < 0 || w < 0 || u + w > 1) continue
              const z = z0 + u * dz1 + w * dz2
              columns[iy * nx + ix].push(z)
            }
          }
        }
      }

      const solid = new Uint8Array(nx * ny * nz)
      const nxy = nx * ny
      for (let iy = 0; iy < ny; iy++) {
        for (let ix = 0; ix < nx; ix++) {
          const zs = columns[iy * nx + ix]
          const n = zs.length
          if (n < 2) continue
          zs.sort((a, b) => a - b)
          // Drop a trailing unpaired event (tangent/edge touch) to stay even.
          const pairs = n - (n % 2)
          for (let k = 0; k < pairs; k += 2) {
            const iz0 = Math.max(0,      Math.floor((zs[k]     - minZ) * invCell))
            const iz1 = Math.min(nz - 1, Math.floor((zs[k + 1] - minZ) * invCell))
            for (let iz = iz0; iz <= iz1; iz++) {
              solid[iz * nxy + iy * nx + ix] = 1
            }
          }
        }
      }
      return solid
    }

    // Main BoR analysis — runs on model load. Generates candidate axes from
    // PCA of vertex positions + the dominant cylinder axis, voxelizes the
    // original once in a cube centered on the vertex centroid, then for each
    // candidate voxelizes a 180°-rotated copy and computes voxel IoU. Returns
    // the best candidate + every tested candidate for downstream inspection.
    const analyzeBodyOfRevolution = (cylinderFaces) => {
      if (!clickableMeshes.length) return null
      const GRID_RES = 48

      // Pass 1: vertex centroid
      const centroid = new THREE.Vector3()
      let vertexCount = 0
      const v = new THREE.Vector3()
      for (const mesh of clickableMeshes) {
        mesh.updateWorldMatrix(true, false)
        const wm = mesh.matrixWorld
        const pos = mesh.geometry?.attributes?.position
        if (!pos) continue
        for (let i = 0; i < pos.count; i++) {
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(wm)
          centroid.add(v)
          vertexCount++
        }
      }
      if (vertexCount === 0) return null
      centroid.divideScalar(vertexCount)

      // Pass 2: max radius from centroid + covariance matrix (for PCA)
      let maxR2 = 0
      let cxx = 0, cxy = 0, cxz = 0, cyy = 0, cyz = 0, czz = 0
      for (const mesh of clickableMeshes) {
        mesh.updateWorldMatrix(true, false)
        const wm = mesh.matrixWorld
        const pos = mesh.geometry?.attributes?.position
        if (!pos) continue
        for (let i = 0; i < pos.count; i++) {
          v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(wm)
          const dx = v.x - centroid.x
          const dy = v.y - centroid.y
          const dz = v.z - centroid.z
          const r2 = dx * dx + dy * dy + dz * dz
          if (r2 > maxR2) maxR2 = r2
          cxx += dx * dx; cxy += dx * dy; cxz += dx * dz
          cyy += dy * dy; cyz += dy * dz
          czz += dz * dz
        }
      }
      cxx /= vertexCount; cxy /= vertexCount; cxz /= vertexCount
      cyy /= vertexCount; cyz /= vertexCount; czz /= vertexCount

      const halfSize = Math.sqrt(maxR2) * 1.02 || 1
      if (halfSize < 1e-9) return null

      // PCA eigen — sort axes by eigenvalue descending ("longest axis" first)
      const eig = jacobi3x3([[cxx, cxy, cxz], [cxy, cyy, cyz], [cxz, cyz, czz]])
      const order = [0, 1, 2].sort((a, b) => eig.values[b] - eig.values[a])
      const pcaAxes = order.map(i => eig.vectors[i].clone().normalize())
      const pcaValues = order.map(i => eig.values[i])

      const candidates = [
        { source: 'pca-longest',  axis: pcaAxes[0] },
        { source: 'pca-mid',      axis: pcaAxes[1] },
        { source: 'pca-shortest', axis: pcaAxes[2] },
      ]

      // Dominant cylinder axis — cluster cylinder directions (ignores sign)
      if (Array.isArray(cylinderFaces) && cylinderFaces.length) {
        const clusters = []
        for (const cyl of cylinderFaces) {
          if (!cyl?.axis) continue
          const a = new THREE.Vector3(cyl.axis.x, cyl.axis.y, cyl.axis.z)
          if (a.lengthSq() < 1e-8) continue
          a.normalize()
          const existing = clusters.find(c => Math.abs(c.axis.dot(a)) > 0.98)
          if (existing) existing.count++
          else clusters.push({ axis: a, count: 1 })
        }
        if (clusters.length) {
          clusters.sort((a, b) => b.count - a.count)
          candidates.push({ source: 'cylinder-dominant', axis: clusters[0].axis })
        }
      }

      // Dedupe near-parallel candidates
      const unique = []
      for (const c of candidates) {
        if (unique.some(u => Math.abs(u.axis.dot(c.axis)) > 0.98)) continue
        unique.push(c)
      }

      // Voxelize original once — shared across all candidate comparisons
      const original = voxelizeSolid(clickableMeshes, centroid, halfSize, GRID_RES, null)
      let originalCount = 0
      for (let i = 0; i < original.length; i++) originalCount += original[i]
      if (!originalCount) return null

      const results = []
      for (const c of unique) {
        const tNeg = new THREE.Matrix4().makeTranslation(-centroid.x, -centroid.y, -centroid.z)
        const rot  = new THREE.Matrix4().makeRotationAxis(c.axis, Math.PI)
        const tPos = new THREE.Matrix4().makeTranslation(centroid.x, centroid.y, centroid.z)
        const xform = new THREE.Matrix4().multiplyMatrices(tPos, rot).multiply(tNeg)

        const rotated = voxelizeSolid(clickableMeshes, centroid, halfSize, GRID_RES, xform)
        let inter = 0, uni = 0
        for (let i = 0; i < original.length; i++) {
          const a = original[i], b = rotated[i]
          if (a | b) uni++
          if (a & b) inter++
        }
        const iou = uni > 0 ? inter / uni : 0
        results.push({ source: c.source, axis: c.axis, overlapPercent: Math.round(iou * 10000) / 100 })
      }

      results.sort((a, b) => b.overlapPercent - a.overlapPercent)
      const best  = results[0]
      const round = v => Math.round(v * 1000) / 1000

      return {
        axis:           { x: round(best.axis.x), y: round(best.axis.y), z: round(best.axis.z) },
        axisOrigin:     { x: round(centroid.x),  y: round(centroid.y),  z: round(centroid.z)  },
        overlapPercent: best.overlapPercent,
        axisSource:     best.source,
        isBodyOfRevolution: best.overlapPercent >= 90,
        pcaEigenvalues: pcaValues.map(round),
        candidatesTested: results.map(r => ({
          source:         r.source,
          axis:           { x: round(r.axis.x), y: round(r.axis.y), z: round(r.axis.z) },
          overlapPercent: r.overlapPercent,
        })),
      }
    }

    // Build a sub-geometry overlay mesh that covers only the group containing faceIndex.
    // offsetFactor: -1 for annotations (below), -2 for selections (above annotations).
    const makeOverlayMesh = (mesh, faceIndex, color, offsetFactor = -2) => {
      const geo    = mesh.geometry
      const subGeo = new THREE.BufferGeometry()

      // Share vertex attributes (read-only; safe for static geometry)
      for (const [key, attr] of Object.entries(geo.attributes)) {
        subGeo.setAttribute(key, attr)
      }

      let idxStart = 0
      let idxCount = geo.index ? geo.index.count : (geo.attributes.position?.count ?? 0)

      if (geo.groups?.length > 0) {
        const triOffset = faceIndex * 3
        const group = geo.groups.find(g => triOffset >= g.start && triOffset < g.start + g.count)
        if (group) {
          idxStart = group.start
          idxCount = group.count
        }
      }

      if (geo.index) {
        const src = geo.index.array
        const arr = new (src.constructor)(idxCount)
        for (let i = 0; i < idxCount; i++) arr[i] = src[idxStart + i]
        subGeo.setIndex(new THREE.BufferAttribute(arr, 1))
      } else {
        subGeo.setDrawRange(idxStart, idxCount)
      }

      const overlay = new THREE.Mesh(subGeo, new THREE.MeshBasicMaterial({
        color:               new THREE.Color(color),
        transparent:         true,
        opacity:             0.75,
        polygonOffset:       true,
        polygonOffsetFactor: offsetFactor,
        polygonOffsetUnits:  offsetFactor,
        side:                THREE.DoubleSide,
        depthWrite:          false,
      }))

      mesh.updateWorldMatrix(true, false)
      overlay.matrixAutoUpdate = false
      overlay.matrix.copy(mesh.matrixWorld)
      scene.add(overlay)
      return overlay
    }

    const removeOverlay = (overlay) => {
      if (!overlay || !scene) return
      scene.remove(overlay)
      Object.keys(overlay.geometry.attributes).forEach(k => overlay.geometry.deleteAttribute(k))
      overlay.geometry.dispose()
      overlay.material.dispose()
    }

    // Look up a face entry from the pre-computed unified list by mesh name + material index.
    // Falls back to searching merged-cylinder entries (which span multiple mesh names).
    const getFaceData = (meshName, materialIdx) => {
      const exact = facesData.find(f => f.meshName === meshName && f.materialIndex === materialIdx)
      if (exact) return exact
      return facesData.find(f => Array.isArray(f.meshNames) && f.meshNames.includes(meshName)) ?? null
    }

    // ─── Selection management ─────────────────────────────────────────────────
    const clearAllSelections = () => {
      selections.forEach(s => s.overlays?.forEach(o => removeOverlay(o)))
      selections = []
      selectionLabel.value = ''
    }

    // Keep alias used by resetCamera
    const deselectMesh = clearAllSelections

    // Build overlay meshes for a selection. For merged cylinders, creates one overlay
    // per constituent mesh so the full 360° surface is highlighted, not just the clicked half.
    const buildSelectionOverlays = (clickedMesh, faceIndex, faceData) => {
      const color = props.content?.selectionColor || '#1a73e8'
      const overlays = [makeOverlayMesh(clickedMesh, faceIndex, color, -2)]
      if (faceData?.merged && Array.isArray(faceData.meshNames)) {
        for (const name of faceData.meshNames) {
          if (name === clickedMesh.name) continue
          const m = clickableMeshes.find(cm => cm.name === name)
          if (m) overlays.push(makeOverlayMesh(m, 0, color, -2))
        }
      }
      return overlays
    }

    const updateSelectionLabel = () => {
      if (selections.length === 0) {
        selectionLabel.value = ''
      } else if (selections.length === 1) {
        selectionLabel.value = selections[0].meshName || `Group ${selections[0].groupIndex}`
      } else {
        selectionLabel.value = `${selections.length} faces selected`
      }
    }

    const emitMultiSelection = () => {
      const data = selections.map(s => {
        const fd = s.faceData
        return {
          faceIndex:   s.faceIndex,
          groupIndex:  s.groupIndex,
          meshName:    s.meshName,
          objectName:  s.objectName,
          point:       s.point,
          normal:      s.normal,
          userData:    s.userData,
          faceType:    s.faceType,
          shape:       s.shape    ?? null,
          diameter:    s.diameter ?? null,
          depth:       s.depth    ?? null,
          axis:        s.axis     ?? null,
          arcDeg:      s.arcDeg   ?? null,
          is360:       s.is360    ?? null,
          surfaceType: fd?.surfaceType  ?? null,
          isHole:      fd?.isHole       ?? false,
          isConcave:   fd?.isConcave    ?? null,
          center:      fd?.center       ?? null,
          halfAngle:   fd?.halfAngle    ?? null,
          merged:      fd?.merged       ?? false,
          mergedCount: fd?.mergedCount  ?? null,
          meshNames:   fd?.meshNames    ?? null,
        }
      })
      emit('trigger-event', {
        name:  'faces-selected',
        event: { selections: data, count: data.length },
      })
      setMultiSelectionVar(data)
    }

    // ─── Color override ───────────────────────────────────────────────────────
    const storeOriginalMaterials = () => {
      originalMaterials.clear()
      loadedModel?.traverse(obj => {
        if (!obj.isMesh) return
        originalMaterials.set(obj, Array.isArray(obj.material) ? [...obj.material] : obj.material)
      })
    }

    const applyModelOpacity = (opacity) => {
      if (!loadedModel) return
      const op = (typeof opacity === 'number' && opacity >= 0 && opacity <= 1) ? opacity : 1
      const needsTransparency = op < 1
      loadedModel.traverse(obj => {
        if (!obj.isMesh) return
        const mats = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach(m => {
          if (!m) return
          m.transparent = needsTransparency
          m.opacity     = op
          m.depthWrite  = !needsTransparency
          m.needsUpdate = true
        })
      })
    }

    const applyColorOverride = (color) => {
      if (!loadedModel) return
      overrideMaterials.forEach(m => m.dispose())
      overrideMaterials = []
      const op = props.content?.modelOpacity ?? 1
      const needsTransparency = typeof op === 'number' && op < 1
      loadedModel.traverse(obj => {
        if (!obj.isMesh) return
        const mat = new THREE.MeshStandardMaterial({
          color:       new THREE.Color(color || '#cccccc'),
          roughness:   0.35,
          metalness:   0.1,
          transparent: needsTransparency,
          opacity:     needsTransparency ? op : 1,
          depthWrite:  !needsTransparency,
        })
        obj.material = mat
        overrideMaterials.push(mat)
      })
    }

    const removeColorOverride = () => {
      if (!loadedModel) return
      loadedModel.traverse(obj => {
        if (!obj.isMesh) return
        const orig = originalMaterials.get(obj)
        if (orig !== undefined) obj.material = orig
      })
      overrideMaterials.forEach(m => m.dispose())
      overrideMaterials = []
      applyModelOpacity(props.content?.modelOpacity ?? 1)
    }

    const clearFocusedHoleOverlay = () => {
      focusedHoleOverlays.forEach(o => removeOverlay(o))
      focusedHoleOverlays = []
    }

    // ─── Annotation overlays ──────────────────────────────────────────────────
    const clearAnnotationOverlays = () => {
      annotationOverlays.forEach(a => removeOverlay(a.overlay))
      annotationOverlays = []
    }

    const buildAnnotationOverlays = () => {
      clearAnnotationOverlays()
      if (!loadedModel || !raycaster || !scene) return

      const annotations = processedAnnotations.value
      if (!annotations.length) return

      const epsilon = (modelRadius * 0.0001) || 0.001
      const color   = props.content?.annotationColor || '#ff6b35'

      for (const annotation of annotations) {
        const pt = annotation.point
        const nm = annotation.normal
        if (!pt) continue

        const nmVec = new THREE.Vector3(nm?.x ?? 0, nm?.y ?? 0, nm?.z ?? 0)
        if (nmVec.lengthSq() < 0.0001) nmVec.set(0, 1, 0)
        nmVec.normalize()

        const ptVec = new THREE.Vector3(pt.x ?? 0, pt.y ?? 0, pt.z ?? 0)

        // Primary: shoot from slightly above surface (normal side) inward
        raycaster.set(ptVec.clone().addScaledVector(nmVec, epsilon), nmVec.clone().negate())
        let hits = raycaster.intersectObjects(clickableMeshes, true)

        // Fallback: shoot from slightly inside outward
        if (!hits.length) {
          raycaster.set(ptVec.clone().addScaledVector(nmVec, -epsilon), nmVec)
          hits = raycaster.intersectObjects(clickableMeshes, true)
        }

        if (hits.length > 0) {
          const hit      = hits[0]
          const mesh     = hit.object
          const fi       = hit.faceIndex ?? 0
          const groupIdx = getGroupIndex(mesh, fi)
          const overlay  = makeOverlayMesh(mesh, fi, color, -1)
          annotationOverlays.push({ mesh, groupIndex: groupIdx, overlay, annotation })
        }
      }
    }

    // ─── Main Three.js init ───────────────────────────────────────────────────
    const initThree = () => {
      const canvas = canvasRef.value
      const w = rootRef.value?.clientWidth  || 400
      const h = rootRef.value?.clientHeight || 300

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setSize(w, h)
      renderer.setPixelRatio(Math.min(getWin().devicePixelRatio, 2))
      renderer.setClearColor(0x000000, 0)
      renderer.shadowMap.enabled = true
      renderer.shadowMap.type    = THREE.PCFSoftShadowMap
      renderer.toneMapping       = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.1

      scene = new THREE.Scene()
      const bgColor = props.content?.backgroundColor
      scene.background = bgColor ? new THREE.Color(bgColor) : null

      camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 100000)
      camera.position.set(5, 5, 5)
      camera.lookAt(0, 0, 0)

      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping      = false
      controls.screenSpacePanning = true
      controls.enableZoom         = true

      // Three-point lighting
      scene.add(new THREE.AmbientLight(0xffffff, 0.65))
      const key = new THREE.DirectionalLight(0xffffff, 0.85)
      key.position.set(5, 10, 7)
      key.castShadow = true
      scene.add(key)
      const fill = new THREE.DirectionalLight(0xffffff, 0.3)
      fill.position.set(-5, -3, -5)
      scene.add(fill)
      const rim = new THREE.DirectionalLight(0xffffff, 0.2)
      rim.position.set(0, -10, -5)
      scene.add(rim)

      raycaster = new THREE.Raycaster()

      // Keep centerOfRotation variable in sync with orbit target
      controlsChangeHandler = () => {
        const r = v => Math.round(v * 1000) / 1000
        setCenterOfRotationVar({ x: r(controls.target.x), y: r(controls.target.y), z: r(controls.target.z) })
      }
      controls.addEventListener('change', controlsChangeHandler)

      resizeObserver = new ResizeObserver(onResize)
      resizeObserver.observe(rootRef.value)

      animate()
    }

    // ─── Animation loop ───────────────────────────────────────────────────────
    const animate = () => {
      animFrameId = requestAnimationFrame(animate)

      if (snapAnim) {
        snapAnim.progress = Math.min(snapAnim.progress + 0.07, 1)
        const t = easeInOut(snapAnim.progress)
        camera.position.lerpVectors(snapAnim.startPos, snapAnim.endPos, t)
        controls.target.lerpVectors(snapAnim.startTarget, snapAnim.endTarget, t)
        camera.lookAt(controls.target)
        controls.update()
        if (snapAnim.progress >= 1) snapAnim = null
      } else {
        controls.update()
      }

      renderer.render(scene, camera)
    }

    // ─── Resize ───────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!renderer || !rootRef.value) return
      const w = rootRef.value.clientWidth
      const h = rootRef.value.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h)
    }

    // ─── Model loading ────────────────────────────────────────────────────────
    const loadModel = async (glbData) => {
      if (!glbData || !scene) return

      isLoading.value  = true
      loadingMsg.value = 'Loading model…'
      errorMsg.value   = ''

      if (loadedModel) {
        scene.remove(loadedModel)
        disposeObject(loadedModel)
        loadedModel = null
      }
      clearAllSelections()
      clearAnnotationOverlays()
      clearFocusedHoleOverlay()
      facesData = []

      try {
        const loader = new GLTFLoader()
        let gltf

        if (isDataUrl(glbData)) {
          const buf = decodeBase64ToBuffer(glbData.split(',')[1])
          gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej))
        } else if (isHttpUrl(glbData)) {
          gltf = await new Promise((res, rej) => loader.load(glbData, res, undefined, rej))
        } else {
          const buf = decodeBase64ToBuffer(glbData)
          gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej))
        }

        loadedModel = gltf.scene
        scene.add(loadedModel)

        clickableMeshes = []
        loadedModel.traverse(obj => { if (obj.isMesh) clickableMeshes.push(obj) })
        loadedModel.updateMatrixWorld(true)

        storeOriginalMaterials()
        if (props.content?.overrideColor) applyColorOverride(props.content?.modelColor || '#cccccc')
        else if ((props.content?.modelOpacity ?? 1) < 1) applyModelOpacity(props.content.modelOpacity)

        const box    = new THREE.Box3().setFromObject(loadedModel, true)
        const center = box.getCenter(new THREE.Vector3())
        const size   = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)

        modelRadius = maxDim * 0.6

        const fov  = camera.fov * (Math.PI / 180)
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5

        camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist)
        camera.near = maxDim * 0.0001
        camera.far  = maxDim * 200
        camera.updateProjectionMatrix()
        camera.lookAt(center)

        controls.target.copy(center)
        controls.minDistance = maxDim * 0.05
        controls.maxDistance = maxDim * 20
        controls.update()

        defaultCameraPos = camera.position.clone()
        defaultTarget    = center.clone()

        if (gridHelper) { scene.remove(gridHelper); gridHelper.dispose(); gridHelper = null }
        if (props.content?.showGrid) {
          gridHelper = new THREE.GridHelper(maxDim * 2, 20, 0x888888, 0xcccccc)
          gridHelper.position.y = box.min.y
          scene.add(gridHelper)
        }

        let meshCount = 0, vertexCount = 0
        loadedModel.traverse((obj) => {
          if (obj.isMesh) {
            meshCount++
            vertexCount += obj.geometry?.attributes?.position?.count || 0
          }
        })

        modelLoaded.value = true

        // Build annotation overlays now that clickableMeshes is populated
        buildAnnotationOverlays()

        // Build unified face list — all surface types; cylindrical faces carry isHole flag.
        // Merge split half-cylinders before combining with non-cylindrical faces.
        const rawFaces         = buildAllFaces()
        const cylindricalFaces = rawFaces.filter(f => f.surfaceType === 'Cylinder')
        const otherFaces       = rawFaces.filter(f => f.surfaceType !== 'Cylinder')
        const mergedCylinders  = mergeCylinders(cylindricalFaces)
        const allFaces         = [...otherFaces, ...mergedCylinders]
        facesData = allFaces
        setFacesVar(allFaces)

        const holeCount = mergedCylinders.filter(c => c.isHole === true).length
        const bossCount = mergedCylinders.filter(c => c.isHole === false).length
        emit('trigger-event', {
          name:  'holes-detected',
          event: { cylinders: mergedCylinders, holeCount, bossCount },
        })

        // Compute surface area, volume, and bounding box
        const partProps = analyzeModelGeometry(box)
        setPartPropertiesVar(partProps)

        // Body of Revolution test — voxel IoU against a 180°-rotated copy
        const bor = analyzeBodyOfRevolution(mergedCylinders)
        setBodyOfRevolutionVar(bor)

        emit('trigger-event', {
          name: 'model-loaded',
          event: {
            meshCount,
            vertexCount,
            surfaceArea:  partProps.surfaceArea,
            volume:       partProps.volume,
            boundingBox:  partProps.boundingBox,
          },
        })
      } catch (err) {
        errorMsg.value = `Failed to load model: ${err?.message || 'Unknown error'}`
        console.error('STEP Viewer: model load error', err)
      } finally {
        isLoading.value = false
      }
    }

    // ─── Canvas click → raycasting ────────────────────────────────────────────
    const onPointerDown = (event) => {
      pointerDownPos = { x: event.clientX, y: event.clientY }
    }

    const onCanvasClick = (event) => {
      if (pointerDownPos) {
        const dx = event.clientX - pointerDownPos.x
        const dy = event.clientY - pointerDownPos.y
        pointerDownPos = null
        if (Math.sqrt(dx * dx + dy * dy) > 5) return
      }

      if (!scene || !camera || !loadedModel) return

      const canvas = canvasRef.value
      const rect   = canvas.getBoundingClientRect()
      const mouse  = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width)  * 2 - 1,
        -((event.clientY - rect.top)  / rect.height) * 2 + 1
      )

      raycaster.setFromCamera(mouse, camera)
      const hits = raycaster.intersectObjects(clickableMeshes, true)

      if (hits.length > 0) {
        const hit      = hits[0]
        const mesh     = hit.object
        const fi       = hit.faceIndex ?? 0
        const groupIdx = getGroupIndex(mesh, fi)

        const point  = { x: hit.point.x, y: hit.point.y, z: hit.point.z }
        const normal = hit.face
          ? { x: hit.face.normal.x, y: hit.face.normal.y, z: hit.face.normal.z }
          : { x: 0, y: 0, z: 0 }
        const meshName   = mesh.name || ''
        const objectName = mesh.parent?.name || mesh.name || ''
        const userData   = mesh.userData ?? {}

        const faceGeometry = analyzeFaceGeometry(mesh, fi)
        const faceData     = getFaceData(meshName, groupIdx)
        const faceEnrich   = faceData ? {
          surfaceType: faceData.surfaceType,
          isHole:      faceData.isHole,
          isConcave:   faceData.isConcave,
          center:      faceData.center,
          halfAngle:   faceData.halfAngle    ?? null,
          merged:      faceData.merged       ?? false,
          mergedCount: faceData.mergedCount  ?? null,
          meshNames:   faceData.meshNames    ?? null,
        } : { isHole: false, isConcave: null, surfaceType: null, center: null, halfAngle: null, merged: false, mergedCount: null, meshNames: null }

        // ── Annotation check ─────────────────────────────────────────────────
        const matchedAnnotation = annotationOverlays.find(
          a => a.mesh === mesh && a.groupIndex === groupIdx
        )
        if (matchedAnnotation) {
          emit('trigger-event', {
            name:  'annotation-clicked',
            event: {
              annotation: matchedAnnotation.annotation,
              point:      matchedAnnotation.annotation.point,
              normal:     matchedAnnotation.annotation.normal,
            },
          })
        }

        // ── Selection logic ───────────────────────────────────────────────────
        if (isShiftHeld) {
          // Toggle this face in/out of the multi-selection
          const existingIdx = selections.findIndex(
            s => s.mesh === mesh && s.groupIndex === groupIdx
          )
          if (existingIdx >= 0) {
            selections[existingIdx].overlays?.forEach(o => removeOverlay(o))
            selections.splice(existingIdx, 1)
          } else {
            const overlays = buildSelectionOverlays(mesh, fi, faceData)
            selections.push({ mesh, groupIndex: groupIdx, overlays, faceIndex: fi, point, normal, meshName, objectName, userData, ...faceGeometry, faceData })
            emit('trigger-event', {
              name:  'face-selected',
              event: { faceIndex: fi, groupIndex: groupIdx, meshName, objectName, point, normal, userData, ...faceGeometry, ...faceEnrich },
            })
          }
        } else {
          // Single-select: replace any existing selection
          const alreadySingle =
            selections.length === 1 &&
            selections[0].mesh === mesh &&
            selections[0].groupIndex === groupIdx

          if (!alreadySingle) {
            clearAllSelections()
            const overlays = buildSelectionOverlays(mesh, fi, faceData)
            selections.push({ mesh, groupIndex: groupIdx, overlays, faceIndex: fi, point, normal, meshName, objectName, userData, ...faceGeometry, faceData })
            emit('trigger-event', {
              name:  'face-selected',
              event: { faceIndex: fi, groupIndex: groupIdx, meshName, objectName, point, normal, userData, ...faceGeometry, ...faceEnrich },
            })
          }
        }

        updateSelectionLabel()
        emitMultiSelection()

      } else {
        // Clicked empty space — clear all selections
        clearAllSelections()
        emitMultiSelection()
      }
    }

    // ─── Keyboard tracking (shift for multi-select) ───────────────────────────
    const onKeyDown = (e) => { if (e.key === 'Shift') isShiftHeld = true }
    const onKeyUp   = (e) => { if (e.key === 'Shift') isShiftHeld = false }

    // ─── File upload ──────────────────────────────────────────────────────────
    const triggerFileUpload = () => fileInputRef.value?.click()

    const loadFile = async (file) => {
      if (!file) return
      const blobUrl = URL.createObjectURL(file)
      await loadModel(blobUrl)
      URL.revokeObjectURL(blobUrl)
    }

    const onFileSelected = async (event) => {
      const file = event.target.files?.[0]
      if (!file) return
      event.target.value = ''
      await loadFile(file)
    }

    const onDragOver  = () => { isDragging.value = true }
    const onDragLeave = () => { isDragging.value = false }
    const onDrop = async (event) => {
      isDragging.value = false
      await loadFile(event.dataTransfer?.files?.[0])
    }

    // ─── Camera controls ──────────────────────────────────────────────────────
    const resetCamera = () => {
      if (!camera || !defaultCameraPos) return
      snapAnim = {
        startPos:    camera.position.clone(),
        endPos:      defaultCameraPos.clone(),
        startTarget: controls.target.clone(),
        endTarget:   defaultTarget ? defaultTarget.clone() : new THREE.Vector3(),
        progress:    0,
      }
      deselectMesh()
    }

    const rotateDeg = (deg) => {
      if (!camera || !controls) return
      const angle  = (deg * Math.PI) / 180
      const offset = camera.position.clone().sub(controls.target)
      const cos    = Math.cos(angle)
      const sin    = Math.sin(angle)
      camera.position.set(
        controls.target.x + cos * offset.x + sin * offset.z,
        camera.position.y,
        controls.target.z - sin * offset.x + cos * offset.z
      )
      camera.lookAt(controls.target)
      controls.update()
    }
    const rotateLeft  = () => rotateDeg(-45)
    const rotateRight = () => rotateDeg(45)

    // Focus the camera on a specific hole, looking along its axis from the open end
    const focusOnHole = (hole) => {
      if (!camera || !controls || !hole?.center || !hole?.axis) return

      const center  = new THREE.Vector3(hole.center.x, hole.center.y, hole.center.z)
      const axisVec = new THREE.Vector3(hole.axis.x, hole.axis.y, hole.axis.z).normalize()

      // Orient the axis to point away from the model's geometric center so the
      // camera always lands on the exterior (opening) side of the hole.
      const modelCenter = defaultTarget || new THREE.Vector3()
      const outward     = center.clone().sub(modelCenter)
      if (outward.lengthSq() > 0.0001) {
        if (axisVec.dot(outward) < 0) axisVec.negate()
      } else {
        // Fallback for holes exactly at the model center
        if (axisVec.dot(camera.position.clone().sub(center)) < 0) axisVec.negate()
      }

      const viewDist = Math.max(
        (hole.diameter || 10) * 3,
        (hole.depth    || 10) * 2,
        modelRadius    * 0.3
      ) * 3.5

      snapAnim = {
        startPos:    camera.position.clone(),
        endPos:      center.clone().addScaledVector(axisVec, viewDist),
        startTarget: controls.target.clone(),
        endTarget:   center.clone(),
        progress:    0,
      }

      // Highlight all constituent meshes (merged holes span multiple meshes)
      clearFocusedHoleOverlay()
      const names = Array.isArray(hole.meshNames) ? hole.meshNames : [hole.meshName].filter(Boolean)
      for (const name of names) {
        const mesh = clickableMeshes.find(m => m.name === name)
        if (mesh) focusedHoleOverlays.push(makeOverlayMesh(mesh, 0, props.content?.selectionColor || '#1a73e8', -3))
      }
    }

    // ─── Watchers ─────────────────────────────────────────────────────────────
    watch(() => props.content?.glbData, (val) => { if (val && libsReady.value) loadModel(val) })

    watch(() => props.content?.focusedHole, (hole) => {
      if (hole && libsReady.value && loadedModel) focusOnHole(hole)
    }, { deep: true })

    watch(() => props.content?.centerOfRotation, (pos) => {
      if (!controls || pos?.x === undefined) return
      controls.target.set(pos.x ?? 0, pos.y ?? 0, pos.z ?? 0)
      controls.update()
    }, { deep: true })

    watch(() => [props.content?.overrideColor, props.content?.modelColor], ([override, color]) => {
      if (!loadedModel) return
      if (override) applyColorOverride(color || '#cccccc')
      else removeColorOverride()
    })

    watch(() => props.content?.modelOpacity, (opacity) => {
      if (!loadedModel) return
      if (props.content?.overrideColor) applyColorOverride(props.content?.modelColor || '#cccccc')
      else applyModelOpacity(opacity ?? 1)
    })

    watch(() => props.content?.backgroundColor, (color) => {
      if (!scene || !renderer) return
      if (color) {
        scene.background = new THREE.Color(color)
        renderer.setClearColor(new THREE.Color(color), 1)
      } else {
        scene.background = null
        renderer.setClearColor(0x000000, 0)
      }
    })

    watch(() => props.content?.selectionColor, (color) => {
      selections.forEach(s => s.overlays?.forEach(o => o.material?.color?.set(color || '#1a73e8')))
      focusedHoleOverlays.forEach(o => o.material?.color?.set(color || '#1a73e8'))
    })

    watch(() => props.content?.annotationColor, (color) => {
      annotationOverlays.forEach(a => a.overlay?.material?.color?.set(color || '#ff6b35'))
    })

    watch(() => props.content?.showGrid, (show) => {
      if (!scene) return
      if (show && !gridHelper) {
        gridHelper = new THREE.GridHelper(modelRadius * 4, 20, 0x888888, 0xcccccc)
        scene.add(gridHelper)
      } else if (!show && gridHelper) {
        scene.remove(gridHelper); gridHelper.dispose(); gridHelper = null
      }
    })

    // Rebuild annotation overlays whenever the resolved annotation array changes
    watch(processedAnnotations, () => {
      if (libsReady.value && loadedModel) buildAnnotationOverlays()
    }, { deep: true })

    // ─── Lifecycle ────────────────────────────────────────────────────────────
    onMounted(async () => {
      isLoading.value  = true
      loadingMsg.value = 'Initializing viewer…'
      const win = getWin()
      win.addEventListener('keydown', onKeyDown)
      win.addEventListener('keyup',   onKeyUp)
      try {
        await loadLibs()
        libsReady.value = true
        initThree()
        if (props.content?.glbData) await loadModel(props.content.glbData)
      } catch (err) {
        errorMsg.value = 'Failed to load viewer libraries. Check network connection.'
        console.error('STEP Viewer: lib load error', err)
      } finally {
        isLoading.value = false
      }
    })

    onBeforeUnmount(() => {
      const win = getWin()
      win.removeEventListener('keydown', onKeyDown)
      win.removeEventListener('keyup',   onKeyUp)
      cancelAnimationFrame(animFrameId)
      resizeObserver?.disconnect()
      if (controls && controlsChangeHandler) controls.removeEventListener('change', controlsChangeHandler)
      controls?.dispose()
      clearAllSelections()
      clearAnnotationOverlays()
      clearFocusedHoleOverlay()
      facesData = []
      overrideMaterials.forEach(m => m.dispose())
      overrideMaterials = []
      if (loadedModel) disposeObject(loadedModel)
      if (renderer) { renderer.dispose(); renderer.forceContextLoss() }
    })

    return {
      // DOM
      rootRef, canvasRef, fileInputRef,
      content: props.content,
      // UI
      isLoading, loadingMsg, errorMsg, selectionLabel, libsReady,
      modelLoaded, isDragging,
      rootStyle,
      // Handlers
      onPointerDown, onCanvasClick,
      resetCamera, rotateLeft, rotateRight,
      triggerFileUpload, onFileSelected, onDragOver, onDragLeave, onDrop,
      /* wwEditor:start */
      isEditing,
      /* wwEditor:end */
    }
  },
}
</script>

<style lang="scss" scoped>
.step-viewer {
  display: block;
  box-sizing: border-box;
  font-family: Arial, sans-serif;

  .viewer-canvas {
    display: block;
    width: 100%;
    height: 100%;
    cursor: grab;
    &:active { cursor: grabbing; }
  }

  // ── Overlays ──────────────────────────────────────────────────────────────
  .viewer-overlay {
    position: absolute;
    inset: 0;
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 12px;

    .overlay-text {
      font-size: 13px;
      font-weight: 500;
      color: #555;
    }
  }

  .loading-overlay {
    background: rgba(255, 255, 255, 0.82);
    backdrop-filter: blur(4px);
  }

  .error-overlay {
    background: rgba(255, 240, 240, 0.92);
    .overlay-text { color: #c0392b; }
  }

  // ── Upload zone ────────────────────────────────────────────────────────────
  .upload-zone {
    background: rgba(246, 249, 252, 0.97);
    gap: 10px;
    cursor: pointer;
    border: 2px dashed #c5d5e8;
    transition: background 0.15s, border-color 0.15s;

    &:hover, &.drag-active {
      background: rgba(232, 242, 255, 0.97);
      border-color: #1a73e8;

      .upload-icon svg { stroke: #1a73e8; }
      .upload-title { color: #1a73e8; }
    }

    .upload-icon svg { stroke: #8faec8; transition: stroke 0.15s; }

    .upload-title {
      font-size: 15px;
      font-weight: 600;
      color: #3a5068;
      transition: color 0.15s;
    }

    .upload-sub {
      font-size: 12px;
      color: #8faec8;
    }
  }

  .file-input-hidden {
    display: none;
  }

  .spinner {
    width: 30px;
    height: 30px;
    border: 3px solid #e0e0e0;
    border-top-color: #1a73e8;
    border-radius: 50%;
    animation: spin 0.8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }

  // ── Controls panel ─────────────────────────────────────────────────────────
  .controls-panel {
    position: absolute;
    top: 12px;
    right: 12px;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 8px;
    z-index: 10;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 32px;
    height: 32px;
    border: 1px solid rgba(0, 0, 0, 0.14);
    border-radius: 6px;
    background: rgba(255, 255, 255, 0.92);
    color: #444;
    cursor: pointer;
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.12);
    padding: 0;
    font-size: 14px;
    line-height: 1;
    transition: background 0.12s, box-shadow 0.12s;

    &:hover  { background: #fff; box-shadow: 0 2px 6px rgba(0,0,0,0.18); }
    &:active { background: #f0f4f8; box-shadow: none; }
  }

  .rotate-btns { display: flex; gap: 4px; }

  // ── Selection badge ────────────────────────────────────────────────────────
  .selection-badge {
    position: absolute;
    bottom: 12px;
    left: 12px;
    background: rgba(26, 115, 232, 0.9);
    color: #fff;
    font-size: 12px;
    font-weight: 500;
    padding: 4px 10px;
    border-radius: 12px;
    pointer-events: none;
    backdrop-filter: blur(4px);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.2);
    max-width: calc(100% - 24px);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
}
</style>
