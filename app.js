// ============================================
// PARADISE AI - PRODUCTION-GRADE VRM VIEWER
// Version: 2.0.0 | Level: GOD
// ============================================

// ================= IMPORTS ==================
import * as THREE from 'https://esm.sh/three@0.169.0';
import { GLTFLoader } from 'https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils } from 'https://esm.sh/@pixiv/three-vrm@3.4.4';
import { Octree } from 'https://esm.sh/three@0.169.0/examples/jsm/math/Octree.js';

// ================= CONSTANTS ================
const APP_STATE = {
  BOOTING: 'BOOTING',
  LOADING: 'LOADING',
  READY: 'READY',
  ERROR: 'ERROR',
  SUSPENDED: 'SUSPENDED'
};

const PERFORMANCE_TIER = (() => {
  const memory = navigator.deviceMemory || 1;
  const cores = navigator.hardwareConcurrency || 2;
  const gpu = (() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    return gl ? gl.getParameter(gl.RENDERER) : 'unknown';
  })();
  
  if (memory >= 8 && cores >= 8) return 'ULTRA';
  if (memory >= 4 && cores >= 4) return 'HIGH';
  if (memory >= 2) return 'MEDIUM';
  return 'LOW';
})();

const CONFIG = Object.freeze({
  PERFORMANCE_TIER,
  MODEL_URL: './VRM1_Constraint_Twist_Sample.vrm',
  FALLBACK_MODEL: 'https://cdn.jsdelivr.net/npm/@pixiv/three-vrm@3.4.4/samples/models/VRM1_Constraint_Twist_Sample.vrm',
  
  RENDER: {
    FOV: 35,
    NEAR: 0.1,
    FAR: 100,
    TONE_MAPPING: THREE.ACESFilmicToneMapping,
    TONE_MAPPING_EXPOSURE: 1.0,
    OUTPUT_COLOR_SPACE: THREE.SRGBColorSpace,
    SHADOW_ENABLED: PERFORMANCE_TIER !== 'LOW',
    MSAA_SAMPLES: PERFORMANCE_TIER === 'ULTRA' ? 8 : PERFORMANCE_TIER === 'HIGH' ? 4 : 0
  },
  
  CAMERA: {
    INITIAL: [0, 1.45, 1.9],
    MIN_DISTANCE: 0.5,
    MAX_DISTANCE: 5.0,
    ROTATION_SPEED: 0.005
  },
  
  AVATAR: {
    SCALE: 1.6,
    POSITION: [0, -1.1, 0],
    BREATH: {
      SPEED: [0.25, 0.4, 0.6, 0.8][['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].indexOf(PERFORMANCE_TIER)],
      AMPLITUDE: [0.008, 0.012, 0.015, 0.018][['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].indexOf(PERFORMANCE_TIER)]
    },
    BLINK: {
      MIN_INTERVAL: [8, 6, 4, 3][['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].indexOf(PERFORMANCE_TIER)],
      MAX_INTERVAL: [15, 10, 7, 5][['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].indexOf(PERFORMANCE_TIER)],
      DURATION: 120
    }
  },
  
  EMOTION: {
    LERP_SPEED: [1.5, 2.0, 3.0, 4.0][['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].indexOf(PERFORMANCE_TIER)],
    TRANSITION_TIME: 1.5,
    PRESETS: {
      NEUTRAL: { valence: 0, arousal: 0, weight: 1.0 },
      HAPPY: { valence: 0.8, arousal: 0.6, weight: 0.7 },
      SAD: { valence: -0.7, arousal: 0.3, weight: 0.5 },
      ANGRY: { valence: -0.5, arousal: 0.9, weight: 0.6 }
    }
  },
  
  PERFORMANCE: {
    TARGET_FPS: [25, 30, 45, 60][['LOW', 'MEDIUM', 'HIGH', 'ULTRA'].indexOf(PERFORMANCE_TIER)],
    DEBOUNCE_THRESHOLD: 100,
    IDLE_TIMEOUT: 30000,
    MEMORY_THRESHOLD: 0.85
  }
});

// ================= UTILS ====================
class MathUtils {
  static lerp(a, b, t) {
    return a + (b - a) * Math.min(Math.max(t, 0), 1);
  }
  
  static clamp(value, min, max) {
    return Math.min(Math.max(value, min), max);
  }
  
  static random(min, max) {
    return min + Math.random() * (max - min);
  }
  
  static smoothStep(min, max, value) {
    const x = Math.max(0, Math.min(1, (value - min) / (max - min)));
    return x * x * (3 - 2 * x);
  }
  
  static degToRad(degrees) {
    return degrees * (Math.PI / 180);
  }
}

class PerformanceMonitor {
  static instance = null;
  
  constructor() {
    if (PerformanceMonitor.instance) return PerformanceMonitor.instance;
    PerformanceMonitor.instance = this;
    
    this.fps = 60;
    this.frameTimes = [];
    this.lastFrameTime = performance.now();
    this.memory = { usedJSHeapSize: 0, totalJSHeapSize: 0 };
    this.stats = {
      minFPS: 60,
      maxFPS: 60,
      averageFPS: 60
    };
    
    this.updateInterval = setInterval(() => this.calculateStats(), 1000);
  }
  
  recordFrame() {
    const now = performance.now();
    const delta = now - this.lastFrameTime;
    this.lastFrameTime = now;
    
    if (delta > 0) {
      const currentFPS = 1000 / delta;
      this.fps = MathUtils.lerp(this.fps, currentFPS, 0.1);
      this.frameTimes.push(currentFPS);
      
      if (this.frameTimes.length > 60) this.frameTimes.shift();
    }
    
    if (performance.memory) {
      this.memory = {
        usedJSHeapSize: performance.memory.usedJSHeapSize / 1048576,
        totalJSHeapSize: performance.memory.totalJSHeapSize / 1048576
      };
    }
  }
  
  calculateStats() {
    if (this.frameTimes.length === 0) return;
    
    this.stats = {
      minFPS: Math.min(...this.frameTimes),
      maxFPS: Math.max(...this.frameTimes),
      averageFPS: this.frameTimes.reduce((a, b) => a + b) / this.frameTimes.length
    };
    
    if (this.memory.usedJSHeapSize / this.memory.totalJSHeapSize > CONFIG.PERFORMANCE.MEMORY_THRESHOLD) {
      console.warn('Memory usage high:', this.memory);
    }
  }
  
  getMetrics() {
    return { fps: this.fps, memory: this.memory, stats: this.stats };
  }
  
  destroy() {
    clearInterval(this.updateInterval);
  }
}

// ================= EMOTION SYSTEM ===========
class EmotionSystem {
  constructor() {
    this.current = { ...CONFIG.EMOTION.PRESETS.NEUTRAL };
    this.target = { ...CONFIG.EMOTION.PRESETS.NEUTRAL };
    this.transitionProgress = 1;
    this.transitionDuration = 0;
    this.emotionHistory = [];
    this.blendWeights = new Map();
    
    Object.keys(CONFIG.EMOTION.PRESETS).forEach(key => {
      this.blendWeights.set(key, key === 'NEUTRAL' ? 1.0 : 0.0);
    });
  }
  
  setEmotion(emotionName, intensity = 1.0, duration = CONFIG.EMOTION.TRANSITION_TIME) {
    if (!CONFIG.EMOTION.PRESETS[emotionName]) {
      console.warn(`Unknown emotion: ${emotionName}`);
      return;
    }
    
    this.target = { ...CONFIG.EMOTION.PRESETS[emotionName] };
    this.target.valence *= intensity;
    this.target.arousal *= intensity;
    this.transitionProgress = 0;
    this.transitionDuration = duration;
    
    this.emotionHistory.push({
      emotion: emotionName,
      intensity,
      timestamp: Date.now()
    });
    
    if (this.emotionHistory.length > 10) this.emotionHistory.shift();
  }
  
  setBlendWeights(weights) {
    Object.entries(weights).forEach(([emotion, weight]) => {
      if (this.blendWeights.has(emotion)) {
        this.blendWeights.set(emotion, MathUtils.clamp(weight, 0, 1));
      }
    });
  }
  
  update(deltaTime) {
    if (this.transitionProgress < 1) {
      this.transitionProgress += deltaTime / this.transitionDuration;
      
      const t = MathUtils.smoothStep(0, 1, this.transitionProgress);
      this.current.valence = MathUtils.lerp(this.current.valence, this.target.valence, t);
      this.current.arousal = MathUtils.lerp(this.current.arousal, this.target.arousal, t);
    }
    
    if (Math.random() < 0.01) {
      const emotions = Object.keys(CONFIG.EMOTION.PRESETS);
      const randomEmotion = emotions[Math.floor(Math.random() * emotions.length)];
      this.setEmotion(randomEmotion, Math.random() * 0.5 + 0.5, MathUtils.random(2, 5));
    }
    
    return this.current;
  }
  
  getBlendedExpression() {
    let result = { valence: 0, arousal: 0 };
    let totalWeight = 0;
    
    this.blendWeights.forEach((weight, emotion) => {
      if (weight > 0 && CONFIG.EMOTION.PRESETS[emotion]) {
        const preset = CONFIG.EMOTION.PRESETS[emotion];
        result.valence += preset.valence * weight;
        result.arousal += preset.arousal * weight;
        totalWeight += weight;
      }
    });
    
    if (totalWeight > 0) {
      result.valence /= totalWeight;
      result.arousal /= totalWeight;
    }
    
    return result;
  }
}

// ================= RENDERER =================
class AdvancedRenderer {
  constructor() {
    this.canvas = document.createElement('canvas');
    this.contextAttributes = {
      alpha: true,
      antialias: CONFIG.RENDER.MSAA_SAMPLES > 0,
      depth: true,
      stencil: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: false,
      failIfMajorPerformanceCaveat: true
    };
    
    this.initWebGL();
    this.setupRenderer();
    this.setupScene();
    this.setupLights();
    this.setupPostProcessing();
    
    window.addEventListener('resize', this.handleResize.bind(this), { passive: true });
    this.handleResize();
  }
  
  initWebGL() {
    try {
      this.gl = this.canvas.getContext('webgl2', this.contextAttributes) || 
                 this.canvas.getContext('webgl', this.contextAttributes);
      
      if (!this.gl) throw new Error('WebGL not supported');
      
      const debugInfo = this.gl.getExtension('WEBGL_debug_renderer_info');
      const vendor = debugInfo ? this.gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) : 'unknown';
      const renderer = debugInfo ? this.gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) : 'unknown';
      
      console.info(`WebGL Vendor: ${vendor}, Renderer: ${renderer}`);
    } catch (error) {
      console.error('WebGL initialization failed:', error);
      throw error;
    }
  }
  
  setupRenderer() {
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      context: this.gl,
      antialias: CONFIG.RENDER.MSAA_SAMPLES > 0,
      alpha: true,
      powerPreference: 'high-performance',
      precision: 'highp',
      depth: true,
      stencil: true
    });
    
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.outputColorSpace = CONFIG.RENDER.OUTPUT_COLOR_SPACE;
    this.renderer.toneMapping = CONFIG.RENDER.TONE_MAPPING;
    this.renderer.toneMappingExposure = CONFIG.RENDER.TONE_MAPPING_EXPOSURE;
    this.renderer.shadowMap.enabled = CONFIG.RENDER.SHADOW_ENABLED;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    
    if (CONFIG.RENDER.SHADOW_ENABLED) {
      this.renderer.shadowMap.autoUpdate = false;
    }
    
    Object.assign(this.canvas.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      outline: 'none',
      touchAction: 'none'
    });
    
    document.body.appendChild(this.canvas);
  }
  
  setupScene() {
    this.scene = new THREE.Scene();
    this.scene.background = null;
    this.scene.fog = null;
    
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.RENDER.FOV,
      window.innerWidth / window.innerHeight,
      CONFIG.RENDER.NEAR,
      CONFIG.RENDER.FAR
    );
    this.camera.position.set(...CONFIG.CAMERA.INITIAL);
    this.camera.lookAt(0, 1.4, 0);
    
    this.raycaster = new THREE.Raycaster();
    this.clock = new THREE.Clock();
    this.frameCount = 0;
  }
  
  setupLights() {
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.4);
    this.scene.add(ambientLight);
    
    const mainLight = new THREE.DirectionalLight(0xffffff, 1.2);
    mainLight.position.set(2, 5, 3);
    mainLight.castShadow = CONFIG.RENDER.SHADOW_ENABLED;
    
    if (CONFIG.RENDER.SHADOW_ENABLED) {
      mainLight.shadow.mapSize.width = 2048;
      mainLight.shadow.mapSize.height = 2048;
      mainLight.shadow.camera.near = 0.5;
      mainLight.shadow.camera.far = 50;
      mainLight.shadow.camera.left = -10;
      mainLight.shadow.camera.right = 10;
      mainLight.shadow.camera.top = 10;
      mainLight.shadow.camera.bottom = -10;
      mainLight.shadow.bias = -0.0001;
    }
    
    this.scene.add(mainLight);
    
    const fillLight = new THREE.DirectionalLight(0xffffff, 0.3);
    fillLight.position.set(-3, 2, -2);
    this.scene.add(fillLight);
    
    const rimLight = new THREE.DirectionalLight(0xffffff, 0.2);
    rimLight.position.set(-1, 1, -4);
    this.scene.add(rimLight);
  }
  
  setupPostProcessing() {
    if (PERFORMANCE_TIER === 'ULTRA') {
      this.composer = null;
    }
  }
  
  handleResize() {
    const width = window.innerWidth;
    const height = window.innerHeight;
    
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
    
    if (this.composer) {
      this.composer.setSize(width, height);
    }
  }
  
  render() {
    this.frameCount++;
    this.renderer.render(this.scene, this.camera);
  }
  
  dispose() {
    this.renderer.dispose();
    this.canvas.remove();
    window.removeEventListener('resize', this.handleResize);
  }
}

// ================= VRM AVATAR ==============
class VRMAvatar {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.mixer = null;
    this.blinkTimer = 0;
    this.nextBlink = MathUtils.random(CONFIG.AVATAR.BLINK.MIN_INTERVAL, CONFIG.AVATAR.BLINK.MAX_INTERVAL);
    this.breathOffset = Math.random() * Math.PI * 2;
    this.lookAtTarget = new THREE.Vector3(0, 1.6, -1);
    this.headRotation = new THREE.Quaternion();
    this.eyeRotation = new THREE.Quaternion();
    this.morphTargets = new Map();
    this.loadingPromise = null;
    this.isLoaded = false;
  }
  
  async load(url) {
    if (this.loadingPromise) return this.loadingPromise;
    
    this.loadingPromise = (async () => {
      try {
        const startTime = performance.now();
        
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 30000);
        
        const response = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);
        
        if (!response.ok) {
          if (url !== CONFIG.FALLBACK_MODEL) {
            console.warn('Primary model failed, trying fallback...');
            return this.load(CONFIG.FALLBACK_MODEL);
          }
          throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }
        
        const blob = await response.blob();
        const blobUrl = URL.createObjectURL(blob);
        
        const loader = new GLTFLoader();
        loader.register(parser => new VRMLoaderPlugin(parser));
        
        const gltf = await loader.loadAsync(blobUrl);
        URL.revokeObjectURL(blobUrl);
        
        if (!gltf.userData.vrm) {
          throw new Error('Loaded model is not a valid VRM');
        }
        
        this.vrm = gltf.userData.vrm;
        
        VRMUtils.removeUnnecessaryVertices(gltf.scene);
        VRMUtils.removeUnnecessaryJoints(gltf.scene);
        
        this.vrm.scene.traverse((child) => {
          if (child.isMesh) {
            child.frustumCulled = true;
            child.matrixAutoUpdate = false;
          }
        });
        
        this.vrm.scene.scale.setScalar(CONFIG.AVATAR.SCALE);
        this.vrm.scene.position.set(...CONFIG.AVATAR.POSITION);
        this.scene.add(this.vrm.scene);
        
        this.setupMorphTargets();
        this.isLoaded = true;
        
        const loadTime = performance.now() - startTime;
        console.info(`VRM loaded in ${loadTime.toFixed(2)}ms`);
        
        return this.vrm;
      } catch (error) {
        console.error('VRM loading failed:', error);
        this.loadingPromise = null;
        throw error;
      }
    })();
    
    return this.loadingPromise;
  }
  
  setupMorphTargets() {
    if (!this.vrm?.blendShapeProxy) return;
    
    const presets = this.vrm.blendShapeProxy.getPresetNameList();
    presets.forEach(preset => {
      this.morphTargets.set(preset, 0);
    });
  }
  
  setMorphTarget(name, value, duration = 0.2) {
    if (!this.morphTargets.has(name)) return;
    
    const current = this.morphTargets.get(name);
    this.morphTargets.set(name, MathUtils.clamp(value, 0, 1));
    
    if (this.vrm?.blendShapeProxy) {
      this.vrm.blendShapeProxy.setValue(name, this.morphTargets.get(name));
    }
  }
  
  update(deltaTime, emotion, input) {
    if (!this.vrm) return;
    
    this.updateBlink(deltaTime);
    this.updateBreathing(deltaTime);
    this.updateEmotion(emotion);
    this.updateLookAt(input);
    
    if (this.vrm.humanoid) {
      this.vrm.humanoid.update();
    }
  }
  
  updateBlink(deltaTime) {
    this.blinkTimer += deltaTime;
    
    if (this.blinkTimer >= this.nextBlink) {
      this.setMorphTarget('blink', 1, 0.05);
      
      setTimeout(() => {
        this.setMorphTarget('blink', 0, 0.1);
      }, CONFIG.AVATAR.BLINK.DURATION);
      
      this.blinkTimer = 0;
      this.nextBlink = MathUtils.random(
        CONFIG.AVATAR.BLINK.MIN_INTERVAL,
        CONFIG.AVATAR.BLINK.MAX_INTERVAL
      );
    }
  }
  
  updateBreathing(deltaTime) {
    const chest = this.vrm.humanoid?.getNormalizedBoneNode('chest');
    if (!chest) return;
    
    const breathValue = Math.sin(
      Date.now() * 0.001 * CONFIG.AVATAR.BREATH.SPEED + this.breathOffset
    ) * CONFIG.AVATAR.BREATH.AMPLITUDE;
    
    chest.position.y = breathValue;
  }
  
  updateEmotion(emotion) {
    if (!emotion) return;
    
    const valence = MathUtils.clamp(emotion.valence, -1, 1);
    const arousal = MathUtils.clamp(emotion.arousal, 0, 1);
    
    if (valence > 0) {
      this.setMorphTarget('joy', valence * 0.8);
      this.setMorphTarget('sorrow', 0);
    } else {
      this.setMorphTarget('sorrow', -valence * 0.6);
      this.setMorphTarget('joy', 0);
    }
    
    if (arousal > 0.7) {
      this.setMorphTarget('angry', arousal * 0.5);
    } else {
      this.setMorphTarget('angry', 0);
    }
  }
  
  updateLookAt(input) {
    if (!this.vrm.lookAt) return;
    
    const lookAt = new THREE.Vector3(
      input.lookAt.x * 0.3,
      1.6 + input.lookAt.y * 0.2,
      -1
    );
    
    this.vrm.lookAt.lookAt(lookAt);
  }
  
  dispose() {
    if (this.vrm?.scene) {
      this.scene.remove(this.vrm.scene);
      VRMUtils.deepDispose(this.vrm.scene);
    }
    this.vrm = null;
    this.mixer = null;
  }
}

