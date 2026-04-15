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

    const _wwHolesVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'holes',
          type:         'array',
          defaultValue: [],
        })
      : null
    const setHolesVar = (val) => _wwHolesVar?.setValue?.(val)

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

    let clickableMeshes    = []
    // Multi-selection: [{mesh, groupIndex, overlay, faceIndex, point, normal, meshName, objectName, userData}]
    let selections         = []
    // Annotation overlays: [{mesh, groupIndex, overlay, annotation}]
    let annotationOverlays = []

    let modelRadius    = 5
    let snapAnim       = null
    let pointerDownPos = null
    let isShiftHeld    = false

    let defaultCameraPos     = null
    let defaultTarget        = null
    let focusedHoleOverlay   = null

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

    // ─── Full-model cylinder scan (runs once on load) ─────────────────────────
    // Returns every cylindrical face with isHole flag (concave = hole, convex = boss).
    const analyzeAllFaces = () => {
      const round   = v => Math.round(v * 1000) / 1000
      const results = []

      for (const mesh of clickableMeshes) {
        const geo = mesh.geometry
        if (!geo?.attributes?.position) continue

        // No groups → treat entire mesh as one face
        const groups = geo.groups?.length > 0
          ? geo.groups
          : [{ start: 0, count: geo.index ? geo.index.count : geo.attributes.position.count }]

        for (const group of groups) {
          const faceIndex = Math.floor(group.start / 3)
          const result    = analyzeFaceGeometry(mesh, faceIndex)
          if (result.faceType !== 'cylindrical') continue

          // Hole vs boss: dot(centroid − vertex, normal) > 0 → concave (hole)
          let isHole = null
          if (result._centroid) {
            const posAttr  = geo.attributes.position
            const normAttr = geo.attributes.normal
            if (posAttr && normAttr) {
              mesh.updateWorldMatrix(true, false)
              const wm = mesh.matrixWorld
              const nm = new THREE.Matrix3().getNormalMatrix(wm)
              const vi  = geo.index ? geo.index.array[group.start] : group.start
              const pos = new THREE.Vector3(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(wm)
              const nor = new THREE.Vector3(normAttr.getX(vi), normAttr.getY(vi), normAttr.getZ(vi)).applyMatrix3(nm).normalize()
              // Concave (normals point toward axis center) AND full 360° wrap = true hole
              const isConcave = result._centroid.clone().sub(pos).dot(nor) > 0
              isHole = isConcave && (result.is360 === true)
            }
          }

          const c = result._centroid
          results.push({
            meshName:   mesh.name || '',
            objectName: mesh.parent?.name || mesh.name || '',
            diameter:   result.diameter,
            depth:      result.depth,
            axis:       result.axis,
            center:     c ? { x: round(c.x), y: round(c.y), z: round(c.z) } : null,
            arcDeg:     result.arcDeg ?? null,
            isHole,
          })
        }
      }

      return results
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

    // ─── Selection management ─────────────────────────────────────────────────
    const clearAllSelections = () => {
      selections.forEach(s => removeOverlay(s.overlay))
      selections = []
      selectionLabel.value = ''
    }

    // Keep alias used by resetCamera
    const deselectMesh = clearAllSelections

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
      const data = selections.map(s => ({
        faceIndex:  s.faceIndex,
        groupIndex: s.groupIndex,
        meshName:   s.meshName,
        objectName: s.objectName,
        point:      s.point,
        normal:     s.normal,
        userData:   s.userData,
        faceType:   s.faceType,
        shape:      s.shape ?? null,
        diameter:   s.diameter ?? null,
        depth:      s.depth ?? null,
        axis:       s.axis ?? null,
      }))
      emit('trigger-event', {
        name:  'faces-selected',
        event: { selections: data, count: data.length },
      })
      setMultiSelectionVar(data)
    }

    const clearFocusedHoleOverlay = () => {
      if (focusedHoleOverlay) { removeOverlay(focusedHoleOverlay); focusedHoleOverlay = null }
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

        // Scan all faces for cylindrical geometry and emit holes manifest
        const cylinders = analyzeAllFaces()
        const holeCount = cylinders.filter(c => c.isHole === true).length
        const bossCount = cylinders.filter(c => c.isHole === false).length
        setHolesVar(cylinders)
        emit('trigger-event', {
          name:  'holes-detected',
          event: { cylinders, holeCount, bossCount },
        })

        emit('trigger-event', {
          name: 'model-loaded',
          event: {
            meshCount,
            vertexCount,
            boundingBox: {
              min:  { x: box.min.x, y: box.min.y, z: box.min.z },
              max:  { x: box.max.x, y: box.max.y, z: box.max.z },
              size: { x: size.x,   y: size.y,   z: size.z },
            },
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
            removeOverlay(selections[existingIdx].overlay)
            selections.splice(existingIdx, 1)
          } else {
            const overlay = makeOverlayMesh(mesh, fi, props.content?.selectionColor || '#1a73e8', -2)
            selections.push({ mesh, groupIndex: groupIdx, overlay, faceIndex: fi, point, normal, meshName, objectName, userData, ...faceGeometry })
            emit('trigger-event', {
              name:  'face-selected',
              event: { faceIndex: fi, groupIndex: groupIdx, meshName, objectName, point, normal, userData, ...faceGeometry },
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
            const overlay = makeOverlayMesh(mesh, fi, props.content?.selectionColor || '#1a73e8', -2)
            selections.push({ mesh, groupIndex: groupIdx, overlay, faceIndex: fi, point, normal, meshName, objectName, userData, ...faceGeometry })
            emit('trigger-event', {
              name:  'face-selected',
              event: { faceIndex: fi, groupIndex: groupIdx, meshName, objectName, point, normal, userData, ...faceGeometry },
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

      // Highlight the hole with the configured color
      clearFocusedHoleOverlay()
      const mesh = clickableMeshes.find(m => m.name === hole.meshName)
      if (mesh) {
        focusedHoleOverlay = makeOverlayMesh(mesh, 0, props.content?.focusedHoleColor || '#ffcc00', -3)
      }
    }

    // ─── Watchers ─────────────────────────────────────────────────────────────
    watch(() => props.content?.glbData, (val) => { if (val && libsReady.value) loadModel(val) })

    watch(() => props.content?.focusedHole, (hole) => {
      if (hole && libsReady.value && loadedModel) focusOnHole(hole)
    }, { deep: true })

    watch(() => props.content?.focusedHoleColor, (color) => {
      if (focusedHoleOverlay) focusedHoleOverlay.material.color.set(color || '#ffcc00')
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
      selections.forEach(s => s.overlay?.material?.color?.set(color || '#1a73e8'))
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
      controls?.dispose()
      clearAllSelections()
      clearAnnotationOverlays()
      clearFocusedHoleOverlay()
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
