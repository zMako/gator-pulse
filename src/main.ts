import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js'
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js'
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js'
import { CSS2DObject, CSS2DRenderer } from 'three/addons/renderers/CSS2DRenderer.js'
import './style.css'
import { buildCampus, seededRandom, type CampusData } from './campus'
import { buildTraffic } from './traffic'
import { Beacons } from './beacons'
import { dayOf, formatDate, formatTime, loadEvents, nightness, stateAt, themeOf, withDay, type CampusEvent } from './events'
import { createGuide, type Plan } from './guide'
import { createPanel } from './panel'
import { createSubmit } from './submit'
import { createTimeline } from './timeline'
import { env, skyDome } from './sky'
import { blankTheme, mixTheme, type ThemeName } from './theme'

/** 'auto' lights the campus for the time on the slider; the others pin it. */
type ThemeMode = 'auto' | ThemeName

const THEME_KEY = 'gator-pulse-theme'
// Ids of events added from this browser, so their cards offer a Remove button.
const MINE_KEY = 'gator-pulse-mine'
const TRANSITION_SECONDS = 1.6
const AUTO_TRANSITION_SECONDS = 0.7
const FLIGHT_SECONDS = 1.4
const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// How long a guided tour rests on each stop of a plan.
const TOUR_DWELL_MS = 4500
const FEED_REFRESH_MS = 5 * 60 * 1000
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

const isMode = (value: string | null): value is ThemeMode => value === 'auto' || value === 'day' || value === 'night'

function storedMode(): ThemeMode | null {
  try {
    const value = localStorage.getItem(THEME_KEY)
    return isMode(value) ? value : null
  } catch {
    return null
  }
}

