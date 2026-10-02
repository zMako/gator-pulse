import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import type { CampusData } from './campus'

// Cars on the main roads and people on the campus footpaths, wandering the path network.
// Purely decorative: positions are random, not real traffic.

type RGB = [number, number, number]

interface Route {
  /** x, z pairs. */
  points: number[]
  /** Distance from the start to each point. */
  along: number[]
  length: number
}

function insidePolygon(x: number, z: number, ring: number[]) {
  let hit = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [x1, z1, x2, z2] = [ring[i], ring[i + 1], ring[j], ring[j + 1]]
    if (z1 > z !== z2 > z && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) hit = !hit
  }
  return hit
}

function toRoute(points: number[]): Route {
  const along = [0]
  for (let i = 2; i < points.length; i += 2) {
    along.push(along[along.length - 1] + Math.hypot(points[i] - points[i - 2], points[i + 1] - points[i - 1]))
  }
  return { points, along, length: along[along.length - 1] }
}

const endKey = (route: Route, atEnd: boolean) => {
  const i = atEnd ? route.points.length - 2 : 0
  return `${route.points[i].toFixed(1)},${route.points[i + 1].toFixed(1)}`
}

interface MoverOptions {
  count: number
  speed: [number, number]
  /** Metres to the right of the path centre line, so opposing traffic keeps apart. */
  lane: number
  /** How quickly the heading swings round at a corner, per second. */
  turnRate: number
  /** Minimum starting gap between movers going the same way on the same route. */
  spacing: number
}

/** Moves a set of things along the routes; x/z and heading are refreshed by advance(). */
class Movers {
  readonly count: number
  readonly x: Float32Array
  readonly z: Float32Array
  readonly headingX: Float32Array
  readonly headingZ: Float32Array
  readonly speed: Float32Array
  private route: Int32Array
  private distance: Float32Array
  private direction: Int8Array
  private segment: Int32Array
  private joins = new Map<string, { route: number; atEnd: boolean }[]>()
  private started = false

  constructor(
    private routes: Route[],
    private options: MoverOptions,
    private random: () => number,
  ) {
    const count = (this.count = routes.length ? options.count : 0)
    this.x = new Float32Array(count)
    this.z = new Float32Array(count)
    this.headingX = new Float32Array(count)
    this.headingZ = new Float32Array(count)
    this.speed = new Float32Array(count)
    this.route = new Int32Array(count)
    this.distance = new Float32Array(count)
    this.direction = new Int8Array(count)
    this.segment = new Int32Array(count).fill(1)

    routes.forEach((route, index) => {
      for (const atEnd of [false, true]) {
        const key = endKey(route, atEnd)
        this.joins.set(key, [...(this.joins.get(key) ?? []), { route: index, atEnd }])
      }
    })

    const total = routes.reduce((sum, route) => sum + route.length, 0)
    for (let i = 0; i < count; i++) {
      for (let attempt = 0; attempt < 10; attempt++) {
        // Longer routes get proportionally more movers.
        let pick = random() * total
        let route = 0
        while (route < routes.length - 1 && pick > routes[route].length) pick -= routes[route++].length
        this.route[i] = route
        this.distance[i] = random() * routes[route].length
        this.direction[i] = random() < 0.5 ? 1 : -1
        let crowded = false
        for (let j = 0; j < i && !crowded; j++) {
          crowded =
            this.route[j] === route &&
            this.direction[j] === this.direction[i] &&
            Math.abs(this.distance[j] - this.distance[i]) < options.spacing
        }
        if (!crowded) break
      }
      this.speed[i] = THREE.MathUtils.lerp(options.speed[0], options.speed[1], random())
    }
    this.advance(0)
  }

