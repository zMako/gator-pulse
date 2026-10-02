// One server for everything: the API, and the page itself (through Vite in development, from
// the built files in production).
import express from 'express'
import { fileURLToPath } from 'node:url'
import { getEvents } from './events.js'
import { askGuide, GuideError } from './guide.js'
import { changes, removeCommunityEvent } from './store.js'
import { readSubmission, saveSubmission, SubmitError } from './submit.js'

// Local development keeps secrets in .env; in production they arrive as real environment variables.
try {
  process.loadEnvFile()
} catch {
  // No .env file.
}

const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? (production ? 8080 : 5173))
const app = express()
// Behind Cloud Run's proxy the caller's address is in X-Forwarded-For.
app.set('trust proxy', true)

/** At most `limit` requests per minute from one address, to keep a public demo from draining the API quota. */
function rateLimit(limit) {
  const recent = new Map()
  return (request, response, next) => {
    const now = Date.now()
    const times = (recent.get(request.ip) ?? []).filter((time) => now - time < 60_000)
    if (times.length >= limit) return response.status(429).json({ error: 'Too many requests. Give it a minute and try again.' })
    recent.set(request.ip, [...times, now])
    if (recent.size > 5000) recent.clear()
    next()
  }
}

app.get('/api/events', async (request, response) => {
  try {
    response.json(await getEvents({ samples: request.query.samples === '1' }))
  } catch (error) {
    console.error('events feed failed:', error)
    response.status(502).json({ error: "SF State's events feed could not be reached." })
  }
})

app.post('/api/guide', express.json({ limit: '32kb' }), rateLimit(12), async (request, response) => {
  const message = typeof request.body?.message === 'string' ? request.body.message.trim().slice(0, 600) : ''
  if (!message) return response.status(400).json({ error: 'Type a message first.' })
  const history = Array.isArray(request.body.history) ? request.body.history.slice(-10) : []
  try {
    response.json(await askGuide(message, history, { samples: request.body.samples === true }))
  } catch (error) {
    if (error instanceof GuideError) return response.status(error.status).json({ error: error.message })
    console.error('guide failed:', error)
    const status = Number(error?.status)
    const reason =
      status === 402
        ? "The Gemini project behind this server has run out of credit, so the guide can't answer."
        : status === 429
          ? 'Google is rate-limiting the guide right now. Try again in a minute.'
          : status === 400 || status === 401 || status === 403
            ? 'Google rejected the request. Check the Gemini API key and model name on the server.'
            : 'The guide could not reach Gemini. Try again.'
    response.status(502).json({ error: reason })
  }
})

/** Shared error handling for the two submission steps. */
function submissionFailed(error, response) {
  if (error instanceof SubmitError) return response.status(error.status).json({ error: error.message })
  console.error('submission failed:', error)
  const status = Number(error?.status)
  const reason =
    status === 402
      ? "The Gemini project behind this server has run out of credit, so Gemma can't read submissions."
      : status === 429
        ? 'Google is rate-limiting Gemma right now. Try again in a minute.'
        : 'Gemma could not be reached. Try again.'
  response.status(502).json({ error: reason })
}

// Step one: Gemma reads a flyer photo or a typed line and returns a draft to check.
app.post('/api/submissions/read', express.json({ limit: '6mb' }), rateLimit(6), async (request, response) => {
  try {
    response.json({ draft: await readSubmission(request.body ?? {}) })
  } catch (error) {
    submissionFailed(error, response)
  }
})

// Step two: the checked draft is screened and saved.
app.post('/api/submissions', express.json({ limit: '32kb' }), rateLimit(6), async (request, response) => {
  try {
    response.json({ event: await saveSubmission(request.body ?? {}) })
  } catch (error) {
    submissionFailed(error, response)
  }
})

// A student can take down an event they added (the page only offers this for its own posts).
app.delete('/api/submissions/:id', rateLimit(12), (request, response) => {
  if (removeCommunityEvent(String(request.params.id))) response.status(204).end()
  else response.status(404).json({ error: 'That event is no longer on the map.' })
})

// Open pages hold this connection and are told the moment anyone adds an event.
app.get('/api/stream', (request, response) => {
  response.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
  response.write(': connected\n\n')
  const send = (event) => response.write(`event: added\ndata: ${JSON.stringify(event)}\n\n`)
  const gone = (id) => response.write(`event: removed\ndata: ${JSON.stringify({ id })}\n\n`)
  const heartbeat = setInterval(() => response.write(': still here\n\n'), 25_000)
  changes.on('added', send)
  changes.on('removed', gone)
  request.on('close', () => {
    clearInterval(heartbeat)
    changes.off('added', send)
    changes.off('removed', gone)
  })
})

if (production) {
  const dist = fileURLToPath(new URL('../dist', import.meta.url))
  app.use(express.static(dist))
  app.get('*', (_request, response) => response.sendFile('index.html', { root: dist }))
} else {
  const { createServer } = await import('vite')
  const vite = await createServer({ server: { middlewareMode: true }, appType: 'spa' })
  app.use(vite.middlewares)
}

app.listen(port, () => console.log(`Gator Pulse on http://localhost:${port}`))