async function init() {
  const params = new URLSearchParams(location.search)
  const queryMode = params.get('theme')
  let mode: ThemeMode = isMode(queryMode) ? queryMode : (storedMode() ?? 'auto')

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

  const traffic = buildTraffic(data, seededRandom(29))
  scene.add(traffic.group)

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: 4 }))
  composer.setPixelRatio(renderer.getPixelRatio())
  composer.setSize(innerWidth, innerHeight)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.4, 0.62, 0.9)
  const vignette = new ShaderPass({
    uniforms: { tDiffuse: { value: null }, uAmount: { value: 0.4 }, uSaturation: { value: 1 } },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform sampler2D tDiffuse;
      uniform float uAmount;
      uniform float uSaturation;
      varying vec2 vUv;
      void main() {
        vec4 c = texture2D(tDiffuse, vUv);
        // A NaN or infinite pixel fails these comparisons. Left in, the bloom blur that follows
        // would spread it into a large black block.
        bool finite = c.r >= 0.0 && c.r < 1e4 && c.g >= 0.0 && c.g < 1e4 && c.b >= 0.0 && c.b < 1e4;
        if (!finite) c.rgb = vec3(0.0);
        c.rgb = min(c.rgb, vec3(64.0));
        c.rgb = max(mix(vec3(dot(c.rgb, vec3(0.2126, 0.7152, 0.0722))), c.rgb, uSaturation), 0.0);
        float edge = 1.0 - smoothstep(1.05, 0.25, length(vUv - 0.5) * 1.25);
        gl_FragColor = vec4(c.rgb * (1.0 - uAmount * edge), c.a);
      }`,
  })
  composer.addPass(vignette)
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  // --- camera flights ------------------------------------------------------------------------
  let flight: { progress: number; fromTarget: THREE.Vector3; toTarget: THREE.Vector3; fromEye: THREE.Vector3; toEye: THREE.Vector3 } | null = null

  /** Glide to look at a point on the map, keeping roughly the current viewing direction. */
  function flyTo(anchor: THREE.Vector3) {
    const toTarget = new THREE.Vector3(anchor.x, Math.min(anchor.y, 30) * 0.5, anchor.z)
    const offset = camera.position.clone().sub(controls.target)
    const distance = THREE.MathUtils.clamp(offset.length(), 240, 420)
    const direction = offset.normalize()
    direction.y = THREE.MathUtils.clamp(direction.y, 0.35, 0.7)
    flight = {
      progress: 0,
      fromTarget: controls.target.clone(),
      toTarget,
      fromEye: camera.position.clone(),
      toEye: toTarget.clone().addScaledVector(direction.normalize(), distance),
    }
    controls.autoRotate = false
  }
  controls.addEventListener('start', () => {
    controls.autoRotate = false
    flight = null
    stopTour()
  })

  // --- events, beacons, list and timeline ------------------------------------------------------
  let events: CampusEvent[] = []
  let selected: CampusEvent | null = null
  // Whether the demo's sample student posts are showing alongside the official listing.
  let samples = params.get('posts') === '1'
  /** The event each beacon currently stands for. */
  const leads = new Map<string, CampusEvent>()
  let autoNight = 1

  const beacons = new Beacons((place) => {
    const event = leads.get(place)
    if (!event) return
    stopTour()
    select(event, false)
  })
  scene.add(beacons.group)

  const panel = createPanel(document.getElementById('events')!, document.getElementById('card')!, {
    onSelect: (event) => {
      stopTour()
      select(event, true)
    },
    onClose: () => {
      stopTour()
      select(null, false)
    },
    isMine: (event) => mine().includes(event.id),
    async onRemove(event) {
      const response = await fetch(`/api/submissions/${encodeURIComponent(event.id)}`, { method: 'DELETE' })
      if (response.ok || response.status === 404) {
        removeEvent(event.id)
        select(null, false)
      }
    },
  })

  function mine(): string[] {
    try {
      return JSON.parse(localStorage.getItem(MINE_KEY) ?? '[]')
    } catch {
      return []
    }
  }
  function remember(id: string) {
    try {
      localStorage.setItem(MINE_KEY, JSON.stringify([...mine(), id].slice(-50)))
    } catch {
      // Without storage the Remove button just won't appear.
    }
  }
  function removeEvent(id: string) {
    if (!events.some((event) => event.id === id)) return
    events = events.filter((event) => event.id !== id)
    timeline.setEvents(events)
    refresh(timeline.time)
  }

  /** Outline the building a name refers to, or clear the outline. */
  function highlightPlace(name: string | null) {
    campus.highlight(name ? (campus.places.get(name)?.index ?? null) : null)
  }

  /** Open a building's card and outline it. */
  function showBuilding(index: number) {
    stopTour()
    selected = null
    const name = data.buildings[index].n ?? 'Building'
    const now = Date.now()
    const here = events.filter((event) => event.place === name && event.end > now && event.start < now + WEEK_MS)
    campus.highlight(index)
    panel.showBuilding(name, here, timeline.time, (event) => select(event, true))
    refresh(timeline.time)
  }

  // A click (not a drag) on the map picks the building under the pointer.
  const raycaster = new THREE.Raycaster()
  let press: { x: number; y: number; at: number } | null = null
  renderer.domElement.addEventListener('pointerdown', (event) => (press = { x: event.clientX, y: event.clientY, at: performance.now() }))
  renderer.domElement.addEventListener('pointerup', (event) => {
    if (!press || Math.hypot(event.clientX - press.x, event.clientY - press.y) > 6 || performance.now() - press.at > 500) return
    press = null
    raycaster.setFromCamera(new THREE.Vector2((event.clientX / innerWidth) * 2 - 1, -(event.clientY / innerHeight) * 2 + 1), camera)
    const hit = raycaster.intersectObject(campus.buildings, false)[0]
    if (hit?.face) showBuilding(campus.buildings.geometry.attributes.aBuilding.getX(hit.face.a))
    else {
      stopTour()
      select(null, false)
    }
  })
  const timeline = createTimeline(document.getElementById('timeline')!, refresh)

  /** Redraw the list and the beacons for the moment on the slider. */
  function refresh(time: number) {
    autoNight = nightness(time)
    const day = dayOf(time)
    const todays = events.filter((event) => event.day === day)
    panel.showDay(formatDate(time), todays, time, selected?.id ?? null)

    const byPlace = new Map<string, CampusEvent[]>()
    for (const event of todays) {
      if (event.place && campus.places.has(event.place)) byPlace.set(event.place, [...(byPlace.get(event.place) ?? []), event])
    }
    leads.clear()
    // Every place with an event, plus every place that still has a beacon from an earlier listing.
    for (const name of new Set([...events.map((event) => event.place), ...beacons.names()])) {
      const place = name ? campus.places.get(name) : undefined
      if (!name || !place) continue
      const here = byPlace.get(name)
      if (!here) {
        beacons.set(name, place.anchor, null)
        continue
      }
      // The beacon speaks for whatever is on now, else what is next, else what just ended.
      const lead =
        here.find((event) => stateAt(event, time) === 'live') ??
        here.find((event) => stateAt(event, time) === 'soon') ??
        here[here.length - 1]
      const state = stateAt(lead, time)
      const detail = state === 'live' ? `until ${formatTime(lead.end)}` : state === 'soon' ? formatTime(lead.start) : 'ended'
      leads.set(name, lead)
      beacons.set(name, place.anchor, {
        color: themeOf(lead.theme).color,
        level: (state === 'live' ? 0.85 : state === 'soon' ? 0.42 : 0.14) + Math.min(lead.rsvps, 15) / 100,
        live: state === 'live',
        title: lead.title,
        detail: here.length > 1 ? `${detail} · +${here.length - 1}` : detail,
      })
    }
  }

  /** Open an event's card and fly to it. `seek` also moves the slider to when it starts. */
  function select(event: CampusEvent | null, seek: boolean) {
    selected = event
    panel.showCard(event)
    highlightPlace(event?.place ?? null)
    // Bring the slider to the event unless it is already on, or already over in real life.
    if (event && seek && stateAt(event, timeline.time) !== 'live' && event.end > Date.now()) timeline.set(event.start)
    else refresh(timeline.time)
    const place = event?.place ? campus.places.get(event.place) : undefined
    if (place) flyTo(place.anchor)
  }

  // --- the guide: plans come back from Gemini and the map tours through their stops -------------
  let tour = 0

  function stopTour() {
    clearInterval(tour)
    tour = 0
  }

  function showStep(plan: Plan, index: number) {
    const step = plan.steps[index]
    guide.markStep(index)
    const event = step.eventId ? events.find((candidate) => candidate.id === step.eventId) : undefined
    if (event) return select(event, true)
    const place = step.place ? campus.places.get(step.place) : undefined
    if (place) flyTo(place.anchor)
  }

  const guide = createGuide(
    document.getElementById('guide')!,
    {
    onAsk: stopTour,
    onPlan(plan) {
      stopTour()
      let index = 0
      showStep(plan, index)
      tour = window.setInterval(() => (++index < plan.steps.length ? showStep(plan, index) : stopTour()), TOUR_DWELL_MS)
    },
    onStep(plan, index) {
      stopTour()
      showStep(plan, index)
    },
    },
    () => ({ samples }),
  )

  const sourceButtons = [...document.querySelectorAll<HTMLButtonElement>('[data-set-source]')]
  function setSamples(on: boolean) {
    samples = on
    for (const button of sourceButtons) button.setAttribute('aria-pressed', String((button.dataset.setSource === 'all') === on))
    load()
  }
  for (const button of sourceButtons) button.addEventListener('click', () => setSamples(button.dataset.setSource === 'all'))
  setSamples(samples)

  // --- events added by students -------------------------------------------------------------------
  /** Put a newly added event on the map, whether it came from this page or from someone else's. */
  function addEvent(event: CampusEvent) {
    if (events.some((existing) => existing.id === event.id)) return
    events = [...events, event].sort((a, b) => a.start - b.start)
    timeline.setEvents(events)
    refresh(timeline.time)
  }

  createSubmit(document.getElementById('add')!, [...campus.places.keys()].sort(), (event) => {
    const added = withDay(event)
    remember(added.id)
    addEvent(added)
    stopTour()
    select(added, true)
  })

  // The server pushes each new event to every open page.
  const stream = new EventSource('/api/stream')
  stream.addEventListener('added', (message) => addEvent(withDay(JSON.parse((message as MessageEvent).data))))
  stream.addEventListener('removed', (message) => removeEvent(JSON.parse((message as MessageEvent).data).id))

  const tabs = [...document.querySelectorAll<HTMLButtonElement>('[data-tab]')]
  for (const tab of tabs) {
    tab.addEventListener('click', () => {
      for (const other of tabs) {
        other.setAttribute('aria-selected', String(other === tab))
        document.getElementById(other.dataset.tab!)!.hidden = other !== tab
      }
    })
  }

  async function load() {
    try {
      const result = await loadEvents(samples)
      events = result.events
      timeline.setEvents(events)
      panel.showNote(result.stale ? "Showing the last copy of SF State's events listing; it could not be refreshed." : '')
    } catch (error) {
      panel.showNote(error instanceof Error ? error.message : 'The events could not be loaded.', load)
    }
    refresh(timeline.time)
  }
  setInterval(load, FEED_REFRESH_MS)
  // While the slider sits at "now", keep the live markers and the light moving with the clock.
  setInterval(() => refresh(timeline.time), 30 * 1000)

  // --- day / night ---------------------------------------------------------------------------
  const theme = blankTheme()
  const goal = () => (mode === 'auto' ? autoNight : mode === 'night' ? 1 : 0)
  let blend = goal()

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
    vignette.uniforms.uSaturation.value = theme.saturation
    traffic.setTheme(k)
    campus.setTheme(k)
    beacons.setTheme(k)
    renderer.shadowMap.needsUpdate = true
    // The panels and labels switch between their light and dark styles at the halfway point.
    const look = k >= 0.5 ? 'night' : 'day'
    if (document.body.dataset.theme !== look) document.body.dataset.theme = look
  }

  const buttons = [...document.querySelectorAll<HTMLButtonElement>('[data-set-theme]')]
  function setMode(next: ThemeMode) {
    mode = next
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.setTheme === next))
    try {
      localStorage.setItem(THEME_KEY, next)
    } catch {
      // Private windows can refuse storage; the control still works for this visit.
    }
  }
  for (const button of buttons) button.addEventListener('click', () => setMode(button.dataset.setTheme as ThemeMode))
  addEventListener('keydown', (event) => {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement
    if (event.key.toLowerCase() === 't' && !typing && !event.metaKey && !event.ctrlKey) setMode(blend >= 0.5 ? 'day' : 'night')
  })
  setMode(mode)
  applyTheme(THREE.MathUtils.smootherstep(blend, 0, 1))
  // Flush styles first so enabling transitions does not fade the panels in from the other theme.
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

    const target = goal()
    if (blend !== target) {
      const seconds = mode === 'auto' ? AUTO_TRANSITION_SECONDS : TRANSITION_SECONDS
      const stride = delta / seconds
      blend = Math.abs(target - blend) <= stride ? target : blend + Math.sign(target - blend) * stride
      applyTheme(THREE.MathUtils.smootherstep(blend, 0, 1))
    }

    if (flight) {
      flight.progress = Math.min(1, flight.progress + delta / FLIGHT_SECONDS)
      const eased = THREE.MathUtils.smootherstep(flight.progress, 0, 1)
      controls.target.lerpVectors(flight.fromTarget, flight.toTarget, eased)
      camera.position.lerpVectors(flight.fromEye, flight.toEye, eased)
      if (flight.progress >= 1) flight = null
    }

    env.uTime.value = time
    controls.update()
    sky.position.copy(camera.position)
    beacons.tick(time, delta)
    campus.tick(time)
    traffic.tick(delta, renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)))
    composer.render()
    labels.render(scene, camera)
  })
}

init()
