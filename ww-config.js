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
        faceIndex:  0,
        groupIndex: 0,
        meshName:   '',
        objectName: '',
        point:  { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 0 },
        userData: {},
        faceType: '',     // 'cylindrical' | 'planar' | 'unknown'
        shape:    null,   // 'circular' | 'other' | null  (planar faces only)
        diameter: null,   // number | null  (model units)
        depth:    null,   // number | null  (cylindrical faces only)
        axis:     null,   // {x,y,z} | null  (cylinder axis or face normal)
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
      name: 'model-loaded',
      label: { en: 'On Model Loaded' },
      event: {
        meshCount:   0,
        vertexCount: 0,
        boundingBox: {},
      },
    },
  ],
}
