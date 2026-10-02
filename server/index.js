// One server for everything: the API, and the page itself (through Vite in development, from
// the built files in production).
import express from 'express'
import { fileURLToPath } from 'node:url'
import { getEvents } from './events.js'

const production = process.env.NODE_ENV === 'production'
const port = Number(process.env.PORT ?? (production ? 8080 : 5173))
const app = express()

app.get('/api/events', async (_request, response) => {
  try {
    response.json(await getEvents())
  } catch (error) {
    console.error('events feed failed:', error)
    response.status(502).json({ error: "SF State's events feed could not be reached." })
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
