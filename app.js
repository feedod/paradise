import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.169.0/build/three.module.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.4.4/lib/three-vrm.module.js';

const TG = globalThis.Telegram?.WebApp ?? null;
TG?.ready?.();
TG?.expand?.();

const CONFIG = Object.freeze({
  PROJECT: 'ParadiseAI',
  MODEL_URL: 'https://pixiv.github.io/three-vrm/models/AliciaSolid.vrm',
  LANG: 'ru-RU',
  WAKE_WORD: 'айри',
  CAMERA: { fov: 35, near: 0.05, far: 200, pos: [0, 1.45, 1.8] },
  RENDER: { maxPixelRatio: 1.5 },
  LIPSYNC: { gain: 4.4, smooth: 0.14 },
  BLINK: { min: 3, max: 7 },
  MODEL_TIMEOUT_MS: 20000,
  MIC_TIMEOUT_MS: 10000,
  LLM_ENDPOINT: null,
});

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const rand = (a, b) => a + Math.random() * (b - a);

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
    this.renderer.setPixelRatio(clamp(devicePixelRatio || 1, 1, CONFIG.RENDER.maxPixelRatio));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.domElement.classList.add('paradise-canvas');
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.appendChild(this.renderer.domElement);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    const dl = new THREE.DirectionalLight(0xffffff, 1.2);
    dl.position.set(1, 2, 1.5);
    this.scene.add(dl);
    this._onResize = this._onResize.bind(this);
    addEventListener('resize', this._onResize, { passive: true });
  }
  _onResize() {
    this.camera.aspect = innerWidth / innerHeight;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(innerWidth, innerHeight);
  }
  render() {
    this.renderer.render(this.scene, this.camera);
  }
  dispose() {
    try { this.renderer.dispose(); } catch {}
    try { removeEventListener('resize', this._onResize); } catch {}
    try { this.renderer.domElement.remove(); } catch {}
  }
}

class Avatar {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.time = 0;
    this.blinkTimer = 0;
    this.nextBlink = rand(CONFIG.BLINK.min, CONFIG.BLINK.max);
  }
  async load(url, ms = CONFIG.MODEL_TIMEOUT_MS) {
    const loader = new GLTFLoader();
    loader.register((p) => new VRMLoaderPlugin(p));
    const loadPromise = loader.loadAsync(url);
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('model load timeout')), ms));
    const gltf = await Promise.race([loadPromise, timeout]);
    try { VRMUtils.removeUnnecessaryVertices(gltf.scene); VRMUtils.removeUnnecessaryJoints(gltf.scene); } catch {}
    const vrm = gltf.userData.vrm ?? null;
    if (!vrm) throw new Error('vrm missing');
    vrm.scene.scale.setScalar(1.6);
    vrm.scene.position.set(0, -1.1, 0);
    this.vrm = vrm;
    this.scene.add(this.vrm.scene);
  }
  setBlend(name, value) {
    try {
      if (!this.vrm) return;
      if (this.vrm.expressionManager?.setValue) { this.vrm.expressionManager.setValue(name, value); return; }
      if (this.vrm.blendShapeProxy?.setValue) { this.vrm.blendShapeProxy.setValue(name, value); return; }
    } catch {}
  }
  update(dt, emotion = { valence: 0, arousal: 0 }, speaking = false) {
    if (!this.vrm) return;
    this.time += dt;
    try { this.vrm.update(dt); } catch {}
    const chest = this.vrm.humanoid?.getNormalizedBoneNode?.('chest');
    if (chest) chest.position.y = Math.sin(this.time * 0.6) * 0.015 * (1 + emotion.arousal);
    const head = this.vrm.humanoid?.getNormalizedBoneNode?.('head');
    if (head) {
      head.rotation.y = Math.sin(this.time * 0.4) * 0.1 * emotion.valence;
      head.rotation.x = Math.sin(this.time * 0.3) * 0.05;
    }
    if (!speaking) {
      this.blinkTimer += dt;
      if (this.blinkTimer >= this.nextBlink) {
        this.setBlend('blink', 1);
        setTimeout(() => this.setBlend('blink', 0), 120);
        this.blinkTimer = 0;
        this.nextBlink = rand(CONFIG.BLINK.min, CONFIG.BLINK.max);
      }
    }
  }
  applyMouth(v) {
    const value = clamp(v, 0, 1);
    this.setBlend('aa', value);
    this.setBlend('o', clamp(value * 0.6, 0, 1));
  }
  setEmotion(e) {
    this.setBlend('joy', clamp(e.valence, 0, 1));
    this.setBlend('sorrow', clamp(-e.valence, 0, 1));
  }
  dispose() {
    try { if (this.vrm?.scene) this.scene.remove(this.vrm.scene); } catch {}
  }
}