// ================= INPUT CONTROLLER =========
class InputController {
  constructor() {
    this.state = {
      touch: { x: 0, y: 0, active: false },
      lookAt: { x: 0, y: 0 },
      gesture: null,
      lastTap: 0
    };
    
    this.touchStartPos = { x: 0, y: 0 };
    this.touchStartTime = 0;
    this.pinchDistance = 0;
    this.velocity = { x: 0, y: 0 };
    
    this.bindEvents();
    this.setupGestureDetection();
  }
  
  bindEvents() {
    this.handlers = {
      touchstart: this.handleTouchStart.bind(this),
      touchmove: this.handleTouchMove.bind(this),
      touchend: this.handleTouchEnd.bind(this),
      touchcancel: this.handleTouchEnd.bind(this)
    };
    
    Object.entries(this.handlers).forEach(([event, handler]) => {
      document.addEventListener(event, handler, { passive: false });
    });
    
    window.addEventListener('blur', () => {
      this.state.touch.active = false;
      this.state.gesture = null;
    });
  }
  
  setupGestureDetection() {
    this.gestures = new Map([
      ['tap', { count: 0, lastTime: 0 }],
      ['doubleTap', { count: 0, lastTime: 0 }],
      ['swipe', { direction: null, velocity: 0 }]
    ]);
  }
  
