// One server for everything: the API, and the page itself (through Vite in development, from
// the built files in production).
import express from 'express'
import { fileURLToPath } from 'node:url'
import { getEvents } from './events.js'
import { askGuide, GuideError } from './guide.js'

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

app.get('/api/events', async (_request, response) => {
  try {
    response.json(await getEvents())
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
    response.json(await askGuide(message, history))
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
