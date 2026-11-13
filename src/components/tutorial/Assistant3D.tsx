/**
 * 3D Business Professional Learning Assistant (Ingobia 3D Guide)
 * Built with Three.js according to Section 3.1:
 * - Professional male business consultant in an elegant dark tailored suit.
 * - Smooth, blank, featureless face (no eyes, nose, mouth, or cartoon expressions).
 * - Realistic proportions, friendly welcoming posture, contact shadow grounding,
 *   warm/cool studio lighting rig, and gentle procedural idle breathing/gesturing.
 */

import React, { useEffect, useRef } from 'react';
import * as THREE from 'three';

interface Assistant3DProps {
  className?: string;
  isSpeaking?: boolean;
  width?: number;
  height?: number;
}

export const Assistant3D: React.FC<Assistant3DProps> = ({
  className = '',
  isSpeaking = false,
  width,
  height,
}) => {
  const mountRef = useRef<HTMLDivElement>(null);
  const isSpeakingRef = useRef(isSpeaking);
  isSpeakingRef.current = isSpeaking;

  useEffect(() => {
    const container = mountRef.current;
    if (!container) return;

    // Detect software WebGL to adapt performance gracefully
    const isSoftwareGl = (() => {
      try {
        const gl = document.createElement('canvas').getContext('webgl2');
        if (!gl) return true;
        const ext = gl.getExtension('WEBGL_debug_renderer_info');
        const param = ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER;
        const gpu = String(gl.getParameter(param));
        gl.getExtension('WEBGL_lose_context')?.loseContext();
        return /SwiftShader|llvmpipe|softpipe|Software|Basic Render/i.test(gpu);
      } catch {
        return false;
      }
    })();

    const width = container.clientWidth || 220;
    const height = container.clientHeight || 280;

    // Scene & Camera
    const scene = new THREE.Scene();

    const camera = new THREE.PerspectiveCamera(36, width / height, 0.1, 50);
    camera.position.set(0, 1.45, 3.2);
    camera.lookAt(0, 1.25, 0);

    // Renderer
    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: !isSoftwareGl,
      powerPreference: 'high-performance',
    });
    renderer.setSize(width, height);
    renderer.setPixelRatio(isSoftwareGl ? 1 : Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = !isSoftwareGl;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    container.appendChild(renderer.domElement);

    // Studio Lighting Rig
    const ambientLight = new THREE.HemisphereLight(0xffffff, 0x1e293b, 0.7);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xfff7ed, 1.8);
    keyLight.position.set(2, 4, 3);
    keyLight.castShadow = !isSoftwareGl;
    if (keyLight.shadow) {
      keyLight.shadow.mapSize.width = 512;
      keyLight.shadow.mapSize.height = 512;
      keyLight.shadow.bias = -0.0005;
    }
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x93c5fd, 1.2);
    rimLight.position.set(-2.5, 3, -2);
    scene.add(rimLight);

    // Materials Palette (Tailored navy suit, crisp white shirt, Ingobia blue silk tie, sleek featureless head)
    const suitMaterial = new THREE.MeshStandardMaterial({
      color: 0x1e293b, // Dark navy/charcoal
      roughness: 0.6,
      metalness: 0.1,
    });

    const shirtMaterial = new THREE.MeshStandardMaterial({
      color: 0xffffff,
      roughness: 0.3,
      metalness: 0.05,
    });

    const tieMaterial = new THREE.MeshStandardMaterial({
      color: 0x2563eb, // Ingobia Royal Blue
      roughness: 0.35,
      metalness: 0.25,
    });

    // Smooth, blank, featureless face (no eyes, mouth, nose - sleek matte aesthetic)
    const mannequinMaterial = new THREE.MeshStandardMaterial({
      color: 0xe2e8f0, // Sleek platinum / light marble
      roughness: 0.25,
      metalness: 0.08,
    });

    const shoesMaterial = new THREE.MeshStandardMaterial({
      color: 0x0f172a,
      roughness: 0.2,
      metalness: 0.3,
    });

    // Build Composite 3D Character Group
    const characterGroup = new THREE.Group();

    // 1. Head (Featureless, smooth architectural oval)
    const headGeo = new THREE.SphereGeometry(0.19, 32, 28);
    headGeo.scale(0.85, 1.1, 0.9);
    const headMesh = new THREE.Mesh(headGeo, mannequinMaterial);
    headMesh.position.set(0, 1.76, 0);
    headMesh.castShadow = !isSoftwareGl;
    characterGroup.add(headMesh);

    // 2. Neck
    const neckGeo = new THREE.CylinderGeometry(0.08, 0.09, 0.12, 20);
    const neckMesh = new THREE.Mesh(neckGeo, mannequinMaterial);
    neckMesh.position.set(0, 1.58, 0);
    characterGroup.add(neckMesh);

    // 3. Shirt Collar & Chest V
    const collarGeo = new THREE.CylinderGeometry(0.1, 0.13, 0.08, 16);
    const collarMesh = new THREE.Mesh(collarGeo, shirtMaterial);
    collarMesh.position.set(0, 1.54, 0);
    characterGroup.add(collarMesh);

    // 4. Silk Tie
    const tieShape = new THREE.Shape();
    tieShape.moveTo(-0.035, 0);
    tieShape.lineTo(0.035, 0);
    tieShape.lineTo(0.045, -0.22);
    tieShape.lineTo(0, -0.32);
    tieShape.lineTo(-0.045, -0.22);
    tieShape.closePath();

    const tieGeo = new THREE.ExtrudeGeometry(tieShape, {
      depth: 0.015,
      bevelEnabled: true,
      bevelSegments: 2,
      steps: 1,
      bevelSize: 0.005,
      bevelThickness: 0.005,
    });
    const tieMesh = new THREE.Mesh(tieGeo, tieMaterial);
    tieMesh.position.set(0, 1.52, 0.145);
    characterGroup.add(tieMesh);

    // 5. Torso / Suit Jacket
    const torsoGeo = new THREE.CylinderGeometry(0.24, 0.2, 0.62, 24);
    torsoGeo.scale(1.15, 1, 0.75);
    const torsoMesh = new THREE.Mesh(torsoGeo, suitMaterial);
    torsoMesh.position.set(0, 1.22, 0);
    torsoMesh.castShadow = !isSoftwareGl;
    characterGroup.add(torsoMesh);

    // Lapels (Left & Right)
    const lapelGeo = new THREE.BoxGeometry(0.08, 0.34, 0.03);
    const leftLapel = new THREE.Mesh(lapelGeo, suitMaterial);
    leftLapel.position.set(-0.09, 1.34, 0.14);
    leftLapel.rotation.z = -0.15;
    characterGroup.add(leftLapel);

    const rightLapel = new THREE.Mesh(lapelGeo, suitMaterial);
    rightLapel.position.set(0.09, 1.34, 0.14);
    rightLapel.rotation.z = 0.15;
    characterGroup.add(rightLapel);

    // 6. Right Arm (Welcoming gesture toward the UI)
    const rightArmGroup = new THREE.Group();
    rightArmGroup.position.set(0.32, 1.45, 0);

    const upperArmGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.32, 16);
    const upperArmMesh = new THREE.Mesh(upperArmGeo, suitMaterial);
    upperArmMesh.position.set(0, -0.16, 0);
    rightArmGroup.add(upperArmMesh);

    const forearmGeo = new THREE.CylinderGeometry(0.065, 0.055, 0.28, 16);
    const forearmMesh = new THREE.Mesh(forearmGeo, suitMaterial);
    forearmMesh.position.set(0.06, -0.38, 0.1);
    forearmMesh.rotation.x = 0.7;
    forearmMesh.rotation.z = -0.3;
    rightArmGroup.add(forearmMesh);

    // Right Hand (Palm open welcoming gesture)
    const handGeo = new THREE.BoxGeometry(0.07, 0.09, 0.03);
    const handMesh = new THREE.Mesh(handGeo, mannequinMaterial);
    handMesh.position.set(0.1, -0.5, 0.22);
    handMesh.rotation.x = 0.6;
    rightArmGroup.add(handMesh);

    rightArmGroup.rotation.z = -0.15;
    rightArmGroup.rotation.y = 0.2;
    characterGroup.add(rightArmGroup);

    // 7. Left Arm (Relaxed at side)
    const leftArmGroup = new THREE.Group();
    leftArmGroup.position.set(-0.32, 1.45, 0);

    const leftArmGeo = new THREE.CylinderGeometry(0.075, 0.065, 0.52, 16);
    const leftArmMesh = new THREE.Mesh(leftArmGeo, suitMaterial);
    leftArmMesh.position.set(0, -0.26, 0);
    leftArmGroup.add(leftArmMesh);

    const leftHandGeo = new THREE.BoxGeometry(0.06, 0.08, 0.03);
    const leftHandMesh = new THREE.Mesh(leftHandGeo, mannequinMaterial);
    leftHandMesh.position.set(0, -0.55, 0);
    leftArmGroup.add(leftHandMesh);

    leftArmGroup.rotation.z = 0.08;
    characterGroup.add(leftArmGroup);

    // 8. Legs / Trousers
    const legGeo = new THREE.CylinderGeometry(0.09, 0.075, 0.78, 20);
    const leftLeg = new THREE.Mesh(legGeo, suitMaterial);
    leftLeg.position.set(-0.13, 0.52, 0);
    leftLeg.castShadow = !isSoftwareGl;
    characterGroup.add(leftLeg);

    const rightLeg = new THREE.Mesh(legGeo, suitMaterial);
    rightLeg.position.set(0.13, 0.52, 0);
    rightLeg.castShadow = !isSoftwareGl;
    characterGroup.add(rightLeg);

    // 9. Shoes (Polished Oxford Shoes)
    const shoeGeo = new THREE.BoxGeometry(0.1, 0.08, 0.22);
    const leftShoe = new THREE.Mesh(shoeGeo, shoesMaterial);
    leftShoe.position.set(-0.13, 0.06, 0.04);
    characterGroup.add(leftShoe);

    const rightShoe = new THREE.Mesh(shoeGeo, shoesMaterial);
    rightShoe.position.set(0.13, 0.06, 0.04);
    characterGroup.add(rightShoe);

    // 10. Soft Radial Contact Grounding Shadow
    const shadowGeo = new THREE.PlaneGeometry(1.2, 1.2);
    // Procedural radial alpha texture for soft contact shadow
    const shadowCanvas = document.createElement('canvas');
    shadowCanvas.width = 128;
    shadowCanvas.height = 128;
    const sCtx = shadowCanvas.getContext('2d')!;
    const gradient = sCtx.createRadialGradient(64, 64, 4, 64, 64, 60);
    gradient.addColorStop(0, 'rgba(15, 23, 42, 0.65)');
    gradient.addColorStop(0.5, 'rgba(15, 23, 42, 0.2)');
    gradient.addColorStop(1, 'rgba(15, 23, 42, 0)');
    sCtx.fillStyle = gradient;
    sCtx.fillRect(0, 0, 128, 128);

    const shadowTex = new THREE.CanvasTexture(shadowCanvas);
    const shadowMat = new THREE.MeshBasicMaterial({
      map: shadowTex,
      transparent: true,
      depthWrite: false,
      opacity: 0.5,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.y = 0.01;
    characterGroup.add(shadowMesh);

    scene.add(characterGroup);

    // Animation Loop (Gentle breathing, slight hand gesture and polite nodding)
    let frameId = 0;
    let clock = new THREE.Clock();

    const animate = () => {
      const elapsed = clock.getElapsedTime();

      // Subtle breathing motion on torso
      torsoMesh.scale.y = 1 + Math.sin(elapsed * 2.2) * 0.015;
      torsoMesh.scale.x = 1.15 + Math.sin(elapsed * 2.2) * 0.012;

      // Polite welcoming arm gesture
      const gestureAmp = isSpeakingRef.current ? 0.12 : 0.05;
      rightArmGroup.rotation.z = -0.15 + Math.sin(elapsed * 2.5) * gestureAmp;
      rightArmGroup.rotation.x = Math.cos(elapsed * 1.8) * (gestureAmp * 0.6);

      // Subtle head movement
      headMesh.rotation.y = Math.sin(elapsed * 1.2) * 0.08;
      headMesh.rotation.x = Math.sin(elapsed * 2.2) * 0.03;

      // Gentle subtle floating/swaying
      characterGroup.position.y = Math.sin(elapsed * 1.8) * 0.015;

      renderer.render(scene, camera);
      frameId = requestAnimationFrame(animate);
    };

    frameId = requestAnimationFrame(animate);

    // Handle Resize
    const handleResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w === 0 || h === 0) return;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };

    window.addEventListener('resize', handleResize);

    // Cleanup on unmount
    return () => {
      cancelAnimationFrame(frameId);
      window.removeEventListener('resize', handleResize);
      renderer.dispose();
      headGeo.dispose();
      neckGeo.dispose();
      torsoGeo.dispose();
      collarGeo.dispose();
      tieGeo.dispose();
      shadowGeo.dispose();
      shadowTex.dispose();
      suitMaterial.dispose();
      shirtMaterial.dispose();
      tieMaterial.dispose();
      mannequinMaterial.dispose();
      shoesMaterial.dispose();
      if (renderer.domElement && renderer.domElement.parentNode) {
        renderer.domElement.parentNode.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      style={{ width, height }}
      className={`relative w-full h-full flex items-center justify-center pointer-events-none select-none ${className}`}
    />
  );
};
