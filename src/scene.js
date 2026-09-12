import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
export function initScene(container) {
  const coarse = window.matchMedia('(pointer: coarse)').matches;
  const renderer = new THREE.WebGLRenderer({ antialias: !coarse, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, coarse ? 1.5 : 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = coarse ? THREE.PCFShadowMap : THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xd8e2df);
  scene.fog = new THREE.Fog(0xd8e2df, 160, 420);

  const camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 0.5, 800);
  camera.position.set(0, 72, 138);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.target.set(0, 7, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = 1.42;
  controls.minDistance = 14;
  controls.maxDistance = 300;
  controls.autoRotate = true;
  controls.autoRotateSpeed = 0.5;

  // แสง
  const hemi = new THREE.HemisphereLight(0xeaf2ff, 0x77704f, 0.95);
  scene.add(hemi);

  const sun = new THREE.DirectionalLight(0xfff2dc, 1.5);
  sun.position.set(70, 110, 45);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  sun.shadow.camera.left = -130;
  sun.shadow.camera.right = 130;
  sun.shadow.camera.top = 130;
  sun.shadow.camera.bottom = -130;
  sun.shadow.camera.far = 400;
  sun.shadow.bias = -0.0006;
  scene.add(sun);

  // พื้น
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(900, 900),
    new THREE.MeshLambertMaterial({ color: 0x8ea065, flatShading: true })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground);

  // ภูเขารอบไกล ๆ (ฉากหลังแบบจีน)
  const mtnMat = new THREE.MeshLambertMaterial({ color: 0x93a68b, flatShading: true });
  const mtnMat2 = new THREE.MeshLambertMaterial({ color: 0xa7b79b, flatShading: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 + 0.35;
    const r = 260 + ((i * 53) % 90);
    const h = 55 + ((i * 97) % 70);
    const m = new THREE.Mesh(new THREE.ConeGeometry(h * (0.9 + (i % 3) * 0.25), h, 5), i % 2 ? mtnMat : mtnMat2);
    m.position.set(Math.cos(a) * r, h / 2 - 4, Math.sin(a) * r);
    m.rotation.y = i * 1.3;
    scene.add(m);
  }

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  return { renderer, scene, camera, controls, ground };
}

// เลื่อนกล้องไปยังจุดหมายแบบนุ่ม ๆ (main.js ตั้ง camera.__focusTween เอง)
export function updateCameraTween(camera, controls, dt) {
  if (camera.__focusTween) {
    const tw = camera.__focusTween;
    tw.t += dt / 0.9;
    const k = Math.min(1, tw.t);
    const e = k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2;
    camera.position.lerpVectors(tw.fromPos, tw.toPos, e);
    controls.target.lerpVectors(tw.fromTarget, tw.toTarget, e);
    if (k >= 1) camera.__focusTween = null;
  }
  controls.update();
}
