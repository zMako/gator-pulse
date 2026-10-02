import * as THREE from 'three'

export type ThemeName = 'day' | 'night'

export interface Theme {
  zenith: THREE.Color
  horizon: THREE.Color
  /** Horizon glow around the sun's azimuth. */
  glow: THREE.Color
  sunDir: THREE.Vector3
  sunColor: THREE.Color
  sunIntensity: number
  sunDisc: number
  hemiSky: THREE.Color
  hemiGround: THREE.Color
  hemiIntensity: number
  fogDensity: number
  exposure: number
  bloom: number
  bloomThreshold: number
  vignette: number
  saturation: number
  stars: number
}

const c = (r: number, g: number, b: number) => new THREE.Color(r, g, b)
// x = east, y = up, z = south.
const dir = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z).normalize()

export const DAY: Theme = {
  zenith: c(0.06, 0.23, 0.74),
  horizon: c(0.42, 0.62, 0.95),
  glow: c(0.3, 0.26, 0.18),
  sunDir: dir(-0.5, 0.72, 0.48),
  sunColor: c(1.0, 0.95, 0.86),
  sunIntensity: 3.1,
  sunDisc: 1,
  hemiSky: c(0.55, 0.72, 1.0),
  hemiGround: c(0.42, 0.4, 0.36),
  hemiIntensity: 0.6,
  fogDensity: 0.00026,
  exposure: 0.9,
  bloom: 0.16,
  bloomThreshold: 1.0,
  vignette: 0.18,
  saturation: 1.28,
  stars: 0,
}

// Blue hour: the sun is just down in the west, the campus is lit from inside.
export const NIGHT: Theme = {
  zenith: c(0.004, 0.007, 0.03),
  horizon: c(0.036, 0.028, 0.072),
  glow: c(0.85, 0.32, 0.12),
  sunDir: dir(-0.92, 0.3, 0.25),
  sunColor: c(1.0, 0.5, 0.3),
  sunIntensity: 1.0,
  sunDisc: 0,
  hemiSky: c(0.25, 0.32, 0.6),
  hemiGround: c(0.06, 0.05, 0.09),
  hemiIntensity: 0.9,
  fogDensity: 0.00034,
  exposure: 1.15,
  bloom: 0.46,
  bloomThreshold: 0.9,
  vignette: 0.45,
  saturation: 1,
  stars: 1,
}

/** Write the blend of DAY and NIGHT into `out`; k = 0 is day, 1 is night. */
export function mixTheme(out: Theme, k: number): Theme {
  for (const key of Object.keys(DAY) as (keyof Theme)[]) {
    const a = DAY[key]
    const b = NIGHT[key]
    if (a instanceof THREE.Color) (out[key] as THREE.Color).lerpColors(a, b as THREE.Color, k)
    else if (a instanceof THREE.Vector3) (out[key] as THREE.Vector3).lerpVectors(a, b as THREE.Vector3, k).normalize()
    else (out[key] as number) = THREE.MathUtils.lerp(a, b as number, k)
  }
  return out
}

export function blankTheme(): Theme {
  const out = {} as Record<string, unknown>
  for (const [key, value] of Object.entries(DAY)) out[key] = typeof value === 'number' ? value : value.clone()
  return out as unknown as Theme
}