  handleTouchStart(event) {
    event.preventDefault();
    
    if (event.touches.length > 2) return;
    
    const touch = event.touches[0];
    this.state.touch = {
      x: touch.clientX,
      y: touch.clientY,
      active: true
    };
    
    this.touchStartPos = { ...this.state.touch };
    this.touchStartTime = Date.now();
    this.velocity = { x: 0, y: 0 };
    
    if (event.touches.length === 2) {
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      this.pinchDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      this.state.gesture = 'pinch';
    } else {
      const now = Date.now();
      if (now - this.state.lastTap < 300) {
        this.state.gesture = 'doubleTap';
        this.gestures.get('doubleTap').count++;
      } else {
        this.state.gesture = 'tap';
        this.gestures.get('tap').count++;
      }
      this.state.lastTap = now;
    }
  }
  
  handleTouchMove(event) {
    event.preventDefault();
    
    if (!this.state.touch.active) return;
    
    const touch = event.touches[0];
    const deltaTime = Date.now() - this.touchStartTime;
    
    const deltaX = touch.clientX - this.state.touch.x;
    const deltaY = touch.clientY - this.state.touch.y;
    
    if (deltaTime > 0) {
      this.velocity.x = deltaX / deltaTime;
      this.velocity.y = deltaY / deltaTime;
    }
    
    this.state.touch.x = touch.clientX;
    this.state.touch.y = touch.clientY;
    
    this.state.lookAt = {
      x: ((touch.clientX / window.innerWidth) * 2 - 1) * 0.5,
      y: -((touch.clientY / window.innerHeight) * 2 - 1) * 0.5
    };
    
    if (event.touches.length === 2 && this.state.gesture === 'pinch') {
      const touch1 = event.touches[0];
      const touch2 = event.touches[1];
      const newDistance = Math.hypot(
        touch2.clientX - touch1.clientX,
        touch2.clientY - touch1.clientY
      );
      
      const scale = newDistance / this.pinchDistance;
      this.state.gesture = { type: 'pinch', scale };
      this.pinchDistance = newDistance;
    } else if (Math.hypot(deltaX, deltaY) > 10) {
      this.state.gesture = 'swipe';
      this.gestures.get('swipe').direction = 
        Math.abs(deltaX) > Math.abs(deltaY) ? 
        (deltaX > 0 ? 'right' : 'left') : 
        (deltaY > 0 ? 'down' : 'up');
      this.gestures.get('swipe').velocity = Math.hypot(this.velocity.x, this.velocity.y);
    }
  }
  
