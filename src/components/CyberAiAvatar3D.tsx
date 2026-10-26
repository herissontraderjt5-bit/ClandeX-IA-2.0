import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

export interface CyberAiAvatar3DProps {
  status: 'idle' | 'connecting' | 'listening' | 'speaking' | 'interrupted' | 'error';
  speechLevel: number; // 0 to 100 (live audio level when AI is speaking)
  micLevel?: number;   // 0 to 100 (user mic level)
  className?: string;
  isAnalyzing?: boolean;
}

/**
 * CyberAiAvatar3D: Three.js 3D Futuristic Cybernetic Avatar with Articulated Jaw (Lip-Sync)
 * - Three.js WebGL Scene, Camera, and Cyberpunk Lighting
 * - Sleek Metallic Cranium & Android Facial Armor Plates
 * - Articulated Mandible (Jaw Pivot Group) dynamically driven by audio RMS speech level & syllable frequency
 * - Vocal Cavity PointLight synchronized with vocal intensity
 * - High-tech Holographic Orbital Rings responding to soundwaves
 * - Dynamic Status Colors: Cyan (Speaking/Idle), Emerald (Listening), Rose (Interrupted/Error)
 */
export const CyberAiAvatar3D: React.FC<CyberAiAvatar3DProps> = ({
  status,
  speechLevel,
  micLevel = 0,
  className = '',
  isAnalyzing = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);

  const speechRef = useRef(speechLevel);
  speechRef.current = speechLevel;

  const micRef = useRef(micLevel);
  micRef.current = micLevel;

  const statusRef = useRef(status);
  statusRef.current = status;

  const analyzingRef = useRef(isAnalyzing);
  analyzingRef.current = isAnalyzing;

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // 1. Scene, Camera & WebGL Renderer
    const scene = new THREE.Scene();
    const width = container.clientWidth || 340;
    const height = container.clientHeight || 280;

    const camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
    camera.position.set(0, 0.1, 4.3);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    container.appendChild(renderer.domElement);

    // 2. Cyberpunk Lighting Setup
    // Key Light (Cyan)
    const keyLight = new THREE.DirectionalLight(0x06b6d4, 3.5);
    keyLight.position.set(2.5, 3.0, 3.0);
    scene.add(keyLight);

    // Rim / Backlight (Cyber Magenta)
    const rimLight = new THREE.DirectionalLight(0xd946ef, 2.8);
    rimLight.position.set(-2.5, 2.0, -2.5);
    scene.add(rimLight);

    // Ambient / Fill Light
    const fillLight = new THREE.DirectionalLight(0x3b82f6, 1.2);
    fillLight.position.set(-2.0, -1.5, 2.5);
    scene.add(fillLight);

    // Vocal Cavity Mouth Glow Light (reacts to Lip-Sync)
    const mouthGlowLight = new THREE.PointLight(0x06b6d4, 0, 3.5);
    mouthGlowLight.position.set(0, -0.4, 0.65);
    scene.add(mouthGlowLight);

    // Optic Sensor Light
    const opticLight = new THREE.PointLight(0x06b6d4, 1.2, 2.5);
    opticLight.position.set(0, 0.12, 1.1);
    scene.add(opticLight);

    // 3. Materials
    const skullMat = new THREE.MeshStandardMaterial({
      color: 0x090e1a,
      metalness: 0.92,
      roughness: 0.18,
    });

    const platingMat = new THREE.MeshStandardMaterial({
      color: 0x111c30,
      metalness: 0.85,
      roughness: 0.28,
    });

    const earPlateMat = new THREE.MeshStandardMaterial({
      color: 0x172545,
      metalness: 0.95,
      roughness: 0.12,
    });

    const visorMat = new THREE.MeshStandardMaterial({
      color: 0x06b6d4,
      emissive: 0x06b6d4,
      emissiveIntensity: 0.85,
      roughness: 0.1,
      metalness: 0.6,
    });

    const haloRingMat = new THREE.MeshBasicMaterial({
      color: 0x06b6d4,
      wireframe: true,
      transparent: true,
      opacity: 0.35,
    });

    const innerRingMat = new THREE.MeshBasicMaterial({
      color: 0x22d3ee,
      wireframe: true,
      transparent: true,
      opacity: 0.2,
    });

    // 4. Head Group (Floating Master Group)
    const headGroup = new THREE.Group();
    scene.add(headGroup);

    // Cranium / Upper Head
    const craniumGeo = new THREE.SphereGeometry(1.0, 36, 32);
    const cranium = new THREE.Mesh(craniumGeo, skullMat);
    cranium.scale.set(0.92, 1.05, 0.95);
    headGroup.add(cranium);

    // Forehead Armor Plate
    const foreheadGeo = new THREE.BoxGeometry(0.85, 0.42, 0.3);
    const foreheadPlate = new THREE.Mesh(foreheadGeo, platingMat);
    foreheadPlate.position.set(0, 0.52, 0.78);
    foreheadPlate.rotation.x = -0.22;
    headGroup.add(foreheadPlate);

    // Cyber Visor / Optic Sensor Strip
    const visorGeo = new THREE.BoxGeometry(0.78, 0.13, 0.32);
    const visor = new THREE.Mesh(visorGeo, visorMat);
    visor.position.set(0, 0.12, 0.9);
    headGroup.add(visor);

    // Left & Right Cheek Armor Plates
    const cheekGeo = new THREE.BoxGeometry(0.28, 0.45, 0.4);
    const leftCheek = new THREE.Mesh(cheekGeo, platingMat);
    leftCheek.position.set(-0.62, -0.15, 0.68);
    leftCheek.rotation.y = 0.25;
    headGroup.add(leftCheek);

    const rightCheek = new THREE.Mesh(cheekGeo, platingMat);
    rightCheek.position.set(0.62, -0.15, 0.68);
    rightCheek.rotation.y = -0.25;
    headGroup.add(rightCheek);

    // Cyber Ear / Neural Audio Receivers
    const earGeo = new THREE.CylinderGeometry(0.22, 0.22, 0.18, 24);
    const leftEar = new THREE.Mesh(earGeo, earPlateMat);
    leftEar.position.set(-0.95, 0.05, 0);
    leftEar.rotation.z = Math.PI / 2;
    headGroup.add(leftEar);

    const rightEar = new THREE.Mesh(earGeo, earPlateMat);
    rightEar.position.set(0.95, 0.05, 0);
    rightEar.rotation.z = Math.PI / 2;
    headGroup.add(rightEar);

    // 5. Articulated Jaw Rig (Mouth Pivot for Lip-Sync)
    const jawPivotGroup = new THREE.Group();
    jawPivotGroup.position.set(0, -0.22, 0.3); // Rotation pivot for mouth opening
    headGroup.add(jawPivotGroup);

    // Mandible / Chin Box Mesh
    const jawGeo = new THREE.BoxGeometry(0.55, 0.38, 0.65);
    const jawMesh = new THREE.Mesh(jawGeo, skullMat);
    jawMesh.position.set(0, -0.26, 0.22);
    jawPivotGroup.add(jawMesh);

    // Chin Accent Plate
    const chinPlateGeo = new THREE.BoxGeometry(0.38, 0.22, 0.2);
    const chinPlate = new THREE.Mesh(chinPlateGeo, platingMat);
    chinPlate.position.set(0, -0.32, 0.52);
    jawPivotGroup.add(chinPlate);

    // 6. Holographic Sonic Orbit Rings
    const haloRingGeo = new THREE.TorusGeometry(1.58, 0.016, 16, 80);
    const haloRing = new THREE.Mesh(haloRingGeo, haloRingMat);
    haloRing.rotation.x = Math.PI / 3;
    scene.add(haloRing);

    const innerRingGeo = new THREE.TorusGeometry(1.85, 0.012, 16, 80);
    const innerRing = new THREE.Mesh(innerRingGeo, innerRingMat);
    innerRing.rotation.x = -Math.PI / 4;
    innerRing.rotation.y = Math.PI / 6;
    scene.add(innerRing);

    // 7. Dynamic Color Mapping based on Live Status
    const updateColors = (currentStatus: string) => {
      let mainHex = 0x06b6d4; // Cyan (Speaking/Idle)
      let lightHex = 0x06b6d4;

      if (currentStatus === 'listening') {
        mainHex = 0x10b981; // Emerald Green
        lightHex = 0x34d399;
      } else if (currentStatus === 'interrupted' || currentStatus === 'error') {
        mainHex = 0xf43f5e; // Rose / Red
        lightHex = 0xfb7185;
      } else if (currentStatus === 'connecting') {
        mainHex = 0x38bdf8; // Sky Blue
        lightHex = 0x7dd3fc;
      }

      visorMat.color.setHex(mainHex);
      visorMat.emissive.setHex(mainHex);
      mouthGlowLight.color.setHex(lightHex);
      opticLight.color.setHex(lightHex);
      haloRingMat.color.setHex(mainHex);
      keyLight.color.setHex(lightHex);
    };

    // 8. Animation Loop with Lip-Sync
    let animationFrameId: number;
    let currentMouthOpen = 0;
    let targetMouthOpen = 0;

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      const time = performance.now() * 0.001;
      const curStatus = statusRef.current;
      const curSpeech = speechRef.current;
      const curMic = micRef.current;
      const curAnalyzing = analyzingRef.current;

      updateColors(curStatus);

      const isSpeaking = curStatus === 'speaking' || curSpeech > 4;
      const isListening = curStatus === 'listening';

      // Lip-Sync Calculation: Volume RMS + Syllabic Pulse
      if (isSpeaking) {
        // Normalize speechLevel (0 - 100) to (0.0 - 1.0)
        const normalized = Math.min(1.0, Math.max(0, curSpeech / 60));
        // High-frequency syllable oscillations simulating spoken vowels and consonants
        const syllablePulse = Math.sin(time * 24) * 0.35 + Math.cos(time * 14) * 0.15;
        targetMouthOpen = Math.max(0.06, normalized * (0.75 + syllablePulse * 0.25));

        // Smooth Lerp
        currentMouthOpen += (targetMouthOpen - currentMouthOpen) * 0.32;
        mouthGlowLight.intensity = 1.0 + normalized * 4.2;
        visorMat.emissiveIntensity = 0.9 + normalized * 1.6;
        opticLight.intensity = 1.4 + normalized * 2.0;
      } else {
        targetMouthOpen = 0;
        currentMouthOpen += (0 - currentMouthOpen) * 0.2;
        mouthGlowLight.intensity = 0.05;

        if (isListening) {
          const micNorm = Math.min(1.0, curMic / 60);
          visorMat.emissiveIntensity = 1.0 + micNorm * 1.2;
          opticLight.intensity = 1.2 + Math.sin(time * 6) * 0.4;
        } else {
          visorMat.emissiveIntensity = 0.75 + Math.sin(time * 2) * 0.2;
          opticLight.intensity = 1.0;
        }
      }

      // Articulate Mandible (Jaw Rotation & Vertical Displacement)
      jawPivotGroup.rotation.x = currentMouthOpen * 0.45;
      jawPivotGroup.position.y = -0.22 - currentMouthOpen * 0.08;

      // Natural Breathing & Subtle Floating Physics
      const swaySpeed = curAnalyzing ? 3.0 : 1.8;
      headGroup.position.y = Math.sin(time * swaySpeed) * 0.045;
      headGroup.rotation.y = Math.sin(time * 0.9) * 0.06;
      headGroup.rotation.x = Math.sin(time * 1.2) * 0.03;

      // Rotate Holographic Rings
      haloRing.rotation.z = time * 0.25;
      innerRing.rotation.z = -time * 0.18;
      haloRing.scale.setScalar(1.0 + Math.sin(time * 2.5) * 0.02 + (curSpeech / 100) * 0.08);

      renderer.render(scene, camera);
    };

    animate();

    // 9. Resize Handling via ResizeObserver
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth || 340;
      const h = container.clientHeight || 280;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(handleResize);
    resizeObserver.observe(container);

    // 10. Clean Cleanup on Unmount
    return () => {
      cancelAnimationFrame(animationFrameId);
      resizeObserver.disconnect();

      // Dispose Geometries
      craniumGeo.dispose();
      foreheadGeo.dispose();
      visorGeo.dispose();
      cheekGeo.dispose();
      earGeo.dispose();
      jawGeo.dispose();
      chinPlateGeo.dispose();
      haloRingGeo.dispose();
      innerRingGeo.dispose();

      // Dispose Materials
      skullMat.dispose();
      platingMat.dispose();
      earPlateMat.dispose();
      visorMat.dispose();
      haloRingMat.dispose();
      innerRingMat.dispose();

      // Dispose Renderer
      renderer.dispose();
      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={containerRef}
      className={`relative w-full h-full min-h-[220px] flex items-center justify-center overflow-hidden select-none ${className}`}
    />
  );
};