  advance(delta: number) {
    const { routes, options } = this
    const swing = this.started ? Math.min(1, delta * options.turnRate) : 1
    for (let i = 0; i < this.count; i++) {
      let route = routes[this.route[i]]
      let distance = this.distance[i] + this.direction[i] * this.speed[i] * delta
      if (distance < 0 || distance > route.length) {
        // At the end of a path: carry on along a connected one, or turn back.
        const exits = (this.joins.get(endKey(route, distance > 0)) ?? []).filter((exit) => exit.route !== this.route[i])
        if (exits.length) {
          const exit = exits[Math.floor(this.random() * exits.length)]
          this.route[i] = exit.route
          route = routes[exit.route]
          this.direction[i] = exit.atEnd ? -1 : 1
          distance = exit.atEnd ? route.length : 0
        } else {
          this.direction[i] = distance > 0 ? -1 : 1
          distance = THREE.MathUtils.clamp(distance, 0, route.length)
        }
        this.segment[i] = 1
      }
      this.distance[i] = distance

      const { along, points } = route
      let segment = Math.min(this.segment[i], along.length - 1)
      while (segment < along.length - 1 && along[segment] < distance) segment++
      while (segment > 1 && along[segment - 1] > distance) segment--
      this.segment[i] = segment

      const x1 = points[segment * 2 - 2]
      const z1 = points[segment * 2 - 1]
      const span = along[segment] - along[segment - 1] || 1
      const dx = (points[segment * 2] - x1) / span
      const dz = (points[segment * 2 + 1] - z1) / span
      const run = distance - along[segment - 1]
      const direction = this.direction[i]
      this.x[i] = x1 + dx * run - dz * options.lane * direction
      this.z[i] = z1 + dz * run + dx * options.lane * direction

      const hx = this.headingX[i] + (dx * direction - this.headingX[i]) * swing
      const hz = this.headingZ[i] + (dz * direction - this.headingZ[i]) * swing
      const length = Math.hypot(hx, hz) || 1
      this.headingX[i] = hx / length
      this.headingZ[i] = hz / length
    }
    this.started = true
  }
}

// --- geometry helpers ------------------------------------------------------------------------

/** A box with flat vertex colours; `top` recolours the upper face, `taper` narrows it. */
function box(size: RGB, at: RGB, color: RGB, top: RGB = color, taper = 1) {
  const geometry = new THREE.BoxGeometry(...size).toNonIndexed()
  const position = geometry.attributes.position
  if (taper !== 1) {
    for (let i = 0; i < position.count; i++) {
      if (position.getY(i) > 0) position.setXYZ(i, position.getX(i) * taper, position.getY(i), position.getZ(i) * 0.9)
    }
  }
  geometry.translate(...at)
  geometry.computeVertexNormals()
  geometry.deleteAttribute('uv')
  // Non-indexed box faces come six vertices at a time: +x, -x, +y, -y, +z, -z.
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) colors.set(i >= 12 && i < 18 ? top : color, i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  return geometry
}

/** Flat triangles on the ground from [x, z, r, g, b, a] vertices, for light pools and soft shadows. */
function flat(vertices: number[][], y: number, alpha: boolean) {
  const position: number[] = []
  const normal: number[] = []
  const color: number[] = []
  for (const [x, z, r, g, b, a] of vertices) {
    position.push(x, y, z)
    normal.push(0, 1, 0)
    color.push(r, g, b)
    if (alpha) color.push(a)
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  geometry.setAttribute('normal', new THREE.Float32BufferAttribute(normal, 3))
  geometry.setAttribute('color', new THREE.Float32BufferAttribute(color, alpha ? 4 : 3))
  return geometry
}

/**
 * A patch of light on the ground from x = near to x = far, widening as it goes. Finely divided
 * so the vertex colours fade smoothly to black, which is invisible when blended additively.
 */
function lightPool(near: number, far: number, nearHalfWidth: number, farHalfWidth: number, color: RGB) {
  const [steps, lanes] = [8, 6]
  const corner = (i: number, j: number) => {
    const u = i / steps
    const v = (j / lanes) * 2 - 1
    const strength = Math.pow(1 - u, 1.6) * Math.pow(1 - v * v, 1.5)
    const halfWidth = THREE.MathUtils.lerp(nearHalfWidth, farHalfWidth, u)
    return [THREE.MathUtils.lerp(near, far, u), v * halfWidth, color[0] * strength, color[1] * strength, color[2] * strength]
  }
  const vertices: number[][] = []
  for (let i = 0; i < steps; i++) {
    for (let j = 0; j < lanes; j++) {
      vertices.push(corner(i, j), corner(i + 1, j), corner(i + 1, j + 1), corner(i, j), corner(i + 1, j + 1), corner(i, j + 1))
    }
  }
  return flat(vertices, 0.2, false)
}

/** A soft dark ellipse: opaque-ish in the middle, fading to nothing at the rim. */
function softShadow(radiusX: number, radiusZ: number, strength: number) {
  const vertices: number[][] = []
  const steps = 10
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * Math.PI * 2
    const b = ((i + 1) / steps) * Math.PI * 2
    vertices.push([0, 0, 1, 1, 1, strength])
    vertices.push([Math.cos(b) * radiusX, Math.sin(b) * radiusZ, 1, 1, 1, 0])
    vertices.push([Math.cos(a) * radiusX, Math.sin(a) * radiusZ, 1, 1, 1, 0])
  }
  return flat(vertices, 0.03, true)
}

