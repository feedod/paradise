// ============================================
// PARADISE AI - GOD MODE
// Production-ready VRM Avatar System
// ============================================

// ================= IMPORTS ==================
import * as THREE from 'https://esm.sh/three@0.170.0';
import { GLTFLoader } from 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js';
import { VRMLoaderPlugin, VRMUtils, VRM } from 'https://esm.sh/@pixiv/three-vrm@3.5.0';
import { OrbitControls } from 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js';
import { RenderPass } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/RenderPass.js';
import { EffectComposer } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js';
import { SMAAPass } from 'https://esm.sh/three@0.170.0/examples/jsm/postprocessing/SMAAPass.js';

// ================= CONFIGURATION ============
const CONFIG = Object.freeze({
  DEBUG: false,
  MODEL_URL: './VRM1_Constraint_Twist_Sample.vrm',
  
  RENDER: {
    ANTIALIAS: true,
    TONE_MAPPING: THREE.ACESFilmicToneMapping,
    EXPOSURE: 1.0,
    SHADOWS: true,
    PHYSICALLY_CORRECT_LIGHTS: true
  },
  
  CAMERA: {
    FOV: 35,
    NEAR: 0.1,
    FAR: 1000,
    POSITION: new THREE.Vector3(0, 1.6, 2.5),
    TARGET: new THREE.Vector3(0, 1.4, 0)
  },
  
  AVATAR: {
    SCALE: 1.0,
    POSITION: new THREE.Vector3(0, 0, 0),
    GROUND_Y: -1.0
  },
  
  LIGHTS: {
    AMBIENT: { color: 0xffffff, intensity: 0.4 },
    MAIN: { color: 0xffffff, intensity: 1.2, position: [3, 5, 2] },
    FILL: { color: 0xffffff, intensity: 0.3, position: [-3, 2, -2] }
  },
  
  ANIMATION: {
    BREATH_SPEED: 0.6,
    BREATH_AMPLITUDE: 0.008,
    BLINK_INTERVAL_MIN: 2,
    BLINK_INTERVAL_MAX: 6,
    BLINK_DURATION: 0.15,
    EYE_MOVEMENT_SPEED: 0.1,
    HEAD_TRACK_SPEED: 0.15,
    MAX_HEAD_ANGLE: 0.3
  },
  
  INTERACTION: {
    ORBIT_CONTROLS: true,
    ORBIT_SENSITIVITY: 0.5,
    TOUCH_SENSITIVITY: 0.01,
    MAX_POLAR_ANGLE: Math.PI / 2,
    MIN_DISTANCE: 0.5,
    MAX_DISTANCE: 10
  }
});

// ================= ERROR HANDLER ============
class ErrorHandler {
  static fatal(error) {
    console.error('FATAL ERROR:', error);
    
    const message = error.message || 'Unknown error occurred';
    const stack = error.stack || '';
    
    if (window.Telegram?.WebApp) {
      window.Telegram.WebApp.showAlert(`Fatal Error: ${message}`);
      window.Telegram.WebApp.close();
    } else {
      document.body.innerHTML = `
        <div style="
          position: fixed;
          top: 0; left: 0;
          width: 100%; height: 100%;
          background: #000;
          color: #fff;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          font-family: Arial, sans-serif;
          padding: 20px;
          text-align: center;
          z-index: 9999;
        ">
          <h1>Application Error</h1>
          <p style="color: #ff6b6b; margin: 20px 0;">${message}</p>
          <pre style="
            background: #1a1a1a;
            padding: 15px;
            border-radius: 5px;
            max-width: 800px;
            overflow: auto;
            font-size: 12px;
            text-align: left;
          ">${stack}</pre>
          <button onclick="location.reload()" style="
            margin-top: 30px;
            padding: 12px 24px;
            background: #4CAF50;
            color: white;
            border: none;
            border-radius: 5px;
            cursor: pointer;
            font-size: 16px;
          ">Restart Application</button>
        </div>
      `;
    }
    
    throw error;
  }
  
  static warning(message, data = null) {
    console.warn(`WARNING: ${message}`, data);
  }
}

// ================= PERFORMANCE MONITOR ======
class PerformanceMonitor {
  constructor() {
    this.fps = 60;
    this.frameCount = 0;
    this.lastTime = performance.now();
    this.frameTimes = [];
    this.averageFPS = 60;
    this.lowFPSThreshold = 30;
    
    this.memory = {
      used: 0,
      total: 0,
      percentage: 0
    };
    
    this.startMonitoring();
  }
  