class Audio {
  constructor() {
    const AC = globalThis.AudioContext || globalThis.webkitAudioContext;
    this.ctx = AC ? new AC({ latencyHint: 'interactive' }) : null;
    this.analyser = null;
    this.data = null;
    this.level = 0;
    this.stream = null;
  }
  async requestMic(ms = CONFIG.MIC_TIMEOUT_MS) {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error('getUserMedia unsupported');
    const controller = new AbortController();
    const id = setTimeout(() => controller.abort(), ms);
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } finally { clearTimeout(id); }
    if (!this.stream) throw new Error('microphone not granted');
    if (!this.ctx) return;
    const src = this.ctx.createMediaStreamSource(this.stream);
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
    this.level = lerp(this.level, rms, CONFIG.LIPSYNC.smooth);
    return clamp(this.level * CONFIG.LIPSYNC.gain, 0, 1);
  }
  stop() {
    try { this.stream?.getTracks()?.forEach((t) => t.stop()); } catch {}
    try { this.ctx?.close?.(); } catch {}
  }
}

class Speech {
  constructor(onFinal) {
    const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
    this.recognition = SR ? new SR() : null;
    this.onFinal = onFinal;
    this.active = false;
    if (this.recognition) {
      this.recognition.lang = CONFIG.LANG;
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.onresult = (e) => this._handle(e);
      this.recognition.onerror = () => {};
      this.recognition.onend = () => { if (this.active) this.recognition.start().catch(() => {}); };
    }
  }
  start() {
    if (!this.recognition || this.active) return;
    try { this.recognition.start(); this.active = true; } catch {}
  }
  stop() {
    if (!this.recognition || !this.active) return;
    try { this.recognition.stop(); this.active = false; } catch {}
  }
  _handle(e) {
    let text = '';
    for (let i = e.resultIndex; i < e.results.length; i++) text += e.results[i][0].transcript;
    const last = e.results[e.results.length - 1];
    if (last?.isFinal) {
      const cleaned = String(text).replace(/[\u0000-\u001F\u007F-\u009F]/g, '').trim();
      if (cleaned.toLowerCase().includes(CONFIG.WAKE_WORD)) this.onFinal(cleaned);
    }
  }
}

class TTS {
  constructor(onStart, onEnd) {
    this.synth = globalThis.speechSynthesis;
    this.onStart = onStart;
    this.onEnd = onEnd;
  }
  speak(text) {
    if (!this.synth) return;
    try { this.synth.cancel(); } catch {}
    const u = new SpeechSynthesisUtterance(String(text));
    u.lang = CONFIG.LANG;
    u.pitch = 1.6;
    u.rate = 0.95;
    u.onstart = () => this.onStart?.();
    u.onend = () => this.onEnd?.();
    u.onerror = () => this.onEnd?.();
    try { this.synth.speak(u); } catch { this.onEnd?.(); }
  }
}

class Emotion {
  constructor() {
    this.valence = 0;
    this.arousal = 0;
    this.tValence = 0;
    this.tArousal = 0;
  }
  set(v, a) {
    this.tValence = clamp(v, -1, 1);
    this.tArousal = clamp(a, 0, 1);
  }
  update(dt) {
    this.valence = lerp(this.valence, this.tValence, clamp(dt * 3, 0, 1));
    this.arousal = lerp(this.arousal, this.tArousal, clamp(dt * 3, 0, 1));
  }
}

class Memory {
  constructor() {
    this.short = [];
    this.long = ['Ты ParadiseAI — доброжелательная и тёплая персона.', 'Отвечай мягко и с эмпатией.'];
  }
  push(item) {
    this.short.push(item);
    if (this.short.length > 20) this.short.shift();
  }
  context() {
    return [...this.long, ...this.short].join('\n');
  }
}

class LLM {
  constructor(endpoint = CONFIG.LLM_ENDPOINT) { this.endpoint = endpoint; }
  async generate(prompt) {
    if (!this.endpoint) return this._fallback(prompt);
    try {
      const r = await fetch(this.endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ prompt }) });
      if (!r.ok) throw new Error('llm error');
      const j = await r.json();
      return j.output ?? this._fallback(prompt);
    } catch { return this._fallback(prompt); }
  }
  _fallback(text) {
    const t = text.toLowerCase();
    if (t.includes('привет')) return 'Приветик~ ♥ Так рада тебя слышать!';
    if (t.includes('как дела')) return 'У меня всё хорошо, спасибо!';
    if (t.includes('люблю')) return 'Я тоже тебя очень люблю~ ♥';
    return 'Интересно! Расскажи подробнее.';
  }
}

