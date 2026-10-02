import { dayOf, formatChip, formatDate, formatTime, hourOf, type CampusEvent } from './events'

const STEP = 30 * 60 * 1000
const DAYS = 7
const STEPS = DAYS * 48
const PLAY_INTERVAL = 220

export interface Timeline {
  /** The moment being shown: the real current time while the slider sits at "now". */
  readonly time: number
  /** Move to the first half-hour at or after this moment. */
  set(time: number): void
  setEvents(events: CampusEvent[]): void
}

/** The bar along the bottom: play, now, a chip per day and a half-hour slider over the next week. */
export function createTimeline(root: HTMLElement, onChange: (time: number) => void): Timeline {
  const base = Math.floor(Date.now() / STEP) * STEP
  let step = 0
  let timer = 0
  let events: CampusEvent[] = []
  const timeAt = (s: number) => (s === 0 ? Date.now() : base + s * STEP)

  const button = (text: string, className: string) => {
    const element = document.createElement('button')
    element.type = 'button'
    element.className = className
    element.textContent = text
    return element
  }
  const play = button('Play', 'pill')
  play.title = 'Run through the week'
  const now = button('Now', 'pill')
  const days = document.createElement('div')
  days.className = 'days'
  days.setAttribute('role', 'group')
  days.setAttribute('aria-label', 'Day')
  const readout = document.createElement('output')
  const range = document.createElement('input')
  range.type = 'range'
  range.min = '0'
  range.max = String(STEPS)
  range.step = '1'
  range.setAttribute('aria-label', 'Time over the next seven days')
  root.append(play, now, days, readout, range)

  const chips = Array.from({ length: DAYS }, (_, index) => {
    const time = base + index * 24 * 60 * 60 * 1000
    const chip = button(index === 0 ? 'Today' : formatChip(time), '')
    const count = document.createElement('sup')
    chip.append(count)
    days.append(chip)
    return { key: dayOf(time), chip, count }
  })

  const show = () => {
    const time = timeAt(step)
    range.value = String(step)
    readout.textContent = `${step === 0 ? 'Now' : formatDate(time)} · ${formatTime(time)}`
    range.setAttribute('aria-valuetext', `${formatDate(time)} ${formatTime(time)}`)
    const key = dayOf(time)
    for (const { key: day, chip } of chips) chip.setAttribute('aria-pressed', String(day === key))
    play.textContent = timer ? 'Pause' : 'Play'
  }
  const go = (next: number) => {
    step = Math.max(0, Math.min(STEPS, Math.round(next)))
    show()
    onChange(timeAt(step))
  }
  const stop = () => {
    clearInterval(timer)
    timer = 0
    show()
  }

  /** The first event of that day, or mid-morning when the day has none. */
  const openingStep = (key: string) => {
    const first = events.find((event) => event.day === key && event.start >= base)
    if (first) return Math.ceil((first.start - base) / STEP)
    for (let s = 0; s <= STEPS; s++) if (dayOf(base + s * STEP) === key && hourOf(base + s * STEP) >= 10) return s
    return step
  }

  range.addEventListener('input', () => {
    // Read the new position first: stop() redraws the slider from the current step.
    const next = Number(range.value)
    stop()
    go(next)
  })
  now.addEventListener('click', () => {
    stop()
    go(0)
  })
  play.addEventListener('click', () => {
    if (timer) return stop()
    if (step >= STEPS) go(0)
    timer = window.setInterval(() => (step >= STEPS ? stop() : go(step + 1)), PLAY_INTERVAL)
    show()
  })
  chips.forEach(({ key, chip }, index) =>
    chip.addEventListener('click', () => {
      stop()
      go(index === 0 ? 0 : openingStep(key))
    }),
  )
  show()

  return {
    get time() {
      return timeAt(step)
    },
    set(time) {
      stop()
      go(Math.ceil((time - base) / STEP))
    },
    setEvents(list) {
      events = list
      for (const { key, count } of chips) count.textContent = String(list.filter((event) => event.day === key).length || '')
    },
  }
}
