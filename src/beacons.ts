import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { GLOW } from './campus'

export interface BeaconState {
  color: THREE.Color
  /** 0..1: how prominent the beam is. */
  level: number
  /** Happening at the moment being shown. */
  live: boolean
  title: string
  detail: string
}

// Premultiplied output with blend (ONE, 1 - srcAlpha): uSolid = 0 is purely additive light
// (night), uSolid = 1 is ordinary alpha blending so the beam still reads against a bright sky.
function lightMaterial(color: THREE.Color, fragmentAlpha: string) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uColor: { value: color },
      uTime: { value: 0 },
      uPhase: { value: 0 },
      uGain: { value: 1 },
      uAlpha: { value: 1 },
      uSolid: { value: 0 },
      uPulse: { value: 0.3 },
    },
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      uniform float uTime;
      uniform float uPhase;
      uniform float uGain;
      uniform float uAlpha;
      uniform float uSolid;
      uniform float uPulse;
      varying vec2 vUv;
      void main() {
        float a = uAlpha * (${fragmentAlpha});
        gl_FragColor = vec4(uColor * uGain * a, a * uSolid);
      }`,
  })
}

const BEAM_ALPHA = `pow(clamp(1.0 - vUv.y, 0.0, 1.0), 1.7) * (1.0 - uPulse + uPulse * sin(uTime * 2.2 + uPhase)) * (0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 3.0 + uPhase))`

const BEAM = new THREE.CylinderGeometry(0.35, 2.2, 1, 24, 1, true).translate(0, 0.5, 0)
const HALO = new THREE.CylinderGeometry(1.6, 6.5, 1, 24, 1, true).translate(0, 0.5, 0)
const RING = new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2)

interface Light {
  material: THREE.ShaderMaterial
  nightGain: number
  dayGain: number
}

interface Beacon {
  root: THREE.Group
  color: THREE.Color
  lights: Light[]
  shafts: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; scale: number }[]
  rings: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; phase: number }[]
  glow: THREE.SpriteMaterial
  label: CSS2DObject
  pill: HTMLButtonElement
  title: Text
  detail: HTMLElement
  shown: number
  goal: number
  height: number
  goalHeight: number
  live: boolean
}

/** One beam of light per building, restyled as the events there change. */
export class Beacons {
  readonly group = new THREE.Group()
  private beacons = new Map<string, Beacon>()
  private night = 1

  constructor(private onPick: (place: string) => void) {}

  /** Show or restyle the beacon at a place; pass null to fade it out. */
  set(place: string, at: THREE.Vector3, state: BeaconState | null) {
    let beacon = this.beacons.get(place)
    if (!state) {
      if (beacon) beacon.goal = 0
      return
    }
    if (!beacon) {
      beacon = this.create(place, at)
      this.beacons.set(place, beacon)
    }
    beacon.color.copy(state.color)
    beacon.glow.color.copy(state.color).multiplyScalar(1.8)
    beacon.goal = state.level
    beacon.goalHeight = 46 + state.level * 140
    beacon.live = state.live
    beacon.pill.style.setProperty('--c', `#${state.color.getHexString()}`)
    beacon.pill.dataset.live = String(state.live)
    beacon.title.data = state.title
    beacon.detail.textContent = state.detail
  }

  private create(place: string, at: THREE.Vector3): Beacon {
    const root = new THREE.Group()
    root.position.copy(at)
    const color = new THREE.Color()
    const phase = this.beacons.size * 1.7
    const lights: Light[] = []

    const shafts = [
      { geometry: BEAM, scale: 1, nightGain: 2.6, dayGain: 2.3 },
      { geometry: HALO, scale: 0.75, nightGain: 0.5, dayGain: 0.45 },
    ].map(({ geometry, scale, nightGain, dayGain }) => {
      const material = lightMaterial(color, BEAM_ALPHA)
      material.uniforms.uPhase.value = phase
      const mesh = new THREE.Mesh(geometry, material)
      lights.push({ material, nightGain, dayGain })
      root.add(mesh)
      return { mesh, material, scale }
    })

    const rings = [0, 0.5].map((offset) => {
      const material = lightMaterial(color, '1.0')
      const mesh = new THREE.Mesh(RING, material)
      mesh.position.y = 0.4
      lights.push({ material, nightGain: 2.2, dayGain: 1.2 })
      root.add(mesh)
      return { mesh, material, phase: phase + offset }
    })

    const glow = new THREE.SpriteMaterial({ map: GLOW, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending })
    const sprite = new THREE.Sprite(glow)
    sprite.scale.setScalar(34)
    sprite.position.y = 2
    root.add(sprite)

    const pill = document.createElement('button')
    pill.type = 'button'
    pill.className = 'event'
    const title = document.createTextNode('')
    const detail = document.createElement('small')
    pill.append(title, detail)
    pill.addEventListener('click', () => this.onPick(place))
    const label = new CSS2DObject(pill)
    root.add(label)

    root.visible = false
    label.visible = false
    this.group.add(root)
    const beacon: Beacon = { root, color, lights, shafts, rings, glow, label, pill, title, detail, shown: 0, goal: 0, height: 60, goalHeight: 60, live: false }
    this.applyTheme(beacon)
    return beacon
  }

  private applyTheme(beacon: Beacon) {
    for (const { material, nightGain, dayGain } of beacon.lights) {
      material.uniforms.uGain.value = THREE.MathUtils.lerp(dayGain, nightGain, this.night)
      material.uniforms.uSolid.value = 1 - this.night
    }
  }

  /** k = 0 is day, 1 is night. */
  setTheme(k: number) {
    this.night = k
    for (const beacon of this.beacons.values()) this.applyTheme(beacon)
  }

  tick(time: number, delta: number) {
    for (const beacon of this.beacons.values()) {
      beacon.shown += (beacon.goal - beacon.shown) * Math.min(1, delta * 5)
      beacon.height += (beacon.goalHeight - beacon.height) * Math.min(1, delta * 4)
      beacon.root.visible = beacon.shown > 0.02
      beacon.label.visible = beacon.shown > 0.1 && beacon.goal > 0
      if (!beacon.root.visible) continue

      for (const { mesh, material, scale } of beacon.shafts) {
        mesh.scale.y = beacon.height * scale
        material.uniforms.uTime.value = time
        material.uniforms.uAlpha.value = Math.min(1, beacon.shown * 1.4)
        material.uniforms.uPulse.value = beacon.live ? 0.3 : 0.06
      }
      for (const { mesh, material, phase } of beacon.rings) {
        const progress = (time * 0.45 + phase) % 1
        mesh.scale.setScalar(5 + progress * 30)
        material.uniforms.uAlpha.value = (1 - progress) * 0.9 * (beacon.live ? beacon.shown : beacon.shown * 0.4)
      }
      beacon.glow.opacity = this.night * beacon.shown
      beacon.label.position.y = beacon.height * 0.42
    }
  }
}
