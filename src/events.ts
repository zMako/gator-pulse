import * as THREE from 'three'

export interface CampusEvent {
  id: string
  title: string
  start: number
  end: number
  /** Location exactly as the organiser wrote it. */
  where: string
  /** Name of the building it was matched to, or null when it is not on the map. */
  place: string | null
  host: string
  theme: string
  description: string
  image: string | null
  url: string
  rsvps: number
  /** Campus-local calendar day of the start, YYYY-MM-DD. */
  day: string
}

export type EventState = 'live' | 'soon' | 'done'

export const stateAt = (event: CampusEvent, time: number): EventState =>
  time >= event.end ? 'done' : time >= event.start ? 'live' : 'soon'

// Everything is shown in campus time, whatever time zone the viewer is in.
const ZONE = 'America/Los_Angeles'
const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const clockFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit', hourCycle: 'h23' })
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' })
const dateFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short', month: 'short', day: 'numeric' })
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'short' })
const dayNumberFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, day: 'numeric' })

export const dayOf = (time: number) => dayFormat.format(time)
export const formatTime = (time: number) => timeFormat.format(time)
export const formatDate = (time: number) => dateFormat.format(time)
export const formatChip = (time: number) => `${weekdayFormat.format(time)} ${dayNumberFormat.format(time)}`

/** Hour of the campus day as a decimal, 0 to 24. */
export function hourOf(time: number) {
  const parts = clockFormat.formatToParts(time)
  const part = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? 0)
  return (part('hour') % 24) + part('minute') / 60
}

/** 0 in daylight, 1 at night, easing through dawn and dusk. Tuned for early October in San Francisco. */
export function nightness(time: number) {
  const hour = hourOf(time)
  return hour < 12 ? 1 - THREE.MathUtils.smoothstep(hour, 6.4, 7.6) : THREE.MathUtils.smoothstep(hour, 18.2, 19.4)
}

const THEMES: Record<string, { label: string; color: [number, number, number] }> = {
  Social: { label: 'Social', color: [0.3, 0.88, 1.0] },
  Arts: { label: 'Arts', color: [1.0, 0.3, 0.72] },
  ThoughtfulLearning: { label: 'Learning', color: [1.0, 0.78, 0.3] },
  Cultural: { label: 'Cultural', color: [1.0, 0.5, 0.22] },
  Spirituality: { label: 'Spirituality', color: [0.72, 0.56, 1.0] },
  Athletics: { label: 'Athletics', color: [0.42, 1.0, 0.6] },
  CommunityService: { label: 'Service', color: [0.42, 1.0, 0.6] },
  Fundraising: { label: 'Fundraising', color: [0.42, 1.0, 0.6] },
  GroupBusiness: { label: 'Meeting', color: [0.74, 0.8, 0.92] },
}
const OTHER = { label: 'Event', color: [0.74, 0.8, 0.92] as [number, number, number] }

export function themeOf(theme: string) {
  const { label, color } = THEMES[theme] ?? OTHER
  const three = new THREE.Color(...color)
  return { label, color: three, css: `#${three.getHexString()}` }
}

export async function loadEvents(): Promise<{ events: CampusEvent[]; stale: boolean }> {
  const response = await fetch('/api/events')
  const body = await response.json().catch(() => null)
  if (!response.ok || !body) throw new Error(body?.error ?? `The events request failed (${response.status}).`)
  const events = (body.events as Omit<CampusEvent, 'day'>[]).map((event) => ({ ...event, day: dayOf(event.start) }))
  return { events, stale: Boolean(body.stale) }
}
