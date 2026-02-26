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
        tooltip: 'Highlight color applied to the selected mesh/face',
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
        faceIndex: 0,
        groupIndex: 0,
        meshName: '',
        objectName: '',
        point: { x: 0, y: 0, z: 0 },
        normal: { x: 0, y: 0, z: 0 },
        userData: {},
      },
      default: true,
    },
    {
      name: 'model-loaded',
      label: { en: 'On Model Loaded' },
      event: {
        meshCount: 0,
        vertexCount: 0,
        boundingBox: {},
      },
    },
  ],
}