  handleTouchEnd(event) {
    event.preventDefault();
    
    const deltaTime = Date.now() - this.touchStartTime;
    const deltaX = this.state.touch.x - this.touchStartPos.x;
    const deltaY = this.state.touch.y - this.touchStartPos.y;
    const distance = Math.hypot(deltaX, deltaY);
    
    if (distance < 10 && deltaTime < 200) {
      if (this.state.gesture === 'doubleTap') {
      }
    }
    
    this.state.touch.active = false;
    this.state.gesture = null;
    
    setTimeout(() => {
      this.state.lookAt = { x: 0, y: 0 };
    }, 500);
  }
  
  getState() {
    return { ...this.state };
  }
  
  dispose() {
    Object.entries(this.handlers).forEach(([event, handler]) => {
      document.removeEventListener(event, handler);
    });
  }
}

// ================= MAIN APPLICATION =========
class ParadiseAI {
  constructor() {
    this.state = APP_STATE.BOOTING;
    this.initTime = Date.now();
    
    this.setupTelegram();
    this.initSystems();
    this.setupErrorHandling();
    this.start();
  }
  
  setupTelegram() {
    this.telegram = window.Telegram?.WebApp;
    
    if (this.telegram) {
      try {
        this.telegram.ready();
        this.telegram.expand();
        this.telegram.enableClosingConfirmation();
        
        if (this.telegram.platform !== 'unknown') {
          document.documentElement.style.setProperty(
            '--tg-viewport-height',
            `${this.telegram.viewportHeight}px`
          );
        }
      } catch (error) {
        console.warn('Telegram Web App integration failed:', error);
      }
    }
  }
  
