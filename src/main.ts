import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import { buildCampus, type CampusData } from './campus'
import { Beacons, type BeaconSpec } from './beacons'
import { env, skyDome } from './sky'
import { blankTheme, mixTheme, type ThemeName } from './theme'

const THEME_KEY = 'gator-pulse-theme'
const TRANSITION_SECONDS = 1.6
const MAX_PIXEL_RATIO = 1.5
// Below this frame rate the render resolution steps down, so slow GPUs stay smooth.
const MIN_FPS = 40
// Centre and half-width of the baked map, for fitting the sun's shadow frustum.
const MAP_CENTRE = new THREE.Vector3(-88, 0, 22)
const MAP_REACH = 1120

const LABELS: Record<string, string> = {
  'J. Paul Leonard Library': 'Library',
  'Cesar Chavez Student Center': 'Student Center',
  'Thornton Hall': 'Thornton Hall',
  'Hensill Hall': 'Hensill Hall',
  'Burk Hall': 'Burk Hall',
  Administration: 'Administration',
  'Creative Arts': 'Creative Arts',
  'Fine Arts': 'Fine Arts',
  Humanities: 'Humanities',
  Business: 'Business',
  Gymnasium: 'Gymnasium',
  'Mashouf Wellness Center': 'Mashouf Wellness',
  'Towers at Centennial Square': 'Towers',
  'Temporary Annex 1': 'Annex I',
  'Mary Ward Hall': 'Mary Ward Hall',
  'Manzanita Square': 'Manzanita Square',
  'Science and Engineering Innovation Center': 'Science & Engineering',
}

// Placeholder beacons copied from today's SFSU events listing. Phase 2 replaces these with the live feed.
const SAMPLE_EVENTS: [place: string, title: string, where: string, color: THREE.Color, strength: number][] = [
  ['Cesar Chavez Student Center', 'Karaoke Night', 'The Depot', new THREE.Color(1.0, 0.3, 0.72), 0.85],
  ['Thornton Hall', 'Guided Meditation', 'TH 818', new THREE.Color(0.3, 0.88, 1.0), 0.45],
  ['Mashouf Wellness Center', 'Sound Bath', 'Studio 122', new THREE.Color(0.3, 0.88, 1.0), 0.6],
  ['J. Paul Leonard Library', 'Interview Prep', 'LIB 121', new THREE.Color(1.0, 0.78, 0.3), 0.55],
  ['Temporary Annex 1', 'SF Hacks × GDG', 'Annex I', new THREE.Color(0.42, 1.0, 0.6), 1.0],
]

function storedTheme(): ThemeName | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return value === 'day' || value === 'night' ? value : null
  } catch {
    return null
  }
}