  startMonitoring() {
    setInterval(() => this.updateMemory(), 2000);
  }
  
  updateMemory() {
    if (performance.memory) {
      this.memory = {
        used: performance.memory.usedJSHeapSize / 1048576,
        total: performance.memory.totalJSHeapSize / 1048576,
        percentage: (performance.memory.usedJSHeapSize / performance.memory.totalJSHeapSize) * 100
      };
      
      if (this.memory.percentage > 90) {
        ErrorHandler.warning('High memory usage', this.memory);
      }
    }
  }
  
  update() {
    const currentTime = performance.now();
    const delta = currentTime - this.lastTime;
    
    if (delta > 0) {
      this.fps = 1000 / delta;
      this.frameTimes.push(this.fps);
      
      if (this.frameTimes.length > 60) {
        this.frameTimes.shift();
      }
      
      this.averageFPS = this.frameTimes.reduce((a, b) => a + b) / this.frameTimes.length;
      
      if (this.averageFPS < this.lowFPSThreshold) {
        ErrorHandler.warning('Low FPS detected', { fps: this.averageFPS });
      }
    }
    
    this.lastTime = currentTime;
    this.frameCount++;
    
    return this.fps;
  }
  
  getMetrics() {
    return {
      fps: Math.round(this.fps),
      averageFPS: Math.round(this.averageFPS),
      frameCount: this.frameCount,
      memory: this.memory
    };
  }
}

// ================= SCENE MANAGER ============
class SceneManager {
  constructor() {
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.composer = null;
    this.controls = null;
    this.performance = new PerformanceMonitor();
    
    this.init();
  }
  
  init() {
    try {
      this.createScene();
      this.createCamera();
      this.createRenderer();
      this.createLights();
      this.createGround();
      this.setupPostProcessing();
      this.setupControls();
      this.setupEventListeners();
      
      if (CONFIG.DEBUG) {
        this.setupDebug();
      }
    } catch (error) {
      ErrorHandler.fatal(error);
    }
  }
  
