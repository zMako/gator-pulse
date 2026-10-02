import { formatDate, formatTime, stateAt, themeOf, type CampusEvent } from './events'

export interface Panel {
  /** List the events of one day, marked up for the moment being shown. */
  showDay(title: string, events: CampusEvent[], time: number, selectedId: string | null): void
  showCard(event: CampusEvent | null): void
  /** A line under the heading, e.g. when the feed could not be loaded. */
  showNote(text: string, retry?: () => void): void
}

const el = <K extends keyof HTMLElementTagNameMap>(tag: K, className = '', text = '') => {
  const element = document.createElement(tag)
  if (className) element.className = className
  if (text) element.textContent = text
  return element
}

export function createPanel(
  list: HTMLElement,
  card: HTMLElement,
  handlers: { onSelect(event: CampusEvent): void; onClose(): void },
): Panel {
  const head = el('button', 'head')
  head.type = 'button'
  head.setAttribute('aria-expanded', 'true')
  const heading = el('b')
  const count = el('span')
  head.append(heading, count)
  head.addEventListener('click', () => head.setAttribute('aria-expanded', String(!list.classList.toggle('collapsed'))))
  const note = el('p', 'note')
  note.hidden = true
  const rows = el('ol')
  list.append(head, note, rows)

  return {
    showDay(title, events, time, selectedId) {
      heading.textContent = title
      count.textContent = events.length === 1 ? '1 event' : `${events.length} events`
      rows.replaceChildren(
        ...events.map((event) => {
          const state = stateAt(event, time)
          const row = el('button', 'row')
          row.type = 'button'
          row.dataset.state = state
          if (event.id === selectedId) row.setAttribute('aria-current', 'true')
          const dot = el('span', 'dot')
          dot.style.setProperty('--c', themeOf(event.theme).css)
          const what = el('span', 'what', event.title)
          what.append(el('small', '', event.place ? event.where : `${event.where} · not on the map`))
          row.append(dot, el('span', 'when', state === 'live' ? 'Live' : formatTime(event.start)), what)
          row.addEventListener('click', () => handlers.onSelect(event))
          const item = el('li')
          item.append(row)
          return item
        }),
      )
      if (!events.length) rows.replaceChildren(el('li', 'note', 'Nothing listed for this day.'))
    },

    showCard(event) {
      card.hidden = !event
      if (!event) return card.replaceChildren()
      const theme = themeOf(event.theme)
      const close = el('button', 'close', 'Close')
      close.type = 'button'
      close.addEventListener('click', handlers.onClose)
      const children: HTMLElement[] = [close]
      if (event.image) {
        const image = el('img')
        image.alt = ''
        image.loading = 'lazy'
        image.src = event.image
        image.addEventListener('error', () => image.remove())
        children.push(image)
      }
      const tag = el('span', 'tag', theme.label)
      tag.style.setProperty('--c', theme.css)
      const fact = (label: string, value: string) => {
        const line = el('p', 'fact')
        line.append(el('span', '', `${label} `), value)
        return line
      }
      const link = el('a', '', 'Open the event page')
      link.href = event.url
      link.target = '_blank'
      link.rel = 'noreferrer'
      children.push(
        tag,
        el('h2', '', event.title),
        fact('When', `${formatDate(event.start)}, ${formatTime(event.start)} – ${formatTime(event.end)}`),
        fact('Where', event.place ? event.where : `${event.where} (not on the map)`),
        fact('Host', event.host),
        el('p', 'about', event.description),
        link,
      )
      card.replaceChildren(...children)
      card.scrollTop = 0
    },

    showNote(text, retry) {
      note.hidden = !text
      note.textContent = text
      if (retry) {
        const again = el('button', '', 'Try again')
        again.type = 'button'
        again.addEventListener('click', retry)
        note.append(' ', again)
      }
    },
  }
}
