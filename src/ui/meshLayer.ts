// Only the layer for plain meshes: the package's entry also pulls in the glTF layer with its loaders, which the
// app doesn't use and which would otherwise show up in the license list.
export { default as SimpleMeshLayer } from '../../node_modules/@deck.gl/mesh-layers/dist/simple-mesh-layer/simple-mesh-layer.js';
