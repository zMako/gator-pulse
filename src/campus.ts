import * as THREE from 'three'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'
import { facadeMaterial } from './facade'

export interface Building {
  n?: string
  h: number
  c: number
  r: number[]
  k?: number[][]
}

export interface CampusData {
  buildings: Building[]
  paths: { t: number; p: number[] }[]
  areas: { t: 'g' | 'p' | 'w'; r: number[] }[]
  trees: number[]
  campus: number[]
}

export interface Place {
  name: string
  /** A point on the roof that is guaranteed to be inside the footprint. */
  anchor: THREE.Vector3
  area: number
}

export interface Campus {
  group: THREE.Group
  places: Map<string, Place>
  /** k = 0 is day, 1 is night. */
  setTheme(k: number): void
}

type RGB = [number, number, number]
type Surface = THREE.MeshLambertMaterial | THREE.MeshStandardMaterial
interface Look {
  material: Surface
  day: THREE.Color
  night: THREE.Color
  glow?: THREE.Color
}

export function seededRandom(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function points(flat: number[]) {
  const out: THREE.Vector2[] = []
  for (let i = 0; i < flat.length; i += 2) out.push(new THREE.Vector2(flat[i], flat[i + 1]))
  return out
}

// Ground coords are (x, z). Shapes are authored as (x, -z) so that rotateX(-90deg) puts them
// back on the ground with their front face up.
function toShape(ring: number[], holes: number[][] = []) {
  const flip = (flat: number[]) => points(flat).map((p) => new THREE.Vector2(p.x, -p.y))
  const shape = new THREE.Shape(flip(ring))
  for (const hole of holes) shape.holes.push(new THREE.Path(flip(hole)))
  return shape
}

function withInfo(geometry: THREE.BufferGeometry, seed: number, height: number, campus: number) {
  const count = geometry.attributes.position.count
  const info = new Float32Array(count * 3)
  for (let i = 0; i < count; i++) info.set([seed, height, campus], i * 3)
  geometry.setAttribute('aInfo', new THREE.BufferAttribute(info, 3))
  return geometry
}

interface Triangle {
  a: THREE.Vector2
  b: THREE.Vector2
  c: THREE.Vector2
  area: number
}

function roofTriangles(building: Building): Triangle[] {
  const contour = points(building.r)
  const holes = (building.k ?? []).map(points)
  const all = contour.concat(...holes)
  return THREE.ShapeUtils.triangulateShape(contour, holes)
    .map(([i, j, k]) => {
      const [a, b, c] = [all[i], all[j], all[k]]
      return { a, b, c, area: Math.abs((b.x - a.x) * (c.y - a.y) - (c.x - a.x) * (b.y - a.y)) / 2 }
    })
    .sort((p, q) => q.area - p.area)
}

function ribbons(paths: CampusData['paths'], kind: number, halfWidth: number, y: number) {
  const position: number[] = []
  for (const path of paths) {
    if (path.t !== kind) continue
    const p = path.p
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [x1, z1, x2, z2] = [p[i], p[i + 1], p[i + 2], p[i + 3]]
      const length = Math.hypot(x2 - x1, z2 - z1)
      if (length < 0.01) continue
      const nx = (-(z2 - z1) / length) * halfWidth
      const nz = ((x2 - x1) / length) * halfWidth
      position.push(x1 + nx, y, z1 + nz, x2 + nx, y, z2 + nz, x1 - nx, y, z1 - nz)
      position.push(x2 + nx, y, z2 + nz, x2 - nx, y, z2 - nz, x1 - nx, y, z1 - nz)
    }
  }
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(position, 3))
  const normal = new Float32Array(position.length)
  for (let i = 1; i < normal.length; i += 3) normal[i] = 1
  geometry.setAttribute('normal', new THREE.BufferAttribute(normal, 3))
  return geometry
}

function glowTexture() {
  const canvas = document.createElement('canvas')
  canvas.width = canvas.height = 64
  const ctx = canvas.getContext('2d')!
  const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32)
  gradient.addColorStop(0, 'rgba(255,255,255,1)')
  gradient.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  gradient.addColorStop(1, 'rgba(255,255,255,0)')
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, 64, 64)
  return new THREE.CanvasTexture(canvas)
}

export const GLOW = glowTexture()

