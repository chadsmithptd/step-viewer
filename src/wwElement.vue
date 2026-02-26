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
const CDN_ORBIT = CDN + '/examples/jsm/controls/OrbitControls'
const CDN_GLTF  = CDN + '/examples/jsm/loaders/GLTFLoader'

// Module-level cache so libs are fetched once per page load
let THREE = null
let OrbitControls = null
let GLTFLoader = null

const loadLibs = async () => {
  if (THREE) return
  const [t, c, g] = await Promise.all([
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/controls/OrbitControls'),
    import(/* webpackIgnore: true */ 'https://esm.sh/three@0.162.0/examples/jsm/loaders/GLTFLoader'),
  ])
  THREE = t
  OrbitControls = c.OrbitControls
  GLTFLoader = g.GLTFLoader
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

    // ─── Three.js objects (plain vars – no Vue reactivity overhead) ───────────
    let renderer       = null
    let scene          = null
    let camera         = null
    let controls       = null
    let raycaster      = null
    let animFrameId    = null
    let resizeObserver = null
    let loadedModel    = null
    let highlightOverlay = null
    let gridHelper     = null
    let modelRadius    = 5
    let snapAnim       = null
    let pointerDownPos = null   // for drag detection

    // Stored after first model load; used by resetCamera
    let defaultCameraPos = null
    let defaultTarget    = null

    // ─── Computed ─────────────────────────────────────────────────────────────
    const rootStyle = computed(() => ({
      width: '100%',
      height: '100%',
      position: 'relative',
      overflow: 'hidden',
      background: props.content?.backgroundColor || 'transparent',
    }))

    // ─── Helpers ──────────────────────────────────────────────────────────────
    const easeInOut = (t) => (t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t)

    const isDataUrl  = (s) => typeof s === 'string' && s.startsWith('data:')
    const isHttpUrl  = (s) => typeof s === 'string' &&
      (s.startsWith('http') || s.startsWith('/') || s.startsWith('blob:'))

    const decodeBase64ToBuffer = (b64) => {
      const raw = atob(b64)
      const buf = new ArrayBuffer(raw.length)
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
      renderer.shadowMap.type = THREE.PCFSoftShadowMap
      renderer.toneMapping = THREE.ACESFilmicToneMapping
      renderer.toneMappingExposure = 1.1

      scene = new THREE.Scene()
      const bgColor = props.content?.backgroundColor
      scene.background = bgColor ? new THREE.Color(bgColor) : null

      camera = new THREE.PerspectiveCamera(45, w / h, 0.001, 100000)
      camera.position.set(5, 5, 5)
      camera.lookAt(0, 0, 0)

      controls = new OrbitControls(camera, renderer.domElement)
      controls.enableDamping   = true
      controls.dampingFactor   = 0.06
      controls.screenSpacePanning = true
      controls.enableZoom      = true

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
      removeHighlight()

      try {
        const loader = new GLTFLoader()
        let gltf

        if (isDataUrl(glbData)) {
          const buf = decodeBase64ToBuffer(glbData.split(',')[1])
          gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej))
        } else if (isHttpUrl(glbData)) {
          gltf = await new Promise((res, rej) => loader.load(glbData, res, undefined, rej))
        } else {
          // Assume raw base64
          const buf = decodeBase64ToBuffer(glbData)
          gltf = await new Promise((res, rej) => loader.parse(buf, '', res, rej))
        }

        loadedModel = gltf.scene
        scene.add(loadedModel)

        // Flush all child transforms before computing bounding box
        loadedModel.updateMatrixWorld(true)

        // Auto-fit camera using world-space bounding box center as orbit pivot
        const box    = new THREE.Box3().setFromObject(loadedModel)
        const center = box.getCenter(new THREE.Vector3())
        const size   = box.getSize(new THREE.Vector3())
        const maxDim = Math.max(size.x, size.y, size.z)

        // DO NOT move loadedModel — use world-space center as controls.target
        modelRadius = maxDim * 0.6

        const fov  = camera.fov * (Math.PI / 180)
        const dist = (maxDim / 2) / Math.tan(fov / 2) * 1.5

        camera.position.set(center.x + dist, center.y + dist * 0.7, center.z + dist)
        camera.near = maxDim * 0.0001
        camera.far  = maxDim * 200
        camera.updateProjectionMatrix()

        controls.target.copy(center)
        controls.minDistance = maxDim * 0.05
        controls.maxDistance = maxDim * 20
        controls.update()

        defaultCameraPos = camera.position.clone()
        defaultTarget    = center.clone()

        // Rebuild grid at model floor level
        if (gridHelper) { scene.remove(gridHelper); gridHelper.dispose(); gridHelper = null }
        if (props.content?.showGrid) {
          gridHelper = new THREE.GridHelper(maxDim * 2, 20, 0x888888, 0xcccccc)
          gridHelper.position.y = box.min.y
          scene.add(gridHelper)
        }

        // Count geometry stats for the trigger event
        let meshCount = 0, vertexCount = 0
        loadedModel.traverse((obj) => {
          if (obj.isMesh) {
            meshCount++
            vertexCount += obj.geometry?.attributes?.position?.count || 0
          }
        })

        modelLoaded.value = true

        emit('trigger-event', {
          name: 'model-loaded',
          event: {
            meshCount,
            vertexCount,
            boundingBox: {
              min:  { x: box.min.x, y: box.min.y, z: box.min.z },
              max:  { x: box.max.x, y: box.max.y, z: box.max.z },
              size: { x: size.x,  y: size.y,  z: size.z },
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

    // ─── Per-face highlight overlay ───────────────────────────────────────────
    const selectFace = (mesh, materialIndex) => {
      removeHighlight()
      const geo = mesh.geometry
      const hasFaceGroups = geo.groups?.length > 1
      const subGeo = new THREE.BufferGeometry()

      // Share (don't clone) vertex attributes — safe for static models
      for (const [key, attr] of Object.entries(geo.attributes)) {
        subGeo.setAttribute(key, attr)
      }

      if (hasFaceGroups && geo.index) {
        const group = geo.groups[materialIndex ?? 0]
        if (group) {
          const src = geo.index.array
          const arr = new (src.constructor)(group.count)
          for (let i = 0; i < group.count; i++) arr[i] = src[group.start + i]
          subGeo.setIndex(new THREE.BufferAttribute(arr, 1))
        }
      } else if (geo.index) {
        subGeo.setIndex(geo.index) // whole mesh, shared ref
      }

      highlightOverlay = new THREE.Mesh(subGeo, new THREE.MeshBasicMaterial({
        color: new THREE.Color(props.content?.selectionColor || '#1a73e8'),
        transparent: true,
        opacity: 0.75,
        polygonOffset: true,
        polygonOffsetFactor: -2,
        polygonOffsetUnits: -2,
        side: THREE.DoubleSide,
        depthWrite: false,
      }))

      mesh.updateWorldMatrix(true, false)
      highlightOverlay.matrixAutoUpdate = false
      highlightOverlay.matrix.copy(mesh.matrixWorld)
      scene.add(highlightOverlay)
    }

    const removeHighlight = () => {
      if (!highlightOverlay) return
      scene.remove(highlightOverlay)
      // Clear attribute refs WITHOUT disposing shared geometry attributes
      Object.keys(highlightOverlay.geometry.attributes).forEach(k =>
        highlightOverlay.geometry.deleteAttribute(k))
      highlightOverlay.geometry.dispose()
      highlightOverlay.material.dispose()
      highlightOverlay = null
    }

    // ─── Canvas click → raycasting ────────────────────────────────────────────
    const onCanvasClick = (event) => {
      if (!scene || !camera || !loadedModel) return

      const canvas = canvasRef.value
      const rect   = canvas.getBoundingClientRect()
      const mouse  = new THREE.Vector2(
        ((event.clientX - rect.left) / rect.width)  * 2 - 1,
        -((event.clientY - rect.top)  / rect.height) * 2 + 1
      )

      raycaster.setFromCamera(mouse, camera)

      const meshes = []
      loadedModel.traverse((obj) => { if (obj.isMesh) meshes.push(obj) })
      const hits = raycaster.intersectObjects(meshes, false)

      if (hits.length > 0) {
        const hit = hits[0]
        const groupIndex = hit.face?.materialIndex ?? 0
        selectFace(hit.object, groupIndex)
        selectionLabel.value = hit.object.name || `Face ${hit.faceIndex}`

        emit('trigger-event', {
          name: 'face-selected',
          event: {
            faceIndex:  hit.faceIndex ?? 0,
            groupIndex,
            meshName:   hit.object.name || '',
            objectName: hit.object.parent?.name || hit.object.name || '',
            point:  { x: hit.point.x, y: hit.point.y, z: hit.point.z },
            normal: hit.face
              ? { x: hit.face.normal.x, y: hit.face.normal.y, z: hit.face.normal.z }
              : { x: 0, y: 0, z: 0 },
            userData: hit.object.userData ?? {},
          },
        })
      } else {
        removeHighlight()
        selectionLabel.value = ''
      }
    }

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
      event.target.value = '' // allow re-selecting the same file
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
      removeHighlight()
      selectionLabel.value = ''
    }

    const rotateDeg = (deg) => {
      if (!camera || !controls) return
      const angle  = (deg * Math.PI) / 180
      const offset = camera.position.clone().sub(controls.target)
      const cos = Math.cos(angle), sin = Math.sin(angle)
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

    // ─── Watchers ─────────────────────────────────────────────────────────────
    watch(() => props.content?.glbData, (val) => { if (val && libsReady.value) loadModel(val) })

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

    watch(() => props.content?.showGrid, (show) => {
      if (!scene) return
      if (show && !gridHelper) {
        gridHelper = new THREE.GridHelper(modelRadius * 4, 20, 0x888888, 0xcccccc)
        scene.add(gridHelper)
      } else if (!show && gridHelper) {
        scene.remove(gridHelper); gridHelper.dispose(); gridHelper = null
      }
    })

    // ─── Lifecycle ────────────────────────────────────────────────────────────
    onMounted(async () => {
      isLoading.value  = true
      loadingMsg.value = 'Initializing viewer…'
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
      cancelAnimationFrame(animFrameId)
      resizeObserver?.disconnect()
      controls?.dispose()
      removeHighlight()
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
      onCanvasClick,
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
