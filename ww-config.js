export default {
  editor: {
    label: { en: 'STEP Viewer' },
    icon: 'cube',
  },
  properties: {
    glbData: {
      label: { en: 'GLB Data' },
      type: 'Text',
      section: 'settings',
      bindable: true,
      defaultValue: '',
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: 'A URL (http/https/blob) or base64-encoded GLB string from OCCT processing',
      },
      propertyHelp: 'Pass a URL or base64-encoded GLB binary from OCCT. Supports GLTF/GLB format.',
      /* wwEditor:end */
    },

    centerOfRotation: {
      label: { en: 'Center of Rotation' },
      type: 'Object',
      section: 'settings',
      bindable: true,
      defaultValue: null,
      /* wwEditor:start */
      bindingValidation: {
        type: 'object',
        tooltip: 'Object with x, y, z properties. When bound and changed, moves the orbit pivot to that point.',
      },
      propertyHelp: 'Bind a variable to read the live orbit center, or set it to programmatically move the pivot.',
      /* wwEditor:end */
    },

    focusedHole: {
      label: { en: 'Focused Hole' },
      type: 'Object',
      section: 'settings',
      bindable: true,
      defaultValue: null,
      /* wwEditor:start */
      bindingValidation: {
        type: 'object',
        tooltip: 'Bind a hole object from the holes variable. Must include center {x,y,z} and axis {x,y,z}.',
      },
      propertyHelp: 'When changed, the camera animates to look into this hole. Bind to a variable updated on list-item click.',
      /* wwEditor:end */
    },

    // ── Annotations ──────────────────────────────────────────────────────────
    annotations: {
      label: { en: 'Annotations' },
      type: 'Array',
      section: 'settings',
      bindable: true,
      defaultValue: [],
      options: {
        expandable: true,
        getItemLabel(item) {
          return item.label || item.name || item.title || 'Annotation'
        },
        item: {
          type: 'Object',
          defaultValue: {
            point:  { x: 0, y: 0, z: 0 },
            normal: { x: 0, y: 1, z: 0 },
            label:  '',
          },
          options: {
            item: {
              point:  { label: { en: 'Point (x, y, z)' },  type: 'Object' },
              normal: { label: { en: 'Normal (x, y, z)' }, type: 'Object' },
              label:  { label: { en: 'Label' },             type: 'Text'   },
            },
          },
        },
      },
      /* wwEditor:start */
      bindingValidation: {
        type: 'array',
        tooltip: 'Array of annotation objects, each with a point {x,y,z} and normal {x,y,z} matching a face on the loaded model',
      },
      propertyHelp: 'Bind an array of annotations. Each item must include a point and normal that correspond to a face on the loaded model.',
      /* wwEditor:end */
    },

    annotationPointFormula: {
      label: { en: 'Point Field' },
      type: 'Formula',
      section: 'settings',
      options: content => ({
        template: Array.isArray(content.annotations) && content.annotations.length > 0
          ? content.annotations[0]
          : null,
      }),
      defaultValue: { type: 'f', code: "context.mapping?.['point']" },
      hidden: (content, sidepanelContent, boundProps) =>
        !Array.isArray(content.annotations) || !content.annotations?.length || !boundProps.annotations,
    },

    annotationNormalFormula: {
      label: { en: 'Normal Field' },
      type: 'Formula',
      section: 'settings',
      options: content => ({
        template: Array.isArray(content.annotations) && content.annotations.length > 0
          ? content.annotations[0]
          : null,
      }),
      defaultValue: { type: 'f', code: "context.mapping?.['normal']" },
      hidden: (content, sidepanelContent, boundProps) =>
        !Array.isArray(content.annotations) || !content.annotations?.length || !boundProps.annotations,
    },

    // ── Style ─────────────────────────────────────────────────────────────────
    backgroundColor: {
      label: { en: 'Background Color' },
      type: 'Color',
      section: 'style',
      bindable: true,
      defaultValue: '',
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: 'CSS color for the viewer background',
      },
      /* wwEditor:end */
    },

    overrideColor: {
      label: { en: 'Override Model Color' },
      type: 'OnOff',
      section: 'style',
      bindable: true,
      defaultValue: false,
      /* wwEditor:start */
      bindingValidation: {
        type: 'boolean',
        tooltip: 'When on, replaces all GLB materials with a single uniform color',
      },
      /* wwEditor:end */
    },

    modelColor: {
      label: { en: 'Model Color' },
      type: 'Color',
      section: 'style',
      bindable: true,
      defaultValue: '#cccccc',
      hidden: content => !content?.overrideColor,
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: 'Uniform color applied to all mesh surfaces when Override Model Color is on',
      },
      /* wwEditor:end */
    },

    modelOpacity: {
      label: { en: 'Model Opacity' },
      type: 'Number',
      section: 'style',
      bindable: true,
      defaultValue: 1,
      options: { min: 0, max: 1, step: 0.01 },
      /* wwEditor:start */
      bindingValidation: {
        type: 'number',
        tooltip: 'Model opacity from 0 (invisible) to 1 (fully opaque). Hole highlights and selections retain full color.',
      },
      /* wwEditor:end */
    },

    selectionColor: {
      label: { en: 'Selection Highlight Color' },
      type: 'Color',
      section: 'style',
      bindable: true,
      defaultValue: '#1a73e8',
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: 'Highlight color applied to selected mesh faces',
      },
      /* wwEditor:end */
    },

    annotationColor: {
      label: { en: 'Annotation Highlight Color' },
      type: 'Color',
      section: 'style',
      bindable: true,
      defaultValue: '#ff6b35',
      /* wwEditor:start */
      bindingValidation: {
        type: 'string',
        tooltip: 'Color applied to faces that have an annotation pinned to them',
      },
      /* wwEditor:end */
    },

    showGrid: {
      label: { en: 'Show Grid' },
      type: 'OnOff',
      section: 'settings',
      bindable: true,
      defaultValue: false,
      /* wwEditor:start */
      bindingValidation: {
        type: 'boolean',
        tooltip: 'Toggle the reference grid in the scene',
      },
      /* wwEditor:end */
    },
  },

  triggerEvents: [
    {
      name: 'face-selected',
      label: { en: 'On Face Selected' },
      event: {
        faceIndex:   0,
        groupIndex:  0,
        meshName:    '',
        objectName:  '',
        point:       { x: 0, y: 0, z: 0 },
        normal:      { x: 0, y: 0, z: 0 },
        userData:    {},
        faceType:    '',    // 'cylindrical' | 'planar' | 'conical' | 'toroidal' | 'unknown'
        surfaceType: '',    // 'Cylinder' | 'Plane' | 'Cone' | 'Torus' | 'Unknown'
        shape:       null,  // 'circular' | 'other' | null  (planar faces only)
        diameter:    null,  // number | null
        depth:       null,  // number | null  (cylindrical faces only)
        halfAngle:   null,  // number | null  (conical faces only — degrees)
        axis:        null,  // {x,y,z} | null
        center:      null,  // {x,y,z} | null  (cylindrical faces only)
        arcDeg:      null,  // number | null  — degrees of angular coverage
        is360:       null,  // boolean | null — true only for full 360° cylindrical surfaces
        isHole:      false, // boolean — true when face is a concave cylindrical bore
        isConcave:   null,  // boolean | null — true when normals point inward
        merged:      false, // boolean — true when face was merged from split B-Rep halves
        mergedCount: null,  // number | null — how many raw faces were merged
        meshNames:   null,  // string[] | null — all mesh names for merged faces
      },
      default: true,
    },
    {
      name: 'faces-selected',
      label: { en: 'On Selection Changed' },
      event: {
        selections: [],   // each item includes all face-selected fields above
        count: 0,
      },
    },
    {
      name: 'annotation-clicked',
      label: { en: 'On Annotation Clicked' },
      event: {
        annotation: {},
        point:  { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 0 },
      },
    },
    {
      name: 'holes-detected',
      label: { en: 'On Holes Detected' },
      event: {
        cylinders:  [],  // all cylindrical faces — each has meshName, objectName, diameter, depth, axis, center, isHole
        holeCount:  0,   // concave cylinders (bores, holes)
        bossCount:  0,   // convex cylinders (pins, bosses)
      },
    },
    {
      name: 'model-loaded',
      label: { en: 'On Model Loaded' },
      event: {
        meshCount:   0,
        vertexCount: 0,
        surfaceArea: 0,    // total surface area in model units²
        volume:      0,    // total volume in model units³ (requires closed solid)
        boundingBox: { min: {}, max: {}, width: 0, height: 0, depth: 0 },
        // faces list available via the 'faces' internal variable (may be large — not inlined here)
      },
    },
  ],
}
