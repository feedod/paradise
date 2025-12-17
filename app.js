import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@3.4.4';

const TG = globalThis.Telegram?.WebApp;
TG?.ready();

const DEVICE_MEMORY = navigator.deviceMemory || 1;
const LOW_PERFORMANCE = DEVICE_MEMORY <= 2;

const CONFIG = Object.freeze({
  MODEL_URL: './VRM1_Constraint_Twist_Sample.vrm',
  CAMERA: { fov: 35, near: 0.1, far: 100, position: [0, 1.45, 1.9] },
  PIXEL_RATIO: LOW_PERFORMANCE ? 1 : Math.min(window.devicePixelRatio || 1, 2),
  BREATH: { speed: LOW_PERFORMANCE ? 0.25 : 0.6, amp: LOW_PERFORMANCE ? 0.008 : 0.015 },
  BLINK_INTERVAL: { min: LOW_PERFORMANCE ? 8 : 3, max: LOW_PERFORMANCE ? 15 : 7 },
  EMOTION_LERP: LOW_PERFORMANCE ? 1.5 : 3,
  MAX_FPS: LOW_PERFORMANCE ? 25 : 60,
  MESH_VERTEX_THRESHOLD: LOW_PERFORMANCE ? 12000 : 20000,
  IDLE_LOOK_INTERVAL: { min: 5, max: 12 },
  IDLE_LOOK_ANGLE: { x: 0.1, y: 0.2 },
  EYE_TRACK_SPEED: LOW_PERFORMANCE ? 2 : 4,
  HEAD_TILT_FACTOR: 0.25,
  EMOTION_CHANGE_INTERVAL: { min: 3, max: 8 }
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);

class EmotionController {
  valence = 0;
  arousal = 0;
  targetValence = 0;
  targetArousal = 0;

  setTarget(v, a) {
    this.targetValence = clamp(v, -1, 1);
    this.targetArousal = clamp(a, 0, 1);
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
    this.idleLookTimer = 0;
    this.nextIdleLook = rand(CONFIG.IDLE_LOOK_INTERVAL.min, CONFIG.IDLE_LOOK_INTERVAL.max);
    this.eyeTarget = new THREE.Vector2(0, 0);
    this.headTilt = new THREE.Vector2(0, 0);
  }

  async load(url) {
    try {
      if (TG) {
        TG.MainButton.setText('Загрузка 0%');
        TG.MainButton.show();
        TG.MainButton.disable();
      }

      const cache = 'caches' in window ? await caches.open('paradiseai-vrm') : null;
      let blob;
      if (cache) {
        const cached = await cache.match(url);
        if (cached) blob = await cached.blob();
      }

      if (!blob) {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Не удалось загрузить модель');

        const reader = response.body.getReader();
        const contentLength = +response.headers.get('Content-Length');
        let received = 0,
          chunks = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          chunks.push(value);
          received += value.length;

          if (TG && contentLength) {
            let p = Math.floor((received / contentLength) * 100);
            p = clamp(p, 0, 100);
            TG.MainButton.setText(`Загрузка ${p}%`);
          }
        }

        blob = new Blob(chunks);
        if (cache) await cache.put(url, new Response(blob));
      }

      const blobUrl = URL.createObjectURL(blob);
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(blobUrl);

      if (!gltf.userData.vrm) throw new Error('VRM не найден');

      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);

      this.vrm = gltf.userData.vrm;
      this.vrm.scene.scale.setScalar(1.6);
      this.vrm.scene.position.set(0, -1.1, 0);
      this.scene.add(this.vrm.scene);

      if (TG) TG.MainButton.hide();
    } catch (e) {
      console.error('Ошибка VRM', e);
      if (TG) {
        TG.MainButton.setText('Ошибка');
        TG.MainButton.show();
        TG.MainButton.disable();
      }
      TG?.showAlert('Не удалось загрузить аватар');
      TG?.close();
    }
  }

  setExpression(name, value) {
    if (!this.vrm?.blendShapeProxy) return;
    this.vrm.blendShapeProxy.setValue(name, value);
  }

  update(dt) {
    if (!this.vrm) return;

    this.blinkTimer += dt;
    if (this.blinkTimer > this.nextBlink) {
      this.setExpression('blink', 1);
      setTimeout(() => this.setExpression('blink', 0), 120);
      this.blinkTimer = 0;
      this.nextBlink = rand(CONFIG.BLINK_INTERVAL.min, CONFIG.BLINK_INTERVAL.max);
    }

    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest');
    if (chest)
      chest.position.y =
        Math.sin(Date.now() * 0.001 * CONFIG.BREATH.speed + this.breathOffset) *
        CONFIG.BREATH.amp;

    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      const lerpFactor = LOW_PERFORMANCE ? 1.2 : 2.5;
      head.rotation.y = lerp(head.rotation.y, this.headTilt.x, dt * lerpFactor);
      head.rotation.x = lerp(head.rotation.x, this.headTilt.y, dt * lerpFactor);
    }
  }
}

class ParadiseAI {
  constructor() {
    this.renderer = new Renderer3D();
    this.avatar = new VRMAvatar(this.renderer.scene);
    this.emotion = new EmotionController();
    this.clock = new THREE.Clock();
    this.lastFrame = 0;
    this.isTouching = false;
    this.initTouchControls();
  }

  async requestMic() {
    try {
      await navigator.mediaDevices.getUserMedia({ audio: true });
    } catch (e) {
      TG?.showAlert('Доступ к микрофону необходим');
      TG?.close();
    }
  }

  initTouchControls() {
    document.addEventListener('touchstart', e => {
      this.isTouching = true;
      this.updateEyeTarget(e.touches[0].clientX, e.touches[0].clientY);
    });

    document.addEventListener('touchmove', e => {
      if (!this.isTouching) return;
      this.updateEyeTarget(e.touches[0].clientX, e.touches[0].clientY);
      const nx = (e.touches[0].clientX / window.innerWidth - 0.5) * 2;
      const ny = -(e.touches[0].clientY / window.innerHeight - 0.5) * 2;
      this.avatar.headTilt.set(nx * CONFIG.HEAD_TILT_FACTOR, ny * CONFIG.HEAD_TILT_FACTOR);
      this.emotion.setTarget(ny, Math.abs(nx));
    });

    document.addEventListener('touchend', e => {
      this.isTouching = false;
      this.avatar.eyeTarget.set(0, 0);
      this.avatar.headTilt.set(0, 0);
      this.emotion.setTarget(0, 0);
    });
  }

  updateEyeTarget(x, y) {
    const nx = (x / window.innerWidth - 0.5) * 2;
    const ny = -(y / window.innerHeight - 0.5) * 2;
    this.avatar.eyeTarget.set(nx * 0.5, ny * 0.5);
  }

  async start() {
    await this.requestMic();
    await this.avatar.load(CONFIG.MODEL_URL);
    this.loop();
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const now = performance.now();
    let dt = (now - this.lastFrame) / 1000;
    if (dt < 1 / CONFIG.MAX_FPS) return;
    this.lastFrame = now;

    this.emotion.update(dt);
    this.avatar.update(dt);
    this.renderer.render();
  }
}

new ParadiseAI().start();