function shadowMaterial() {
  return new THREE.MeshBasicMaterial({
    color: 0x000000,
    vertexColors: true,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  })
}

/** An instanced mesh that follows another one's instances. */
function follower(leader: THREE.InstancedMesh, geometry: THREE.BufferGeometry, material: THREE.Material) {
  const mesh = new THREE.InstancedMesh(geometry, material, leader.count)
  mesh.instanceMatrix = leader.instanceMatrix
  mesh.frustumCulled = false
  return mesh
}

interface Part {
  objects: THREE.Object3D[]
  setTheme(k: number): void
  tick(delta: number, time: number, pixelsPerUnit: number): void
}

// --- cars --------------------------------------------------------------------------------------

const CAR_PAINT: RGB[] = [
  [0.9, 0.9, 0.91], [0.9, 0.9, 0.91], [0.62, 0.64, 0.67], [0.62, 0.64, 0.67], [0.06, 0.06, 0.07], [0.06, 0.06, 0.07],
  [0.3, 0.31, 0.34], [0.62, 0.07, 0.07], [0.08, 0.2, 0.5], [0.1, 0.3, 0.22], [0.78, 0.7, 0.55],
]
const GLASS: RGB = [0.05, 0.07, 0.09]
const TYRE: RGB = [0.03, 0.03, 0.035]
const WHITE: RGB = [1, 1, 1]
const CAR_SPEED = 11.5

function buildCars(routes: Route[], random: () => number): Part {
  // All cars share one speed so they never drive through each other along a road.
  const movers = new Movers(routes, { count: 110, speed: [CAR_SPEED, CAR_SPEED], lane: 2.4, turnRate: 5, spacing: 14 }, random)
  const count = movers.count

  // Model space: nose points along +x, the origin sits on the road under the middle of the car.
  const body = mergeGeometries([
    box([3.9, 0.3, 1.84], [0, 0.15, 0], TYRE),
    box([4.4, 0.62, 1.82], [0, 0.61, 0], WHITE),
    box([2.4, 0.5, 1.62], [-0.25, 1.17, 0], GLASS, WHITE, 0.72),
  ])
  const bodies = new THREE.InstancedMesh(body, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 }), count)
  bodies.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  bodies.frustumCulled = false
  bodies.receiveShadow = true

  const lamp: RGB = [3.2, 3.0, 2.4]
  const tail: RGB = [2.8, 0.14, 0.1]
  const lights = follower(
    bodies,
    mergeGeometries([
      box([0.14, 0.24, 0.5], [2.2, 0.7, 0.58], lamp),
      box([0.14, 0.24, 0.5], [2.2, 0.7, -0.58], lamp),
      box([0.14, 0.2, 0.46], [-2.2, 0.74, 0.6], tail),
      box([0.14, 0.2, 0.46], [-2.2, 0.74, -0.6], tail),
      // Light thrown on the road: a long warm pool ahead and a short red one behind.
      lightPool(2.3, 17, 0.9, 3.8, [0.55, 0.49, 0.34]),
      lightPool(-2.3, -5.6, 0.9, 1.5, [0.55, 0.03, 0.02]),
    ]),
    new THREE.MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      fog: false,
    }),
  )
  const lightMaterial = lights.material as THREE.MeshBasicMaterial
  const shadows = follower(bodies, softShadow(3.1, 1.6, 0.55), shadowMaterial())
  const shadowLook = shadows.material as THREE.MeshBasicMaterial

  const scale = new Float32Array(count * 3)
  const color = new THREE.Color()
  for (let i = 0; i < count; i++) {
    // About one vehicle in fourteen is a van.
    const van = random() < 0.07
    scale.set(van ? [1.3, 1.55, 1.12] : [0.94 + random() * 0.14, 0.95 + random() * 0.12, 1], i * 3)
    bodies.setColorAt(i, color.setRGB(...(van ? CAR_PAINT[0] : CAR_PAINT[Math.floor(random() * CAR_PAINT.length)])))
  }

  const write = () => {
    const m = bodies.instanceMatrix.array as Float32Array
    for (let i = 0; i < count; i++) {
      const [hx, hz] = [movers.headingX[i], movers.headingZ[i]]
      const [sx, sy, sz] = [scale[i * 3], scale[i * 3 + 1], scale[i * 3 + 2]]
      // Rotation about the vertical that turns +x onto the heading, with per-axis scale.
      m.set([hx * sx, 0, hz * sx, 0, 0, sy, 0, 0, -hz * sz, 0, hx * sz, 0, movers.x[i], 0.33, movers.z[i], 1], i * 16)
    }
    bodies.instanceMatrix.needsUpdate = true
  }
  write()

  return {
    objects: [shadows, bodies, lights],
    setTheme(k) {
      lightMaterial.opacity = k
      lights.visible = k > 0.02
      shadowLook.opacity = 1 - k
      shadows.visible = k < 0.98
    },
    tick(delta) {
      movers.advance(delta)
      write()
    },
  }
}

