import * as PIXI from 'https://cdn.jsdelivr.net/npm/pixi.js@7.4.0/dist/pixi.mjs'
import { Live2DModel } from 'https://cdn.jsdelivr.net/npm/pixi-live2d-display@0.5.0/dist/esm/index.js'

const tg = window.Telegram?.WebApp ?? null
if (tg) {
  tg.expand()
  tg.ready()
}

const app = new PIXI.Application({
  resizeTo: window,
  transparent: true,
  autoDensity: true,
  resolution: devicePixelRatio || 1
})

document.body.appendChild(app.view)

const model = await Live2DModel.from(
  'https://cdn.jsdelivr.net/gh/guansss/pixi-live2d-display@master/examples/assets/haru/haru.model3.json'
)

model.anchor.set(0.5, 1)
model.position.set(app.screen.width / 2, app.screen.height)
model.scale.set(0.35)

app.stage.addChild(model)

const core =
  model.internalModel?.coreModel ??
  model.internalModel?.model

function setParam(id, v) {
  try { core.setParameterValueById(id, v) } catch {}
}

let t = 0
app.ticker.add((d) => {
  t += 0.01 * d
  setParam('ParamAngleX', Math.sin(t) * 8)
  setParam('ParamAngleY', Math.sin(t * 0.7) * 4)
  setParam('ParamBodyAngleX', Math.sin(t * 0.5) * 3)
  setParam('ParamBreath', (Math.sin(t * 1.5) + 1) * 0.5)
})

function speak(text) {
  if (!speechSynthesis) return
  const u = new SpeechSynthesisUtterance(text)
  u.lang = 'ru-RU'
  let s = 0
  const i = setInterval(() => {
    s += 0.2
    setParam('ParamMouthOpenY', Math.abs(Math.sin(s)) * 0.9)
  }, 60)
  u.onend = () => {
    clearInterval(i)
    setParam('ParamMouthOpenY', 0)
  }
  speechSynthesis.speak(u)
}

setTimeout(() => {
  speak('Привет.')
}, 1000)