export interface PlanStep {
  eventId: string | null
  /** Building on the map, or null when the stop cannot be flown to. */
  place: string | null
  label: string
  note: string
}

export interface Plan {
  title: string
  steps: PlanStep[]
}

export interface Guide {
  /** Highlight the plan step the map is currently showing; null clears it. */
  markStep(index: number | null): void
}

interface Turn {
  role: 'user' | 'guide'
  text: string
}

const SUGGESTIONS = [
  "I'm on campus today until 7 and I like games",
  'Plan my Tuesday: free 10 to 3, into art and music',
  "What's on this week for someone who wants to meet people?",
]

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

/** The chat with the Gemini guide. Plans it returns are handed to `onPlan`; step clicks to `onStep`. */
export function createGuide(
  root: HTMLElement,
  handlers: { onPlan(plan: Plan): void; onStep(plan: Plan, index: number): void; onAsk(): void },
  /** Extra fields sent with every question, e.g. whether the demo's sample posts are showing. */
  extra: () => Record<string, unknown> = () => ({}),
): Guide {
  const history: Turn[] = []
  let stepButtons: HTMLButtonElement[] = []

  const log = el('div', 'log')
  log.setAttribute('aria-live', 'polite')
  log.append(el('p', 'hint', "Tell me when you're on campus and what you're into. I'll find what fits and fly you there."))
  const chips = el('div', 'chips')
  for (const text of SUGGESTIONS) {
    const chip = el('button', '', text)
    chip.type = 'button'
    chip.addEventListener('click', () => ask(text))
    chips.append(chip)
  }
  log.append(chips)

  const form = el('form')
  const input = el('input')
  input.type = 'text'
  input.maxLength = 600
  input.placeholder = 'When are you here, and what do you like?'
  input.setAttribute('aria-label', 'Message the guide')
  const send = el('button', '', 'Ask')
  send.type = 'submit'
  form.append(input, send)
  form.addEventListener('submit', (event) => {
    event.preventDefault()
    ask(input.value)
  })
  root.append(log, form)

  const say = (className: string, text: string) => {
    const bubble = el('p', className, text)
    log.append(bubble)
    log.scrollTop = log.scrollHeight
    return bubble
  }

  async function ask(text: string) {
    const message = text.trim()
    if (!message || send.disabled) return
    chips.remove()
    input.value = ''
    send.disabled = true
    handlers.onAsk()
    say('me', message)
    const waiting = say('guide waiting', 'Looking through the listings…')
    try {
      const response = await fetch('/api/guide', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message, history, ...extra() }),
      })
      const body = await response.json().catch(() => null)
      if (!response.ok || !body) throw new Error(body?.error ?? `The guide request failed (${response.status}).`)
      waiting.classList.remove('waiting')
      waiting.textContent = body.reply
      history.push({ role: 'user', text: message }, { role: 'guide', text: body.reply })

      const plan = body.plan as Plan | null
      if (plan?.steps.length) {
        const list = el('ol', 'plan')
        list.setAttribute('aria-label', plan.title)
        stepButtons = plan.steps.map((step, index) => {
          const button = el('button')
          button.type = 'button'
          button.append(el('b', '', step.label), el('span', '', step.place ? step.note : `${step.note} (not on the map)`))
          button.addEventListener('click', () => handlers.onStep(plan, index))
          const item = el('li')
          item.append(button)
          list.append(item)
          return button
        })
        log.append(list)
        handlers.onPlan(plan)
      }
    } catch (error) {
      waiting.classList.remove('waiting')
      waiting.classList.add('problem')
      waiting.textContent = error instanceof Error ? error.message : 'The guide could not answer.'
    }
    send.disabled = false
    log.scrollTop = log.scrollHeight
    input.focus()
  }

  return {
    markStep(index) {
      stepButtons.forEach((button, i) => (i === index ? button.setAttribute('aria-current', 'step') : button.removeAttribute('aria-current')))
    },
  }
}
