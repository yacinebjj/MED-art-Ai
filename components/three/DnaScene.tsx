"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";

// World-space span (in scene units) the model should occupy along its
// longest axis once centered — independent of the source file's own scale
// and pivot, which turned out to be an arbitrary, off-origin bounding box.
const TARGET_SPAN = 7.5;
// Resting tilt so the helix reads as posed rather than flat-on; pointer
// movement offsets from this base instead of replacing it.
const BASE_TILT_X = 0.15;
const BASE_TILT_Z = 0.3;

/**
 * PERFORMANCE (the "app freezes, especially on phones" report). This scene
 * used to render 60 times a second, forever, as a full-screen TRANSPARENT
 * canvas (antialias on, up to 1.5x pixel ratio) behind the landing, the auth
 * pages AND every dashboard page — the GPU never idled and the compositor
 * blended a full-screen layer every frame, on top of a ~600 KB three.js
 * bundle and an 812 KB model downloaded on first paint. Now:
 *  - phones / touch-first, low-end devices (≤4 cores or ≤4 GB), data-saver
 *    and prefers-reduced-motion get NO WebGL at all — a static CSS glow;
 *  - elsewhere the scene starts only once the browser is idle (never
 *    competes with first paint / hydration), renders on demand at
 *    TARGET_FPS (it's a slow ambient rotation — 30 fps is indistinguishable),
 *    at pixel ratio 1, without antialiasing, on the low-power GPU;
 *  - and it stops entirely while the tab is hidden.
 */
const TARGET_FPS = 30;

/** Drives frameloop="demand" at TARGET_FPS, and not at all while the tab is hidden. */
function FrameTicker() {
  const invalidate = useThree((state) => state.invalidate);
  useEffect(() => {
    let timer: number | undefined;
    const start = () => {
      window.clearInterval(timer);
      if (document.visibilityState === "visible") timer = window.setInterval(() => invalidate(), 1000 / TARGET_FPS);
    };
    start();
    document.addEventListener("visibilitychange", start);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", start);
    };
  }, [invalidate]);
  return null;
}

function DnaModel() {
  const group = useRef<THREE.Group>(null);
  const { scene } = useGLTF("/dna.glb");
  // Normalized window-space pointer (not R3F's canvas-scoped pointer) — the
  // canvas has pointer-events disabled so hero text/buttons stay clickable,
  // so canvas-relative pointer events never reach it.
  const pointer = useRef({ x: 0, y: 0 });

  // useGLTF caches and returns the SAME scene object across every mount
  // (remounts from route changes, Fast Refresh, StrictMode). Cloning here
  // means each mount centers/scales its own independent copy instead of
  // computing a bounding box against a copy an earlier mount already
  // shifted — mutating the shared singleton's transform in place would
  // compound a fresh offset onto the previous one on every remount.
  const { model, center, scale } = useMemo(() => {
    const cloned = scene.clone(true);
    const box = new THREE.Box3().setFromObject(cloned);
    const size = new THREE.Vector3();
    box.getSize(size);
    const boxCenter = new THREE.Vector3();
    box.getCenter(boxCenter);
    const maxDim = Math.max(size.x, size.y, size.z) || 1;
    return { model: cloned, center: boxCenter, scale: TARGET_SPAN / maxDim };
  }, [scene]);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      pointer.current.x = (event.clientX / window.innerWidth) * 2 - 1;
      pointer.current.y = (event.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener("pointermove", handlePointerMove);
    return () => window.removeEventListener("pointermove", handlePointerMove);
  }, []);

  useFrame((_, delta) => {
    const node = group.current;
    if (!node) return;
    node.rotation.y += delta * 0.15;
    const targetTiltX = BASE_TILT_X + pointer.current.y * 0.2;
    const targetTiltZ = BASE_TILT_Z - pointer.current.x * 0.15;
    node.rotation.x = THREE.MathUtils.lerp(node.rotation.x, targetTiltX, 0.04);
    node.rotation.z = THREE.MathUtils.lerp(node.rotation.z, targetTiltZ, 0.04);
  });

  return (
    <group ref={group}>
      <group scale={scale}>
        <primitive object={model} position={[-center.x, -center.y, -center.z]} />
      </group>
    </group>
  );
}

/** The heavy part (three.js + model), loaded only when DnaBackground decides WebGL is worth it. */
export default function DnaScene() {
  return (
    <Canvas
      camera={{ position: [0, 0, 7], fov: 42 }}
      dpr={1}
      frameloop="demand"
      gl={{ alpha: true, antialias: false, powerPreference: "low-power" }}
    >
      <FrameTicker />
      <ambientLight intensity={0.7} />
      <directionalLight position={[3, 4, 5]} intensity={1.4} />
      <directionalLight position={[-4, -2, -3]} intensity={0.5} color="#5eead4" />
      <Suspense fallback={null}>
        <DnaModel />
      </Suspense>
    </Canvas>
  );
}