  initSystems() {
    this.performanceMonitor = new PerformanceMonitor();
    this.renderer = new AdvancedRenderer();
    this.avatar = new VRMAvatar(this.renderer.scene);
    this.emotionSystem = new EmotionSystem();
    this.inputController = new InputController();
    
    this.rafId = null;
    this.lastFrameTime = 0;
    this.fpsInterval = 1000 / CONFIG.PERFORMANCE.TARGET_FPS;
    this.frameCounter = 0;
    this.idleTimer = 0;
    this.isVisible = true;
    
    this.setupVisibilityHandling();
  }
  
  setupErrorHandling() {
    window.addEventListener('error', this.handleGlobalError.bind(this));
    window.addEventListener('unhandledrejection', this.handlePromiseRejection.bind(this));
    
    if (window.ReportingObserver) {
      this.reportingObserver = new ReportingObserver((reports) => {
        reports.forEach(report => {
          console.warn('Browser reporting:', report);
        });
      });
      this.reportingObserver.observe();
    }
  }
  
  setupVisibilityHandling() {
    document.addEventListener('visibilitychange', () => {
      this.isVisible = document.visibilityState === 'visible';
      
      if (this.isVisible) {
        this.resume();
      } else {
        this.suspend();
      }
    });
    
    window.addEventListener('blur', this.suspend.bind(this));
    window.addEventListener('focus', this.resume.bind(this));
  }
  
