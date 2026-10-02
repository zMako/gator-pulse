import * as THREE from 'three'
import { CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js'
import { GLOW } from './campus'

export interface BeaconSpec {
  at: THREE.Vector3
  color: THREE.Color
  title: string
  where: string
  /** 0..1, drives beam height. */
  strength: number
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
      varying vec2 vUv;
      void main() {
        float a = uAlpha * (${fragmentAlpha});
        gl_FragColor = vec4(uColor * uGain * a, a * uSolid);
      }`,
  })
}

const BEAM_ALPHA = `pow(1.0 - vUv.y, 1.7) * (0.7 + 0.3 * sin(uTime * 2.2 + uPhase)) * (0.85 + 0.15 * sin(vUv.y * 40.0 - uTime * 3.0 + uPhase))`

interface Lit {
  material: THREE.ShaderMaterial
  nightGain: number
  dayGain: number
}

export class Beacons {
  readonly group = new THREE.Group()
  private lights: Lit[] = []
  private rings: { mesh: THREE.Mesh; material: THREE.ShaderMaterial; phase: number }[] = []
  private glows: THREE.SpriteMaterial[] = []

  constructor(specs: BeaconSpec[]) {
    const beam = new THREE.CylinderGeometry(0.35, 2.2, 1, 24, 1, true).translate(0, 0.5, 0)
    const halo = new THREE.CylinderGeometry(1.6, 6.5, 1, 24, 1, true).translate(0, 0.5, 0)
    const ring = new THREE.RingGeometry(0.9, 1, 64).rotateX(-Math.PI / 2)

    specs.forEach((spec, index) => {
      const node = new THREE.Group()
      node.position.copy(spec.at)
      const height = 60 + spec.strength * 130
      const phase = index * 1.7

      const shafts = [
        { geometry: beam, scale: 1, nightGain: 2.6, dayGain: 1.6 },
        { geometry: halo, scale: 0.75, nightGain: 0.5, dayGain: 0.45 },
      ]
      for (const shaft of shafts) {
        const material = lightMaterial(spec.color, BEAM_ALPHA)
        material.uniforms.uPhase.value = phase
        const mesh = new THREE.Mesh(shaft.geometry, material)
        mesh.scale.y = height * shaft.scale
        this.lights.push({ material, nightGain: shaft.nightGain, dayGain: shaft.dayGain })
        node.add(mesh)
      }

      for (let i = 0; i < 2; i++) {
        const material = lightMaterial(spec.color, '1.0')
        const mesh = new THREE.Mesh(ring, material)
        mesh.position.y = 0.4
        this.lights.push({ material, nightGain: 2.2, dayGain: 1.2 })
        this.rings.push({ mesh, material, phase: phase + i * 0.5 })
        node.add(mesh)
      }

      const glow = new THREE.SpriteMaterial({
        map: GLOW,
        color: spec.color.clone().multiplyScalar(1.8),
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      })
      const sprite = new THREE.Sprite(glow)
      sprite.scale.setScalar(34)
      sprite.position.y = 2
      this.glows.push(glow)
      node.add(sprite)

      const pill = document.createElement('div')
      pill.className = 'event'
      pill.style.setProperty('--c', `#${spec.color.getHexString()}`)
      pill.append(spec.title)
      const where = document.createElement('small')
      where.textContent = spec.where
      pill.append(where)
      const label = new CSS2DObject(pill)
      label.position.y = height * 0.42
      node.add(label)

      this.group.add(node)
    })
  }

  /** k = 0 is day, 1 is night. */
  setTheme(k: number) {
    for (const { material, nightGain, dayGain } of this.lights) {
      material.uniforms.uGain.value = THREE.MathUtils.lerp(dayGain, nightGain, k)
      material.uniforms.uSolid.value = 1 - k
    }
    for (const glow of this.glows) glow.opacity = k
  }

  tick(time: number) {
    for (const { material } of this.lights) material.uniforms.uTime.value = time
    for (const { mesh, material, phase } of this.rings) {
      const progress = (time * 0.45 + phase) % 1
      mesh.scale.setScalar(5 + progress * 30)
      material.uniforms.uAlpha.value = (1 - progress) * 0.9
    }
  }
}
