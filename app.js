import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@3.4.4';

const TG = globalThis.Telegram?.WebApp;
TG?.ready();
TG?.expand();

const DEVICE_MEMORY = navigator.deviceMemory || 1;
const LOW_PERFORMANCE = DEVICE_MEMORY <= 2;

const CONFIG = Object.freeze({
  MODEL_URL: 'https://edsandbox.bluemarble.in/three.js-master/examples/models/vrm/Alicia/AliciaSolid.vrm',
  CAMERA: { fov: 35, near: 0.1, far: 100, position: [0, 1.45, 1.9] },
  PIXEL_RATIO: LOW_PERFORMANCE ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  BREATH: { speed: LOW_PERFORMANCE ? 0.25 : 0.6, amp: LOW_PERFORMANCE ? 0.008 : 0.015 },
  BLINK_INTERVAL: { min: LOW_PERFORMANCE ? 8 : 3, max: LOW_PERFORMANCE ? 15 : 7 },
  EMOTION_LERP: LOW_PERFORMANCE ? 1.5 : 3,
  MAX_FPS: LOW_PERFORMANCE ? 25 : 60,
  MESH_VERTEX_THRESHOLD: LOW_PERFORMANCE ? 12000 : 20000
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);

class EmotionController {
  valence = 0;
  arousal = 0;
  targetValence = 0;
  targetArousal = 0;

  setTarget(valence, arousal) {
    this.targetValence = clamp(valence, -1, 1);
    this.targetArousal = clamp(arousal, 0, 1);
  }

  update(dt) {
    this.valence = lerp(this.valence, this.targetValence, dt * CONFIG.EMOTION_LERP);
    this.arousal = lerp(this.arousal, this.targetArousal, dt * CONFIG.EMOTION_LERP);
  }
}

class Renderer3D {
  constructor() {
    this.scene = new THREE.Scene();

    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.fov,
      window.innerWidth / window.innerHeight,
      CONFIG.CAMERA.near,
      CONFIG.CAMERA.far
    );
    this.camera.position.set(...CONFIG.CAMERA.position);

    this.renderer = new THREE.WebGLRenderer({
      antialias: !LOW_PERFORMANCE,
      alpha: true,
      powerPreference: 'high-performance'
    });

    this.renderer.setPixelRatio(CONFIG.PIXEL_RATIO);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.shadowMap.enabled = false;
    this.renderer.toneMapping = THREE.NoToneMapping;

    Object.assign(this.renderer.domElement.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      touchAction: 'none'
    });

    Object.assign(document.body.style, {
      margin: '0',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor: '#000'
    });

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));

    const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
    dirLight.position.set(1, 2, 1.5);
    this.scene.add(dirLight);

    document.body.appendChild(this.renderer.domElement);

    window.addEventListener('resize', () => this.resize(), { passive: true });
  }

  resize() {
    this.camera.aspect = window.innerWidth / window.innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    if (TG) TG.expand();
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

class VRMAvatar {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.blinkTimer = 0;
    this.nextBlink = rand(CONFIG.BLINK_INTERVAL.min, CONFIG.BLINK_INTERVAL.max);
    this.breathOffset = Math.random() * Math.PI * 2;
  }

  async load(url) {
    try {
      const loader = new GLTFLoader();
      loader.register(p => new VRMLoaderPlugin(p));
      const gltf = await loader.loadAsync(url);

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);

      if (LOW_PERFORMANCE) {
        gltf.scene.traverse(obj => {
          if (obj.isMesh && obj.geometry && obj.geometry.attributes.position.count > CONFIG.MESH_VERTEX_THRESHOLD)
            obj.visible = false;
        });
      }

      this.vrm = gltf.userData.vrm;
      this.vrm.scene.scale.setScalar(LOW_PERFORMANCE ? 1.1 : 1.6);
      this.vrm.scene.position.set(0, -1.1, 0);
      this.scene.add(this.vrm.scene);
    } catch (e) {
      console.error('VRM load error:', e);
      TG?.showAlert('Не удалось загрузить аватар');
    }
  }

  setExpression(name, value) {
    if (!this.vrm?.blendShapeProxy) return;
    this.vrm.blendShapeProxy.setValue(name, value);
  }

  update(dt, emotion) {
    if (!this.vrm) return;

    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest');
    if (chest)
      chest.position.y =
        Math.sin(Date.now() * 0.001 * CONFIG.BREATH.speed + this.breathOffset) *
        CONFIG.BREATH.amp *
        (1 + emotion.arousal);

    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      const lerpFactor = LOW_PERFORMANCE ? 1.2 : 2.5;
      head.rotation.y = lerp(head.rotation.y, 0, dt * lerpFactor);
      head.rotation.x = lerp(head.rotation.x, 0, dt * lerpFactor);
    }

    this.blinkTimer += dt;
    if (this.blinkTimer > this.nextBlink) {
      this.setExpression('blink', 1);
      setTimeout(() => this.setExpression('blink', 0), LOW_PERFORMANCE ? 80 : 120);
      this.blinkTimer = 0;
      this.nextBlink = rand(CONFIG.BLINK_INTERVAL.min, CONFIG.BLINK_INTERVAL.max);
    }

    this.setExpression('joy', clamp(emotion.valence, 0, 1));
    this.setExpression('sorrow', clamp(-emotion.valence, 0, 1));
  }
}

class ParadiseAI {
  constructor() {
    this.renderer = new Renderer3D();
    this.avatar = new VRMAvatar(this.renderer.scene);
    this.emotion = new EmotionController();
    this.clock = new THREE.Clock();
    this.lastFrameTime = 0;
    this.adaptiveTimer = 0;
    this.fpsFactor = 1;

    this.startX = null;
    this.startY = null;

    this.initTouchControls();
  }

  initTouchControls() {
    document.addEventListener('touchstart', e => {
      this.startX = e.touches[0].clientX;
      this.startY = e.touches[0].clientY;
    });

    document.addEventListener('touchend', e => {
      const endX = e.changedTouches[0].clientX;
      const endY = e.changedTouches[0].clientY;

      const dx = endX - this.startX;
      const dy = endY - this.startY;
      const absX = Math.abs(dx);
      const absY = Math.abs(dy);

      if (absX < 20 && absY < 20) {
        this.emotion.setTarget(0, 0);
        return;
      }

      if (absY > absX) {
        if (dy < 0) this.emotion.setTarget(1, 0.7);
        else this.emotion.setTarget(-1, 0.6);
      } else {
        if (dx > 0) this.emotion.setTarget(0.5, 0.5);
        else this.emotion.setTarget(-0.5, 0.5);
      }
    });
  }

  async start() {
    await this.avatar.load(CONFIG.MODEL_URL);
    this.loop();
  }

  loop() {
    requestAnimationFrame(() => this.loop());

    const now = performance.now();
    let dt = (now - this.lastFrameTime) / 1000;
    if (dt < 1 / CONFIG.MAX_FPS) return;
    this.lastFrameTime = now;

    this.adaptiveTimer += dt;
    if (this.adaptiveTimer > 2) {
      const fps = 1 / dt;
      this.fpsFactor = LOW_PERFORMANCE && fps < 20 ? 0.6 : 1;
      this.adaptiveTimer = 0;
    }

    this.emotion.update(dt * this.fpsFactor);
    this.avatar.update(dt * this.fpsFactor, this.emotion);
    this.renderer.render();
  }
}

new ParadiseAI().start();