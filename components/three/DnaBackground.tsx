"use client";

import { Suspense, useEffect, useMemo, useRef } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { useGLTF } from "@react-three/drei";
import * as THREE from "three";
import { cn } from "@/lib/utils";

// World-space span (in scene units) the model should occupy along its
// longest axis once centered — independent of the source file's own scale
// and pivot, which turned out to be an arbitrary, off-origin bounding box.
const TARGET_SPAN = 7.5;
// Resting tilt so the helix reads as posed rather than flat-on; pointer
// movement offsets from this base instead of replacing it.
const BASE_TILT_X = 0.15;
const BASE_TILT_Z = 0.3;

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

useGLTF.preload("/dna.glb");

export function DnaBackground({ opacityClassName }: { opacityClassName?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        // z-0, NOT a negative z-index: a negative z-index escapes to
        // whichever ancestor stacking context it belongs to and paints
        // BEFORE that context's own normal-flow content — and since none of
        // this component's host layouts give their root element its own
        // stacking context, that root turns out to be the document itself,
        // whose <body> has an opaque background painted in the normal flow
        // phase. A negative z-index here paints behind that opaque
        // background site-wide, i.e. is completely invisible. z-0 keeps
        // this in the normal painting phase instead, where DOM order alone
        // (this component is always mounted before the real page content)
        // already guarantees it stays behind everything that matters.
        "pointer-events-none fixed inset-0 z-0 h-screen w-screen",
        opacityClassName ?? "opacity-40 dark:opacity-25",
      )}
    >
      <Canvas
        camera={{ position: [0, 0, 7], fov: 42 }}
        dpr={[1, 1.5]}
        gl={{ alpha: true, antialias: true }}
      >
        <ambientLight intensity={0.7} />
        <directionalLight position={[3, 4, 5]} intensity={1.4} />
        <directionalLight position={[-4, -2, -3]} intensity={0.5} color="#5eead4" />
        <Suspense fallback={null}>
          <DnaModel />
        </Suspense>
      </Canvas>
    </div>
  );
}
