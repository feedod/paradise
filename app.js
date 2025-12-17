Telegram.WebApp.ready();
Telegram.WebApp.expand();
document.body.style.backgroundColor = Telegram.WebApp.themeParams.bg_color ?? 'transparent';

// Динамические импорты через esm.sh
const THREE = await import('https://esm.sh/three@0.169.0');
const { GLTFLoader } = await import('https://esm.sh/three@0.169.0/examples/jsm/loaders/GLTFLoader.js');
const { VRMLoaderPlugin } = await import('https://esm.sh/@pixiv/three-vrm@2.0.14');

// Сцена
const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.1, 100);
camera.position.set(0, 1.4, 1.8);

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  alpha: true,
  powerPreference: 'high-performance',
});
renderer.setPixelRatio(devicePixelRatio);
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
document.body.appendChild(renderer.domElement);

// Свет
const directionalLight = new THREE.DirectionalLight(0xffffff, 1.2);
directionalLight.position.set(1, 2, 1.5);
scene.add(directionalLight);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

// Загрузка модели
let vrm = null;
let isSpeaking = false;

const loader = new GLTFLoader();
loader.register((parser) => new VRMLoaderPlugin(parser, { autoUpdateAnimation: true }));

try {
  const gltf = await loader.loadAsync('https://pixiv.github.io/three-vrm/models/AliciaSolid.vrm');
  vrm = gltf.userData.vrm;

  vrm.scene.scale.setScalar(1.6);
  vrm.scene.position.set(0, -1.1, 0);

  scene.add(vrm.scene);
} catch (err) {
  console.error('Ошибка загрузки модели:', err);
}

// Анимация
const clock = new THREE.Clock();
let blinkTimer = 0;
let idleLookTimer = 0;

function animate() {
  requestAnimationFrame(animate);
  const delta = clock.getDelta();

  if (vrm) {
    vrm.update(delta);

    // Lip-sync
    if (isSpeaking) {
      const phase = performance.now() / 120;
      const mouthValue = 0.3 + 0.7 * Math.abs(Math.sin(phase));
      vrm.blendShapeProxy?.setValue('aa', mouthValue);
      vrm.blendShapeProxy?.setValue('o', 0.3 * Math.abs(Math.sin(phase + Math.PI / 3)));
    } else {
      vrm.blendShapeProxy?.setValue('aa', 0);
      vrm.blendShapeProxy?.setValue('o', 0);
    }

    // Моргание
    if (!isSpeaking) {
      blinkTimer += delta;
      if (blinkTimer > 3 + Math.random() * 5) {
        vrm.blendShapeProxy?.setValue('blink', 1);
        setTimeout(() => vrm.blendShapeProxy?.setValue('blink', 0), 150);
        blinkTimer = 0;
      }
    }

    // Idle взгляд
    idleLookTimer += delta;
    if (idleLookTimer > 8 + Math.random() * 10) {
      const head = vrm.humanoid?.getNormalizedBoneNode('head');
      if (head) {
        head.rotation.y = (Math.random() - 0.5) * 0.2;
        head.rotation.x = (Math.random() - 0.5) * 0.1;
        setTimeout(() => head.rotation.set(0, 0, 0), 1000 + Math.random() * 2000);
      }
      idleLookTimer = 0;
    }
  }

  renderer.render(scene, camera);
}
animate();

// Resize
addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

// Эмоции
function resetExpressions() {
  if (!vrm?.blendShapeProxy) return;
  vrm.expressionManager?.expressions.forEach((exp) => (exp.weight = 0));
}

function setExpression(name) {
  resetExpressions();
  if (!vrm) return;

  const mapping = {
    happy: 'joy',
    angry: 'angry',
    sad: 'sorrow',
    surprised: 'surprised',
    listening: 'neutral',
    neutral: null,
  };

  const preset = mapping[name];
  if (preset) {
    vrm.blendShapeProxy?.setValue(preset, 1);
  }
}

// Speech Recognition
const Recognition = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
if (!Recognition) {
  console.error('SpeechRecognition не поддерживается');
  Telegram.WebApp.showAlert('Голосовой ввод не поддерживается в этом браузере');
}

const recognition = new Recognition();
recognition.lang = 'ru-RU';
recognition.continuous = true;
recognition.interimResults = true;

let isListening = false;
const wakeWord = 'айри';

// Запуск по любому тапу/клику (повторные попытки возможны)
document.addEventListener('click', async () => {
  if (isListening) return;

  try {
    await recognition.start();
    isListening = true;
    setExpression('listening');
    Telegram.WebApp.HapticFeedback.impactOccurred('light');
  } catch (err) {
    console.error('Ошибка запуска микрофона:', err);
    if (err.name === 'NotAllowedError' || err.message?.includes('permission')) {
      Telegram.WebApp.showAlert('Разреши доступ к микрофону в настройках браузера');
    }
  }
});

// Speech Synthesis
const synth = globalThis.speechSynthesis;

function speak(text) {
  synth.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'ru-RU';
  utterance.pitch = 1.6;
  utterance.rate = 0.95;

  const voices = synth.getVoices();
  const preferred = voices.find(v => v.lang.startsWith('ru') && /female|жен|alice|milena/i.test(v.name));
  if (preferred) utterance.voice = preferred;

  utterance.onstart = () => {
    isSpeaking = true;
    setExpression('happy');
  };

  utterance.onend = utterance.onerror = () => {
    isSpeaking = false;
    setExpression('neutral');
  };

  synth.speak(utterance);
}

// Ответы
function getResponse(transcript) {
  const lower = transcript.toLowerCase();

  if (lower.includes('привет') || lower.includes('здравствуй')) return 'Приветик~ ♥ Так рада тебя слышать!';
  if (lower.includes('как дела') || lower.includes('как ты')) return 'У меня всё супер! А у тебя как, милый?';
  if (lower.includes('люблю') || lower.includes('обожаю')) return 'Ой, я тоже тебя очень-очень люблю~ ♥';
  if (lower.includes('грустно') || lower.includes('плохо')) return 'Не грусти… Я здесь. Расскажи мне всё.';
  if (lower.includes('злой') || lower.includes('сердит')) return 'Успокойся~ Давай лучше обнимемся!';
  if (lower.includes('удив') || lower.includes('вау')) return 'Вау! Правда? Это потрясающе!';

  return 'Хм… Очень интересно! Расскажи ещё~';
}

recognition.onresult = (event) => {
  let transcript = '';
  for (let i = event.resultIndex; i < event.results.length; i++) {
    transcript += event.results[i][0].transcript;
  }

  const lastResult = event.results[event.results.length - 1];
  if (lastResult.isFinal && transcript.toLowerCase().includes(wakeWord)) {
    const response = getResponse(transcript);
    speak(response);
  }
};

recognition.onerror = (event) => {
  console.error('Ошибка STT:', event.error);
  if (event.error === 'not-allowed') {
    Telegram.WebApp.showAlert('Доступ к микрофону заблокирован. Разреши в настройках');
  }
};

recognition.onend = () => {
  if (isListening) {
    recognition.start().catch(() => {});
  }
};