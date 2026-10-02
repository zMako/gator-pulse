# ShipYard submission draft

## Project title

Gator Pulse

## Elevator pitch (131 of 140 characters)

A live 3D map of SF State: events glow as beams of light, Gemini plans your free hours, and Gemma 4 turns flyer photos into events.

## Tracks

- GDG: Build with AI for Social Good (the one main track)
- MLH: Best Open-Source AI Project
- MLH: Best Use of Gemma 4

## Full description

### The problem

SF State is a commuter campus, and students say it feels dead and lonely. About twelve of the
hundred most-upvoted posts on r/SFSU over the past year are about not being able to make friends.
One commuter wrote that clubs meet in the late afternoon and evening, after they have already gone
home.

Events do exist, but they are scattered across paper flyers and a listing few people open. Today
the official student-organisation listing had three events for the whole campus.

### What it does

Gator Pulse is a live 3D map of the campus where every event is a beam of light on the building it
is in.

- **See the campus alive.** Real events from SF State's public listing appear as beacons. A
  timeline covers the next seven days and the lighting follows the time of day, so dragging to
  7 PM brings on night.
- **Plan your gaps.** Tell the guide something like "I'm on campus Tuesday 10 to 3 and I'm into
  art and music". Gemini picks real events that fit those hours and the map flies you to each one.
  If nothing fits, it says so.
- **Turn a flyer into a beacon.** Take a photo of a paper flyer, or type one line. Gemma 4 reads it
  into an event, you check the draft, and it appears on the map for everyone with the page open.

### How I built it

- **The campus** is drawn with three.js from OpenStreetMap data: about a thousand real building
  footprints, with window facades, day and night lighting, shadows, trees, and cars and people
  moving along the paths.
- **Gemini 3.5 Flash-Lite** is the guide. It is given the real upcoming events and answers through
  a tool call that also tells the map where to fly, so one call both replies and drives the camera.
- **Gemma 4** (the open-weights `gemma-4-26b-a4b-it`, called through the Gemini API) reads flyer
  photos and typed lines into structured events, works out which campus building a place like
  "The Depot" or "TH 818" is in, and screens submissions.
- **A small Node server** fetches SF State's listing, matches each event to a building, and pushes
  new events to every open page.

### What was hard

- Making extruded building outlines look like a campus and not a pile of blocks. The fix was a
  shader that draws windows, lit rooms and glass reflections.
- A black square that flashed on screen during fast camera moves. It turned out to be one invalid
  pixel being smeared by the glow effect.
- Free-tier rate limits. The first guide used three model calls per question and hit the limit on
  its second question, so it was reworked to answer in one.
- Gemma took 19 seconds on a one-line message because it was thinking before answering. Turning
  its thinking down brought that to about 4.

### Keeping it responsible

- A person checks what the model read before anything is saved, and sees what it was unsure about.
- Submissions are screened twice: when read, and again on the final wording.
- The guide can only recommend events that are really in the listing.
- Flyer photos are not stored.
- The moving cars and people are decoration, not real traffic data.

### What's next

Sign-in with SF State accounts so only students can post, more event sources, and "open to hang"
pins for students who want company between classes.

## Tags

three.js, WebGL, TypeScript, Node.js, Express, Gemini API, Gemini 3.5 Flash-Lite, Gemma 4,
open-weights, function calling, multimodal, OpenStreetMap, 3D, maps, social good, campus,
community, events

## Links

- Code: https://github.com/zMako/gator-pulse

## Media

- `docs/night.png`: the campus at night with live event beacons
- `docs/day.png`: the same view by day
