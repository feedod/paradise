import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@3.4.4';

const TG = globalThis.Telegram?.WebApp;
TG?.ready();
TG?.expand();

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
  EYE_TRACK_SPEED: LOW_PERFORMANCE ? 2 : 4
});

const clamp = (v, min, max) => Math.min(max, Math.max(min, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (min, max) => min + Math.random() * (max - min);

if (TG) {
  TG.MainButton.setText('Загрузка 0%');
  TG.MainButton.show();
  TG.MainButton.disable();
}

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
    this.renderer.toneMapping = THREE.NoToneMapping;
    Object.assign(this.renderer.domElement.style, {
      position: 'fixed', inset: '0', width: '100%', height: '100%', display: 'block', touchAction: 'none'
    });
    Object.assign(document.body.style, {
      margin: '0', width: '100%', height: '100%', overflow: 'hidden', backgroundColor: '#000'
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
    TG?.expand();
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
  }

  async load(url) {
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url, xhr => {
        if (TG && xhr.total) {
          const percent = Math.floor((xhr.loaded / xhr.total) * 100);
          TG.MainButton.setText(`Загрузка ${percent}%`);
        }
      });
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
      if (TG) TG.MainButton.hide();
    } catch (e) {
      console.error('Ошибка загрузки VRM:', e);
      if (TG) TG.MainButton.setText('Ошибка загрузки');
      TG?.showAlert('Не удалось загрузить аватар. Попробуйте позже.');
      TG?.close();
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
      chest.position.y = Math.sin(Date.now() * 0.001 * CONFIG.BREATH.speed + this.breathOffset) *
        CONFIG.BREATH.amp * (1 + emotion.arousal);

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

    this.idleLookTimer += dt;
    if (this.idleLookTimer > this.nextIdleLook) {
      if (head) {
        head.rotation.y = (Math.random() - 0.5) * CONFIG.IDLE_LOOK_ANGLE.y;
        head.rotation.x = (Math.random() - 0.5) * CONFIG.IDLE_LOOK_ANGLE.x;
        setTimeout(() => { head.rotation.x = 0; head.rotation.y = 0; }, 1000 + Math.random() * 2000);
      }
      this.idleLookTimer = 0;
      this.nextIdleLook = rand(CONFIG.IDLE_LOOK_INTERVAL.min, CONFIG.IDLE_LOOK_INTERVAL.max);
    }

    // слежение глазами
    if (head) {
      const eyeL = this.vrm.humanoid.getNormalizedBoneNode('leftEye');
      const eyeR = this.vrm.humanoid.getNormalizedBoneNode('rightEye');
      if (eyeL && eyeR) {
        const eyeX = clamp(this.eyeTarget.x, -0.5, 0.5);
        const eyeY = clamp(this.eyeTarget.y, -0.5, 0.5);
        eyeL.rotation.y = lerp(eyeL.rotation.y, eyeX, dt * CONFIG.EYE_TRACK_SPEED);
        eyeL.rotation.x = lerp(eyeL.rotation.x, eyeY, dt * CONFIG.EYE_TRACK_SPEED);
        eyeR.rotation.y = lerp(eyeR.rotation.y, eyeX, dt * CONFIG.EYE_TRACK_SPEED);
        eyeR.rotation.x = lerp(eyeR.rotation.x, eyeY, dt * CONFIG.EYE_TRACK_SPEED);
      }
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
      this.updateEyeTarget(e.touches[0].clientX, e.touches[0].clientY);
    });

    document.addEventListener('touchmove', e => {
      this.updateEyeTarget(e.touches[0].clientX, e.touches[0].clientY);
    });

    document.addEventListener('touchend', e => {
      const dx = e.changedTouches[0].clientX - this.startX;
      const dy = e.changedTouches[0].clientY - this.startY;
      if (Math.abs(dx) < 20 && Math.abs(dy) < 20) this.emotion.setTarget(0, 0);
      else if (Math.abs(dy) > Math.abs(dx)) dy < 0 ? this.emotion.setTarget(1, 0.7) : this.emotion.setTarget(-1, 0.6);
      else dx > 0 ? this.emotion.setTarget(0.5, 0.5) : this.emotion.setTarget(-0.5, 0.5);
      this.avatar.eyeTarget.set(0, 0);
    });
  }

  updateEyeTarget(x, y) {
    const nx = (x / window.innerWidth - 0.5) * 2;
    const ny = -(y / window.innerHeight - 0.5) * 2;
    this.avatar.eyeTarget.set(nx * 0.5, ny * 0.5);
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