class App {
  constructor() {
    this.renderer = new Renderer();
    this.avatar = new Avatar(this.renderer.scene);
    this.audio = new Audio();
    this.speech = new Speech(this._onWake.bind(this));
    this.tts = new TTS(this._onTStart.bind(this), this._onTEnd.bind(this));
    this.emotion = new Emotion();
    this.memory = new Memory();
    this.llm = new LLM(null);
    this.state = 'boot';
    this.clock = new THREE.Clock();
    this._createStatus();
    this._boundLoop = this._loop.bind(this);
    this._beforeUnload = this._beforeUnload.bind(this);
    addEventListener('beforeunload', this._beforeUnload);
  }
  async start() {
    try {
      this._setStatus('Запрашиваю доступ к микрофону...');
      await this._requestMic();
      this._setStatus('Загружаю модель...');
      await this.avatar.load(CONFIG.MODEL_URL);
      this._setStatus('Готово. Скажи «айри»');
      this.state = 'idle';
      this._loop();
    } catch (err) {
      this._fatal(err);
    }
  }
  async _requestMic() {
    try {
      if (navigator.permissions && navigator.permissions.query) {
        const p = await navigator.permissions.query({ name: 'microphone' }).catch(() => null);
        if (p?.state === 'denied') throw new Error('mic denied');
      }
    } catch {}
    try {
      const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('mic timeout')), CONFIG.MIC_TIMEOUT_MS));
      await Promise.race([this.audio.requestMic(), timeout]);
    } catch {
      try { TG?.showAlert?.('Разрешите доступ к микрофону — приложение будет закрыто.'); } catch {}
      try { TG?.close?.(); } catch { try { window.close(); } catch {} }
      throw new Error('microphone permission required');
    }
  }
  async _onWake(text) {
    try {
      this.memory.push('User: ' + text);
      this.state = 'thinking';
      this._setStatus('Думаю...');
      this.emotion.set(0, 0.6);
      const prompt = [this.memory.context(), 'Пользователь: ' + text, 'Ассистент:'].join('\n\n');
      const reply = await this.llm.generate(prompt);
      this.memory.push('Assistant: ' + reply);
      this.state = 'speaking';
      this._setStatus('Говорю...');
      this.tts.speak(reply);
    } catch {
      this._setStatus('Ошибка обработки');
      this.state = 'idle';
    }
  }
  _onTStart() {
    this.state = 'speaking';
    this.emotion.set(0.8, 0.8);
  }
  _onTEnd() {
    this.state = 'idle';
    this.emotion.set(0.1, 0.2);
  }
  _loop() {
    requestAnimationFrame(this._boundLoop);
    const dt = this.clock.getDelta();
    this.emotion.update(dt);
    if (this.state === 'idle') { this.emotion.set(0.1, 0.2); if (!this.speech.active) this.speech.start(); }
    if (this.state === 'thinking') this.emotion.set(0, 0.6);
    if (this.state === 'speaking') { if (this.speech.active) this.speech.stop(); }
    const mouth = this.audio.update();
    this.avatar.applyMouth(mouth);
    this.avatar.setEmotion({ valence: this.emotion.valence, arousal: this.emotion.arousal });
    this.avatar.update(dt, { valence: this.emotion.valence, arousal: this.emotion.arousal }, this.state === 'speaking');
    this.renderer.render();
  }
  _createStatus() {
    const el = document.createElement('div');
    el.className = 'paradise-status';
    el.setAttribute('role', 'status');
    el.setAttribute('aria-live', 'polite');
    el.textContent = '';
    document.body.appendChild(el);
    this._status = el;
  }
  _setStatus(t) {
    try { this._status.textContent = String(t); } catch {}
  }
  _fatal(err) {
    try { TG?.showAlert?.(err?.message ?? 'Fatal error'); } catch {}
    try { TG?.close?.(); } catch { try { window.close(); } catch {} }
  }
  _beforeUnload() {
    try { this.audio.stop(); } catch {}
    try { this.avatar.dispose(); } catch {}
    try { this.renderer.dispose(); } catch {}
  }
}

const app = new App();
await app.start();