async function init() {
  const params = new URLSearchParams(location.search)
  const queryTheme = params.get('theme')
  let themeName: ThemeName = queryTheme === 'day' || queryTheme === 'night' ? queryTheme : (storedTheme() ?? 'night')

  const renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: 'high-performance' })
  let pixelRatio = Math.min(devicePixelRatio, MAX_PIXEL_RATIO)
  renderer.setPixelRatio(pixelRatio)
  renderer.setSize(innerWidth, innerHeight)
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  // The scene is static, so the shadow map is only redrawn while the sun moves.
  renderer.shadowMap.autoUpdate = false
  document.getElementById('app')!.appendChild(renderer.domElement)

  const labels = new CSS2DRenderer({ element: document.getElementById('labels')! })
  labels.setSize(innerWidth, innerHeight)

  const scene = new THREE.Scene()
  const fog = new THREE.FogExp2(0x000000, 0.0003)
  scene.fog = fog
  const sky = skyDome()
  scene.add(sky)

  const hemi = new THREE.HemisphereLight()
  const sun = new THREE.DirectionalLight()
  sun.castShadow = true
  sun.shadow.mapSize.set(4096, 4096)
  sun.shadow.bias = -0.0004
  sun.shadow.normalBias = 0.8
  Object.assign(sun.shadow.camera, { left: -MAP_REACH, right: MAP_REACH, top: MAP_REACH, bottom: -MAP_REACH, near: 200, far: 5200 })
  sun.shadow.camera.updateProjectionMatrix()
  sun.target.position.copy(MAP_CENTRE)
  scene.add(hemi, sun, sun.target)

  const camera = new THREE.PerspectiveCamera(36, innerWidth / innerHeight, 5, 30000)
  // ?cam=x,y,z,tx,ty,tz overrides the opening shot; ?still stops the idle orbit.
  const shot = (params.get('cam') ?? '560,300,600,-60,10,-40').split(',').map(Number)
  camera.position.set(shot[0], shot[1], shot[2])
  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.set(shot[3], shot[4], shot[5])
  controls.enableDamping = true
  controls.maxPolarAngle = 1.46
  controls.minDistance = 60
  controls.maxDistance = 2600
  controls.autoRotate = !params.has('still')
  controls.autoRotateSpeed = 0.22
  controls.addEventListener('start', () => (controls.autoRotate = false))
  controls.update()

  const data: CampusData = await (await fetch('/campus.json')).json()
  const campus = buildCampus(data)
  scene.add(campus.group)

  for (const [name, text] of Object.entries(LABELS)) {
    const place = campus.places.get(name)
    if (!place) continue
    const element = document.createElement('div')
    element.className = 'bldg'
    element.textContent = text
    const label = new CSS2DObject(element)
    label.position.copy(place.anchor).setY(place.anchor.y + 7)
    scene.add(label)
  }

  const specs: BeaconSpec[] = []
  for (const [name, title, where, color, strength] of SAMPLE_EVENTS) {
    const place = campus.places.get(name)
    if (place) specs.push({ at: place.anchor.clone(), color, title, where, strength })
  }
  const beacons = new Beacons(specs)
  scene.add(beacons.group)

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(innerWidth, innerHeight)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.62, 0.9)
  composer.addPass(bloom)
  const vignette = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.4 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uAmount;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        float edge = 1.0 - smoothstep(1.05, 0.25, length(vUv - 0.5) * 1.25);
        gl_FragColor = vec4(c.rgb * (1.0 - uAmount * edge), c.a);
      }`,
  })
  composer.addPass(vignette)
  composer.addPass(new OutputPass())

  // --- day / night ---------------------------------------------------------------------------
  const theme = blankTheme()
  let blend = themeName === 'night' ? 1 : 0

  function applyTheme(k: number) {
    mixTheme(theme, k)
    env.uNight.value = k
    env.uZenith.value.copy(theme.zenith)
    env.uHorizon.value.copy(theme.horizon)
    env.uGlow.value.copy(theme.glow)
    env.uSunDir.value.copy(theme.sunDir)
    env.uSunColor.value.copy(theme.sunColor)
    env.uSunDisc.value = theme.sunDisc
    env.uStars.value = theme.stars
    fog.color.copy(theme.horizon)
    fog.density = theme.fogDensity
    hemi.color.copy(theme.hemiSky)
    hemi.groundColor.copy(theme.hemiGround)
    hemi.intensity = theme.hemiIntensity
    sun.color.copy(theme.sunColor)
    sun.intensity = theme.sunIntensity
    sun.position.copy(MAP_CENTRE).addScaledVector(theme.sunDir, 2600)
    renderer.toneMappingExposure = theme.exposure
    bloom.strength = theme.bloom
    bloom.threshold = theme.bloomThreshold
    vignette.uniforms.uAmount.value = theme.vignette
    campus.setTheme(k)
    beacons.setTheme(k)
    renderer.shadowMap.needsUpdate = true
  }

  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-set-theme]')]
  function setTheme(name: ThemeName) {
    themeName = name
    document.body.dataset.theme = name
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.setTheme === name))
    try {
      localStorage.setItem(THEME_KEY, name)
    } catch {
      // Private windows can refuse storage; the toggle still works for this visit.
    }
  }
  for (const button of buttons) button.addEventListener('click', () => setTheme(button.dataset.setTheme as ThemeName))
  addEventListener('keydown', (event) => {
    if (event.key.toLowerCase() === 't' && !event.metaKey && !event.ctrlKey) setTheme(themeName === 'night' ? 'day' : 'night')
  })
  setTheme(themeName)
  applyTheme(blend)
  // Flush styles first so enabling transitions does not fade the HUD in from the other theme.
  void document.body.offsetHeight
  document.body.classList.add('ready')

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
    labels.setSize(innerWidth, innerHeight)
    composer.setSize(innerWidth, innerHeight)
  })

  const clock = new THREE.Clock()
  let sampleFrames = 0
  let sampleSeconds = 0
  renderer.setAnimationLoop(() => {
    const rawDelta = clock.getDelta()
    const delta = Math.min(rawDelta, 0.1)
    // Hidden tabs report huge gaps; ignore those when judging speed.
    if (rawDelta < 0.25) {
      sampleFrames++
      sampleSeconds += rawDelta
    }
    if (sampleFrames === 90) {
      if (sampleFrames / sampleSeconds < MIN_FPS && pixelRatio > 1) {
        pixelRatio = Math.max(1, pixelRatio - 0.25)
        renderer.setPixelRatio(pixelRatio)
        composer.setPixelRatio(pixelRatio)
      }
      sampleFrames = 0
      sampleSeconds = 0
    }
    const time = clock.elapsedTime
    const goal = themeName === 'night' ? 1 : 0
    if (blend !== goal) {
      blend = THREE.MathUtils.clamp(blend + (Math.sign(goal - blend) * delta) / TRANSITION_SECONDS, 0, 1)
      applyTheme(THREE.MathUtils.smootherstep(blend, 0, 1))
    }
    env.uTime.value = time
    controls.update()
    sky.position.copy(camera.position)
    beacons.tick(time)
    composer.render()
    labels.render(scene, camera)
  })
}

init()
