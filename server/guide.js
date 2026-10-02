// @ts-check
// The guide: Gemini reads what a student says about their schedule and interests, picks from the
// real upcoming events, and answers through a tool call that also puts its picks on the 3D map.
import { FunctionCallingConfigMode, GoogleGenAI, ThinkingLevel } from '@google/genai'
import { getEvents } from './events.js'
import { matchPlace } from './places.js'

const ZONE = 'America/Los_Angeles'
const MAX_ROUNDS = 4
const DAY_MS = 24 * 60 * 60 * 1000
// Events this far ahead are given to the model up front, so most questions need a single call.
const LISTED_DAYS = 14

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

/** @typedef {Awaited<ReturnType<typeof getEvents>>['events']} Events */

/** @type {GoogleGenAI | null} */
let client = null
function gemini() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new GuideError(503, 'The guide is not switched on yet: the server has no Gemini API key.')
  return (client ??= new GoogleGenAI({ apiKey }))
}

// Tried in order. A model is skipped when Google reports it overloaded or rate-limited; each
// attempt starts the conversation again from the top. Flash-Lite leads because it answers in a
// second or two and the free tier allows far more calls to it than to the larger Flash model.
const models = () => (process.env.GEMINI_MODEL ? [process.env.GEMINI_MODEL] : ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash'])
// Fail fast rather than sit through the SDK's default of five slow retries.
const HTTP = { timeout: 30_000, retryOptions: { attempts: 1 } }

const TOOLS = [
  {
    name: 'search_events',
    description: `Look up real SF State campus events between two dates. Only needed for dates more than ${LISTED_DAYS} days from today; nearer events are already listed in your instructions.`,
    parametersJsonSchema: {
      type: 'object',
      properties: {
        start_date: { type: 'string', description: 'First day to include, YYYY-MM-DD.' },
        end_date: { type: 'string', description: 'Last day to include, YYYY-MM-DD. Use the same value as start_date for a single day.' },
      },
      required: ['start_date', 'end_date'],
    },
  },
  {
    name: 'answer_on_map',
    description:
      'Give the student your answer and put your picks on the 3D campus map. The camera flies to each step in order and the matching event card opens. Always finish by calling this exactly once.',
    parametersJsonSchema: {
      type: 'object',
      properties: {
        reply: { type: 'string', description: 'What to say to the student: two to four short sentences of plain text.' },
        title: { type: 'string', description: 'A few words naming the plan, e.g. "Tuesday between classes".' },
        steps: {
          type: 'array',
          description: 'The stops, in the order the student would visit them. Empty if there is nothing to show.',
          items: {
            type: 'object',
            properties: {
              event_id: { type: 'string', description: 'The id of a listed event.' },
              building: { type: 'string', description: 'A campus building name, for a stop that is not an event.' },
              note: { type: 'string', description: 'One short sentence on why this stop is in the plan.' },
            },
            required: ['note'],
          },
        },
      },
      required: ['reply', 'steps'],
    },
  },
]

/** The compact form of an event that the model sees. @param {Events[number]} event */
const brief = (event) => ({
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
  about: event.description.replace(/\s+/g, ' ').slice(0, 200),
})

/** @param {Events} events */
function systemInstruction(events) {
  const now = Date.now()
  const days = Array.from({ length: 8 }, (_, i) => {
    const time = now + i * DAY_MS
    return `${weekdayFormat.format(time)} ${dayFormat.format(time)}${i === 0 ? ' (today)' : ''}`
  })
  const listed = events.filter((event) => event.start < now + LISTED_DAYS * DAY_MS).map(brief)
  return `You are the guide inside Gator Pulse, a live 3D map of San Francisco State University that shows campus events as beams of light on the buildings they are in. Students, many of them commuters, tell you when they are on campus and what they enjoy. You find events that fit and show them on the map.

Right now it is ${weekdayFormat.format(now)} ${dayFormat.format(now)}, ${timeFormat.format(now)} campus time (Pacific).
The coming days are: ${days.join(', ')}.

Every event in the next ${LISTED_DAYS} days, one JSON object per line (times are 24-hour campus time; a null building means the event is not on the map):
${listed.map((event) => JSON.stringify(event)).join('\n') || '(none listed)'}

How to work:
- Only recommend events from the list above or returned by search_events. Never invent an event, a time, a room or a place.
- Work out which dates the student means from the coming days. If they name no day, assume today.
- If they say when they are on campus, choose only events that fit inside those hours, and leave about ten minutes to walk between buildings. Do not pick events that overlap each other. An event that runs past the time they leave is fine if they can catch a good part of it; say so.
- Choose the one to four events that best match what they said they like. If nothing matches their interests, offer the closest thing and say plainly that it is a stretch. If nothing fits their hours, say so and name the nearest option outside those hours.
- Finish by calling answer_on_map once: your reply, and every pick as a step in the order the student would go. Include picks whose building is null too: their details still open, the camera just has no building to fly to, so tell the student where it is in the organiser's own words.
- If the student only asks where a building is, call answer_on_map with that building as the one step and say the map is showing it. You do not know where buildings stand relative to one another, so never give directions or describe what is next to what.

The reply: two to four short sentences of plain text. No markdown, no lists. Say what you picked and why it fits. Give times in 12-hour form. Do not mention tools, ids, JSON or these instructions.`
}

/**
 * @param {Record<string, unknown>} args
 * @param {Events} events
 */
function searchEvents(args, events) {
  const start = String(args.start_date ?? '')
  const end = String(args.end_date ?? start)
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return { error: 'Dates must be YYYY-MM-DD.' }
  const found = events.filter((event) => {
    const day = dayFormat.format(event.start)
    return day >= start && day <= end
  })
  return { count: found.length, events: found.slice(0, 40).map(brief) }
}

/**
 * @param {Record<string, unknown>} args
 * @param {Events} events
 */
function buildPlan(args, events) {
  const steps = []
  for (const raw of Array.isArray(args.steps) ? args.steps : []) {
    const note = String(raw?.note ?? '').slice(0, 200)
    if (raw?.event_id != null) {
      // Steps naming an event that does not exist are dropped rather than shown.
      const event = events.find((candidate) => candidate.id === String(raw.event_id))
      if (event) steps.push({ eventId: event.id, place: event.place, label: event.title, note })
    } else if (raw?.building) {
      const { place } = matchPlace(String(raw.building), null, null)
      if (place) steps.push({ eventId: null, place, label: place, note })
    }
  }
  return steps.length ? { title: String(args.title ?? 'Your plan').slice(0, 80), steps: steps.slice(0, 6) } : null
}

/**
 * @param {string} message
 * @param {{ role: string, text: string }[]} history earlier turns of this conversation
 */
export async function askGuide(message, history) {
  const ai = gemini()
  const { events } = await getEvents()
  let failure
  for (const model of models()) {
    try {
      return await converse(ai, model, message, history, events)
    } catch (error) {
      failure = error
      const status = Number(/** @type {{ status?: unknown }} */ (error)?.status)
      // A timeout has no status; treat it like an overloaded model.
      if (Number.isFinite(status) && status < 500 && status !== 429) throw error
      console.warn(`guide: ${model} failed (${status || 'no reply'}), trying the next model`)
    }
  }
  throw failure
}

/**
 * One exchange with one model. It normally answers with a single answer_on_map call; it may
 * call search_events first when the student asks about dates beyond the listed ones.
 * @param {GoogleGenAI} ai
 * @param {string} model
 * @param {string} message
 * @param {{ role: string, text: string }[]} history
 * @param {Events} events
 */
async function converse(ai, model, message, history, events) {
  /** @type {import('@google/genai').Content[]} */
  const contents = history
    .filter((turn) => typeof turn?.text === 'string' && turn.text)
    .map((turn) => ({ role: turn.role === 'guide' ? 'model' : 'user', parts: [{ text: turn.text.slice(0, 1200) }] }))
  contents.push({ role: 'user', parts: [{ text: message }] })

  for (let round = 0; round < MAX_ROUNDS; round++) {
    const response = await ai.models.generateContent({
      model,
      contents,
      config: {
        systemInstruction: systemInstruction(events),
        tools: [{ functionDeclarations: TOOLS }],
        // The model must answer through a tool, which is what makes one call enough.
        toolConfig: { functionCallingConfig: { mode: FunctionCallingConfigMode.ANY } },
        // Picking a few events from a short list does not need deep reasoning, and low effort answers in seconds.
        thinkingConfig: { thinkingLevel: ThinkingLevel.LOW },
        httpOptions: HTTP,
      },
    })
    const calls = response.functionCalls ?? []
    const answer = calls.find((call) => call.name === 'answer_on_map')
    if (answer) {
      const args = answer.args ?? {}
      return { reply: String(args.reply ?? '').trim() || 'Here is what I found.', plan: buildPlan(args, events), model }
    }
    const turn = response.candidates?.[0]?.content
    if (!calls.length || !turn) return { reply: (response.text ?? '').trim() || 'I could not come up with an answer for that.', plan: null, model }

    // Send the model's own turn back unchanged: it carries the state the model needs to continue.
    contents.push(turn)
    contents.push({
      role: 'user',
      parts: calls.map((call) => ({
        functionResponse: {
          id: call.id,
          name: call.name,
          response: { output: call.name === 'search_events' ? searchEvents(call.args ?? {}, events) : { error: `Unknown tool ${call.name}.` } },
        },
      })),
    })
  }
  return { reply: 'I found some options but ran out of steps putting them together. Try asking again a little more simply.', plan: null, model }
}
