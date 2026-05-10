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

    <!-- Controls panel (center-right) -->
    <div v-show="libsReady" class="controls-panel">
      <button class="ctrl-btn" title="Reset View" @click="resetCamera">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
          <polyline points="9 22 9 12 15 12 15 22"/>
        </svg>
      </button>
      <button class="ctrl-btn" title="Rotate Left" @click="rotateLeft">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="1 4 1 10 7 10"/>
          <path d="M3.51 15a9 9 0 1 0 .49-4.5"/>
        </svg>
      </button>
      <button class="ctrl-btn" title="Rotate Right" @click="rotateRight">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <polyline points="23 4 23 10 17 10"/>
          <path d="M20.49 15a9 9 0 1 1-.49-4.5"/>
        </svg>
      </button>
      <button v-if="showUploadButton" class="ctrl-btn" title="Load GLB file" @click="triggerFileUpload">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
          <polyline points="17 8 12 3 7 8"/>
          <line x1="12" y1="3" x2="12" y2="15"/>
        </svg>
      </button>
      <button v-if="showToleranceButton" class="ctrl-btn" :class="{ 'ctrl-btn--active': toleranceMode }" title="Tolerance Mode" @click="toggleToleranceMode">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <line x1="3" y1="4" x2="3" y2="20"/>
          <line x1="21" y1="4" x2="21" y2="20"/>
          <line x1="3" y1="12" x2="21" y2="12"/>
          <line x1="3" y1="8" x2="9" y2="8"/>
          <line x1="15" y1="8" x2="21" y2="8"/>
          <line x1="3" y1="16" x2="9" y2="16"/>
          <line x1="15" y1="16" x2="21" y2="16"/>
        </svg>
      </button>
      <button v-if="show2DToggle && modelLoaded" class="ctrl-btn ctrl-btn--2d" :class="{ 'ctrl-btn--active': is2DMode }" title="2D Drawing View" @click="toggle2DMode">2D</button>
    </div>

    <!-- 2D view axis selector -->
    <div v-if="is2DMode" class="view2d-panel">
      <button
        v-for="v in ['Front','Back','Top','Bottom','Right','Left']"
        :key="v"
        class="view2d-btn"
        :class="{ 'view2d-btn--active': current2DView === v.toLowerCase() }"
        @click="set2DView(v.toLowerCase())"
      >{{ v }}</button>
    </div>

    <!-- Selection badge -->
    <div v-if="selectionLabel" class="selection-badge">
      {{ selectionLabel }}
    </div>

    <!-- GD&T / PMI badge layer — positioned imperatively in the animate loop -->
    <div
      v-if="showAnnotationBadges"
      ref="badgeContainerRef"
      class="badge-layer"
      aria-hidden="true"
    >
      <div
        v-for="(ann, i) in processedAnnotations"
        :key="i"
        class="annotation-badge"
        :class="`badge-type-${ann.type || 'note'}`"
      >
        <span v-if="ann.datumRef" class="badge-datum">{{ ann.datumRef }}</span>
        <span v-if="showBadgeLabel" class="badge-text">{{ ann.value || ann.label }}</span>
        <wwLayout path="badgeDropzoneContent" direction="row" class="badge-dropzone" />
      </div>
    </div>

    <!-- Tolerance input panel -->
    <div v-if="showToleranceInput" class="tolerance-input-panel" :style="toleranceInputStyle">
      <div class="tol-panel-header">
        <span class="tol-nominal">{{ tolerancePendingNominal.toFixed(3) }}</span>
        <span class="tol-label-text">Nominal distance</span>
      </div>
      <div class="tol-fields">
        <label class="tol-field">
          <span class="tol-sign tol-plus">+</span>
          <input type="number" v-model.number="tolerancePendingPlus" min="0" step="0.001" class="tol-input" />
        </label>
        <label class="tol-field">
          <span class="tol-sign tol-minus">−</span>
          <input type="number" v-model.number="tolerancePendingMinus" min="0" step="0.001" class="tol-input" />
        </label>
      </div>
      <div class="tol-actions">
        <button class="tol-btn-cancel" @click="cancelTolerance">Cancel</button>
        <button class="tol-btn-confirm" @click="confirmTolerance">Add</button>
      </div>
    </div>

    <!-- Tolerance label layer -->
    <div ref="toleranceLabelContainerRef" class="tolerance-label-layer" aria-hidden="true">
      <div
        v-for="entry in toleranceEntriesRef"
        :key="entry.id"
        class="tolerance-label"
      >
        <span class="tol-lbl-nominal">{{ entry.nominal.toFixed(3) }}</span>
        <span class="tol-lbl-tol">+{{ entry.plus.toFixed(3) }} / −{{ entry.minus.toFixed(3) }}</span>
        <button class="tol-lbl-remove" @click="removeToleranceEntry(entry.id)">×</button>
      </div>
    </div>
  </div>
</template>

<script>
import { ref, computed, onMounted, onBeforeUnmount, watch } from 'vue'

// ─── CDN URLs (loaded at runtime, bypassing webpack) ─────────────────────────
const CDN = 'https://esm.sh/three@0.162.0'

// Module-level cache so libs are fetched once per page load
let THREE                = null
let TrackballControls    = null
let GLTFLoader           = null
let LineSegments2        = null
let LineSegmentsGeometry = null
let LineMaterial         = null

