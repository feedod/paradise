import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import {
  VRMLoaderPlugin,
  VRMUtils
} from 'https://esm.sh/@pixiv/three-vrm@3.4.4';

const TG = globalThis.Telegram?.WebApp;
TG?.ready();
TG?.expand();

const CONFIG = Object.freeze({
  MODEL: 'https://pixiv.github.io/three-vrm/models/AliciaSolid.vrm',
  LANG: 'ru-RU',
  WAKE: 'айри',
  CAMERA: { fov: 35, near: 0.1, far: 100, pos: [0, 1.45, 1.9] },
  PIXEL_RATIO: 1.5,
  BREATH: { speed: 0.6, amp: 0.015 },
  BLINK: { min: 3, max: 7 },
  LIPSYNC: { gain: 4.2, smooth: 0.15 },
  GAZE: { speed: 2.5 },
  MEMORY_KEY: 'paradiseai.memory.v1'
});

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

class FSM {
  state = 'boot';
  set(s) { this.state = s; }
}

class Emotion {
  valence = 0;
  arousal = 0;
  tv = 0;
  ta = 0;
  set(v, a) {
    this.tv = clamp(v, -1, 1);
    this.ta = clamp(a, 0, 1);
  }
  update(dt) {
    this.valence = lerp(this.valence, this.tv, dt * 3);
    this.arousal = lerp(this.arousal, this.ta, dt * 3);
  }
}

class Memory {
  short = [];
  long = [];
  constructor() {
    try {
      const raw = localStorage.getItem(CONFIG.MEMORY_KEY);
      if (raw) this.long = JSON.parse(raw);
    } catch {}
    if (!this.long.length) {
      this.long = [
        'Ты ParadiseAI — тёплая, заботливая, живая.',
        'Ты говоришь мягко, эмоционально и по-человечески.'
      ];
    }
  }
  push(text) {
    this.short.push(text);
    if (this.short.length > 20) this.short.shift();
    this.persist();
  }
  persist() {
    try {
      localStorage.setItem(CONFIG.MEMORY_KEY, JSON.stringify(this.long.concat(this.short)));
    } catch {}
  }
  context() {
    return [...this.long, ...this.short].join('\n');
  }
}

class Renderer {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.fov,
      innerWidth / innerHeight,
      CONFIG.CAMERA.near,
      CONFIG.CAMERA.far
    );
    this.camera.position.set(...CONFIG.CAMERA.pos);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio || 1, CONFIG.PIXEL_RATIO));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.domElement.className = 'paradise-canvas';

    document.body.append(this.renderer.domElement);

    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const d = new THREE.DirectionalLight(0xffffff, 1.2);
    d.position.set(1, 2, 1.5);
    this.scene.add(d);

    addEventListener('resize', () => this.resize(), { passive: true });
  }
  resize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
}

class Avatar {
  constructor(scene, camera) {
    this.scene = scene;
    this.camera = camera;
    this.vrm = null;
    this.time = 0;
    this.blink = 0;
    this.nextBlink = rand(CONFIG.BLINK.min, CONFIG.BLINK.max);
  }
  async load(url) {
    const loader = new GLTFLoader();
    loader.register(p => new VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync(url);
    VRMUtils.removeUnnecessaryVertices(gltf.scene);
    VRMUtils.removeUnnecessaryJoints(gltf.scene);
    this.vrm = gltf.userData.vrm;
    this.vrm.scene.scale.setScalar(1.6);
    this.vrm.scene.position.set(0, -1.1, 0);
    this.scene.add(this.vrm.scene);
  }
  set(name, v) {
    this.vrm?.expressionManager?.setValue(name, v);
  }
  update(dt, emotion, mouth, speaking) {
    if (!this.vrm) return;
    this.time += dt;
    this.vrm.update(dt);

    const chest = this.vrm.humanoid.getNormalizedBoneNode('chest');
    chest.position.y = Math.sin(this.time * CONFIG.BREATH.speed) * CONFIG.BREATH.amp * (1 + emotion.arousal);

    const head = this.vrm.humanoid.getNormalizedBoneNode('head');
    const target = new THREE.Vector3().copy(this.camera.position).normalize();
    head.rotation.y = lerp(head.rotation.y, target.x * 0.2 * emotion.valence, dt * CONFIG.GAZE.speed);
    head.rotation.x = lerp(head.rotation.x, target.y * 0.1, dt * CONFIG.GAZE.speed);

    if (!speaking) {
      this.blink += dt;
      if (this.blink > this.nextBlink) {
        this.set('blink', 1);
        setTimeout(() => this.set('blink', 0), 120);
        this.blink = 0;
        this.nextBlink = rand(CONFIG.BLINK.min, CONFIG.BLINK.max);
      }
    }

    this.set('aa', mouth);
    this.set('joy', clamp(emotion.valence, 0, 1));
    this.set('sorrow', clamp(-emotion.valence, 0, 1));
  }
}

class AudioInput {
  level = 0;
  async init() {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = new AC({ latencyHint: 'interactive' });
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.data = new Uint8Array(this.analyser.fftSize);
    src.connect(this.analyser);
  }
  update() {
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (const v of this.data) {
      const n = (v - 128) / 128;
      sum += n * n;
    }
    const rms = Math.sqrt(sum / this.data.length);
    this.level = lerp(this.level, rms, CONFIG.LIPSYNC.smooth);
    return clamp(this.level * CONFIG.LIPSYNC.gain, 0, 1);
  }
}

class ParadiseAI {
  constructor() {
    this.fsm = new FSM();
    this.emotion = new Emotion();
    this.memory = new Memory();
    this.renderer = new Renderer();
    this.avatar = new Avatar(this.renderer.scene, this.renderer.camera);
    this.audio = new AudioInput();
    this.clock = new THREE.Clock();
  }
  async start() {
    try {
      await this.audio.init();
    } catch {
      TG?.showAlert('Нужен доступ к микрофону');
      TG?.close();
      return;
    }
    await this.avatar.load(CONFIG.MODEL);
    this.fsm.set('idle');
    this.loop();
  }
  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = this.clock.getDelta();

    this.emotion.update(dt);
    if (this.fsm.state === 'idle') this.emotion.set(0.1, 0.2);

    const mouth = this.audio.update();
    this.avatar.update(dt, this.emotion, mouth, this.fsm.state === 'speaking');
    this.renderer.render();
  }
}

new ParadiseAI().start();