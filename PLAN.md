# Gator Pulse — concept plan

Working name. SF Hacks x GDG AI Hackathon, 2 October 2026. Submission deadline 4:45 PM.

## Concept

SF State is a commuter campus and students say it feels dead and lonely. Events exist, but they
are scattered across flyers and a listing few people open, and many happen after commuters have
left.

Gator Pulse is a live 3D map of the campus. Everything happening shows up as a beam of light on
the building it is in. A student says when they are on campus and what they like, and the map
shows what they can actually make it to.

## What it does

1. **Shows the campus alive.** Real upcoming events from SFSU's public feed appear as beacons.
2. **Plans your gaps.** "On campus Tue/Thu 10–3, into photography" → the map flies you to the
   events and spots that fit.
3. **Turns flyers into beacons.** Photograph a paper flyer and the event appears for everyone.

## Who does what

| Piece | Role |
|---|---|
| Gemini | The guide: reads schedule and interests, picks events, drives the camera with tool calls |
| Gemma 4 (open weights, via Gemini API) | Reads flyer photos; maps messy location text to a building; screens submissions |
| Cloud Run + Firestore | Hosting; new beacons synced live to every viewer |
| three.js + OpenStreetMap | The 3D campus, day and night |

Tracks: GDG (Gemini for social good) as the one main track, plus both MLH partner tracks
(open-source AI and best use of Gemma 4). The organisers confirmed this combination is allowed.

## Phases

1. **Campus scene.** 3D campus from OpenStreetMap, day and night modes, labels, camera.
2. **Live events.** Events feed → beacons on buildings, with a slider across the week.
3. **Gemini guide.** Chat box; Gemini calls tools to search events and fly the camera.
4. **Flyer to beacon.** Photo upload → Gemma 4 → new beacon, synced through Firestore.
5. **Ship.** Deploy to Cloud Run, public GitHub repo, MIT licence, README naming the models,
   OpenStreetMap credit. Done by 4:15 PM to leave time to submit.
6. **Stretch.** "Open to hang" pins, hand-modelled landmark buildings.

If time runs short: phases 3 and 4 must work; the week slider is the first thing to cut.

## Open questions

- Exact Gemma 4 model name and limits on the Gemini API.
- Google Cloud credits arrive later; build on a free key until then.
