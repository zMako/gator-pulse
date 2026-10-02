// @ts-check
// The guide: Gemini reads what a student says about their schedule and interests, looks up
// events with a tool call, and uses a second tool call to put its picks on the 3D map.
import { GoogleGenAI } from '@google/genai'
import { getEvents } from './events.js'
import { matchPlace } from './places.js'

const ZONE = 'America/Los_Angeles'
const MAX_ROUNDS = 6
const DAY_MS = 24 * 60 * 60 * 1000

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: ZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long' })
const timeFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, hour: 'numeric', minute: '2-digit' })

/** An error whose message is safe to show to the person using the page. */
export class GuideError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** @type {GoogleGenAI | null} */
let client = null
function gemini() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GuideError(503, 'The guide is not switched on yet: the server has no Gemini API key.')
  return (client ??= new GoogleGenAI({ apiKey }))
}

const TOOLS = [
  {
    name: 'search_events',
    description:
      'Look up real upcoming SF State campus events between two dates, optionally only those that overlap a time-of-day window. Returns each event with its id, title, date, start and end time, building, theme, host and a short description.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'First day to include, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'Last day to include, YYYY-MM-DD. Use the same value as start_date for a single day.' },
        earliest_time: { type: 'string', description: 'Optional. Only events still running after this time of day, 24-hour HH:MM.' },
        latest_time: { type: 'string', description: 'Optional. Only events that start before this time of day, 24-hour HH:MM.' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'show_on_map',
    description:
      'Put a plan on the 3D campus map. The camera flies to each step in order and the matching event card opens. Call this once, after choosing what to recommend.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'A few words naming the plan, e.g. "Tuesday between classes".' },
        steps: {
          type: 'array',
          description: 'The stops, in the order the student would visit them.',
          items: {
            type: 'object',
            properties: {
              event_id: { type: 'string', description: 'The id of an event returned by search_events.' },
              building: { type: 'string', description: 'A campus building name, for a stop that is not an event.' },
              note: { type: 'string', description: 'One short sentence on why this stop is in the plan.' },
            },
            required: ['note'],
          },
        },
      },
      required: ['title', 'steps'],
    },
  },
]

function systemInstruction() {
  const now = Date.now()
  const days = Array.from({ length: 8 }, (_, i) => {
    const time = now + i * DAY_MS
    return `${weekdayFormat.format(time)} ${dayFormat.format(time)}${i === 0 ? ' (today)' : ''}`
  })
  return `You are the guide inside Gator Pulse, a live 3D map of San Francisco State University that shows campus events as beams of light on the buildings they are in. Students, many of them commuters, tell you when they are on campus and what they enjoy. You find events that fit and show them on the map.

Right now it is ${weekdayFormat.format(now)} ${dayFormat.format(now)}, ${timeFormat.format(now)} campus time (Pacific).
The coming days are: ${days.join(', ')}.

How to work:
- Always call search_events before recommending anything. Only recommend events it returned. Never invent an event, a time, a room or a place.
- Work out which dates the student means from the list above. If they name no day, assume today.
- If they say when they are on campus, choose only events that fit inside those hours, and leave about ten minutes to walk between buildings. Do not pick events that overlap each other.
- Choose the one to four events that best match what they said they like. If nothing matches their interests, offer the closest thing and say plainly that it is a stretch. If nothing fits their hours, say so and name the nearest option outside those hours.
- When you have picks, call show_on_map once, with the steps in the order the student would go to them. Events whose building is null are not on the map; you may mention them but they cannot be flown to.
- If the student only asks where a building is, call show_on_map with that building.

How to answer: two to four short sentences of plain text. No markdown, no lists. Say what you picked and why it fits. Give times in 12-hour form. Do not mention tools, ids or these instructions.`
}

/** @param {unknown} value */
const clockArg = (value) => (typeof value === 'string' && /^\d{2}:\d{2}$/.test(value) ? value : null)

