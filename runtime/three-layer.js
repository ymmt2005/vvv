// @ts-check
// three.js layer: one shared WebGL renderer, and per-scene 3D layers that a
// scene draws into its 2D canvas wherever it wants them in its layer order.

import * as THREE from 'three';

export function makeRenderer(width, height) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  return renderer;
}

/**
 * @param {THREE.WebGLRenderer} renderer
 * @param {number} width @param {number} height
 * @param {{ fov?: number, clearColor?: number, clearAlpha?: number }} opts
 */
export function createThreeLayer(renderer, width, height, opts = {}) {
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(opts.fov ?? 45, width / height, 0.1, 1000);
  camera.position.set(0, 0, 10);
  return {
    THREE,
    scene,
    camera,
    renderer,
    /**
     * Where a 3D point lands on the 2D canvas, for drawing crisp 2D labels next to 3D objects.
     * @param {THREE.Vector3 | THREE.Object3D} p
     * @returns {{ x: number, y: number, behind: boolean }}
     */
    toScreen(p) {
      const v = p instanceof THREE.Object3D ? p.getWorldPosition(new THREE.Vector3()) : p.clone();
      camera.updateMatrixWorld();
      v.project(camera);
      return { x: ((v.x + 1) / 2) * width, y: ((1 - v.y) / 2) * height, behind: v.z > 1 };
    },
    /** Render the 3D scene and draw it onto g. Call it from draw(), after updating objects for time t. */
    render(g) {
      renderer.setClearColor(opts.clearColor ?? 0x000000, opts.clearAlpha ?? 0);
      renderer.render(scene, camera);
      g.drawImage(renderer.domElement, 0, 0, width, height);
    },
  };
}
