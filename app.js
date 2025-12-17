import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@3.4.4';

const TG = globalThis.Telegram?.WebApp;
TG?.ready();
TG?.expand();

const CONFIG = Object.freeze({
  MODEL_URL: 'https://edsandbox.bluemarble.in/three.js-master/examples/models/vrm/Alicia/AliciaSolid.vrm',
  CAMERA: { fov: 35, near: 0.1, far: 100, position: [0, 1.45, 1.9] },
  PIXEL_RATIO: Math.min(window.devicePixelRatio || 1, 2),
  BREATH: { speed: 0.6, amp: 0.015 },
  BLINK_INTERVAL: { min: 3, max: 7 },
  LIPSYNC_GAIN: 4.2,
  EMOTION_LERP: 3,
});

const clamp = (val, min, max) => Math.min(max, Math.max(min, val));
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

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(CONFIG.PIXEL_RATIO);
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

    Object.assign(this.renderer.domElement.style, {
      position: 'fixed',
      inset: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      touchAction: 'none',
    });

    Object.assign(document.body.style, {
      margin: '0',
      width: '100%',
      height: '100%',
      overflow: 'hidden',
      backgroundColor: '#000',
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
  }

  async load(url) {
    try {
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      const gltf = await loader.loadAsync(url);
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      this.vrm = gltf.userData.vrm;
      this.vrm.scene.scale.setScalar(1.6);
      this.vrm.scene.position.set(0, -1.1, 0);
      this.scene.add(this.vrm.scene);
    } catch (e) {
      console.error('Ошибка загрузки VRM:', e);
      TG?.showAlert('Не удалось загрузить аватар');
    }
  }

  setExpression(name, value) {
    if (!this.vrm?.blendShapeProxy) return;
    this.vrm.blendShapeProxy.setValue(name, value);
  }

  update(dt, emotion, lipsync) {
    if (!this.vrm) return;

    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest');
    if (chest) chest.position.y = Math.sin(Date.now() * 0.001 * CONFIG.BREATH.speed) * CONFIG.BREATH.amp * (1 + emotion.arousal);

    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    if (head) {
      head.rotation.y = lerp(head.rotation.y, 0, dt * 2.5);
      head.rotation.x = lerp(head.rotation.x, 0, dt * 2.5);
    }

    this.blinkTimer += dt;
    if (this.blinkTimer > this.nextBlink) {
      this.setExpression('blink', 1);
      setTimeout(() => this.setExpression('blink', 0), 120);
      this.blinkTimer = 0;
      this.nextBlink = rand(CONFIG.BLINK_INTERVAL.min, CONFIG.BLINK_INTERVAL.max);
    }

    this.setExpression('aa', lipsync);
    this.setExpression('joy', clamp(emotion.valence, 0, 1));
    this.setExpression('sorrow', clamp(-emotion.valence, 0, 1));
  }
}

class Microphone {
  constructor() {
    this.level = 0;
  }

  async init() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
      this.ctx = new AC({ latencyHint: 'interactive' });
      const source = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 2048;
      this.dataArray = new Uint8Array(this.analyser.fftSize);
      source.connect(this.analyser);
    } catch (e) {
      console.error('Ошибка доступа к микрофону', e);
      throw e;
    }
  }

  update() {
    this.analyser.getByteTimeDomainData(this.dataArray);
    let sum = 0;
    for (const val of this.dataArray) {
      const n = (val - 128) / 128;
      sum += n * n;
    }
    const rms = Math.sqrt(sum / this.dataArray.length);
    this.level = lerp(this.level, rms, 0.15);
    return clamp(this.level * CONFIG.LIPSYNC_GAIN, 0, 1);
  }
}

class ParadiseAI {
  constructor() {
    this.renderer = new Renderer3D();
    this.avatar = new VRMAvatar(this.renderer.scene);
    this.emotion = new EmotionController();
    this.mic = new Microphone();
    this.clock = new THREE.Clock();
  }

  async start() {
    try {
      await this.mic.init();
    } catch {
      TG?.showAlert('Нужен доступ к микрофону');
      TG?.close();
      return;
    }

    await this.avatar.load(CONFIG.MODEL_URL);
    this.loop();
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = this.clock.getDelta();

    this.emotion.update(dt);
    this.emotion.setTarget(0.1, 0.2);

    const lipsync = this.mic.update();
    this.avatar.update(dt, this.emotion, lipsync);

    this.renderer.render();
  }
}

new ParadiseAI().start();