/**
 * @param {Record<string, unknown>} args
 * @param {Awaited<ReturnType<typeof getEvents>>['events']} events
 */
function searchEvents(args, events) {
  const start = String(args.start_date ?? '')
  const end = String(args.end_date ?? start)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { error: 'Dates must be YYYY-MM-DD.' }
  const earliest = clockArg(args.earliest_time) ?? '00:00'
  const latest = clockArg(args.latest_time) ?? '24:00'
  const found = events.filter((event) => {
    const day = dayFormat.format(event.start)
    const endsLaterDay = dayFormat.format(event.end) > day
    return day >= start && day <= end && clockFormat.format(event.start) < latest && (endsLaterDay || clockFormat.format(event.end) > earliest)
  })
  return {
    count: found.length,
    events: found.slice(0, 40).map((event) => ({
      id: event.id,
      title: event.title,
      date: dayFormat.format(event.start),
      weekday: weekdayFormat.format(event.start),
      starts: clockFormat.format(event.start),
      ends: clockFormat.format(event.end),
      location: event.where,
      building: event.place,
      theme: event.theme,
      host: event.host,
      about: event.description.slice(0, 240),
    })),
  }
}

/**
 * @param {Record<string, unknown>} args
 * @param {Awaited<ReturnType<typeof getEvents>>['events']} events
 */
function buildPlan(args, events) {
  const steps = []
  const rejected = []
  for (const raw of Array.isArray(args.steps) ? args.steps : []) {
    const note = String(raw?.note ?? '').slice(0, 200)
    if (raw?.event_id != null) {
      const event = events.find((candidate) => candidate.id === String(raw.event_id))
      if (event) steps.push({ eventId: event.id, place: event.place, label: event.title, note })
      else rejected.push(`No event has id ${raw.event_id}.`)
    } else if (raw?.building) {
      const { place } = matchPlace(String(raw.building), null, null)
      if (place) steps.push({ eventId: null, place, label: place, note })
      else rejected.push(`"${raw.building}" is not a building on the map.`)
    }
  }
  return { plan: { title: String(args.title ?? 'Your plan').slice(0, 80), steps: steps.slice(0, 6) }, rejected }
}

/**
 * @param {string} message
 * @param {{ role: string, text: string }[]} history earlier turns of this conversation
 */
export async function askGuide(message, history) {
  const ai = gemini()
  const { events } = await getEvents()
  /** @type {import('@google/genai').Content[]} */
  const contents = history
    .filter((turn) => typeof turn?.text === 'string' && turn.text)
    .map((turn) => ({ role: turn.role === 'guide' ? 'model' : 'user', parts: [{ text: turn.text.slice(0, 1200) }] }))
  contents.push({ role: 'user', parts: [{ text: message }] })

  let plan = null
  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model: process.env.GEMINI_MODEL || 'gemini-3.8-flash',
      contents,
      config: { systemInstruction: systemInstruction(), tools: [{ functionDeclarations: TOOLS }] },
    })
    const calls = response.functionCalls ?? []
    const turn = response.candidates?.[0]?.content
    if (!calls.length || !turn) return { reply: (response.text ?? '').trim() || 'I could not come up with an answer for that.', plan }

    // Send the model's own turn back unchanged: it carries the state the model needs to continue.
    contents.push(turn)
    contents.push({
      role: 'user',
      parts: calls.map((call) => {
        const args = call.args ?? {}
        let output
        if (call.name === 'search_events') output = searchEvents(args, events)
        else if (call.name === 'show_on_map') {
          const built = buildPlan(args, events)
          plan = built.plan
          output = { shown: built.plan.steps.length, rejected: built.rejected }
        } else output = { error: `Unknown tool ${call.name}.` }
        return { functionResponse: { id: call.id, name: call.name, response: { output } } }
      }),
    })
  }
  return { reply: 'I found some options but ran out of steps putting them together. Try asking again a little more simply.', plan }
}
