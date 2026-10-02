import type { CampusEvent } from './events'

/** What Gemma read from a flyer or a typed line, for the student to check before it is saved. */
interface Draft {
  title: string
  date: string
  start: string
  end: string
  where: string
  place: string | null
  host: string
  theme: string
  description: string
  unsure: string[]
}

const MAX_IMAGE_SIDE = 1024

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

/** Phone photos are several megabytes; shrink to something a model reads just as well. */
async function shrink(file: File): Promise<{ data: string; mimeType: string; preview: string }> {
  const bitmap = await createImageBitmap(file)
  const scale = Math.min(1, MAX_IMAGE_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(bitmap.width * scale)
  canvas.height = Math.round(bitmap.height * scale)
  canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const preview = canvas.toDataURL('image/jpeg', 0.85)
  return { data: preview.slice(preview.indexOf(',') + 1), mimeType: 'image/jpeg', preview }
}

async function post(url: string, body: unknown) {
  const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  const reply = await response.json().catch(() => null)
  if (!response.ok || !reply) throw new Error(reply?.error ?? `The request failed (${response.status}).`)
  return reply
}

/**
 * The "Add" tab: a flyer photo or a typed line goes to Gemma 4, the draft comes back for
 * checking, and the confirmed event is saved for everyone.
 */
export function createSubmit(root: HTMLElement, buildings: string[], onAdded: (event: CampusEvent) => void) {
  const problem = (text: string) => {
    const note = el('p', 'problem', text)
    note.setAttribute('role', 'alert')
    return note
  }

  function compose(error = '') {
    let image: Awaited<ReturnType<typeof shrink>> | null = null
    const intro = el('p', 'hint', 'Seen a flyer, or know about something happening? Add a photo or type it. Gemma 4 reads it, you check it, and it goes on the map for everyone.')

    const pick = el('label', 'pick')
    const file = el('input')
    file.type = 'file'
    file.accept = 'image/jpeg,image/png,image/webp'
    const pickText = el('span', '', 'Choose a photo of a flyer')
    pick.append(file, pickText)
    const preview = el('img')
    preview.alt = 'The photo you chose'
    preview.hidden = true

    const message = el('textarea')
    message.rows = 3
    message.maxLength = 600
    message.placeholder = 'Or type it: "Pizza and board games at The Depot, 5 pm tomorrow"'
    message.setAttribute('aria-label', 'Describe the event')

    const read = el('button', 'primary', 'Read it')
    read.type = 'button'
    const status = el('p', 'hint')
    status.setAttribute('aria-live', 'polite')
    const alert = problem(error)
    alert.hidden = !error

    file.addEventListener('change', async () => {
      const chosen = file.files?.[0]
      if (!chosen) return
      try {
        image = await shrink(chosen)
        preview.src = image.preview
        preview.hidden = false
        pickText.textContent = 'Choose a different photo'
      } catch {
        image = null
        preview.hidden = true
        status.textContent = 'That file could not be opened as an image.'
      }
    })

    read.addEventListener('click', async () => {
      if (!image && !message.value.trim()) {
        status.textContent = 'Add a photo or type something first.'
        return
      }
      read.disabled = true
      alert.hidden = true
      status.textContent = image ? 'Gemma is reading the flyer…' : 'Gemma is reading that…'
      try {
        const { draft } = await post('/api/submissions/read', { text: message.value, image: image && { data: image.data, mimeType: image.mimeType } })
        review(draft)
      } catch (failure) {
        read.disabled = false
        status.textContent = ''
        alert.textContent = failure instanceof Error ? failure.message : 'That could not be read.'
        alert.hidden = false
      }
    })

    root.replaceChildren(intro, pick, preview, message, read, status, alert)
  }

  function review(draft: Draft) {
    const field = (label: string, control: HTMLElement) => {
      const wrap = el('label', 'field')
      wrap.append(el('span', '', label), control)
      return wrap
    }
    const input = (type: string, value: string, required = false) => {
      const control = el('input')
      control.type = type
      control.value = value
      control.required = required
      return control
    }
    const title = input('text', draft.title, true)
    title.maxLength = 60
    const date = input('date', draft.date, true)
    const start = input('time', draft.start, true)
    const end = input('time', draft.end)
    const where = input('text', draft.where)
    where.maxLength = 120
    const place = el('select')
    place.append(new Option('Not on the map', ''), ...buildings.map((name) => new Option(name, name)))
    place.value = draft.place ?? ''

    const form = el('form', 'review')
    const times = el('div', 'pair')
    times.append(field('Starts', start), field('Ends', end))
    const add = el('button', 'primary', 'Add to the map')
    add.type = 'submit'
    const again = el('button', '', 'Start over')
    again.type = 'button'
    again.addEventListener('click', () => compose())
    const actions = el('div', 'pair')
    actions.append(add, again)
    const status = el('p', 'hint')
    status.setAttribute('aria-live', 'polite')
    const alert = problem('')
    alert.hidden = true

    form.append(el('p', 'hint', 'This is what Gemma 4 read. Check it and fix anything it got wrong.'))
    if (draft.unsure.length) {
      const doubts = el('ul', 'unsure')
      doubts.append(...draft.unsure.map((note) => el('li', '', note)))
      form.append(el('p', 'hint', 'It was not sure about:'), doubts)
    }
    form.append(field('Event', title), field('Date', date), times, field('Place as written', where), field('Building on the map', place), actions, status, alert)

    form.addEventListener('submit', async (submission) => {
      submission.preventDefault()
      add.disabled = true
      alert.hidden = true
      status.textContent = 'Checking and saving…'
      try {
        const { event } = await post('/api/submissions', {
          ...draft, title: title.value, date: date.value, start: start.value, end: end.value, where: where.value, place: place.value || null,
        })
        done(event)
      } catch (failure) {
        add.disabled = false
        status.textContent = ''
        alert.textContent = failure instanceof Error ? failure.message : 'That could not be saved.'
        alert.hidden = false
      }
    })
    root.replaceChildren(form)
    title.focus()
  }

  function done(event: CampusEvent) {
    const another = el('button', 'primary', 'Add another')
    another.type = 'button'
    another.addEventListener('click', () => compose())
    root.replaceChildren(
      el('p', '', `"${event.title}" is on the map${event.place ? '' : ' list (it has no building, so it has no beacon)'}. Everyone with the page open can see it now.`),
      another,
    )
    onAdded(event)
  }

  compose()
}
