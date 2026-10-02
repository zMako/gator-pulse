// @ts-check
// Student submissions: Gemma 4 (an open-weights model, called through the Gemini API) reads a
// flyer photo or a typed line, turns it into a structured event, places it in a building and
// screens it. A person then checks the draft before it is saved.
import { randomUUID } from 'node:crypto'
import { GoogleGenAI, ThinkingLevel } from '@google/genai'
import { matchPlace, placeNames } from './places.js'
import { addCommunityEvent } from './store.js'

const ZONE = 'America/Los_Angeles'
const DAY_MS = 24 * 60 * 60 * 1000
const THEMES = ['Social', 'Arts', 'ThoughtfulLearning', 'Cultural', 'Spirituality', 'Athletics', 'CommunityService']
const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp']

const dayFormat = new Intl.DateTimeFormat('en-CA', { timeZone: ZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
const weekdayFormat = new Intl.DateTimeFormat('en-US', { timeZone: ZONE, weekday: 'long' })
const partsFormat = new Intl.DateTimeFormat('en-US', {
  timeZone: ZONE, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', hourCycle: 'h23',
})

/** An error whose message is safe to show to the person using the page. */
export class SubmitError extends Error {
  /** @param {number} status @param {string} message */
  constructor(status, message) {
    super(message)
    this.status = status
  }
}

/** @type {GoogleGenAI | null} */
let client = null
function gemma() {
  const apiKey = process.env.GEMINI_API_KEY
  if (!apiKey) throw new SubmitError(503, 'Adding events is not switched on yet: the server has no Gemini API key.')
  return (client ??= new GoogleGenAI({ apiKey }))
}
// Tried in order; the next one is only used when Google answers with a server error.
const models = () => (process.env.GEMMA_MODEL ? [process.env.GEMMA_MODEL] : ['gemma-4-26b-a4b-it', 'gemma-4-31b-it'])

/**
 * Both Gemma models are asked at once and the first good answer wins. One slow or overloaded
 * model then costs nothing but tokens, and a flyer reads in seconds rather than minutes.
 * @param {import('@google/genai').ContentListUnion} contents
 */
async function askGemma(contents) {
  const attempts = models().map((model) =>
    gemma().models.generateContent({
      model,
      contents,
      // Left to its default, Gemma spends most of its time thinking: about 19 seconds for a
      // one-line message. Reading a flyer is extraction, so minimal thinking answers in about two.
      config: { thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL }, httpOptions: { timeout: 30_000, retryOptions: { attempts: 1 } } },
    }),
  )
  try {
    return await Promise.any(attempts)
  } catch (error) {
    throw error instanceof AggregateError ? error.errors[0] : error
  }
}

/** The campus-local calendar day of a timestamp, YYYY-MM-DD. @param {number} time */
export const dayAt = (time) => dayFormat.format(time)

/** Campus-local date and time to a timestamp. @param {string} date YYYY-MM-DD @param {string} time HH:MM */
export function campusTime(date, time) {
  const [year, month, day] = date.split('-').map(Number)
  const [hour, minute] = time.split(':').map(Number)
  const guess = Date.UTC(year, month - 1, day, hour, minute)
  const shown = Object.fromEntries(partsFormat.formatToParts(guess).map((part) => [part.type, Number(part.value)]))
  const offset = Date.UTC(shown.year, shown.month - 1, shown.day, shown.hour % 24, shown.minute) - guess
  return guess - offset
}

/** Models often wrap JSON in prose or a code fence; take the outermost object. @param {string} text */
function parseJson(text) {
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end <= start) throw new SubmitError(502, 'Gemma did not return something readable. Try again.')
  try {
    return JSON.parse(text.slice(start, end + 1))
  } catch {
    throw new SubmitError(502, 'Gemma did not return something readable. Try again.')
  }
}

function readingPrompt(message) {
  const now = Date.now()
  const days = Array.from({ length: 8 }, (_, i) => `${weekdayFormat.format(now + i * DAY_MS)} ${dayFormat.format(now + i * DAY_MS)}`)
  return `You read campus event flyers and short messages for Gator Pulse, a map of events at San Francisco State University.

Today is ${days[0]} (campus time, Pacific). The coming days are: ${days.slice(1).join(', ')}.

From the flyer image and/or the message below, extract ONE event. Reply with only a JSON object and no other text, with exactly these keys:
"is_event": true if this describes a real-world event with a time and place that students could attend, otherwise false
"acceptable": false if it contains hate, harassment, sexual content, illegal activity, a scam, or private personal details about a named individual, otherwise true
"reason": if is_event or acceptable is false, one short sentence saying why, otherwise ""
"title": the event name, at most 60 characters
"date": YYYY-MM-DD. Resolve words like "tomorrow" or "Friday" from today's date. If no year is given, use the next time that date occurs. null if no date is given
"start_time": 24-hour HH:MM, or null if not stated
"end_time": 24-hour HH:MM, or null if not stated
"location": the place exactly as written, or "" if none is given
"building": the one name from the building list that the location is in, copied exactly, or null if none fits
"host": the organiser if stated, otherwise ""
"theme": one of ${THEMES.join(', ')}
"description": one or two plain sentences about the event, at most 240 characters
"unsure": a list of short notes about anything you had to guess or could not read; [] if nothing

Building list: ${placeNames.join('; ')}.
Useful to know: The Depot, the Rosa Parks rooms, Jack Adams Hall and Malcolm X Plaza are at Cesar Chavez Student Center. The Swamp (formerly The Bricks) is at Mary Ward Hall. Room codes start with a building abbreviation: TH is Thornton Hall, LIB is J. Paul Leonard Library, BH is Burk Hall, HUM is Humanities, CA is Creative Arts, FA is Fine Arts, BUS is Business, HH is Hensill Hall.

Message: """${message || '(none; read the image)'}"""`
}

