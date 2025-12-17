import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin } from 'https://esm.sh/@pixiv/three-vrm@2.0.14';

const TG = globalThis.Telegram?.WebApp ?? null;
TG?.ready?.();
TG?.expand?.();
document.body.style.backgroundColor = TG?.themeParams?.bg_color ?? 'transparent';

const CONFIG = Object.freeze({
  PROJECT: 'ParadiseAI',
  MODEL_URL: 'https://pixiv.github.io/three-vrm/models/AliciaSolid.vrm',
  LANG: 'ru-RU',
  WAKE_WORD: 'айри',
  CAMERA: { fov: 35, near: 0.1, far: 100, pos: [0, 1.4, 1.8] },
  RENDER: { maxPixelRatio: 1.5 },
  LIPSYNC: { gain: 4.5, smooth: 0.14 },
  BLINK: { min: 3, max: 7 },
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const rand = (a, b) => a + Math.random() * (b - a);

class RendererCore {
  constructor() {
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.fov,
      innerWidth / innerHeight,
      CONFIG.CAMERA.near,
      CONFIG.CAMERA.far,
    );
    this.camera.position.set(...CONFIG.CAMERA.pos);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });

    this.renderer.setPixelRatio(
      clamp(devicePixelRatio || 1, 1, CONFIG.RENDER.maxPixelRatio),
    );
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;

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

class VRMAvatar {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.blinkTimer = 0;
    this.nextBlink = rand(CONFIG.BLINK.min, CONFIG.BLINK.max);
  }

  async load(url) {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const gltf = await loader.loadAsync(url);
    this.vrm = gltf.userData.vrm;
    this.vrm.scene.scale.setScalar(1.6);
    this.vrm.scene.position.set(0, -1.1, 0);
    this.scene.add(this.vrm.scene);
  }

  update(dt, speaking) {
    if (!this.vrm) return;
    this.vrm.update(dt);
    if (!speaking) this.blink(dt);
  }

  blink(dt) {
    this.blinkTimer += dt;
    if (this.blinkTimer >= this.nextBlink) {
      this.setBlend('blink', 1);
      setTimeout(() => this.setBlend('blink', 0), 120);
      this.blinkTimer = 0;
      this.nextBlink = rand(CONFIG.BLINK.min, CONFIG.BLINK.max);
    }
  }

  setBlend(name, value) {
    this.vrm?.blendShapeProxy?.setValue(name, value);
  }

  setExpression(name) {
    if (!this.vrm?.expressionManager) return;
    this.vrm.expressionManager.expressions.forEach((e) => (e.weight = 0));
    if (name) this.setBlend(name, 1);
  }
}

class AudioController {
  constructor() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = AC ? new AC({ latencyHint: 'interactive' }) : null;
    this.analyser = null;
    this.data = null;
    this.level = 0;
  }

  async initMic() {
    if (!this.ctx || !navigator.mediaDevices) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const src = this.ctx.createMediaStreamSource(stream);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.data = new Uint8Array(this.analyser.fftSize);
    src.connect(this.analyser);
  }

  update() {
    if (!this.analyser) return 0;
    this.analyser.getByteTimeDomainData(this.data);
    let sum = 0;
    for (let i = 0; i < this.data.length; i++) {
      const v = (this.data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.data.length);
    this.level =
      this.level * (1 - CONFIG.LIPSYNC.smooth) +
      rms * CONFIG.LIPSYNC.smooth;
    return clamp(this.level * CONFIG.LIPSYNC.gain, 0, 1);
  }
}

class SpeechController {
  constructor(onFinal) {
    const SR =
      globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    this.recognition = SR ? new SR() : null;
    this.listening = false;
    this.onFinal = onFinal;

    if (this.recognition) {
      this.recognition.lang = CONFIG.LANG;
      this.recognition.continuous = true;
      this.recognition.interimResults = true;

      this.recognition.onresult = (e) => this.handleResult(e);
      this.recognition.onend = () => {
        if (this.listening) this.recognition.start().catch(() => {});
      };
    }
  }

  start() {
    if (!this.recognition || this.listening) return;
    this.listening = true;
    this.recognition.start();
  }

  handleResult(e) {
    let text = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      text += e.results[i][0].transcript;
    }
    const last = e.results[e.results.length - 1];
    if (last.isFinal && text.toLowerCase().includes(CONFIG.WAKE_WORD)) {
      this.onFinal(text);
    }
  }
}

class TTSController {
  constructor(onStart, onEnd) {
    this.synth = globalThis.speechSynthesis;
    this.onStart = onStart;
    this.onEnd = onEnd;
  }

  speak(text) {
    if (!this.synth) return;
    this.synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = CONFIG.LANG;
    u.pitch = 1.6;
    u.rate = 0.95;
    u.onstart = this.onStart;
    u.onend = this.onEnd;
    u.onerror = this.onEnd;
    this.synth.speak(u);
  }
}

class ParadiseAI {
  constructor() {
    this.renderer = new RendererCore();
    this.avatar = new VRMAvatar(this.renderer.scene);
    this.audio = new AudioController();
    this.speaking = false;

    this.tts = new TTSController(
      () => {
        this.speaking = true;
        this.avatar.setExpression('joy');
      },
      () => {
        this.speaking = false;
        this.avatar.setExpression(null);
      },
    );

    this.stt = new SpeechController((text) =>
      this.tts.speak(this.reply(text)),
    );

    this.clock = new THREE.Clock();
  }

  async init() {
    await this.avatar.load(CONFIG.MODEL_URL);
    addEventListener('click', async () => {
      await this.audio.initMic();
      this.stt.start();
      TG?.HapticFeedback?.impactOccurred('light');
    });
    this.loop();
  }

  reply(text) {
    const t = text.toLowerCase();
    if (t.includes('привет')) return 'Приветик~ ♥';
    if (t.includes('как дела')) return 'У меня всё отлично!';
    if (t.includes('люблю')) return 'Я тоже тебя люблю~ ♥';
    return 'Ммм… расскажи ещё~';
  }

  loop() {
    requestAnimationFrame(() => this.loop());
    const dt = this.clock.getDelta();
    const mouth = this.audio.update();
    this.avatar.setBlend('aa', mouth);
    this.avatar.update(dt, this.speaking);
    this.renderer.render();
  }
}

const app = new ParadiseAI();
await app.init();