  createScene() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x000000);
    this.scene.fog = null;
  }
  
  createCamera() {
    const aspect = window.innerWidth / window.innerHeight;
    this.camera = new THREE.PerspectiveCamera(
      CONFIG.CAMERA.FOV,
      aspect,
      CONFIG.CAMERA.NEAR,
      CONFIG.CAMERA.FAR
    );
    
    this.camera.position.copy(CONFIG.CAMERA.POSITION);
    this.camera.lookAt(CONFIG.CAMERA.TARGET);
    this.scene.add(this.camera);
  }
  
  createRenderer() {
    const canvas = document.createElement('canvas');
    
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: CONFIG.RENDER.ANTIALIAS,
      alpha: true,
      powerPreference: 'high-performance',
      precision: 'highp'
    });
    
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = CONFIG.RENDER.TONE_MAPPING;
    this.renderer.toneMappingExposure = CONFIG.RENDER.EXPOSURE;
    this.renderer.shadowMap.enabled = CONFIG.RENDER.SHADOWS;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.physicallyCorrectLights = CONFIG.RENDER.PHYSICALLY_CORRECT_LIGHTS;
    
    Object.assign(canvas.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      outline: 'none',
      touchAction: 'none'
    });
    
    document.body.appendChild(canvas);
  }
  
  createLights() {
    const ambient = new THREE.AmbientLight(
      CONFIG.LIGHTS.AMBIENT.color,
      CONFIG.LIGHTS.AMBIENT.intensity
    );
    this.scene.add(ambient);
    
    const main = new THREE.DirectionalLight(
      CONFIG.LIGHTS.MAIN.color,
      CONFIG.LIGHTS.MAIN.intensity
    );
    main.position.set(...CONFIG.LIGHTS.MAIN.position);
    main.castShadow = CONFIG.RENDER.SHADOWS;
    
    if (CONFIG.RENDER.SHADOWS) {
      main.shadow.mapSize.width = 2048;
      main.shadow.mapSize.height = 2048;
      main.shadow.camera.near = 0.5;
      main.shadow.camera.far = 50;
      main.shadow.camera.left = -10;
      main.shadow.camera.right = 10;
      main.shadow.camera.top = 10;
      main.shadow.camera.bottom = -10;
      main.shadow.bias = -0.0001;
    }
    
    this.scene.add(main);
    
    const fill = new THREE.DirectionalLight(
      CONFIG.LIGHTS.FILL.color,
      CONFIG.LIGHTS.FILL.intensity
    );
    fill.position.set(...CONFIG.LIGHTS.FILL.position);
    this.scene.add(fill);
  }
  
  createGround() {
    const groundGeometry = new THREE.PlaneGeometry(10, 10);
    const groundMaterial = new THREE.ShadowMaterial({ 
      color: 0x000000,
      opacity: 0.3
    });
    
    const ground = new THREE.Mesh(groundGeometry, groundMaterial);
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = CONFIG.AVATAR.GROUND_Y;
    ground.receiveShadow = CONFIG.RENDER.SHADOWS;
    
    this.scene.add(ground);
  }
  
  setupPostProcessing() {
    if (CONFIG.RENDER.ANTIALIAS) {
      this.composer = new EffectComposer(this.renderer);
      
      const renderPass = new RenderPass(this.scene, this.camera);
      this.composer.addPass(renderPass);
      
      const smaaPass = new SMAAPass();
      this.composer.addPass(smaaPass);
    }
  }
  
  setupControls() {
    if (CONFIG.INTERACTION.ORBIT_CONTROLS) {
      this.controls = new OrbitControls(this.camera, this.renderer.domElement);
      this.controls.target.copy(CONFIG.CAMERA.TARGET);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.05;
      this.controls.screenSpacePanning = false;
      this.controls.minDistance = CONFIG.INTERACTION.MIN_DISTANCE;
      this.controls.maxDistance = CONFIG.INTERACTION.MAX_DISTANCE;
      this.controls.maxPolarAngle = CONFIG.INTERACTION.MAX_POLAR_ANGLE;
      this.controls.rotateSpeed = CONFIG.INTERACTION.ORBIT_SENSITIVITY;
      this.controls.panSpeed = CONFIG.INTERACTION.ORBIT_SENSITIVITY * 0.5;
    }
  }
  
  setupEventListeners() {
    const onResize = () => {
      const width = window.innerWidth;
      const height = window.innerHeight;
      
      this.camera.aspect = width / height;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(width, height);
      
      if (this.composer) {
        this.composer.setSize(width, height);
      }
    };
    
    window.addEventListener('resize', onResize, { passive: true });
    onResize();
  }
  
  setupDebug() {
    const axes = new THREE.AxesHelper(2);
    this.scene.add(axes);
    
    const grid = new THREE.GridHelper(10, 10, 0x444444, 0x222222);
    this.scene.add(grid);
  }
  
  update(delta) {
    if (this.controls) {
      this.controls.update();
    }
    
    this.performance.update();
  }
  
  render() {
    if (this.composer) {
      this.composer.render();
    } else {
      this.renderer.render(this.scene, this.camera);
    }
  }
  
  dispose() {
    if (this.controls) {
      this.controls.dispose();
    }
    
    if (this.composer) {
      this.composer.passes.forEach(pass => {
        if (pass.dispose) pass.dispose();
      });
      this.composer.dispose();
    }
    
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}

// ================= VRM AVATAR ==============
class VRMAvatar {
  constructor(scene) {
    this.scene = scene;
    this.vrm = null;
    this.mixer = null;
    this.blinkTimer = 0;
    this.blinkInterval = 0;
    this.breathOffset = Math.random() * Math.PI * 2;
    this.eyeTarget = new THREE.Vector3(0, 1.6, -1);
    this.headTarget = new THREE.Quaternion();
    this.currentEmotion = { valence: 0, arousal: 0 };
    this.targetEmotion = { valence: 0, arousal: 0 };
    this.emotionLerpSpeed = 0.1;
    
    this.resetBlinkTimer();
  }
  