// --- people ------------------------------------------------------------------------------------

const CLOTHES: RGB[] = [
  [0.85, 0.16, 0.14], [0.98, 0.72, 0.1], [0.1, 0.38, 0.9], [0.93, 0.93, 0.93], [0.92, 0.38, 0.7],
  [0.08, 0.62, 0.55], [0.16, 0.16, 0.2], [0.45, 0.2, 0.7], [0.95, 0.5, 0.12],
]
const SKIN: RGB[] = [[1.0, 0.8, 0.66], [0.87, 0.64, 0.48], [0.68, 0.46, 0.32], [0.45, 0.3, 0.21], [0.32, 0.21, 0.15]]
// Larger than life so a person still reads from the air.
const PERSON_SCALE = 1.5

function colored(geometry: THREE.BufferGeometry, pick: (y: number) => RGB) {
  const position = geometry.attributes.position
  const colors = new Float32Array(position.count * 3)
  for (let i = 0; i < position.count; i++) colors.set(pick(position.getY(i)), i * 3)
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3))
  geometry.deleteAttribute('uv')
  return geometry
}

function buildPeople(routes: Route[], random: () => number): Part {
  const movers = new Movers(routes, { count: 420, speed: [1.0, 1.7], lane: 0.5, turnRate: 8, spacing: 0 }, random)
  const count = movers.count

  // Tops take a clothing colour per person; legs and head take a skin tone (the legs stay dark).
  const tops = new THREE.InstancedMesh(
    colored(new THREE.CapsuleGeometry(0.21, 0.4, 2, 6).translate(0, 1.08, 0), () => WHITE),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
    count,
  )
  tops.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  tops.frustumCulled = false
  tops.receiveShadow = true
  const rest = follower(
    tops,
    mergeGeometries([
      colored(new THREE.CylinderGeometry(0.17, 0.14, 0.82, 6).translate(0, 0.41, 0), () => [0.16, 0.17, 0.22]),
      // Hair on the crown, skin below.
      colored(new THREE.SphereGeometry(0.15, 6, 5).translate(0, 1.56, 0), (y) => (y > 1.58 ? [0.1, 0.08, 0.07] : WHITE)),
    ]),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 }),
  )
  rest.receiveShadow = true
  const shadows = follower(tops, softShadow(0.55, 0.55, 0.5), shadowMaterial())
  const shadowLook = shadows.material as THREE.MeshBasicMaterial

  const size = new Float32Array(count)
  const stride = new Float32Array(count)
  const dotColor = new Float32Array(count * 3)
  const color = new THREE.Color()
  for (let i = 0; i < count; i++) {
    size[i] = PERSON_SCALE * (0.9 + random() * 0.2)
    stride[i] = random() * Math.PI * 2
    const clothes = CLOTHES[Math.floor(random() * CLOTHES.length)]
    tops.setColorAt(i, color.setRGB(...clothes))
    rest.setColorAt(i, color.setRGB(...SKIN[Math.floor(random() * SKIN.length)]))
    dotColor.set(clothes, i * 3)
  }

  // From far away a person is a pixel or two, so each one also carries a point: a speck of
  // clothing colour by day (only at a distance) and a small warm light at night.
  const dotPosition = new THREE.BufferAttribute(new Float32Array(count * 3), 3)
  dotPosition.setUsage(THREE.DynamicDrawUsage)
  const dotGeometry = new THREE.BufferGeometry()
  dotGeometry.setAttribute('position', dotPosition)
  dotGeometry.setAttribute('color', new THREE.BufferAttribute(dotColor, 3))
  const dotMaterial = new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    // Premultiplied output: solid dots by day, additive glows at night.
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    uniforms: { uNight: { value: 1 }, uPixelsPerUnit: { value: 1000 }, uNightColor: { value: new THREE.Color(1.5, 1.2, 0.8) } },
    vertexShader: /* glsl */ `
      attribute vec3 color;
      uniform float uNight;
      uniform float uPixelsPerUnit;
      varying vec3 vColor;
      varying float vFar;
      void main() {
        vColor = color;
        float size = mix(1.7, 4.6, uNight);
        // A point sprite has one depth, so its centre rides half a sprite above the ground.
        vec4 mv = modelViewMatrix * vec4(position.x, max(size * 0.52, 1.6), position.z, 1.0);
        vFar = smoothstep(170.0, 430.0, -mv.z);
        gl_PointSize = max(size * uPixelsPerUnit / -mv.z, mix(2.6, 1.5, uNight));
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform float uNight;
      uniform vec3 uNightColor;
      varying vec3 vColor;
      varying float vFar;
      void main() {
        float d = length(gl_PointCoord - 0.5) * 2.0;
        float disc = (1.0 - smoothstep(0.7, 0.95, d)) * vFar;
        float glow = pow(max(1.0 - d, 0.0), 2.2);
        float a = mix(disc, glow, uNight);
        gl_FragColor = vec4(mix(vColor, uNightColor, uNight) * a, a * (1.0 - uNight));
      }`,
  })
  const dots = new THREE.Points(dotGeometry, dotMaterial)
  dots.frustumCulled = false

  const write = (time: number) => {
    const m = tops.instanceMatrix.array as Float32Array
    const d = dotPosition.array as Float32Array
    for (let i = 0; i < count; i++) {
      const s = size[i]
      const bob = Math.abs(Math.sin(time * movers.speed[i] * 4.4 + stride[i])) * 0.09
      m.set([s, 0, 0, 0, 0, s, 0, 0, 0, 0, s, 0, movers.x[i], 0.4 + bob, movers.z[i], 1], i * 16)
      d[i * 3] = movers.x[i]
      d[i * 3 + 2] = movers.z[i]
    }
    tops.instanceMatrix.needsUpdate = true
    dotPosition.needsUpdate = true
  }
  write(0)

  return {
    objects: [shadows, tops, rest, dots],
    setTheme(k) {
      dotMaterial.uniforms.uNight.value = k
      shadowLook.opacity = 1 - k
      shadows.visible = k < 0.98
    },
    tick(delta, time, pixelsPerUnit) {
      movers.advance(delta)
      dotMaterial.uniforms.uPixelsPerUnit.value = pixelsPerUnit
      write(time)
    },
  }
}

// -------------------------------------------------------------------------------------------------

export interface Traffic {
  group: THREE.Group
  /** k = 0 is day, 1 is night. */
  setTheme(k: number): void
  tick(delta: number, pixelsPerUnit: number): void
}

export function buildTraffic(data: CampusData, random: () => number): Traffic {
  const onCampus = (points: number[]) => {
    const mid = Math.floor(points.length / 4) * 2
    return !data.campus.length || insidePolygon(points[mid], points[mid + 1], data.campus)
  }
  const routes = (kind: number, keep: (points: number[]) => boolean) =>
    data.paths
      .filter((path) => path.t === kind && keep(path.p))
      .map((path) => toRoute(path.p))
      .filter((route) => route.length > 6)

  const parts = [
    buildCars(routes(0, (points) => Math.hypot(points[0], points[1]) < 1300), random),
    buildPeople(routes(2, onCampus), random),
  ]
  const group = new THREE.Group()
  for (const part of parts) group.add(...part.objects)
  let time = 0
  return {
    group,
    setTheme: (k) => parts.forEach((part) => part.setTheme(k)),
    tick(delta, pixelsPerUnit) {
      time += delta
      for (const part of parts) part.tick(delta, time, pixelsPerUnit)
    },
  }
}