export function buildCampus(data: CampusData): Campus {
  const group = new THREE.Group()
  const places = new Map<string, Place>()
  const random = seededRandom(11)
  const looks: Look[] = []

  const surface = <M extends Surface>(material: M, day: RGB, night: RGB, glow?: RGB): M => {
    looks.push({
      material,
      day: new THREE.Color(...day),
      night: new THREE.Color(...night),
      glow: glow && new THREE.Color(...glow),
    })
    return material
  }
  const lay = (geometry: THREE.BufferGeometry, material: THREE.Material) => {
    const mesh = new THREE.Mesh(geometry, material)
    mesh.receiveShadow = true
    group.add(mesh)
  }

  // --- ground layers, stacked a few centimetres apart ---------------------------------------
  lay(
    new THREE.CircleGeometry(26000, 96).rotateX(-Math.PI / 2),
    surface(new THREE.MeshLambertMaterial(), [0.45, 0.43, 0.4], [0.12, 0.145, 0.22]),
  )
  if (data.campus.length) {
    lay(
      new THREE.ShapeGeometry(toShape(data.campus)).rotateX(-Math.PI / 2).translate(0, 0.08, 0),
      surface(new THREE.MeshLambertMaterial(), [0.62, 0.56, 0.47], [0.2, 0.235, 0.36]),
    )
  }

  const areaLayers = {
    g: { y: 0.16, material: surface(new THREE.MeshLambertMaterial(), [0.2, 0.43, 0.12], [0.1, 0.4, 0.28]) },
    p: { y: 0.24, material: surface(new THREE.MeshLambertMaterial(), [0.16, 0.52, 0.18], [0.13, 0.78, 0.44]) },
    w: {
      y: 0.2,
      material: surface(new THREE.MeshStandardMaterial({ roughness: 0.22 }), [0.06, 0.3, 0.6], [0.09, 0.28, 0.7]),
    },
  }
  for (const kind of ['g', 'p', 'w'] as const) {
    const shapes = data.areas.filter((a) => a.t === kind && a.r.length >= 6).map((a) => new THREE.ShapeGeometry(toShape(a.r)))
    if (shapes.length) lay(mergeGeometries(shapes).rotateX(-Math.PI / 2).translate(0, areaLayers[kind].y, 0), areaLayers[kind].material)
  }

  // Main roads, side roads, footpaths. Footpaths glow amber at night.
  lay(ribbons(data.paths, 0, 5.5, 0.3), surface(new THREE.MeshLambertMaterial(), [0.16, 0.17, 0.19], [0.3, 0.34, 0.5]))
  lay(ribbons(data.paths, 1, 3, 0.32), surface(new THREE.MeshLambertMaterial(), [0.22, 0.23, 0.25], [0.25, 0.28, 0.44]))
  lay(
    ribbons(data.paths, 2, 0.85, 0.38),
    surface(new THREE.MeshLambertMaterial(), [0.8, 0.71, 0.58], [0.3, 0.24, 0.18], [0.6, 0.35, 0.13]),
  )

  // --- street lights (night only) ------------------------------------------------------------
  const lampPosition: number[] = []
  for (const path of data.paths) {
    if (path.t === 2) continue
    const p = path.p
    let offset = random() * 30
    for (let i = 0; i + 3 < p.length; i += 2) {
      const [x1, z1, x2, z2] = [p[i], p[i + 1], p[i + 2], p[i + 3]]
      const length = Math.hypot(x2 - x1, z2 - z1)
      let d = offset
      for (; d < length; d += 30) lampPosition.push(x1 + ((x2 - x1) * d) / length, 5.5, z1 + ((z2 - z1) * d) / length)
      offset = d - length
    }
  }
  const lampGeometry = new THREE.BufferGeometry()
  lampGeometry.setAttribute('position', new THREE.Float32BufferAttribute(lampPosition, 3))
  const lampMaterial = new THREE.PointsMaterial({
    map: GLOW,
    color: new THREE.Color(1.6, 1.05, 0.55),
    size: 11,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    fog: false,
  })
  const lamps = new THREE.Points(lampGeometry, lampMaterial)
  group.add(lamps)

  // --- buildings -------------------------------------------------------------------------------
  const solids: THREE.BufferGeometry[] = []
  const edgePosition: number[] = []
  data.buildings.forEach((building, index) => {
    if (building.r.length < 6) return
    const seed = (index * 0.6180339887) % 1
    const geometry = withInfo(
      new THREE.ExtrudeGeometry(toShape(building.r, building.k), { depth: building.h, bevelEnabled: false }).rotateX(-Math.PI / 2),
      seed,
      building.h,
      building.c,
    )
    solids.push(geometry)
    if (!building.c) return

    edgePosition.push(...(new THREE.EdgesGeometry(geometry, 28).attributes.position.array as Float32Array))
    const triangles = roofTriangles(building)
    if (!triangles.length) return
    const area = triangles.reduce((sum, t) => sum + t.area, 0)
    const top = triangles[0]
    const anchor = new THREE.Vector3((top.a.x + top.b.x + top.c.x) / 3, building.h, (top.a.y + top.b.y + top.c.y) / 3)
    if (building.n && (places.get(building.n)?.area ?? 0) < area) places.set(building.n, { name: building.n, anchor, area })

    // Rooftop plant: boxes placed inside the largest roof triangles break up the flat roofline.
    if (area < 500) return
    for (const t of triangles.slice(0, area > 2500 ? 4 : 2)) {
      if (t.area < 60) continue
      const size = Math.min(8, Math.max(2.2, Math.sqrt(t.area) * 0.28))
      const height = 1.4 + random() * 2.4
      const w1 = 0.25 + random() * 0.2
      const w2 = 0.25 + random() * 0.2
      const x = t.a.x * w1 + t.b.x * w2 + t.c.x * (1 - w1 - w2)
      const z = t.a.y * w1 + t.b.y * w2 + t.c.y * (1 - w1 - w2)
      const box = new THREE.BoxGeometry(size * (0.7 + random() * 0.6), height, size * (0.7 + random() * 0.6))
        .toNonIndexed()
        .rotateY(random() * Math.PI)
        .translate(x, building.h + height / 2, z)
      solids.push(withInfo(box, seed, 0, 1))
    }
  })

  const buildings = new THREE.Mesh(mergeGeometries(solids), facadeMaterial())
  buildings.castShadow = true
  buildings.receiveShadow = true
  group.add(buildings)

  // Campus outlines: a glowing trace at night, a pencil line by day.
  const edgeGeometry = new THREE.BufferGeometry()
  edgeGeometry.setAttribute('position', new THREE.Float32BufferAttribute(edgePosition, 3))
  const nightEdges = new THREE.LineBasicMaterial({
    color: new THREE.Color(0.5, 0.85, 1.25),
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  })
  const dayEdges = new THREE.LineBasicMaterial({ color: new THREE.Color(0.1, 0.11, 0.14), transparent: true, depthWrite: false })
  group.add(new THREE.LineSegments(edgeGeometry, nightEdges), new THREE.LineSegments(edgeGeometry, dayEdges))

  // --- trees -----------------------------------------------------------------------------------
  const count = data.trees.length / 2
  const canopyMaterial = surface(new THREE.MeshStandardMaterial({ flatShading: true, roughness: 1 }), [1, 1, 1], [1.5, 1.9, 2.3])
  const trunkMaterial = surface(new THREE.MeshLambertMaterial(), [0.3, 0.22, 0.16], [0.3, 0.26, 0.3])
  const canopies = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 1), canopyMaterial, count)
  const trunks = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.22, 0.34, 1, 6).translate(0, 0.5, 0), trunkMaterial, count)
  const matrix = new THREE.Matrix4()
  const turn = new THREE.Quaternion()
  const color = new THREE.Color()
  for (let i = 0; i < count; i++) {
    const [x, z] = [data.trees[i * 2], data.trees[i * 2 + 1]]
    const size = 2.3 + random() * 2.4
    const trunk = 1.6 + random() * 1.4
    turn.setFromAxisAngle(THREE.Object3D.DEFAULT_UP, random() * Math.PI * 2)
    matrix.compose(new THREE.Vector3(x, trunk + size * 0.95, z), turn, new THREE.Vector3(size, size * (1.15 + random() * 0.5), size))
    canopies.setMatrixAt(i, matrix)
    // It is October: roughly one tree in eight has turned.
    const turned = random() < 0.12
    if (turned) color.setRGB(0.42 + random() * 0.2, 0.2 + random() * 0.12, 0.04 + random() * 0.04)
    else color.setRGB(0.09 + random() * 0.08, 0.25 + random() * 0.14, 0.08 + random() * 0.06)
    canopies.setColorAt(i, color)
    matrix.compose(new THREE.Vector3(x, 0, z), turn, new THREE.Vector3(1, trunk + size * 0.5, 1))
    trunks.setMatrixAt(i, matrix)
  }
  canopies.castShadow = true
  canopies.receiveShadow = true
  group.add(canopies, trunks)

  return {
    group,
    places,
    setTheme(k) {
      for (const look of looks) {
        look.material.color.lerpColors(look.day, look.night, k)
        if (look.glow) look.material.emissive.copy(look.glow).multiplyScalar(k)
      }
      lampMaterial.opacity = k
      lamps.visible = k > 0.01
      nightEdges.opacity = 0.42 * k
      dayEdges.opacity = 0.3 * (1 - k)
    },
  }
}