  async load(url) {
    try {
      console.time('VRM Load Time');
      
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 30000);
      
      const response = await fetch(url, { signal: controller.signal });
      clearTimeout(timeout);
      
      if (!response.ok) {
        throw new Error(`Failed to load model: ${response.status} ${response.statusText}`);
      }
      
      const blob = await response.blob();
      const blobUrl = URL.createObjectURL(blob);
      
      const loader = new GLTFLoader();
      loader.register(parser => new VRMLoaderPlugin(parser));
      
      const gltf = await loader.loadAsync(blobUrl);
      URL.revokeObjectURL(blobUrl);
      
      if (!gltf.userData.vrm) {
        throw new Error('Loaded model is not a valid VRM file');
      }
      
      this.vrm = gltf.userData.vrm;
      
      VRMUtils.removeUnnecessaryVertices(gltf.scene);
      VRMUtils.removeUnnecessaryJoints(gltf.scene);
      
      this.vrm.scene.traverse(child => {
        if (child.isMesh) {
          child.frustumCulled = true;
          child.castShadow = true;
          child.receiveShadow = true;
        }
      });
      
      this.vrm.scene.scale.setScalar(CONFIG.AVATAR.SCALE);
      this.vrm.scene.position.copy(CONFIG.AVATAR.POSITION);
      this.scene.add(this.vrm.scene);
      
      this.centerAvatar();
      this.setupLookAt();
      
      console.timeEnd('VRM Load Time');
      console.log('VRM loaded successfully:', this.vrm);
      
      return this.vrm;
    } catch (error) {
      ErrorHandler.fatal(new Error(`Failed to load VRM avatar: ${error.message}`));
    }
  }
  
  centerAvatar() {
    if (!this.vrm) return;
    
    const box = new THREE.Box3().setFromObject(this.vrm.scene);
    const center = new THREE.Vector3();
    box.getCenter(center);
    const size = box.getSize(new THREE.Vector3());
    
    const maxDim = Math.max(size.x, size.y, size.z);
    const targetSize = 1.8;
    const scale = targetSize / maxDim;
    
    this.vrm.scene.scale.multiplyScalar(scale);
    this.vrm.scene.position.y = CONFIG.AVATAR.GROUND_Y - box.min.y * scale;
    
    console.log('Avatar centered:', { center, size, scale });
  }
  
  setupLookAt() {
    if (!this.vrm?.lookAt) return;
    
    this.vrm.lookAt.target = this.camera;
    this.vrm.lookAt.update(1);
  }
  
  resetBlinkTimer() {
    this.blinkTimer = 0;
    this.blinkInterval = THREE.MathUtils.randFloat(
      CONFIG.ANIMATION.BLINK_INTERVAL_MIN,
      CONFIG.ANIMATION.BLINK_INTERVAL_MAX
    );
  }
  
  setExpression(name, weight) {
    if (!this.vrm?.expressionManager) return;
    
    const normalizedWeight = THREE.MathUtils.clamp(weight, 0, 1);
    
    if (this.vrm.expressionManager.getExpression(name) !== undefined) {
      this.vrm.expressionManager.setValue(name, normalizedWeight);
    }
  }
  
  setEmotion(valence, arousal) {
    this.targetEmotion = {
      valence: THREE.MathUtils.clamp(valence, -1, 1),
      arousal: THREE.MathUtils.clamp(arousal, 0, 1)
    };
  }
  
  updateEmotion(delta) {
    this.currentEmotion.valence = THREE.MathUtils.lerp(
      this.currentEmotion.valence,
      this.targetEmotion.valence,
      this.emotionLerpSpeed * delta
    );
    
    this.currentEmotion.arousal = THREE.MathUtils.lerp(
      this.currentEmotion.arousal,
      this.targetEmotion.arousal,
      this.emotionLerpSpeed * delta
    );
    
    const v = this.currentEmotion.valence;
    const a = this.currentEmotion.arousal;
    
    if (v > 0) {
      this.setExpression('happy', v * 0.8);
      this.setExpression('sad', 0);
    } else {
      this.setExpression('sad', -v * 0.6);
      this.setExpression('happy', 0);
    }
    
    if (a > 0.7) {
      this.setExpression('angry', a * 0.5);
    } else {
      this.setExpression('angry', 0);
    }
  }
  
  updateBreathing(delta) {
    const chest = this.vrm?.humanoid?.getNormalizedBoneNode('chest');
    if (!chest) return;
    
    const breath = Math.sin(
      Date.now() * 0.001 * CONFIG.ANIMATION.BREATH_SPEED + this.breathOffset
    ) * CONFIG.ANIMATION.BREATH_AMPLITUDE;
    
    chest.position.y = breath;
  }
  
  updateBlink(delta) {
    this.blinkTimer += delta;
    
    if (this.blinkTimer >= this.blinkInterval) {
      this.setExpression('blink', 1);
      
      setTimeout(() => {
        this.setExpression('blink', 0);
      }, CONFIG.ANIMATION.BLINK_DURATION * 1000);
      
      this.resetBlinkTimer();
    }
  }
  
  updateLookAt(delta) {
    if (!this.vrm?.lookAt) return;
    
    this.vrm.lookAt.update(delta);
    
    const head = this.vrm.humanoid?.getNormalizedBoneNode('head');
    if (head) {
      head.quaternion.slerp(this.headTarget, CONFIG.ANIMATION.HEAD_TRACK_SPEED * delta);
    }
  }
  
  update(delta, touchInput = null) {
    if (!this.vrm) return;
    
    this.updateBreathing(delta);
    this.updateBlink(delta);
    this.updateEmotion(delta);
    
    if (touchInput) {
      this.eyeTarget.x = touchInput.x * 0.3;
      this.eyeTarget.y = 1.6 + touchInput.y * 0.2;
      this.eyeTarget.z = -1;
      
      const headRotation = new THREE.Quaternion().setFromEuler(
        new THREE.Euler(
          touchInput.y * CONFIG.ANIMATION.MAX_HEAD_ANGLE,
          touchInput.x * CONFIG.ANIMATION.MAX_HEAD_ANGLE,
          0
        )
      );
      
      this.headTarget.slerp(headRotation, CONFIG.ANIMATION.HEAD_TRACK_SPEED * delta);
    }
    
    this.updateLookAt(delta);
    
    if (this.vrm.humanoid) {
      this.vrm.humanoid.update();
    }
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

// ================= INPUT MANAGER ============
class InputManager {
  constructor() {
    this.touchInput = { x: 0, y: 0, active: false };
    this.lastTouch = { x: 0, y: 0 };
    this.velocity = { x: 0, y: 0 };
    this.gestures = new Set();
    
    this.setupEventListeners();
  }
  
  setupEventListeners() {
    const onTouchStart = (e) => {
      e.preventDefault();
      this.handleTouchStart(e);
    };
    
    const onTouchMove = (e) => {
      e.preventDefault();
      this.handleTouchMove(e);
    };
    
    const onTouchEnd = (e) => {
      e.preventDefault();
      this.handleTouchEnd(e);
    };
    
    document.addEventListener('touchstart', onTouchStart, { passive: false });
    document.addEventListener('touchmove', onTouchMove, { passive: false });
    document.addEventListener('touchend', onTouchEnd, { passive: false });
    document.addEventListener('touchcancel', onTouchEnd, { passive: false });
    
    window.addEventListener('blur', () => {
      this.touchInput.active = false;
      this.gestures.clear();
    });
  }
  
  handleTouchStart(e) {
    if (e.touches.length > 1) return;
    
    const touch = e.touches[0];
    this.touchInput = {
      x: touch.clientX,
      y: touch.clientY,
      active: true
    };
    
    this.lastTouch = { ...this.touchInput };
    this.velocity = { x: 0, y: 0 };
    this.gestures.add('tap');
  }
  
  handleTouchMove(e) {
    if (!this.touchInput.active || e.touches.length > 1) return;
    
    const touch = e.touches[0];
    const deltaX = touch.clientX - this.touchInput.x;
    const deltaY = touch.clientY - this.touchInput.y;
    
    this.velocity = {
      x: deltaX * CONFIG.INTERACTION.TOUCH_SENSITIVITY,
      y: deltaY * CONFIG.INTERACTION.TOUCH_SENSITIVITY
    };
    
    this.touchInput.x = touch.clientX;
    this.touchInput.y = touch.clientY;
    
    if (Math.abs(deltaX) > 5 || Math.abs(deltaY) > 5) {
      this.gestures.add('swipe');
    }
  }
  
  handleTouchEnd() {
    this.touchInput.active = false;
    
    if (this.gestures.has('tap') && !this.gestures.has('swipe')) {
      this.triggerTap();
    }
    
    this.gestures.clear();
  }
  
  triggerTap() {
    const emotion = Math.random();
    const valence = emotion > 0.5 ? 1 : -1;
    const arousal = Math.random();
    
    return { valence, arousal };
  }
  
  getNormalizedInput() {
    if (!this.touchInput.active) {
      return { x: 0, y: 0 };
    }
    
    return {
      x: (this.touchInput.x / window.innerWidth - 0.5) * 2,
      y: -(this.touchInput.y / window.innerHeight - 0.5) * 2
    };
  }
  
  dispose() {
    const events = ['touchstart', 'touchmove', 'touchend', 'touchcancel'];
    events.forEach(event => {
      document.removeEventListener(event, this[`on${event.charAt(0).toUpperCase() + event.slice(1)}`]);
    });
  }
}

// ================= MAIN APPLICATION =========
class ParadiseAI {
  constructor() {
    this.sceneManager = null;
    this.avatar = null;
    this.inputManager = null;
    this.telegram = window.Telegram?.WebApp;
    
    this.clock = new THREE.Clock();
    this.lastFrameTime = 0;
    this.targetFPS = 60;
    this.frameInterval = 1000 / this.targetFPS;
    
    this.isRunning = false;
    this.isInitialized = false;
    
    this.init();
  }
  
  async init() {
    try {
      console.log('Initializing Paradise AI...');
      
      this.setupTelegram();
      this.sceneManager = new SceneManager();
      this.inputManager = new InputManager();
      
      await this.loadAvatar();
      
      this.isInitialized = true;
      this.start();
      
      console.log('Paradise AI initialized successfully');
    } catch (error) {
      ErrorHandler.fatal(error);
    }
  }
  
  setupTelegram() {
    if (!this.telegram) return;
    
    try {
      this.telegram.ready();
      this.telegram.expand();
      
      this.telegram.MainButton.setText('🚀 Loading Avatar...');
      this.telegram.MainButton.show();
      this.telegram.MainButton.disable();
      
      console.log('Telegram Web App initialized');
    } catch (error) {
      console.warn('Telegram Web App integration failed:', error);
    }
  }
  
  async loadAvatar() {
    console.log('Loading avatar...');
    
    this.avatar = new VRMAvatar(this.sceneManager.scene);
    
    if (this.telegram) {
      this.telegram.MainButton.setText('🔄 Loading...');
    }
    
    await this.avatar.load(CONFIG.MODEL_URL);
    
    if (this.telegram) {
      this.telegram.MainButton.hide();
    }
  }
  
  start() {
    if (this.isRunning) return;
    
    this.isRunning = true;
    this.lastFrameTime = performance.now();
    
    this.animate();
    
    console.log('Animation loop started');
  }
  
  stop() {
    this.isRunning = false;
  }
  
  animate(currentTime = 0) {
    if (!this.isRunning) return;
    
    requestAnimationFrame((time) => this.animate(time));
    
    const deltaTime = this.clock.getDelta();
    
    const elapsed = currentTime - this.lastFrameTime;
    if (elapsed < this.frameInterval) return;
    
    this.lastFrameTime = currentTime - (elapsed % this.frameInterval);
    
    try {
      this.update(deltaTime);
      this.render();
    } catch (error) {
      ErrorHandler.warning('Animation frame error', error);
    }
  }
  
  update(delta) {
    const normalizedDelta = Math.min(delta, 0.1);
    
    this.sceneManager.update(normalizedDelta);
    
    if (this.avatar) {
      const input = this.inputManager.getNormalizedInput();
      this.avatar.update(normalizedDelta, input);
      
      if (this.inputManager.gestures.has('tap')) {
        const emotion = this.inputManager.triggerTap();
        this.avatar.setEmotion(emotion.valence, emotion.arousal);
      }
    }
  }
  
  render() {
    this.sceneManager.render();
  }
  
  dispose() {
    this.stop();
    
    if (this.avatar) {
      this.avatar.dispose();
    }
    
    if (this.inputManager) {
      this.inputManager.dispose();
    }
    
    if (this.sceneManager) {
      this.sceneManager.dispose();
    }
    
    console.log('Paradise AI disposed');
  }
}

// ================= APPLICATION BOOTSTRAP ====
(() => {
  'use strict';
  
  if (typeof window === 'undefined') {
    throw new Error('This application requires a browser environment');
  }
  
  if (!window.WebGLRenderingContext) {
    ErrorHandler.fatal(new Error('WebGL is not supported in this browser'));
    return;
  }
  
  let app = null;
  
  const bootstrap = async () => {
    try {
      console.log('Booting Paradise AI...');
      
      app = new ParadiseAI();
      
      window.addEventListener('beforeunload', () => {
        if (app) {
          app.dispose();
        }
      });
      
      if (module.hot) {
        module.hot.dispose(() => {
          if (app) {
            app.dispose();
          }
        });
        
        module.hot.accept();
      }
    } catch (error) {
      ErrorHandler.fatal(error);
    }
  };
  
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bootstrap);
  } else {
    bootstrap();
  }
  
  window.PARADISE_AI = {
    getInstance: () => app,
    restart: async () => {
      if (app) {
        app.dispose();
      }
      await bootstrap();
    }
  };
})();