/** @param {unknown} value @param {number} max */
const text = (value, max) => (typeof value === 'string' ? value.trim().slice(0, max) : '')
/** @param {unknown} value */
const clock = (value) => (typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : '')
/** @param {unknown} value */
const isDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)

/**
 * Turn what Gemma returned into a draft for the student to check.
 * @param {Record<string, unknown>} read
 */
export function toDraft(read) {
  if (read.acceptable === false) throw new SubmitError(422, text(read.reason, 200) || 'That is not something this map can list.')
  if (read.is_event === false) throw new SubmitError(422, text(read.reason, 200) || 'That does not look like an event with a time and a place.')
  const where = text(read.location, 120)
  // Gemma's choice of building is only trusted when it is a building on the map; otherwise the rules have a go.
  const chosen = typeof read.building === 'string' && placeNames.includes(read.building) ? read.building : null
  const place = chosen ?? matchPlace(where, null, null).place
  return {
    title: text(read.title, 60),
    date: isDate(read.date) ? String(read.date) : '',
    start: clock(read.start_time),
    end: clock(read.end_time),
    where,
    place,
    host: text(read.host, 80),
    theme: THEMES.includes(String(read.theme)) ? String(read.theme) : 'Social',
    description: text(read.description, 240),
    unsure: (Array.isArray(read.unsure) ? read.unsure : []).map((note) => text(note, 140)).filter(Boolean).slice(0, 5),
  }
}

/**
 * Step one: Gemma reads the flyer or message and returns a draft.
 * @param {{ text?: unknown, image?: { data?: unknown, mimeType?: unknown } }} input
 */
export async function readSubmission(input) {
  const message = text(input.text, 600)
  const image = input.image
  const hasImage = typeof image?.data === 'string' && image.data.length > 0
  if (!message && !hasImage) throw new SubmitError(400, 'Add a photo of a flyer or type what is happening.')
  if (hasImage && !IMAGE_TYPES.includes(String(image?.mimeType))) throw new SubmitError(400, 'The photo needs to be a JPEG, PNG or WebP image.')

  /** @type {import('@google/genai').Part[]} */
  const parts = [{ text: readingPrompt(message) }]
  if (hasImage) parts.push({ inlineData: { data: String(image?.data), mimeType: String(image?.mimeType) } })
  const response = await askGemma([{ role: 'user', parts }])
  return toDraft(parseJson(response.text ?? ''))
}

/**
 * Step two: the student has checked the draft. Validate it, screen the final wording, save it.
 * @param {Record<string, unknown>} draft
 */
export async function saveSubmission(draft) {
  const title = text(draft.title, 60)
  const where = text(draft.where, 120)
  const start = clock(draft.start)
  if (!title) throw new SubmitError(400, 'The event needs a name.')
  if (!isDate(draft.date) || !start) throw new SubmitError(400, 'The event needs a date and a start time.')
  const date = String(draft.date)

  const startsAt = campusTime(date, start)
  const end = clock(draft.end)
  let endsAt = end ? campusTime(date, end) : startsAt + 60 * 60 * 1000
  if (endsAt <= startsAt) endsAt += DAY_MS
  if (endsAt < Date.now()) throw new SubmitError(400, 'That time has already passed.')
  if (startsAt > Date.now() + 120 * DAY_MS) throw new SubmitError(400, 'That is more than four months away.')

  const place = typeof draft.place === 'string' && placeNames.includes(draft.place) ? draft.place : null
  const description = text(draft.description, 240)
  const host = text(draft.host, 80)

  // The student may have edited the draft, so the final wording is screened again.
  const verdict = parseJson(
    (
      await askGemma(`You screen listings for a public university campus events map. Reply with only a JSON object: {"acceptable": true or false, "reason": "one short sentence if not acceptable, otherwise empty"}. It is not acceptable if it contains hate, harassment, sexual content, illegal activity, a scam, or private personal details about a named individual.

Title: """${title}"""
Place: """${where}"""
Host: """${host}"""
Description: """${description}"""`)
    ).text ?? '',
  )
  if (verdict.acceptable !== true) throw new SubmitError(422, text(verdict.reason, 200) || 'That listing cannot go on the map.')

  return addCommunityEvent({
    id: `c_${randomUUID().slice(0, 8)}`,
    title,
    start: startsAt,
    end: endsAt,
    where: where || place || 'Somewhere on campus',
    place,
    placedBy: 'student',
    host,
    theme: THEMES.includes(String(draft.theme)) ? String(draft.theme) : 'Social',
    description,
    image: null,
    url: null,
    rsvps: 0,
    source: 'community',
  })
}
