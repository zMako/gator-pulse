// Matches the free-text location of an event ("Thornton Hall TH818", "The Depot") to a building
// on the map. Rules only for now; anything left unmatched is shown in the list but not on the map.
import { readFileSync } from 'node:fs'

const campus = JSON.parse(readFileSync(new URL('../public/campus.json', import.meta.url), 'utf8'))
const [originLat, originLon] = campus.origin
const M_PER_LAT = 110540
const M_PER_LON = 111320 * Math.cos((originLat * Math.PI) / 180)

/** Same projection as scripts/bake_campus.py: x = east, z = south, in metres. */
const project = (lat, lon) => [(lon - originLon) * M_PER_LON, -(lat - originLat) * M_PER_LAT]

function ringArea(ring) {
  let sum = 0
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) sum += ring[j] * ring[i + 1] - ring[i] * ring[j + 1]
  return Math.abs(sum) / 2
}

function inside(x, z, ring) {
  let hit = false
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const [x1, z1, x2, z2] = [ring[i], ring[i + 1], ring[j], ring[j + 1]]
    if (z1 > z !== z2 > z && x < ((x2 - x1) * (z - z1)) / (z2 - z1) + x1) hit = !hit
  }
  return hit
}

// One entry per named campus building; where a name repeats, the largest footprint wins
// (the client picks its map anchor the same way).
const buildings = new Map()
for (const b of campus.buildings) {
  if (!b.c || !b.n) continue
  const area = ringArea(b.r)
  if ((buildings.get(b.n)?.area ?? 0) >= area) continue
  let [cx, cz] = [0, 0]
  for (let i = 0; i < b.r.length; i += 2) {
    cx += b.r[i]
    cz += b.r[i + 1]
  }
  buildings.set(b.n, { name: b.n, ring: b.r, area, x: cx / (b.r.length / 2), z: cz / (b.r.length / 2) })
}

const normalise = (text) => ` ${text.toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim()} `

// Longest names first so "Science and Engineering Innovation Center" wins over "Science".
const byName = [...buildings.values()]
  .map((b) => ({ name: b.name, key: normalise(b.name) }))
  .sort((a, b) => b.key.length - a.key.length)

// Nicknames, rooms inside a building, and room-code prefixes.
const ALIASES = [
  [/ (the depot|depot|rosa parks|jack adams|malcolm x|student center|ccsc) /, 'Cesar Chavez Student Center'],
  [/ (library|lib ?\d{2,4}) /, 'J. Paul Leonard Library'],
  [/ (thornton|th ?\d{3}) /, 'Thornton Hall'],
  [/ (mashouf|mwc|wellness center) /, 'Mashouf Wellness Center'],
  [/ annex (2|ii) /, 'Temporary Annex 2'],
  [/ annex /, 'Temporary Annex 1'],
  [/ towers conference /, 'Towers Conference Center'],
  [/ seven hills /, 'Seven Hills Conference Center'],
  [/ (burk|bh ?\d{2,3}) /, 'Burk Hall'],
  [/ (hensill|hh ?\d{3}) /, 'Hensill Hall'],
  [/ (hum ?\d{3}) /, 'Humanities'],
  [/ (creative arts|ca ?\d{3}|mckenna|knuth) /, 'Creative Arts'],
  [/ (fa ?\d{3}) /, 'Fine Arts'],
  [/ (business building|bus ?\d{3}) /, 'Business'],
  [/ hss ?\d{0,4} /, 'HSS'],
  [/ (gym|gym ?\d{3}) /, 'Gymnasium'],
  [/ (ethnic studies|ep ?\d{3}) /, 'Ethnic Studies & Psychology'],
  [/ (adm ?\d{3}) /, 'Administration'],
  [/ (ssb|ssb ?\d{3}) /, 'Student Services'],
  [/ seic /, 'Science and Engineering Innovation Center'],
  [/ (science building|sci ?\d{3}) /, 'Science'],
  [/ (student health|health center) /, 'Gator Student Health Center'],
].filter(([, name]) => buildings.has(name))

/**
 * @param {string} location free text from the events feed
 * @param {number | null} lat
 * @param {number | null} lon
 * @returns {{ place: string | null, via: 'name' | 'alias' | 'coordinates' | null }}
 */
export function matchPlace(location, lat, lon) {
  const text = normalise(location ?? '')
  for (const { name, key } of byName) if (text.includes(key)) return { place: name, via: 'name' }
  for (const [pattern, name] of ALIASES) if (pattern.test(text)) return { place: name, via: 'alias' }

  if (Number.isFinite(lat) && Number.isFinite(lon)) {
    const [x, z] = project(lat, lon)
    let nearest = null
    for (const b of buildings.values()) {
      if (inside(x, z, b.ring)) return { place: b.name, via: 'coordinates' }
      const distance = Math.hypot(b.x - x, b.z - z)
      if (distance < 80 && (!nearest || distance < nearest.distance)) nearest = { name: b.name, distance }
    }
    if (nearest) return { place: nearest.name, via: 'coordinates' }
  }
  return { place: null, via: null }
}

export const placeNames = [...buildings.keys()]
