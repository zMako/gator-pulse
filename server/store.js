// Events added by students. Kept in a JSON file for now; the same three functions can be backed
// by Firestore once a Google Cloud project is available.
import { EventEmitter } from 'node:events'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

// Kept outside server/ so that saving an event does not trip the development file watcher.
const FILE = process.env.COMMUNITY_FILE ?? fileURLToPath(new URL('../.data/community.json', import.meta.url))
const MAX_KEPT = 200

function load() {
  try {
    return JSON.parse(readFileSync(FILE, 'utf8'))
  } catch {
    return []
  }
}

let events = load()

/** Emits 'added' with each new event, so open pages can be told about it. */
export const changes = new EventEmitter()

/** Student-added events that have not finished yet. */
export function communityEvents() {
  const now = Date.now()
  return events.filter((event) => event.end > now)
}

/** Remove a student-added event; true if it existed. The removal is announced like an addition. */
export function removeCommunityEvent(id) {
  const before = events.length
  events = events.filter((event) => event.id !== id)
  if (events.length === before) return false
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(events))
  changes.emit('removed', id)
  return true
}

export function addCommunityEvent(event) {
  events = [...communityEvents(), event].slice(-MAX_KEPT)
  mkdirSync(dirname(FILE), { recursive: true })
  writeFileSync(FILE, JSON.stringify(events))
  changes.emit('added', event)
  return event
}