const loadLibs = async () => {
  if (THREE) return
  const [t, tc, g, ls2, lsg, lm] = await Promise.all([
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/controls/TrackballControls'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/loaders/GLTFLoader'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/lines/LineSegments2'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/lines/LineSegmentsGeometry'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/lines/LineMaterial'),
  ])
  THREE                = t
  TrackballControls    = tc.TrackballControls
  GLTFLoader           = g.GLTFLoader
  LineSegments2        = ls2.LineSegments2
  LineSegmentsGeometry = lsg.LineSegmentsGeometry
  LineMaterial         = lm.LineMaterial
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
    const rootRef         = ref(null)
    const canvasRef       = ref(null)
    const fileInputRef    = ref(null)
    const badgeContainerRef = ref(null)
    const toleranceLabelContainerRef = ref(null)

    // ─── UI state ────────────────────────────────────────────────────────────
    const isLoading      = ref(false)
    const loadingMsg     = ref('Initializing…')
    const errorMsg       = ref('')
    const selectionLabel = ref('')
    const libsReady      = ref(false)
    const modelLoaded    = ref(false)
    const isDragging     = ref(false)

    const toleranceMode            = ref(false)
    const showToleranceInput       = ref(false)
    const is2DMode                 = ref(false)
    const current2DView            = ref('front')
    const tolerancePendingNominal  = ref(0)
    const tolerancePendingPlus     = ref(0)
    const tolerancePendingMinus    = ref(0)
    const toleranceInputStyle      = ref({})
    const toleranceEntriesRef      = ref([])

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

    const _wwFacesSummaryVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'facesSummary',
          type:         'object',
          defaultValue: null,
        })
      : null
    const setFacesSummaryVar = (val) => _wwFacesSummaryVar?.setValue?.(val)

    const _wwBoRVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'bodyOfRevolution',
          type:         'object',
          defaultValue: null,
        })
      : null
    const setBodyOfRevolutionVar = (val) => _wwBoRVar?.setValue?.(val)

    const _wwCornersVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'sharpCorners',
          type:         'array',
          defaultValue: [],
        })
      : null
    const setSharpCornersVar = (val) => _wwCornersVar?.setValue?.(val)

    // Phase 1 — feature model
    const _wwFeatureModelVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'featureModel',
          type:         'object',
          defaultValue: null,
        })
      : null
    const setFeatureModelVar = (val) => _wwFeatureModelVar?.setValue?.(val)

    // Phase 4 — rule evaluation outputs
    const _wwRuleViolationsVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'ruleViolations',
          type:         'array',
          defaultValue: [],
        })
      : null
    const setRuleViolationsVar = (val) => _wwRuleViolationsVar?.setValue?.(val)

    const _wwRuleWarningsVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'ruleWarnings',
          type:         'array',
          defaultValue: [],
        })
      : null
    const setRuleWarningsVar = (val) => _wwRuleWarningsVar?.setValue?.(val)

    const _wwDesignScoreVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'designScore',
          type:         'number',
          defaultValue: 100,
        })
      : null
    const setDesignScoreVar = (val) => _wwDesignScoreVar?.setValue?.(val)

    const _wwViolationCountVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({
          uid:          props.uid,
          name:         'violationCount',
          type:         'number',
          defaultValue: 0,
        })
      : null
    const setViolationCountVar = (val) => _wwViolationCountVar?.setValue?.(val)

    const _wwToleranceVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({ uid: props.uid, name: 'toleranceEntries', type: 'array', defaultValue: [] })
      : null
    const updateToleranceVar = () => {
      _wwToleranceVar?.setValue?.(toleranceEntriesRef.value)
    }

    const _ww2DModeVar = (typeof wwLib !== 'undefined' && wwLib.wwVariable?.useComponentVariable)
      ? wwLib.wwVariable.useComponentVariable({ uid: props.uid, name: 'is2DMode', type: 'boolean', defaultValue: false })
      : null
    const set2DModeVar = (val) => _ww2DModeVar?.setValue?.(val)

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
    let ambientLight   = null
    let keyLight       = null
    let facesData      = []   // unified face list for click enrichment
    let holeMeshNames  = new Set()   // mesh names belonging to full holes (arcDeg ≥ 350)
    let holeMeshArray  = []          // actual THREE.Mesh objects for hole-priority raycasting
    let edgeLines        = []   // LineSegments overlaying hard geometric edges
    let cornerOverlays   = []   // face overlays for acute/obtuse corner faces
    let cornersData      = []   // deduplicated corner entries (exposed via variable)

    let clickableMeshes    = []
    // Multi-selection: [{mesh, groupIndex, overlay, faceIndex, point, normal, meshName, objectName, userData}]
    let selections         = []
    // Annotation overlays: [{mesh, groupIndex, overlay, annotation, annotationId}]
    let annotationOverlays  = []
    let activeAnnotationId  = null

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

    let tolerancePendingA        = null
    let tolerancePendingB        = null
    let tolerancePendingOverlayA = null
    let tolerancePendingOverlayB = null
    let toleranceVisuals         = []

    let orthoCamera       = null
    let activeCamera      = null
    let drawingEdges      = []
    let silhouetteEdges   = []   // view-dependent outline edges, rebuilt on each set2DView
    let drawing2DLineMats = []   // LineMaterial instances that need resolution updates on resize

    // MBD state — plain vars, no Vue reactivity overhead
    let currentFeatureModel = null
    let currentRuleResult   = null
    let featureOverlayMap   = new Map()

    // ─── Computed ─────────────────────────────────────────────────────────────
    const rootStyle = computed(() => ({
      width:      '100%',
      height:     '100%',
      position:   'relative',
      overflow:   'hidden',
      background: props.content?.backgroundColor || 'transparent',
    }))

    const showBadgeLabel      = computed(() => props.content?.showBadgeLabel !== false)
    const showUploadButton    = computed(() => props.content?.showUploadButton !== false)
    const showToleranceButton = computed(() => props.content?.showToleranceButton !== false)
    const show2DToggle        = computed(() => props.content?.show2DToggle !== false)

    // Resolved annotation array — handles formula field mapping
    const processedAnnotations = computed(() => {
      const items = props.content?.annotations
      if (!Array.isArray(items) || !items.length) return []
      return items.map((item, i) => {
        let point  = item.point
        let normal = item.normal
        let faces  = item.faces
        if (resolveMappingFormula) {
          point  = resolveMappingFormula(props.content?.annotationPointFormula,  item) ?? item.point
          normal = resolveMappingFormula(props.content?.annotationNormalFormula, item) ?? item.normal
          faces  = resolveMappingFormula(props.content?.annotationFacesFormula,  item) ?? item.faces
        }
        return { ...item, point, normal, faces, _id: item.id ?? `ann-${i}` }
      })
    })

    const showAnnotationBadges = computed(() => {
      const mode = props.content?.annotationDisplayMode
      return (mode === 'badge' || mode === 'both') && processedAnnotations.value.length > 0
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

    const getFaceCentroid = (mesh, faceIndex) => {
      const geo = mesh.geometry
      const pos = geo.attributes.position
      if (!pos) return new THREE.Vector3()
      let idxStart = 0
      let idxCount = geo.index ? geo.index.count : pos.count
      if (geo.groups?.length > 0) {
        const triOffset = faceIndex * 3
        const group = geo.groups.find(g => triOffset >= g.start && triOffset < g.start + g.count)
        if (group) { idxStart = group.start; idxCount = group.count }
      }
      const sum = new THREE.Vector3()
      let count = 0
      const v = new THREE.Vector3()
      if (geo.index) {
        for (let i = idxStart; i < idxStart + idxCount; i++) {
          v.fromBufferAttribute(pos, geo.index.array[i]); sum.add(v); count++
        }
      } else {
        for (let i = idxStart; i < idxStart + idxCount; i++) {
          v.fromBufferAttribute(pos, i); sum.add(v); count++
        }
      }
      if (count > 0) sum.divideScalar(count)
      mesh.updateWorldMatrix(true, false)
      sum.applyMatrix4(mesh.matrixWorld)
      return sum
    }

    const buildToleranceLine = (cA, cB) => {
      const geo = new THREE.BufferGeometry().setFromPoints([cA.clone(), cB.clone()])
      const mat = new THREE.LineBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true, opacity: 0.8 })
      const line = new THREE.Line(geo, mat)
      line.renderOrder = 3
      scene.add(line)
      return line
    }

    const clearPendingTolerance = () => {
      if (tolerancePendingOverlayA) { removeOverlay(tolerancePendingOverlayA); tolerancePendingOverlayA = null }
      if (tolerancePendingOverlayB) { removeOverlay(tolerancePendingOverlayB); tolerancePendingOverlayB = null }
      tolerancePendingA = null
      tolerancePendingB = null
      showToleranceInput.value = false
    }

    const clearAllTolerances = () => {
      clearPendingTolerance()
      for (const vis of toleranceVisuals) {
        if (vis.overlayA) removeOverlay(vis.overlayA)
        if (vis.overlayB) removeOverlay(vis.overlayB)
        if (vis.line && scene) { scene.remove(vis.line); vis.line.geometry.dispose(); vis.line.material.dispose() }
      }
      toleranceVisuals = []
      toleranceEntriesRef.value = []
      updateToleranceVar()
    }

    const toggleToleranceMode = () => {
      toleranceMode.value = !toleranceMode.value
      if (!toleranceMode.value) clearPendingTolerance()
    }

    const handleToleranceFaceClick = (hits) => {
      if (!hits.length) { clearPendingTolerance(); return }
      const hit = hits[0]
      const mesh = hit.object
      const fi = hit.faceIndex ?? 0
      const groupIdx = getGroupIndex(mesh, fi)
      const nmVec = hit.face ? { x: hit.face.normal.x, y: hit.face.normal.y, z: hit.face.normal.z } : { x: 0, y: 1, z: 0 }

      if (!tolerancePendingA) {
        const centroid = getFaceCentroid(mesh, fi)
        tolerancePendingA = { mesh, faceIndex: fi, groupIndex: groupIdx, centroid, normal: nmVec, meshName: mesh.name || '' }
        tolerancePendingOverlayA = makeOverlayMesh(mesh, fi, '#3b82f6', -3)
      } else if (!tolerancePendingB) {
        if (mesh === tolerancePendingA.mesh && groupIdx === tolerancePendingA.groupIndex) return
        const centroid = getFaceCentroid(mesh, fi)
        tolerancePendingB = { mesh, faceIndex: fi, groupIndex: groupIdx, centroid, normal: nmVec, meshName: mesh.name || '' }
        tolerancePendingOverlayB = makeOverlayMesh(mesh, fi, '#22c55e', -3)
        tolerancePendingNominal.value = tolerancePendingA.centroid.distanceTo(centroid)
        tolerancePendingPlus.value = 0
        tolerancePendingMinus.value = 0
        if (camera && renderer) {
          const mid = new THREE.Vector3().addVectors(tolerancePendingA.centroid, centroid).multiplyScalar(0.5)
          const w = renderer.domElement.clientWidth || 400
          const h = renderer.domElement.clientHeight || 300
          const v = mid.clone().project(camera)
          const sx = Math.min(Math.max((v.x * 0.5 + 0.5) * w, 100), w - 100)
          const sy = Math.min(Math.max((v.y * -0.5 + 0.5) * h, 80), h - 20)
          toleranceInputStyle.value = { left: `${sx}px`, top: `${sy}px` }
        }
        showToleranceInput.value = true
      }
    }

    const confirmTolerance = () => {
      if (!tolerancePendingA || !tolerancePendingB) return
      const id = `tol-${Date.now()}`
      const cA = tolerancePendingA.centroid
      const cB = tolerancePendingB.centroid
      const entry = {
        id,
        nominal: tolerancePendingNominal.value,
        plus:    Math.abs(tolerancePendingPlus.value),
        minus:   Math.abs(tolerancePendingMinus.value),
        faceA: { meshName: tolerancePendingA.meshName, centroid: { x: cA.x, y: cA.y, z: cA.z }, normal: tolerancePendingA.normal },
        faceB: { meshName: tolerancePendingB.meshName, centroid: { x: cB.x, y: cB.y, z: cB.z }, normal: tolerancePendingB.normal },
      }
      const overlayA = tolerancePendingOverlayA
      const overlayB = tolerancePendingOverlayB
      const line = buildToleranceLine(cA, cB)
      toleranceVisuals.push({ id, overlayA, overlayB, line })
      toleranceEntriesRef.value = [...toleranceEntriesRef.value, entry]
      tolerancePendingA = null; tolerancePendingB = null
      tolerancePendingOverlayA = null; tolerancePendingOverlayB = null
      showToleranceInput.value = false
      updateToleranceVar()
      emit('trigger-event', { name: 'tolerance-added', event: { ...entry } })
    }

    const removeToleranceEntry = (id) => {
      const visIdx = toleranceVisuals.findIndex(v => v.id === id)
      if (visIdx >= 0) {
        const vis = toleranceVisuals[visIdx]
        if (vis.overlayA) removeOverlay(vis.overlayA)
        if (vis.overlayB) removeOverlay(vis.overlayB)
        if (vis.line && scene) { scene.remove(vis.line); vis.line.geometry.dispose(); vis.line.material.dispose() }
        toleranceVisuals.splice(visIdx, 1)
      }
      toleranceEntriesRef.value = toleranceEntriesRef.value.filter(e => e.id !== id)
      updateToleranceVar()
      emit('trigger-event', { name: 'tolerance-removed', event: { id } })
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

      // Reusable vectors for surface-area calculation (avoids GC churn per triangle)
      const _sv0 = new THREE.Vector3()
      const _sv1 = new THREE.Vector3()
      const _sv2 = new THREE.Vector3()
      const _se1 = new THREE.Vector3()
      const _se2 = new THREE.Vector3()
      const _scr = new THREE.Vector3()

      const computeGroupArea = (mesh, group) => {
        const geo = mesh.geometry
        const pos = geo.attributes.position
        const idx = geo.index
        if (!pos) return 0
        mesh.updateWorldMatrix(true, false)
        const wm       = mesh.matrixWorld
        const triStart = group.start / 3
        const triEnd   = triStart + group.count / 3
        let area = 0
        for (let t = triStart; t < triEnd; t++) {
          const i0 = idx ? idx.getX(t * 3)     : t * 3
          const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
          const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2
          _sv0.set(pos.getX(i0), pos.getY(i0), pos.getZ(i0)).applyMatrix4(wm)
          _sv1.set(pos.getX(i1), pos.getY(i1), pos.getZ(i1)).applyMatrix4(wm)
          _sv2.set(pos.getX(i2), pos.getY(i2), pos.getZ(i2)).applyMatrix4(wm)
          _se1.subVectors(_sv1, _sv0)
          _se2.subVectors(_sv2, _sv0)
          area += _scr.crossVectors(_se1, _se2).length() * 0.5
        }
        return area
      }

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

          const c           = result._centroid
          const faceSurface = computeGroupArea(mesh, group)
          results.push({
            meshName:      mesh.name || '',
            objectName:    mesh.parent?.name || mesh.name || '',
            materialIndex: group.materialIndex ?? 0,
            faceType:      result.faceType   ?? 'unknown',
            surfaceType:   typeLabel[result.faceType] ?? 'Unknown',
            shape:         result.shape      ?? null,
            diameter:      result.diameter   ?? null,
            depth:         result.depth      ?? null,
            halfAngle:     result.halfAngle  ?? null,
            arcDeg:        result.arcDeg     ?? null,
            is360:         result.is360      ?? null,
            axis:          result.axis       ?? null,
            center:        c ? { x: round(c.x), y: round(c.y), z: round(c.z) } : null,
            surfaceArea:   Math.round(faceSurface * 1000) / 1000,
            isConcave,
            isHole,
            merged:        false,
            mergedCount:   null,
            meshNames:     null,
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
          objectName:  base.objectName,
          faceType:    'cylindrical',
          surfaceType: 'Cylinder',
          shape:       null,
          diameter:    avgDiam,
          depth:       mergedDepth,
          halfAngle:   null,
          arcDeg:      totalArc,
          is360:       totalArc >= 300,
          axis:        { x: round(normAx.x), y: round(normAx.y), z: round(normAx.z) },
          center:      mergedCenter,
          isConcave:   allConcave,
          isHole:      isMergedHole,
          merged:      true,
          mergedCount: group.length,
          meshNames:   members.map(m => m.meshName),
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
      overlay.renderOrder = 2
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
        const isHole = holeMeshNames.has(obj.name)
        const mats   = Array.isArray(obj.material) ? obj.material : [obj.material]
        mats.forEach(m => {
          if (!m) return
          if (isHole) {
            m.transparent = false
            m.opacity     = 1
            m.depthWrite  = true
            m.depthTest   = !needsTransparency
          } else {
            m.transparent = needsTransparency
            m.opacity     = op
            m.depthWrite  = !needsTransparency
            m.depthTest   = true
          }
          m.needsUpdate = true
        })
        if (isHole) obj.renderOrder = needsTransparency ? 2 : 0
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
        const isHole = holeMeshNames.has(obj.name)
        const mat = new THREE.MeshStandardMaterial({
          color:       new THREE.Color(color || '#cccccc'),
          roughness:   0.35,
          metalness:   0.1,
          transparent: isHole ? false : needsTransparency,
          opacity:     isHole ? 1 : (needsTransparency ? op : 1),
          depthWrite:  isHole ? true : !needsTransparency,
          depthTest:   isHole ? !needsTransparency : true,
        })
        obj.material = mat
        obj.renderOrder = (isHole && needsTransparency) ? 2 : 0
        overrideMaterials.push(mat)
      })
    }

    const removeColorOverride = () => {
      if (!loadedModel) return
      loadedModel.traverse(obj => {
        if (!obj.isMesh) return
        const orig = originalMaterials.get(obj)
        if (orig !== undefined) obj.material = orig
        obj.renderOrder = 0
      })
      overrideMaterials.forEach(m => m.dispose())
      overrideMaterials = []
      applyModelOpacity(props.content?.modelOpacity ?? 1)
    }

    const clearFocusedHoleOverlay = () => {
      focusedHoleOverlays.forEach(o => removeOverlay(o))
      focusedHoleOverlays = []
    }

    // ─── Edge lines ───────────────────────────────────────────────────────────
    const removeEdges = () => {
      edgeLines.forEach(l => {
        scene?.remove(l)
        l.geometry.dispose()
        l.material.dispose()
      })
      edgeLines = []
    }

    const buildEdges = () => {
      removeEdges()
      if (!loadedModel || !props.content?.showEdges) return
      const color = new THREE.Color(props.content?.edgeColor || '#222222')
      for (const mesh of clickableMeshes) {
        mesh.updateWorldMatrix(true, false)
        const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 15)
        const lines    = new THREE.LineSegments(
          edgesGeo,
          new THREE.LineBasicMaterial({ color })
        )
        lines.matrixAutoUpdate = false
        lines.matrix.copy(mesh.matrixWorld)
        lines.renderOrder = 1
        scene.add(lines)
        edgeLines.push(lines)
      }
    }

    // ─── 2D Drawing mode ─────────────────────────────────────────────────────
    const removeDrawingEdges = () => {
      for (const { obj, ownGeo } of drawingEdges) {
        scene?.remove(obj)
        if (ownGeo) obj.geometry?.dispose()
        obj.material?.dispose()
      }
      drawingEdges      = []
      drawing2DLineMats = []
      removeSilhouetteEdges()
    }

    // Compute which edges straddle the silhouette boundary for a given view direction.
    // Returns a Float32Array of world-space position pairs (x0,y0,z0, x1,y1,z1, …)
    // or null if nothing was found.
    const computeSilhouettePositions = (mesh, viewDir) => {
      const geo  = mesh.geometry
      const pos  = geo.attributes.position
      const idx  = geo.index
      if (!pos) return null

      const wm       = mesh.matrixWorld
      const edgeMap  = new Map()
      const _va = new THREE.Vector3()
      const _vb = new THREE.Vector3()
      const _vc = new THREE.Vector3()
      const _e1 = new THREE.Vector3()
      const _e2 = new THREE.Vector3()
      const _n  = new THREE.Vector3()
      const triCount = idx ? idx.count / 3 : pos.count / 3

      for (let t = 0; t < triCount; t++) {
        const i0 = idx ? idx.getX(t * 3)     : t * 3
        const i1 = idx ? idx.getX(t * 3 + 1) : t * 3 + 1
        const i2 = idx ? idx.getX(t * 3 + 2) : t * 3 + 2

        _va.fromBufferAttribute(pos, i0).applyMatrix4(wm)
        _vb.fromBufferAttribute(pos, i1).applyMatrix4(wm)
        _vc.fromBufferAttribute(pos, i2).applyMatrix4(wm)

        _e1.subVectors(_vb, _va)
        _e2.subVectors(_vc, _va)
        _n.crossVectors(_e1, _e2).normalize()
        const dot = _n.dot(viewDir)

        for (const [a, b, p0, p1] of [[i0, i1, _va, _vb], [i1, i2, _vb, _vc], [i2, i0, _vc, _va]]) {
          const key = a < b ? `${a}_${b}` : `${b}_${a}`
          if (!edgeMap.has(key)) edgeMap.set(key, { p0: p0.clone(), p1: p1.clone(), dots: [] })
          edgeMap.get(key).dots.push(dot)
        }
      }

      const out = []
      for (const { p0, p1, dots } of edgeMap.values()) {
        const isSilhouette = dots.length === 1 || (dots[0] > 0) !== (dots[1] > 0)
        if (isSilhouette) out.push(p0.x, p0.y, p0.z, p1.x, p1.y, p1.z)
      }
      return out.length > 0 ? new Float32Array(out) : null
    }

    const removeSilhouetteEdges = () => {
      for (const { obj, mat } of silhouetteEdges) {
        scene?.remove(obj)
        obj.geometry?.dispose()
        mat?.dispose()
      }
      silhouetteEdges = []
    }

    const buildSilhouetteEdges = () => {
      removeSilhouetteEdges()
      if (!loadedModel || !orthoCamera) return

      const viewDir   = new THREE.Vector3()
      orthoCamera.getWorldDirection(viewDir)
      const lineColor = new THREE.Color(props.content?.drawing2DLineColor || '#1a1a1a')
      const w = renderer?.domElement?.width  || 400
      const h = renderer?.domElement?.height || 300

      for (const mesh of clickableMeshes) {
        const positions = computeSilhouettePositions(mesh, viewDir)
        if (!positions) continue

        const lsg = new LineSegmentsGeometry()
        lsg.setPositions(positions)
        const mat = new LineMaterial({ color: lineColor, linewidth: 2.0, resolution: new THREE.Vector2(w, h) })
        const lines = new LineSegments2(lsg, mat)
        lines.renderOrder = 3
        scene.add(lines)
        silhouetteEdges.push({ obj: lines, mat })
        drawing2DLineMats.push(mat)
      }
    }

    const buildDrawingEdges = () => {
      removeDrawingEdges()
      if (!loadedModel) return

      const lineColor   = new THREE.Color(props.content?.drawing2DLineColor      || '#1a1a1a')
      const hiddenColor = new THREE.Color(props.content?.drawing2DHiddenLineColor || '#7a8fa6')
      const showHidden  = props.content?.drawing2DShowHiddenLines !== false
      const w           = renderer?.domElement?.width  || 400
      const h           = renderer?.domElement?.height || 300

      for (const mesh of clickableMeshes) {
        mesh.updateWorldMatrix(true, false)

        // Depth-prepass mesh — fills depth buffer so visible-line depth testing is accurate.
        // polygonOffset pushes the prepass surface slightly back so edge lines always win.
        const depthMat  = new THREE.MeshBasicMaterial({ colorWrite: false, polygonOffset: true, polygonOffsetFactor: 1, polygonOffsetUnits: 1 })
        const depthMesh = new THREE.Mesh(mesh.geometry, depthMat)
        depthMesh.matrixAutoUpdate = false
        depthMesh.matrix.copy(mesh.matrixWorld)
        depthMesh.renderOrder = 0
        scene.add(depthMesh)
        drawingEdges.push({ obj: depthMesh, ownGeo: false })

        const edgesGeo = new THREE.EdgesGeometry(mesh.geometry, 15)

        if (showHidden) {
          // Hidden lines — dashed, faint, no depth test so they show through surfaces
          const hiddenMat   = new THREE.LineDashedMaterial({
            color: hiddenColor, dashSize: 1.5, gapSize: 1.5,
            opacity: 0.28, transparent: true, depthTest: false,
          })
          const hiddenLines = new THREE.LineSegments(edgesGeo, hiddenMat)
          hiddenLines.computeLineDistances()
          hiddenLines.matrixAutoUpdate = false
          hiddenLines.matrix.copy(mesh.matrixWorld)
          hiddenLines.renderOrder = 1
          scene.add(hiddenLines)
          drawingEdges.push({ obj: hiddenLines, ownGeo: true })

          // Visible lines — LineSegments2 for true pixel-width thickness
          const lsg    = new LineSegmentsGeometry()
          lsg.setPositions(edgesGeo.attributes.position.array)
          const visMat = new LineMaterial({ color: lineColor, linewidth: 1.8, resolution: new THREE.Vector2(w, h) })
          const vis    = new LineSegments2(lsg, visMat)
          vis.matrixAutoUpdate = false
          vis.matrix.copy(mesh.matrixWorld)
          vis.renderOrder = 2
          scene.add(vis)
          drawingEdges.push({ obj: vis, ownGeo: true })
          drawing2DLineMats.push(visMat)
        } else {
          // Visible lines only
          const lsg    = new LineSegmentsGeometry()
          lsg.setPositions(edgesGeo.attributes.position.array)
          const visMat = new LineMaterial({ color: lineColor, linewidth: 1.8, resolution: new THREE.Vector2(w, h) })
          const vis    = new LineSegments2(lsg, visMat)
          vis.matrixAutoUpdate = false
          vis.matrix.copy(mesh.matrixWorld)
          vis.renderOrder = 2
          scene.add(vis)
          drawingEdges.push({ obj: vis, ownGeo: true })
          drawing2DLineMats.push(visMat)
          edgesGeo.dispose()
        }
      }
    }

    const set2DView = (view) => {
      if (!orthoCamera || !defaultTarget) return
      current2DView.value = view
      const c    = defaultTarget
      const dist = modelRadius * 10
      const views = {
        front:  { pos: [c.x, c.y, c.z + dist], up: [0, 1, 0] },
        back:   { pos: [c.x, c.y, c.z - dist], up: [0, 1, 0] },
        top:    { pos: [c.x, c.y + dist, c.z], up: [0, 0, -1] },
        bottom: { pos: [c.x, c.y - dist, c.z], up: [0, 0,  1] },
        right:  { pos: [c.x + dist, c.y, c.z], up: [0, 1, 0] },
        left:   { pos: [c.x - dist, c.y, c.z], up: [0, 1, 0] },
      }
      const v = views[view] || views.front
      orthoCamera.position.set(...v.pos)
      orthoCamera.up.set(...v.up)
      orthoCamera.lookAt(c)
      controls.target.copy(c)
      controls.update()
      buildSilhouetteEdges()
    }

    const enter2DMode = (view = 'front') => {
      if (!camera || !renderer) return
      const w      = renderer.domElement.width  || 400
      const h      = renderer.domElement.height || 300
      const aspect = w / h
      const s      = modelRadius * 1.5

      orthoCamera = new THREE.OrthographicCamera(-s * aspect, s * aspect, s, -s, -modelRadius * 200, modelRadius * 200)

      controls.object   = orthoCamera
      controls.noRotate = true
      activeCamera      = orthoCamera

      if (loadedModel) loadedModel.visible = false
      buildDrawingEdges()

      const bg = props.content?.drawing2DBackground
      scene.background = bg ? new THREE.Color(bg) : new THREE.Color('#ffffff')

      set2DView(view)
      is2DMode.value = true
      set2DModeVar(true)
    }

    const exit2DMode = () => {
      removeDrawingEdges()
      removeSilhouetteEdges()
      if (loadedModel) loadedModel.visible = true

      const bgColor = props.content?.backgroundColor
      scene.background = bgColor ? new THREE.Color(bgColor) : null

      if (orthoCamera) { orthoCamera = null }
      controls.object   = camera
      controls.noRotate = false
      activeCamera      = camera
      controls.update()

      is2DMode.value = false
      set2DModeVar(false)
    }

    const toggle2DMode = () => {
      if (is2DMode.value) exit2DMode()
      else enter2DMode(current2DView.value)
    }

    // ─── Sharp corner detection ───────────────────────────────────────────────
    // STEP/OCCT GLB exports tessellate each B-Rep face independently — boundary
    // vertices are NOT shared between adjacent faces. Vertex-index adjacency never
    // finds cross-face edges, so we use a spatial proximity approach instead:
    //
    //  1. Per face group: extract boundary vertices (edges with a single adjacent
    //     triangle within the group) and compute an average outward face normal.
    //  2. Spatial-hash all boundary vertex world positions.
    //  3. For every boundary vertex that has a counterpart from a different face
    //     group within epsilon, those two groups are adjacent.
    //  4. Compute the interior dihedral angle from the two face normals.
    //  5. Flag pairs outside [90° ± tolerance].
    //
    // Returns { data: deduplicatedCorners[], rawEdges: allFlaggedEdges[] }
    const detectSharpCorners = (tolerance) => {
      if (!clickableMeshes.length) return { data: [], rawEdges: [] }

      const tol          = Math.abs(typeof tolerance === 'number' ? tolerance : 10)
      const acuteThresh  = 90 - tol
      const obtuseThresh = 90 + tol
      const round        = v => Math.round(v * 100) / 100
      const EPSILON      = Math.max(modelRadius * 0.002, 0.01)
      const CELL         = EPSILON * 2

      // ── Step 1: collect face groups with boundary vertices + average normal ──
      const faceGroups = []   // { id, meshName, objectName, matIdx, normal, bvPos[] }

      const _p = new THREE.Vector3()

      for (let mi = 0; mi < clickableMeshes.length; mi++) {
        const mesh     = clickableMeshes[mi]
        const geo      = mesh.geometry
        if (!geo?.attributes?.position) continue

        const posAttr  = geo.attributes.position
        const idxArr   = geo.index?.array
        const triCount = idxArr ? idxArr.length / 3 : Math.floor(posAttr.count / 3)
        if (triCount < 1) continue

        mesh.updateWorldMatrix(true, false)
        const wm = mesh.matrixWorld

        const groups = geo.groups?.length > 0
          ? geo.groups
          : [{ start: 0, count: idxArr ? idxArr.length : posAttr.count, materialIndex: 0 }]

        for (let gi = 0; gi < groups.length; gi++) {
          const group    = groups[gi]
          const tStart   = Math.floor(group.start / 3)
          const tEnd     = Math.floor((group.start + group.count) / 3)

          // Count edge valence within this group (boundary edge → count 1)
          const edgeCount = new Map()
          for (let t = tStart; t < tEnd; t++) {
            const i0 = idxArr ? idxArr[t * 3]     : t * 3
            const i1 = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1
            const i2 = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2
            for (const [a, b] of [[i0, i1], [i1, i2], [i2, i0]]) {
              const k = a < b ? `${a}_${b}` : `${b}_${a}`
              edgeCount.set(k, (edgeCount.get(k) || 0) + 1)
            }
          }

          // Boundary vertex indices
          const bvSet = new Set()
          for (const [k, cnt] of edgeCount) {
            if (cnt === 1) {
              const [a, b] = k.split('_').map(Number)
              bvSet.add(a); bvSet.add(b)
            }
          }

          // Average outward face normal from triangle cross products
          let nx = 0, ny = 0, nz = 0, nCnt = 0
          for (let t = tStart; t < tEnd; t++) {
            const i0 = idxArr ? idxArr[t * 3]     : t * 3
            const i1 = idxArr ? idxArr[t * 3 + 1] : t * 3 + 1
            const i2 = idxArr ? idxArr[t * 3 + 2] : t * 3 + 2
            _p.set(posAttr.getX(i0), posAttr.getY(i0), posAttr.getZ(i0)).applyMatrix4(wm)
            const ax = _p.x, ay = _p.y, az = _p.z
            _p.set(posAttr.getX(i1), posAttr.getY(i1), posAttr.getZ(i1)).applyMatrix4(wm)
            const bx = _p.x - ax, by = _p.y - ay, bz = _p.z - az
            _p.set(posAttr.getX(i2), posAttr.getY(i2), posAttr.getZ(i2)).applyMatrix4(wm)
            const cx = _p.x - ax, cy = _p.y - ay, cz = _p.z - az
            const ex = by * cz - bz * cy, ey = bz * cx - bx * cz, ez = bx * cy - by * cx
            const el = Math.sqrt(ex * ex + ey * ey + ez * ez)
            if (el > 0) { nx += ex / el; ny += ey / el; nz += ez / el; nCnt++ }
          }
          if (nCnt === 0 || bvSet.size === 0) continue
          const nl = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1

          // World-space boundary vertex positions (sample up to 300 per group for adjacency detection)
          const allBV = [...bvSet]
          const step  = Math.max(1, Math.floor(allBV.length / 300))
          const bvPos = []
          for (let i = 0; i < allBV.length; i += step) {
            const vi = allBV[i]
            _p.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(wm)
            bvPos.push({ x: _p.x, y: _p.y, z: _p.z })
          }

          // All boundary vertex positions — used for accurate seam segment collection
          const bvPosAll = allBV.map(vi => {
            _p.set(posAttr.getX(vi), posAttr.getY(vi), posAttr.getZ(vi)).applyMatrix4(wm)
            return { x: _p.x, y: _p.y, z: _p.z }
          })

          // Boundary edge pairs (world-space), capped to avoid excess memory on dense meshes
          const bvEdgePairs = []
          let edgeCap = 0
          for (const [k, cnt] of edgeCount) {
            if (cnt !== 1 || edgeCap++ > 2000) continue
            const [a, b] = k.split('_').map(Number)
            _p.set(posAttr.getX(a), posAttr.getY(a), posAttr.getZ(a)).applyMatrix4(wm)
            const pA = { x: _p.x, y: _p.y, z: _p.z }
            _p.set(posAttr.getX(b), posAttr.getY(b), posAttr.getZ(b)).applyMatrix4(wm)
            const pB = { x: _p.x, y: _p.y, z: _p.z }
            bvEdgePairs.push([pA, pB])
          }

          faceGroups.push({
            id:         faceGroups.length,
            meshName:   mesh.name || '',
            objectName: mesh.parent?.name || mesh.name || '',
            matIdx:     group.materialIndex ?? 0,
            normal:     { x: nx / nl, y: ny / nl, z: nz / nl },
            bvPos,
            bvPosAll,
            bvEdgePairs,
          })
        }
      }

      // ── Step 2: spatial hash of all boundary vertices ─────────────────────
      const spatialHash = new Map()
      const hk = (x, y, z) =>
        `${Math.floor(x / CELL)}_${Math.floor(y / CELL)}_${Math.floor(z / CELL)}`

      for (const fg of faceGroups) {
        for (const pos of fg.bvPos) {
          const key = hk(pos.x, pos.y, pos.z)
          if (!spatialHash.has(key)) spatialHash.set(key, [])
          spatialHash.get(key).push({ fgId: fg.id, pos })
        }
      }

      // ── Step 3 & 4: find adjacent pairs + compute dihedral angle ──────────
      const rawEdges = []
      const pairMap  = new Map()   // faceGroupPairKey → data entry

      const checked = new Set()

      for (const fg1 of faceGroups) {
        for (const pos1 of fg1.bvPos) {
          const ix = Math.floor(pos1.x / CELL)
          const iy = Math.floor(pos1.y / CELL)
          const iz = Math.floor(pos1.z / CELL)

          // Check 3×3×3 neighborhood
          for (let dx = -1; dx <= 1; dx++) {
            for (let dy = -1; dy <= 1; dy++) {
              for (let dz = -1; dz <= 1; dz++) {
                const neighbors = spatialHash.get(`${ix+dx}_${iy+dy}_${iz+dz}`)
                if (!neighbors) continue

                for (const { fgId, pos: pos2 } of neighbors) {
                  if (fgId === fg1.id) continue
                  const fg2 = faceGroups[fgId]

                  // Same mesh + same group → skip
                  if (fg2.meshName === fg1.meshName && fg2.matIdx === fg1.matIdx) continue

                  // Check actual Euclidean distance within epsilon
                  const ex = pos1.x - pos2.x, ey = pos1.y - pos2.y, ez = pos1.z - pos2.z
                  if (ex * ex + ey * ey + ez * ez > EPSILON * EPSILON) continue

                  // Canonical pair key (order-independent)
                  const pairId = fg1.id < fgId ? `${fg1.id}_${fgId}` : `${fgId}_${fg1.id}`
                  if (checked.has(pairId)) continue
                  checked.add(pairId)

                  // Dihedral angle between the two face normals
                  const n1 = fg1.normal, n2 = fg2.normal
                  const dot = Math.max(-1, Math.min(1,
                    n1.x * n2.x + n1.y * n2.y + n1.z * n2.z))
                  const normalAngle   = Math.acos(dot) * 180 / Math.PI
                  const interiorAngle = 180 - normalAngle

                  // Skip if within the acceptable band around 90°
                  if (interiorAngle >= acuteThresh && interiorAngle <= obtuseThresh) continue

                  const type = interiorAngle < acuteThresh ? 'acute' : 'obtuse'
                  const v1   = { x: round(pos1.x), y: round(pos1.y), z: round(pos1.z) }
                  const v2   = { x: round(pos2.x), y: round(pos2.y), z: round(pos2.z) }
                  rawEdges.push({ type, v1, v2 })

                  // Deduplicate: keep most-extreme angle per face-pair
                  const existing  = pairMap.get(pairId)
                  const deviation = Math.abs(interiorAngle - 90)
                  if (!existing || deviation > Math.abs(existing.angle - 90)) {
                    pairMap.set(pairId, {
                      meshName:   fg1.meshName,
                      mesh2Name:  fg2.meshName,
                      objectName: fg1.objectName,
                      angle:      round(interiorAngle),
                      type,
                      g1:         fg1.matIdx,
                      g2:         fg2.matIdx,
                      v1,
                      v2,
                    })
                  }
                }
              }
            }
          }
        }
      }

      // ── Step 5: collect seam segments for each flagged pair ───────────────────
      // For each pair, find boundary edges from both faces where both endpoints
      // are within epsilon of the opposing face's boundary — those edges form the seam.
      const isCellNearSet = (pos, cellSet) => {
        const ix = Math.floor(pos.x / CELL), iy = Math.floor(pos.y / CELL), iz = Math.floor(pos.z / CELL)
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++)
              if (cellSet.has(`${ix+dx}_${iy+dy}_${iz+dz}`)) return true
        return false
      }

      for (const [pairId, entry] of pairMap) {
        const [fg1Id, fg2Id] = pairId.split('_').map(Number)
        const fg1 = faceGroups[fg1Id]
        const fg2 = faceGroups[fg2Id]
        if (!fg1?.bvEdgePairs || !fg2?.bvEdgePairs) continue

        const fg1CellSet = new Set(fg1.bvPosAll.map(p => hk(p.x, p.y, p.z)))
        const fg2CellSet = new Set(fg2.bvPosAll.map(p => hk(p.x, p.y, p.z)))

        const seamPositions = []
        for (const [pA, pB] of fg1.bvEdgePairs) {
          if (isCellNearSet(pA, fg2CellSet) && isCellNearSet(pB, fg2CellSet))
            seamPositions.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z)
        }
        for (const [pA, pB] of fg2.bvEdgePairs) {
          if (isCellNearSet(pA, fg1CellSet) && isCellNearSet(pB, fg1CellSet))
            seamPositions.push(pA.x, pA.y, pA.z, pB.x, pB.y, pB.z)
        }

        entry.seamPositions = seamPositions
      }

      return { data: [...pairMap.values()], rawEdges }
    }

    const clearCornerOverlays = () => {
      cornerOverlays.forEach(o => {
        if (!o || !scene) return
        scene.remove(o)
        o.geometry?.dispose()
        o.material?.dispose()
      })
      cornerOverlays = []
    }

    // Renders the shared seam edge between each flagged face-pair using LineSegments.
    const buildCornerOverlays = (data) => {
      clearCornerOverlays()
      if (!loadedModel || !props.content?.showCorners || !data.length) return

      const acuteColor  = props.content?.acuteCornerColor  || '#ff4444'
      const obtuseColor = props.content?.obtuseCornerColor || '#ffaa00'

      const acutePos  = []
      const obtusePos = []

      for (const entry of data) {
        if (!entry.seamPositions?.length) continue
        if (entry.type === 'acute') acutePos.push(...entry.seamPositions)
        else obtusePos.push(...entry.seamPositions)
      }

      const w = renderer.domElement.clientWidth  || 400
      const h = renderer.domElement.clientHeight || 300

      const makeSeamLines = (positions, color) => {
        if (!positions.length) return null
        const geo = new LineSegmentsGeometry()
        geo.setPositions(positions)
        const mat = new LineMaterial({
          color:      new THREE.Color(color),
          linewidth:  6,
          worldUnits: false,
          resolution: new THREE.Vector2(w, h),
        })
        const lines = new LineSegments2(geo, mat)
        lines.renderOrder = 3
        scene.add(lines)
        return lines
      }

      const acuteLines  = makeSeamLines(acutePos,  acuteColor)
      const obtuseLines = makeSeamLines(obtusePos, obtuseColor)
      if (acuteLines)  cornerOverlays.push(acuteLines)
      if (obtuseLines) cornerOverlays.push(obtuseLines)
    }

    // ─── Annotation overlays ──────────────────────────────────────────────────
    const clearAnnotationOverlays = () => {
      annotationOverlays.forEach(a => removeOverlay(a.overlay))
      annotationOverlays  = []
      activeAnnotationId  = null
    }

    // Returns the first raycaster hit for a {point,normal} pair, or null.
    const _raycastFace = (pt, nm) => {
      if (!pt) return null
      const epsilon = (modelRadius * 0.0001) || 0.001
      const nmVec   = new THREE.Vector3(nm?.x ?? 0, nm?.y ?? 0, nm?.z ?? 0)
      if (nmVec.lengthSq() < 0.0001) nmVec.set(0, 1, 0)
      nmVec.normalize()
      const ptVec = new THREE.Vector3(pt.x ?? 0, pt.y ?? 0, pt.z ?? 0)
      raycaster.set(ptVec.clone().addScaledVector(nmVec, epsilon), nmVec.clone().negate())
      let hits = raycaster.intersectObjects(clickableMeshes, true)
      if (!hits.length) {
        raycaster.set(ptVec.clone().addScaledVector(nmVec, -epsilon), nmVec)
        hits = raycaster.intersectObjects(clickableMeshes, true)
      }
      return hits.length ? hits[0] : null
    }

    const buildAnnotationOverlays = () => {
      clearAnnotationOverlays()
      if (!loadedModel || !raycaster || !scene) return

      const annotations = processedAnnotations.value
      if (!annotations.length) return

      const color = props.content?.annotationColor || '#ff6b35'

      for (const annotation of annotations) {
        const annId = annotation._id

        // Primary face
        const primaryHit = _raycastFace(annotation.point, annotation.normal)
        if (primaryHit) {
          const mesh     = primaryHit.object
          const fi       = primaryHit.faceIndex ?? 0
          const groupIdx = getGroupIndex(mesh, fi)
          const overlay  = makeOverlayMesh(mesh, fi, color, -1)
          annotationOverlays.push({ mesh, groupIndex: groupIdx, overlay, annotation, annotationId: annId })
        }

        // Extra faces — array of {point, normal} on the same annotation
        const extraFaces = Array.isArray(annotation.faces) ? annotation.faces : []
        for (const face of extraFaces) {
          const hit = _raycastFace(face.point ?? face, face.normal ?? annotation.normal)
          if (hit) {
            const mesh     = hit.object
            const fi       = hit.faceIndex ?? 0
            const groupIdx = getGroupIndex(mesh, fi)
            const overlay  = makeOverlayMesh(mesh, fi, color, -1)
            annotationOverlays.push({ mesh, groupIndex: groupIdx, overlay, annotation, annotationId: annId })
          }
        }
      }
    }

    // Reverts the current active annotation back to the resting color.
    const clearActiveAnnotation = () => {
      if (activeAnnotationId === null) return
      const annColor = props.content?.annotationColor || '#ff6b35'
      annotationOverlays
        .filter(a => a.annotationId === activeAnnotationId)
        .forEach(a => a.overlay?.material?.color?.set(annColor))
      activeAnnotationId = null
    }

    // Sets the active annotation, recoloring overlays accordingly.
    const setActiveAnnotation = (id) => {
      const activeColor = props.content?.activeAnnotationColor || '#ffffff'
      clearActiveAnnotation()
      annotationOverlays
        .filter(a => a.annotationId === id)
        .forEach(a => a.overlay?.material?.color?.set(activeColor))
      activeAnnotationId = id
    }

    // ─── Main Three.js init ───────────────────────────────────────────────────
    const initThree = () => {
      const canvas = canvasRef.value
      const w = rootRef.value?.clientWidth  || 400
      const h = rootRef.value?.clientHeight || 300

      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true })
      renderer.setSize(w, h, false)
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
      activeCamera = camera

      controls = new TrackballControls(camera, renderer.domElement)
      controls.rotateSpeed  = 2.5
      controls.zoomSpeed    = 1.2
      controls.panSpeed     = 0.8
      controls.staticMoving = true

      // Three-point lighting
      ambientLight = new THREE.AmbientLight(0xffffff, props.content?.ambientIntensity ?? 0.35)
      scene.add(ambientLight)
      keyLight = new THREE.DirectionalLight(0xffffff, 0.85)
      keyLight.position.set(5, 10, 7)
      keyLight.castShadow = true
      keyLight.shadow.mapSize.width  = 2048
      keyLight.shadow.mapSize.height = 2048
      scene.add(keyLight)
      scene.add(keyLight.target)
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

      if (snapAnim && !is2DMode.value) {
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

      renderer.render(scene, activeCamera || camera)
      if (showAnnotationBadges.value) updateBadgePositions()
      if (toleranceEntriesRef.value.length > 0) updateToleranceLabelPositions()
    }

    // ─── View offset (left/right/top/bottom model centering) ─────────────────
    const applyViewOffset = () => {
      if (!camera || !renderer) return
      const W   = renderer.domElement.width
      const H   = renderer.domElement.height
      const ox  = (props.content?.modelOffsetLeft ?? 0) - (props.content?.modelOffsetRight ?? 0)
      const oy  = (props.content?.modelOffsetTop  ?? 0) - (props.content?.modelOffsetBottom ?? 0)
      if (ox !== 0 || oy !== 0) {
        const absX   = Math.abs(ox)
        const absY   = Math.abs(oy)
        const startX = ox < 0 ? 2 * absX : 0
        const startY = oy < 0 ? 2 * absY : 0
        camera.setViewOffset(W + 2 * absX, H + 2 * absY, startX, startY, W, H)
      } else {
        camera.clearViewOffset()
      }
      camera.updateProjectionMatrix()
    }

    // ─── Resize ───────────────────────────────────────────────────────────────
    const onResize = () => {
      if (!renderer || !rootRef.value) return
      const w = rootRef.value.clientWidth
      const h = rootRef.value.clientHeight
      if (!w || !h) return
      camera.aspect = w / h
      camera.updateProjectionMatrix()
      renderer.setSize(w, h, false)
      applyViewOffset()
      if (is2DMode.value && orthoCamera) {
        const aspect = w / h
        const s = modelRadius * 1.5
        orthoCamera.left   = -s * aspect
        orthoCamera.right  =  s * aspect
        orthoCamera.top    =  s
        orthoCamera.bottom = -s
        orthoCamera.updateProjectionMatrix()
        for (const mat of drawing2DLineMats) mat.resolution?.set(w, h)
      }
      for (const o of cornerOverlays) {
        if (o?.material?.resolution) o.material.resolution.set(w, h)
      }
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
      clearAllTolerances()
      removeEdges()
      clearCornerOverlays()
      clearFeatureOverlays()
      removeDrawingEdges()
      if (is2DMode.value) exit2DMode()
      facesData          = []
      cornersData        = []
      holeMeshNames      = new Set()
      holeMeshArray      = []
      currentFeatureModel = null
      currentRuleResult   = null

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
        const shadowsOn = props.content?.shadowsEnabled !== false
        loadedModel.traverse(obj => {
          if (!obj.isMesh) return
          clickableMeshes.push(obj)
          obj.castShadow    = shadowsOn
          obj.receiveShadow = shadowsOn
          obj.renderOrder   = 0
        })
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
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.467

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
        applyViewOffset()

        // Reposition key light relative to model and fit shadow frustum
        if (keyLight) {
          keyLight.position.set(
            center.x + maxDim * 1.5,
            center.y + maxDim * 2,
            center.z + maxDim * 1.2
          )
          keyLight.target.position.copy(center)
          keyLight.target.updateMatrixWorld()
          const s = maxDim * 1.2
          keyLight.shadow.camera.near   = maxDim * 0.1
          keyLight.shadow.camera.far    = maxDim * 8
          keyLight.shadow.camera.left   = -s
          keyLight.shadow.camera.right  =  s
          keyLight.shadow.camera.top    =  s
          keyLight.shadow.camera.bottom = -s
          keyLight.shadow.camera.updateProjectionMatrix()
        }

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

        // Build annotation overlays and edge lines now that clickableMeshes is populated
        buildAnnotationOverlays()
        buildEdges()

        // Build unified face list — all surface types; cylindrical faces carry isHole flag.
        // Merge split half-cylinders before combining with non-cylindrical faces.
        const rawFaces         = buildAllFaces()
        const cylindricalFaces = rawFaces.filter(f => f.surfaceType === 'Cylinder')
        const otherFaces       = rawFaces.filter(f => f.surfaceType !== 'Cylinder')
        const mergedCylinders  = mergeCylinders(cylindricalFaces)
        const allFaces         = [...otherFaces, ...mergedCylinders]
        facesData = allFaces
        holeMeshNames = new Set()
        for (const face of facesData) {
          if ((face.arcDeg ?? 0) >= 350 && face.isConcave === true) {
            if (Array.isArray(face.meshNames)) face.meshNames.forEach(n => holeMeshNames.add(n))
            else if (face.meshName) holeMeshNames.add(face.meshName)
          }
        }
        holeMeshArray = clickableMeshes.filter(m => holeMeshNames.has(m.name))
        setFacesVar(allFaces)

        const round2 = v => Math.round(v * 100) / 100
        const byType = allFaces.reduce((acc, f) => {
          const t = f.faceType || 'unknown'
          if (!acc[t]) acc[t] = { count: 0, surfaceArea: 0 }
          acc[t].count++
          acc[t].surfaceArea += f.surfaceArea ?? 0
          return acc
        }, {})
        const totalArea = allFaces.reduce((s, f) => s + (f.surfaceArea ?? 0), 0)
        Object.values(byType).forEach(b => {
          b.surfaceArea  = round2(b.surfaceArea)
          b.areaPercent  = totalArea > 0 ? round2((b.surfaceArea / totalArea) * 100) : 0
        })
        setFacesSummaryVar({ total: allFaces.length, totalSurfaceArea: round2(totalArea), byType })

        // Sharp corner detection disabled for performance — see docs/reactivate-sharp-corners.md
        const cornerResult = null

        const holeCount = mergedCylinders.filter(c => c.isHole === true).length
        const bossCount = mergedCylinders.filter(c => c.isHole === false).length
        emit('trigger-event', {
          name:  'holes-detected',
          event: { cylinders: mergedCylinders, holeCount, bossCount },
        })

        // Compute surface area, volume, and bounding box
        const partProps = analyzeModelGeometry(box)
        setPartPropertiesVar(partProps)

        // Body of Revolution analysis disabled for performance — see docs/reactivate-body-of-revolution.md
        // ── Phase 1: Build structured feature model ───────────────────────────
        currentFeatureModel = buildFeatureModel(mergedCylinders, allFaces, cornerResult, null, partProps.boundingBox)
        setFeatureModelVar(currentFeatureModel)
        emit('trigger-event', {
          name:  'feature-model-built',
          event: { ...currentFeatureModel.summary },
        })

        // ── Phase 4: Evaluate design rules against the feature model ──────────
        currentRuleResult = evaluateDesignRules(currentFeatureModel, props.content?.designRules)
        setRuleViolationsVar(currentRuleResult.violations)
        setRuleWarningsVar(currentRuleResult.warnings)
        setDesignScoreVar(currentRuleResult.score)
        setViolationCountVar(currentRuleResult.violationCount)
        emit('trigger-event', {
          name:  'rules-evaluated',
          event: {
            passed:         currentRuleResult.passed,
            violations:     currentRuleResult.violations,
            warnings:       currentRuleResult.warnings,
            score:          currentRuleResult.score,
            violationCount: currentRuleResult.violationCount,
          },
        })

        // ── Phase 2: Build feature overlays (violation-aware) ─────────────────
        buildFeatureOverlays()

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
      const allHits = raycaster.intersectObjects(clickableMeshes, true)

      if (toleranceMode.value) { handleToleranceFaceClick(allHits); return }

      if (props.content?.enableSelection === false) return

      const holeHits = holeMeshArray.length > 0 ? raycaster.intersectObjects(holeMeshArray, true) : []
      const hits = holeHits.length > 0 ? holeHits : allHits

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
        // Collect all overlays for this face, then deduplicate by annotationId
        // so each annotation is represented once even if it spans multiple faces.
        const faceOverlays   = annotationOverlays.filter(a => a.mesh === mesh && a.groupIndex === groupIdx)
        const seenIds        = new Set()
        const uniqueMatched  = faceOverlays.filter(a => seenIds.has(a.annotationId) ? false : (seenIds.add(a.annotationId), true))

        if (uniqueMatched.length > 0) {
          // Activate the first annotation; focusedAnnotation binding can override this
          setActiveAnnotation(uniqueMatched[0].annotationId)

          // Backward-compat: fire single-annotation event for the first match
          emit('trigger-event', {
            name:  'annotation-clicked',
            event: {
              annotation: uniqueMatched[0].annotation,
              point:      uniqueMatched[0].annotation.point,
              normal:     uniqueMatched[0].annotation.normal,
            },
          })

          // Always fire the full-array event — count > 1 signals a shared face
          emit('trigger-event', {
            name:  'annotations-clicked',
            event: {
              annotations: uniqueMatched.map(a => a.annotation),
              count:        uniqueMatched.length,
              point:        uniqueMatched[0].annotation.point,
              normal:       uniqueMatched[0].annotation.normal,
            },
          })
        } else {
          clearActiveAnnotation()
        }

        // ── Selection logic ───────────────────────────────────────────────────
        if (props.content?.multiSelectMode) {
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
        // Clicked empty space — clear all selections and deselect active annotation
        clearActiveAnnotation()
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

    // ─── Phase 1: Feature Model ───────────────────────────────────────────────
    // Organises flat facesData output into a typed MBD feature hierarchy.
    // Called once per model load with the already-computed analysis results —
    // no additional geometry passes required.
    const buildFeatureModel = (mergedCylinders, allFaces, cornerResult, borResult, boundingBox = null) => {
      const holes = mergedCylinders
        .filter(c => c.isHole === true)
        .map((c, i) => ({
          id:        `hole-${i}`,
          diameter:  c.diameter,
          depth:     c.depth,
          ldRatio:   (c.depth != null && c.diameter > 0) ? Math.round((c.depth / c.diameter) * 100) / 100 : null,
          axis:      c.axis,
          center:    c.center,
          arcDeg:    c.arcDeg,
          meshName:  c.meshName,
          meshNames: c.meshNames || [c.meshName].filter(Boolean),
          tolerance: null,
          datum:     null,
        }))

      const bosses = mergedCylinders
        .filter(c => c.isHole === false && c.isConcave === false)
        .map((c, i) => ({
          id:        `boss-${i}`,
          diameter:  c.diameter,
          depth:     c.depth,
          axis:      c.axis,
          center:    c.center,
          arcDeg:    c.arcDeg,
          meshName:  c.meshName,
          meshNames: c.meshNames || [c.meshName].filter(Boolean),
        }))

      const planes = allFaces
        .filter(f => f.faceType === 'planar')
        .map((f, i) => ({
          id:            `plane-${i}`,
          normal:        f.axis,
          shape:         f.shape,
          diameter:      f.diameter,
          meshName:      f.meshName,
          materialIndex: f.materialIndex,
        }))

      const cones = allFaces
        .filter(f => f.faceType === 'conical')
        .map((f, i) => ({
          id:            `cone-${i}`,
          halfAngle:     f.halfAngle,
          axis:          f.axis,
          meshName:      f.meshName,
          materialIndex: f.materialIndex,
        }))

      const fillets = allFaces
        .filter(f => f.faceType === 'toroidal')
        .map((f, i) => ({
          id:            `fillet-${i}`,
          meshName:      f.meshName,
          materialIndex: f.materialIndex,
        }))

      const acuteCorners  = (cornerResult?.data?.filter(c => c.type === 'acute')  || []).map((c, i) => ({ ...c, id: `corner-acute-${i}` }))
      const obtuseCorners = (cornerResult?.data?.filter(c => c.type === 'obtuse') || []).map((c, i) => ({ ...c, id: `corner-obtuse-${i}` }))

      return {
        holes,
        bosses,
        planes,
        cones,
        fillets,
        corners:  { acute: acuteCorners, obtuse: obtuseCorners },
        symmetry: borResult ? {
          isBodyOfRevolution: borResult.isBodyOfRevolution,
          axis:               borResult.axis,
          overlapPercent:     borResult.overlapPercent,
          axisSource:         borResult.axisSource,
        } : null,
        summary: {
          holeCount:          holes.length,
          bossCount:          bosses.length,
          planeCount:         planes.length,
          coneCount:          cones.length,
          filletCount:        fillets.length,
          acuteCornerCount:   acuteCorners.length,
          obtuseCornerCount:  obtuseCorners.length,
          isBodyOfRevolution: borResult?.isBodyOfRevolution ?? false,
          bbWidth:            boundingBox?.width  ?? null,
          bbHeight:           boundingBox?.height ?? null,
          bbDepth:            boundingBox?.depth  ?? null,
          bbMaxDimension:     boundingBox ? Math.max(boundingBox.width, boundingBox.height, boundingBox.depth) : null,
        },
      }
    }

    // ─── Phase 4: Design Rule Check Engine ───────────────────────────────────
    // Pure function — no Three.js, no Vue reactivity. Returns a result object
    // that can be stored and re-emitted whenever rules or the model change.
    const RULE_GETTERS = {
      hole:   {
        diameter:         f => f.diameter,
        depth:            f => f.depth,
        'depth/diameter': f => (f.diameter ? f.depth / f.diameter : null),
        arcDeg:           f => f.arcDeg,
      },
      boss:   {
        diameter:         f => f.diameter,
        depth:            f => f.depth,
        'depth/diameter': f => (f.diameter ? f.depth / f.diameter : null),
      },
      plane:  { count: Object.assign((_, list) => list.length, { listLevel: true }) },
      cone:   { halfAngle: f => f.halfAngle, count: Object.assign((_, list) => list.length, { listLevel: true }) },
      fillet: { count: Object.assign((_, list) => list.length, { listLevel: true }) },
      corner: { angle: f => f.angle, type: f => f.type },
      global: {
        holeCount:          (_, __, m) => m.summary.holeCount,
        bossCount:          (_, __, m) => m.summary.bossCount,
        planeCount:         (_, __, m) => m.summary.planeCount,
        coneCount:          (_, __, m) => m.summary.coneCount,
        filletCount:        (_, __, m) => m.summary.filletCount,
        acuteCornerCount:   (_, __, m) => m.summary.acuteCornerCount,
        obtuseCornerCount:  (_, __, m) => m.summary.obtuseCornerCount,
        isBodyOfRevolution: (_, __, m) => m.summary.isBodyOfRevolution,
        'boundingBox.width':        (_, __, m) => m.summary.bbWidth,
        'boundingBox.height':       (_, __, m) => m.summary.bbHeight,
        'boundingBox.depth':        (_, __, m) => m.summary.bbDepth,
        'boundingBox.maxDimension': (_, __, m) => m.summary.bbMaxDimension,
      },
    }

    const RULE_OPS = {
      '>=': (a, b) => typeof a === 'number' && a >= b,
      '<=': (a, b) => typeof a === 'number' && a <= b,
      '>':  (a, b) => typeof a === 'number' && a > b,
      '<':  (a, b) => typeof a === 'number' && a < b,
      '==': (a, b) => a == b,
      '!=': (a, b) => a != b,
      'is': (a, b) => a === b,
    }

    const evaluateDesignRules = (featureModel, rules) => {
      const empty = { passed: true, violations: [], warnings: [], score: 100, violationCount: 0 }
      if (!featureModel || !Array.isArray(rules) || !rules.length) return empty

      const violations = []
      const warnings   = []
      let rulesPassed  = 0
      let rulesTotal   = 0

      for (const rule of rules) {
        const { id, label, featureType, property, operator, threshold, severity = 'error' } = rule
        if (!featureType || !property || !operator) continue
        rulesTotal++

        const list = ({
          hole:   featureModel.holes   || [],
          boss:   featureModel.bosses  || [],
          plane:  featureModel.planes  || [],
          cone:   featureModel.cones   || [],
          fillet: featureModel.fillets || [],
          corner: [...(featureModel.corners?.acute || []), ...(featureModel.corners?.obtuse || [])],
          global: [null],
        })[featureType] || []

        const getter = RULE_GETTERS[featureType]?.[property]
        if (!getter) { rulesPassed++; continue }

        const op        = RULE_OPS[operator]
        let rulePassed  = true
        // List-level getters (e.g. count) produce one result for the whole list, not per feature
        const evalList  = getter.listLevel ? [null] : list

        for (const feature of evalList) {
          const actual = getter(feature, list, featureModel)
          if (actual === null || actual === undefined) continue
          if (!op || !op(actual, threshold)) {
            const entry = {
              ruleId:      id || `${featureType}.${property}`,
              label:       label || `${featureType} ${property} ${operator} ${threshold}`,
              featureType,
              featureId:   feature?.id   ?? null,
              meshName:    feature?.meshName  ?? null,
              meshNames:   feature?.meshNames ?? null,
              actual,
              threshold,
              severity,
            }
            if (severity === 'warning') warnings.push(entry)
            else violations.push(entry)
            rulePassed = false
          }
        }

        if (rulePassed) rulesPassed++
      }

      const score = rulesTotal > 0 ? Math.round((rulesPassed / rulesTotal) * 100) : 100
      return { passed: violations.length === 0, violations, warnings, score, violationCount: violations.length }
    }

    // ─── Phase 2: Feature Overlays ────────────────────────────────────────────
    const clearFeatureOverlays = () => {
      for (const overlays of featureOverlayMap.values()) overlays.forEach(o => removeOverlay(o))
      featureOverlayMap = new Map()
    }

    // Resolve mesh + face index from feature identity, then delegate to makeOverlayMesh
    const makeFeatureOverlay = (meshName, materialIndex, color) => {
      const mesh = clickableMeshes.find(m => m.name === meshName)
      if (!mesh) return null
      const geo = mesh.geometry
      let faceIndex = 0
      if (geo.groups?.length > 0) {
        const g = geo.groups.find(gr => (gr.materialIndex ?? 0) === materialIndex)
        if (g) faceIndex = Math.floor(g.start / 3)
      }
      return makeOverlayMesh(mesh, faceIndex, color, -1.5)
    }

    const buildFeatureOverlays = () => {
      clearFeatureOverlays()
      if (!loadedModel || !currentFeatureModel) return

      const featureColorsDef = props.content?.featureColors || []
      const activeTypes      = props.content?.activeFeatureTypes
      const hasActiveFilter  = Array.isArray(activeTypes) && activeTypes.length > 0
      const violationColor   = props.content?.violationHighlightColor || '#ff3b30'

      const colorMap = Object.fromEntries(
        featureColorsDef.map(fc => [fc.featureType, { color: fc.color || '#888', visible: fc.visible !== false }])
      )
      const violatedIds = new Set(
        (currentRuleResult?.violations || []).map(v => v.featureId).filter(Boolean)
      )

      const groups = [
        { type: 'hole',   features: currentFeatureModel.holes   || [] },
        { type: 'boss',   features: currentFeatureModel.bosses  || [] },
        { type: 'plane',  features: currentFeatureModel.planes  || [] },
        { type: 'cone',   features: currentFeatureModel.cones   || [] },
        { type: 'fillet', features: currentFeatureModel.fillets || [] },
      ]

      for (const { type, features } of groups) {
        const fc          = colorMap[type]
        const typeVisible = fc?.visible && (!hasActiveFilter || activeTypes.includes(type))

        for (const feature of features) {
          const isViolated = violatedIds.has(feature.id)
          // Violations always render; non-violations only render when the type is visible
          if (!isViolated && !typeVisible) continue

          const color    = isViolated ? violationColor : (fc?.color || '#888888')
          const overlays = []

          if (feature.meshNames?.length) {
            for (const name of feature.meshNames) {
              const o = makeFeatureOverlay(name, 0, color)
              if (o) overlays.push(o)
            }
          } else if (feature.meshName) {
            const o = makeFeatureOverlay(feature.meshName, feature.materialIndex ?? 0, color)
            if (o) overlays.push(o)
          }

          if (overlays.length) featureOverlayMap.set(feature.id, overlays)
        }
      }
    }

    // ─── Phase 3: Badge Position Update (called per-frame in animate) ─────────
    // Directly mutates badge element styles to avoid Vue reactivity cost at 60fps.
    const updateBadgePositions = () => {
      const container = badgeContainerRef.value
      if (!container || !camera || !renderer) return
      const w   = renderer.domElement.clientWidth
      const h   = renderer.domElement.clientHeight
      const pts = processedAnnotations.value
      const els = container.children
      for (let i = 0; i < els.length && i < pts.length; i++) {
        const pt = pts[i]?.point
        if (!pt) continue
        const v = new THREE.Vector3(pt.x, pt.y, pt.z).project(camera)
        const x = (v.x *  0.5 + 0.5) * w
        const y = (v.y * -0.5 + 0.5) * h
        const visible = v.z < 1 && x >= 0 && x <= w && y >= 0 && y <= h
        els[i].style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`
        els[i].style.display   = visible ? '' : 'none'
      }
    }

    const updateToleranceLabelPositions = () => {
      const container = toleranceLabelContainerRef.value
      if (!container || !camera || !renderer) return
      const w = renderer.domElement.clientWidth
      const h = renderer.domElement.clientHeight
      const entries = toleranceEntriesRef.value
      const els = container.children
      for (let i = 0; i < els.length && i < entries.length; i++) {
        const { faceA, faceB } = entries[i]
        const mid = new THREE.Vector3(
          (faceA.centroid.x + faceB.centroid.x) / 2,
          (faceA.centroid.y + faceB.centroid.y) / 2,
          (faceA.centroid.z + faceB.centroid.z) / 2,
        )
        const v = mid.project(camera)
        const x = (v.x *  0.5 + 0.5) * w
        const y = (v.y * -0.5 + 0.5) * h
        const visible = v.z < 1 && x >= 0 && x <= w && y >= 0 && y <= h
        els[i].style.transform = `translate(calc(${x}px - 50%), calc(${y}px - 50%))`
        els[i].style.display = visible ? '' : 'none'
      }
    }

    // ─── Watchers ─────────────────────────────────────────────────────────────
    watch(() => props.content?.glbData, (val) => { if (val && libsReady.value) loadModel(val) })

    watch(() => props.content?.focusedHole, (hole) => {
      if (hole && libsReady.value && loadedModel) focusOnHole(hole)
    }, { deep: true })

    watch(() => props.content?.focusedAnnotation, (ann) => {
      if (!ann) { clearActiveAnnotation(); return }
      // Match by _id (set during processedAnnotations), then by id, then by object reference
      const match = annotationOverlays.find(a =>
        (ann._id !== undefined && a.annotationId === ann._id) ||
        (ann.id  !== undefined && a.annotationId === ann.id)  ||
        a.annotation === ann
      )
      if (match) setActiveAnnotation(match.annotationId)
      else clearActiveAnnotation()
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

    watch(() => props.content?.ambientIntensity, (val) => {
      if (ambientLight) ambientLight.intensity = val ?? 0.35
    })

    watch(() => props.content?.shadowsEnabled, (enabled) => {
      if (!loadedModel) return
      const on = enabled !== false
      loadedModel.traverse(obj => {
        if (!obj.isMesh) return
        obj.castShadow    = on
        obj.receiveShadow = on
      })
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
      annotationOverlays
        .filter(a => a.annotationId !== activeAnnotationId)
        .forEach(a => a.overlay?.material?.color?.set(color || '#ff6b35'))
    })

    watch(() => props.content?.activeAnnotationColor, (color) => {
      if (activeAnnotationId === null) return
      annotationOverlays
        .filter(a => a.annotationId === activeAnnotationId)
        .forEach(a => a.overlay?.material?.color?.set(color || '#ffffff'))
    })

    watch(() => props.content?.showEdges, () => {
      if (libsReady.value && loadedModel) buildEdges()
    })

    watch(() => props.content?.edgeColor, (color) => {
      edgeLines.forEach(l => l.material.color.set(color || '#222222'))
    })

    // Corner watchers disabled — see docs/reactivate-sharp-corners.md

    watch(() => props.content?.showGrid, (show) => {
      if (!scene) return
      if (show && !gridHelper) {
        gridHelper = new THREE.GridHelper(modelRadius * 4, 20, 0x888888, 0xcccccc)
        scene.add(gridHelper)
      } else if (!show && gridHelper) {
        scene.remove(gridHelper); gridHelper.dispose(); gridHelper = null
      }
    })

    watch(() => [
      props.content?.modelOffsetLeft,
      props.content?.modelOffsetRight,
      props.content?.modelOffsetTop,
      props.content?.modelOffsetBottom,
    ], () => {
      applyViewOffset()
    })

    // Rebuild annotation overlays whenever the resolved annotation array changes
    watch(processedAnnotations, () => {
      if (libsReady.value && loadedModel) buildAnnotationOverlays()
    }, { deep: true })

    // Phase 2: Rebuild feature overlays when colors / active filter change
    watch(() => [props.content?.featureColors, props.content?.activeFeatureTypes, props.content?.violationHighlightColor], () => {
      if (libsReady.value && loadedModel) buildFeatureOverlays()
    }, { deep: true })

    watch(() => props.content?.enableToleranceMode, (val) => {
      const on = val === true
      if (toleranceMode.value !== on) {
        toleranceMode.value = on
        if (!on) clearPendingTolerance()
      }
    })

    watch(() => props.content?.initialTolerances, (entries) => {
      if (!Array.isArray(entries) || !loadedModel) return
      clearAllTolerances()
      for (const entry of entries) {
        if (!entry?.faceA?.centroid || !entry?.faceB?.centroid) continue
        const cA = new THREE.Vector3(entry.faceA.centroid.x, entry.faceA.centroid.y, entry.faceA.centroid.z)
        const cB = new THREE.Vector3(entry.faceB.centroid.x, entry.faceB.centroid.y, entry.faceB.centroid.z)
        const hitA = _raycastFace(entry.faceA.centroid, entry.faceA.normal)
        const hitB = _raycastFace(entry.faceB.centroid, entry.faceB.normal)
        const id = entry.id || `tol-${Date.now()}-${Math.random()}`
        let overlayA = null, overlayB = null
        if (hitA) overlayA = makeOverlayMesh(hitA.object, hitA.faceIndex ?? 0, '#3b82f6', -3)
        if (hitB) overlayB = makeOverlayMesh(hitB.object, hitB.faceIndex ?? 0, '#22c55e', -3)
        const line = buildToleranceLine(cA, cB)
        toleranceVisuals.push({ id, overlayA, overlayB, line })
        toleranceEntriesRef.value = [...toleranceEntriesRef.value, { ...entry, id }]
      }
      updateToleranceVar()
    }, { deep: true })

    // Phase 4: Re-evaluate rules when rule definitions change; then refresh overlays
    watch(() => props.content?.designRules, (rules) => {
      if (!currentFeatureModel) return
      currentRuleResult = evaluateDesignRules(currentFeatureModel, rules)
      setRuleViolationsVar(currentRuleResult.violations)
      setRuleWarningsVar(currentRuleResult.warnings)
      setDesignScoreVar(currentRuleResult.score)
      setViolationCountVar(currentRuleResult.violationCount)
      emit('trigger-event', {
        name:  'rules-evaluated',
        event: {
          passed:         currentRuleResult.passed,
          violations:     currentRuleResult.violations,
          warnings:       currentRuleResult.warnings,
          score:          currentRuleResult.score,
          violationCount: currentRuleResult.violationCount,
        },
      })
      if (libsReady.value && loadedModel) buildFeatureOverlays()
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
      clearAllTolerances()
      clearCornerOverlays()
      clearFeatureOverlays()
      facesData           = []
      cornersData         = []
      holeMeshNames       = new Set()
      holeMeshArray       = []
      currentFeatureModel = null
      currentRuleResult   = null
      removeEdges()
      overrideMaterials.forEach(m => m.dispose())
      overrideMaterials = []
      if (loadedModel) disposeObject(loadedModel)
      if (renderer) { renderer.dispose(); renderer.forceContextLoss() }
    })

    return {
      // DOM
      rootRef, canvasRef, fileInputRef, badgeContainerRef,
      toleranceLabelContainerRef,
      content: props.content,
      // UI
      isLoading, loadingMsg, errorMsg, selectionLabel, libsReady,
      modelLoaded, isDragging,
      rootStyle,
      // Phase 3: badge layer
      showAnnotationBadges, processedAnnotations, showBadgeLabel, showUploadButton, showToleranceButton,
      // 2D drawing mode
      is2DMode, current2DView, show2DToggle, toggle2DMode, set2DView,
      // Tolerance mode
      toleranceMode, toleranceEntriesRef,
      showToleranceInput, toleranceInputStyle,
      tolerancePendingNominal, tolerancePendingPlus, tolerancePendingMinus,
      toggleToleranceMode, confirmTolerance, cancelTolerance: clearPendingTolerance, removeToleranceEntry,
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
    position: absolute;
    top: 0;
    left: 0;
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
    top: 50%;
    left: 12px;
    transform: translateY(-50%);
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0;
    z-index: 10;
    background: #0D0D0D;
    border-radius: 8px;
    padding: 4px;
    overflow: hidden;
  }

  .ctrl-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 36px;
    height: 36px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: #ffffff;
    cursor: pointer;
    padding: 0;
    line-height: 1;
    transition: background 0.12s;

    &:hover  { background: rgba(255, 255, 255, 0.15); }
    &:active { background: rgba(255, 255, 255, 0.25); }

    &--2d {
      font-size: 11px;
      font-weight: 700;
      letter-spacing: 0.03em;
    }
  }

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

  // ── GD&T / PMI badge layer ─────────────────────────────────────────────────
  .badge-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: hidden;
  }

  .annotation-badge {
    position: absolute;
    top: 0;
    left: 0;
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 3px 8px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
    pointer-events: none;
    backdrop-filter: blur(3px);
    box-shadow: 0 1px 4px rgba(0, 0, 0, 0.3);

    &.badge-type-dimension { background: rgba(26, 115, 232, 0.9); color: #fff; }
    &.badge-type-tolerance { background: rgba(234, 67, 53, 0.9);  color: #fff; }
    &.badge-type-datum     { background: rgba(0, 0, 0, 0.85);     color: #fff; border: 1px solid rgba(255,255,255,0.5); }
    &.badge-type-note      { background: rgba(30, 30, 30, 0.85);  color: #fff; }
  }

  .badge-datum {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 16px;
    height: 16px;
    border: 1.5px solid currentColor;
    border-radius: 50%;
    font-size: 9px;
    font-weight: 700;
    flex-shrink: 0;
  }

  .badge-text {
    max-width: 160px;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .badge-dropzone {
    display: contents;
    pointer-events: auto;

    &:empty {
      display: none;
    }
  }

  // ── 2D view axis panel ────────────────────────────────────────────────────────
  .view2d-panel {
    position: absolute;
    bottom: 12px;
    left: 50%;
    transform: translateX(-50%);
    display: flex;
    gap: 0;
    background: #0D0D0D;
    border-radius: 8px;
    padding: 4px;
    z-index: 10;
  }

  .view2d-btn {
    height: 28px;
    padding: 0 10px;
    border: none;
    border-radius: 5px;
    background: transparent;
    color: #aaa;
    font-size: 11px;
    font-weight: 600;
    letter-spacing: 0.03em;
    cursor: pointer;
    transition: background 0.12s, color 0.12s;

    &:hover { background: rgba(255,255,255,0.1); color: #fff; }

    &--active {
      background: rgba(59, 130, 246, 0.25);
      color: #3b82f6;
    }
  }

  // ── Tolerance mode ────────────────────────────────────────────────────────────
  .ctrl-btn--active {
    background: rgba(59, 130, 246, 0.25) !important;
    color: #3b82f6 !important;
  }

  .tolerance-input-panel {
    position: absolute;
    z-index: 20;
    background: #0D0D0D;
    border-radius: 8px;
    padding: 12px;
    min-width: 180px;
    pointer-events: all;
    transform: translate(-50%, calc(-100% - 10px));

    .tol-panel-header {
      margin-bottom: 10px;
      text-align: center;
      .tol-nominal {
        display: block;
        font-size: 15px;
        font-weight: 600;
        color: #ffffff;
        font-family: monospace;
      }
      .tol-label-text {
        display: block;
        font-size: 10px;
        color: #666;
        text-transform: uppercase;
        letter-spacing: 0.05em;
      }
    }

    .tol-fields {
      display: flex;
      gap: 8px;
      margin-bottom: 10px;
      .tol-field {
        display: flex;
        align-items: center;
        gap: 4px;
        flex: 1;
        .tol-sign {
          font-size: 14px;
          font-weight: 700;
          width: 10px;
          flex-shrink: 0;
          &.tol-plus  { color: #22c55e; }
          &.tol-minus { color: #ef4444; }
        }
        .tol-input {
          width: 100%;
          min-width: 0;
          background: #1a1a1a;
          border: 1px solid #333;
          border-radius: 4px;
          padding: 4px 6px;
          color: #fff;
          font-size: 12px;
          font-family: monospace;
          text-align: right;
          &:focus { outline: none; border-color: #555; }
          &::-webkit-outer-spin-button,
          &::-webkit-inner-spin-button { -webkit-appearance: none; }
        }
      }
    }

    .tol-actions {
      display: flex;
      gap: 6px;
      .tol-btn-cancel, .tol-btn-confirm {
        flex: 1;
        padding: 5px 8px;
        border-radius: 4px;
        font-size: 12px;
        font-weight: 500;
        cursor: pointer;
        border: none;
      }
      .tol-btn-cancel {
        background: #2a2a2a;
        color: #999;
        &:hover { background: #333; color: #fff; }
      }
      .tol-btn-confirm {
        background: #3b82f6;
        color: #fff;
        &:hover { background: #2563eb; }
      }
    }
  }

  .tolerance-label-layer {
    position: absolute;
    inset: 0;
    pointer-events: none;
    overflow: visible;

    .tolerance-label {
      position: absolute;
      background: rgba(13, 13, 13, 0.9);
      border-radius: 6px;
      padding: 4px 10px;
      pointer-events: all;
      min-width: 80px;
      text-align: center;
      .tol-lbl-nominal {
        display: block;
        font-size: 11px;
        font-weight: 600;
        color: #fff;
        font-family: monospace;
      }
      .tol-lbl-tol {
        display: block;
        font-size: 10px;
        color: #aaa;
        font-family: monospace;
      }
      .tol-lbl-remove {
        position: absolute;
        top: -6px;
        right: -6px;
        width: 14px;
        height: 14px;
        background: #ef4444;
        border: none;
        border-radius: 50%;
        color: #fff;
        font-size: 9px;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        line-height: 1;
      }
    }
  }
}
</style>
