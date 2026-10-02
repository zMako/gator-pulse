// Fetches SF State's public student-organisation events feed and reshapes it for the map.
import { matchPlace } from './places.js'

const FEED = 'https://sfsu.campuslabs.com/engage/api/discovery/event/search'
const EVENT_PAGE = 'https://sfsu.campuslabs.com/engage/event/'
const IMAGE = 'https://se-images.campuslabs.com/clink/images/'
const FRESH_MS = 5 * 60 * 1000

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', ndash: '–', mdash: '—', hellip: '…' }

/** The feed's descriptions are HTML; the map shows them as plain text. */
function toText(html) {
  return (html ?? '')
    .replace(/<(br|\/p|\/h\d|\/li|\/div)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&([a-z]+);/gi, (whole, name) => ENTITIES[name.toLowerCase()] ?? whole)
    .replace(/[ \t\r]+/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

function reshape(raw) {
  const lat = raw.latitude == null ? null : Number(raw.latitude)
  const lon = raw.longitude == null ? null : Number(raw.longitude)
  const where = (raw.location ?? '').replace(/^location:\s*/i, '').trim()
  const { place, via } = matchPlace(where, lat, lon)
  const description = toText(raw.description)
  return {
    id: String(raw.id),
    title: (raw.name ?? '').trim(),
    start: Date.parse(raw.startsOn),
    end: Date.parse(raw.endsOn),
    where,
    place,
    placedBy: via,
    host: raw.organizationName ?? '',
    theme: raw.theme ?? 'Other',
    description: description.length > 700 ? `${description.slice(0, 700).trimEnd()}…` : description,
    image: raw.imagePath ? `${IMAGE}${raw.imagePath}?preset=med-w` : null,
    url: `${EVENT_PAGE}${raw.id}`,
    rsvps: raw.rsvpTotal ?? 0,
  }
}

let cache = null
let pending = null

async function download() {
  const query = new URLSearchParams({
    endsAfter: new Date().toISOString(),
    orderByField: 'endsOn',
    orderByDirection: 'ascending',
    status: 'Approved',
    take: '100',
  })
  const response = await fetch(`${FEED}?${query}`, {
    headers: { 'User-Agent': 'gator-pulse/0.1 (student hackathon project)', Accept: 'application/json' },
    signal: AbortSignal.timeout(12000),
  })
  if (!response.ok) throw new Error(`Events feed answered ${response.status}`)
  const body = await response.json()
  const events = body.value
    .map(reshape)
    .filter((event) => event.title && Number.isFinite(event.start) && Number.isFinite(event.end))
    .sort((a, b) => a.start - b.start)
  return { events, fetchedAt: Date.now() }
}

/** Events, at most five minutes old. If the feed is down, the last good copy is served as stale. */
export async function getEvents() {
  if (cache && Date.now() - cache.fetchedAt < FRESH_MS) return { ...cache, stale: false }
  pending ??= download().finally(() => (pending = null))
  try {
    cache = await pending
    return { ...cache, stale: false }
  } catch (error) {
    if (cache) return { ...cache, stale: true }
    throw error
  }
}