  async start() {
    try {
      this.setState(APP_STATE.LOADING);
      
      await this.requestPermissions();
      await this.loadAvatar();
      
      this.setState(APP_STATE.READY);
      this.mainLoop();
      
      console.info(`Paradise AI started in ${Date.now() - this.initTime}ms`);
      console.info(`Performance tier: ${PERFORMANCE_TIER}`);
    } catch (error) {
      this.handleError(error);
    }
  }
  
  async requestPermissions() {
    if (!navigator.mediaDevices?.getUserMedia) return;
    
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true
        }
      });
      
      stream.getTracks().forEach(track => track.stop());
    } catch (error) {
      console.warn('Microphone permission denied:', error);
    }
  }
  
  async loadAvatar() {
    if (this.telegram) {
      this.telegram.MainButton.setText('🚀 Загрузка аватара...');
      this.telegram.MainButton.show();
      this.telegram.MainButton.disable();
    }
    
    try {
      await this.avatar.load(CONFIG.MODEL_URL);
    } finally {
      if (this.telegram) {
        this.telegram.MainButton.hide();
      }
    }
  }
  
  setState(newState) {
    const oldState = this.state;
    this.state = newState;
    
    console.debug(`State change: ${oldState} -> ${newState}`);
    
    if (this.telegram) {
      this.telegram.HapticFeedback.impactOccurred('light');
    }
  }
  
  mainLoop(currentTime = 0) {
    this.rafId = requestAnimationFrame(this.mainLoop.bind(this));
    
    if (!this.isVisible) return;
    
    const deltaTime = Math.min((currentTime - this.lastFrameTime) / 1000, 0.1);
    
    if (currentTime - this.lastFrameTime < this.fpsInterval) return;
    
    this.lastFrameTime = currentTime - ((currentTime - this.lastFrameTime) % this.fpsInterval);
    this.frameCounter++;
    
    this.performanceMonitor.recordFrame();
    
    if (this.state === APP_STATE.READY) {
      this.update(deltaTime);
      this.render();
    }
    
    this.idleTimer += deltaTime;
    if (this.idleTimer > CONFIG.PERFORMANCE.IDLE_TIMEOUT / 1000) {
      this.handleIdle();
    }
  }
  
  update(deltaTime) {
    const inputState = this.inputController.getState();
    const emotion = this.emotionSystem.update(deltaTime);
    
    this.avatar.update(deltaTime, emotion, inputState);
    
    if (inputState.gesture) {
      this.handleGesture(inputState.gesture);
    }
    
    this.updateCamera(inputState, deltaTime);
  }
  
  updateCamera(inputState, deltaTime) {
    if (!inputState.touch.active) return;
    
    const camera = this.renderer.camera;
    const sensitivity = CONFIG.CAMERA.ROTATION_SPEED;
    
    camera.position.x = MathUtils.lerp(
      camera.position.x,
      Math.sin(inputState.touch.x * sensitivity) * 2,
      deltaTime * 2
    );
    
    camera.position.z = MathUtils.lerp(
      camera.position.z,
      1.9 + Math.cos(inputState.touch.x * sensitivity) * 2,
      deltaTime * 2
    );
    
    camera.lookAt(0, 1.4, 0);
  }
  
  handleGesture(gesture) {
    if (gesture === 'doubleTap') {
      this.emotionSystem.setEmotion('HAPPY', 1.0, 0.5);
      
      if (this.telegram) {
        this.telegram.HapticFeedback.notificationOccurred('success');
      }
    } else if (gesture === 'swipe') {
      const direction = this.inputController.gestures.get('swipe').direction;
      const emotions = {
        'up': 'HAPPY',
        'down': 'SAD',
        'left': 'ANGRY',
        'right': 'NEUTRAL'
      };
      
      if (emotions[direction]) {
        this.emotionSystem.setEmotion(emotions[direction], 0.8, 0.3);
      }
    }
  }
  
  handleIdle() {
    this.idleTimer = 0;
    
    const randomAction = Math.random();
    if (randomAction < 0.3) {
      this.emotionSystem.setEmotion('HAPPY', Math.random() * 0.5, 2);
    } else if (randomAction < 0.6) {
      this.emotionSystem.setEmotion('SAD', Math.random() * 0.3, 3);
    }
  }
  
  render() {
    this.renderer.render();
    
    if (this.frameCounter % 60 === 0) {
      const metrics = this.performanceMonitor.getMetrics();
      if (metrics.fps < CONFIG.PERFORMANCE.TARGET_FPS * 0.7) {
        console.warn(`Low FPS: ${metrics.fps.toFixed(1)}`);
      }
    }
  }
  
  handleGlobalError(event) {
    console.error('Global error:', event.error);
    this.setState(APP_STATE.ERROR);
    
    if (this.telegram) {
      this.telegram.showAlert('Произошла ошибка в приложении');
    }
  }
  
  handlePromiseRejection(event) {
    console.error('Unhandled promise rejection:', event.reason);
  }
  
  handleError(error) {
    console.error('Application error:', error);
    this.setState(APP_STATE.ERROR);
    
    if (this.telegram) {
      this.telegram.showAlert(`Ошибка: ${error.message}`);
    }
  }
  
  suspend() {
    if (this.state === APP_STATE.READY) {
      this.setState(APP_STATE.SUSPENDED);
      cancelAnimationFrame(this.rafId);
    }
  }
  
  resume() {
    if (this.state === APP_STATE.SUSPENDED) {
      this.setState(APP_STATE.READY);
      this.lastFrameTime = performance.now();
      this.mainLoop();
    }
  }
  
  destroy() {
    this.suspend();
    
    cancelAnimationFrame(this.rafId);
    
    if (this.avatar) this.avatar.dispose();
    if (this.renderer) this.renderer.dispose();
    if (this.inputController) this.inputController.dispose();
    if (this.performanceMonitor) this.performanceMonitor.destroy();
    
    if (this.reportingObserver) {
      this.reportingObserver.disconnect();
    }
    
    window.removeEventListener('error', this.handleGlobalError);
    window.removeEventListener('unhandledrejection', this.handlePromiseRejection);
    
    console.info('Paradise AI destroyed');
  }
}

// ================= BOOTSTRAP ================
(() => {
  'use strict';
  
  if (typeof window === 'undefined') {
    throw new Error('This application must run in a browser environment');
  }
  
  if (!window.requestAnimationFrame) {
    document.body.innerHTML = '<div style="color: white; padding: 20px; text-align: center;">Ваш браузер не поддерживает необходимые технологии</div>';
    return;
  }
  
  Object.freeze(Object.prototype);
  Object.freeze(Array.prototype);
  Object.freeze(String.prototype);
  
  const app = new ParadiseAI();
  
  window.PARADISE_AI = app;
  
  if (module.hot) {
    module.hot.dispose(() => {
      app.destroy();
    });
    
    module.hot.accept();
  }
  
  window.addEventListener('beforeunload', () => {
    app.destroy();
  });
})();