// Sample student posts for demonstrations: what the week could look like once students add their
// own events. They are made up, dated relative to today, and marked `sample` so the page labels
// them. They are only included when a page asks for them.
import { placeNames } from './places.js'
import { campusTime, dayAt } from './submit.js'

const HOUR = 60 * 60 * 1000

// [days from today, start HH:MM, length in minutes, title, building, place as written, host, theme, description]
const POSTS = [
  [0, '16:00', 90, 'Pickup basketball', 'Gymnasium', 'Gym, main court', 'Pickup Hoops', 'Athletics', 'Casual games, all levels. Just show up; we sort teams at the door.'],
  [0, '18:30', 120, 'Friday film night: Spirited Away', 'Humanities', 'HUM 133', 'Anime & Film Society', 'Arts', 'Big screen, popcorn provided. Discussion afterwards for anyone who wants to stay.'],
  [0, '19:00', 150, 'Board games and boba', 'Cesar Chavez Student Center', 'Rosa Parks B', 'Tabletop Gators', 'Social', 'Catan, Codenames, Uno and whatever you bring. First boba is on us.'],
  [1, '10:00', 60, 'Lake Merced run', 'Cox Stadium', 'Meet at the Cox Stadium gate', 'Run Club', 'Athletics', 'An easy 5 km loop around the lake. Walkers welcome; nobody gets left behind.'],
  [1, '13:00', 180, 'Pottery open studio', 'Fine Arts', 'FA 131, ceramics studio', 'Ceramics Guild', 'Arts', 'Wheel and hand-building time with a few of us around to help. Clay provided, bring an apron.'],
  [1, '16:00', 120, 'Study jam: CSC 413 midterm prep', 'J. Paul Leonard Library', 'LIB 4th floor, group room 4B', 'CS peer tutors', 'ThoughtfulLearning', 'Work through past problems together. Bring your laptop and questions.'],
  [1, '18:00', 120, 'Potluck: dishes from home', 'Mary Ward Hall', 'Mary Ward lounge', 'International Student Circle', 'Cultural', 'Bring something from where you grew up, or just bring plates. Everyone eats.'],
  [2, '11:00', 120, 'Sketching walk around campus', 'Creative Arts', 'Creative Arts main entrance', 'Sketchbook Society', 'Arts', 'A slow walk with sketchbooks, stopping wherever something looks good. Any skill level.'],
  [2, '14:00', 120, 'Chess for all levels', 'Cesar Chavez Student Center', 'The Depot', 'Chess Club', 'Social', 'Boards set up all afternoon. Beginners get a quick lesson; the rest of us play.'],
  [2, '17:00', 60, 'Sunday yoga', 'Mashouf Wellness Center', 'Studio 122 (the lawn if it is sunny)', 'Wellness Peers', 'Athletics', 'Gentle flow to end the weekend. Mats available.'],
  [3, '12:00', 60, 'Conversation table over lunch', 'Humanities', 'HUM 587', 'Conversation Table', 'Social', 'No agenda, just lunch with people you have not met yet. Bring your own food.'],
  [3, '15:00', 120, 'Résumé clinic', 'Business', 'BUS 112', 'Career peer coaches', 'ThoughtfulLearning', 'Drop in with a draft and leave with a better one. Fifteen minutes per person.'],
  [3, '17:30', 90, 'Intro to 3D printing', 'Science and Engineering Innovation Center', 'SEIC maker space', 'Makers Club', 'ThoughtfulLearning', 'Design something small and print it the same evening. No experience needed.'],
  [3, '19:00', 120, 'Open mic: poems and songs', 'Cesar Chavez Student Center', 'Jack Adams Hall', 'Spoken Word Collective', 'Arts', 'Five minutes each, sign up at the door. Listeners are as welcome as performers.'],
  [4, '11:00', 60, 'Language exchange: Spanish and English', 'Burk Hall', 'BH 221', 'Language Exchange', 'Cultural', 'Half an hour in each language, in pairs. Patient people only.'],
  [4, '13:00', 120, 'Drop-in volleyball', 'Gymnasium', 'Gym, court 2', 'Drop-in Volleyball', 'Athletics', 'Rotating teams, no experience needed.'],
  [4, '16:00', 180, 'Hack night: build something small', 'Thornton Hall', 'TH 413', 'Coding Circle', 'ThoughtfulLearning', 'Pick a tiny project and finish it in an evening. Pizza around seven.'],
  [4, '18:00', 120, 'Tacos and salsa dancing', 'Towers Conference Center', 'Towers Conference Center', 'Salsa Gators', 'Cultural', 'A beginner lesson at six, then open dancing. Tacos while they last.'],
  [5, '10:00', 60, 'Coffee and crosswords', 'J. Paul Leonard Library', 'Library café, ground floor', 'Puzzle People', 'Social', 'We print the big one and solve it together. Coffee is yours to buy.'],
  [5, '14:00', 60, 'Climate action meetup', 'Hensill Hall', 'HH 544', 'Students for Sustainability', 'CommunityService', 'Planning the campus clean-up and the compost drive. New faces welcome.'],
  [5, '16:30', 90, 'K-pop dance practice', 'Mashouf Wellness Center', 'Studio 121', 'K-pop Dance Crew', 'Arts', 'Learning the choreography one chorus at a time. Mirrors, speakers, no judgement.'],
  [5, '19:00', 120, 'Trivia night', 'Cesar Chavez Student Center', 'The Depot', 'Trivia Night crew', 'Social', 'Teams of up to five. Form one at the door if you came alone.'],
  [6, '12:00', 90, 'Plant swap', 'Science', 'Science building courtyard', 'Botany Club', 'CommunityService', 'Bring a cutting, take a cutting. Pots and soil on hand for repotting.'],
  [6, '15:00', 90, 'Photo walk at golden hour', 'Manzanita Square', 'Meet at the Manzanita Square entrance', 'Photo Collective', 'Arts', 'Down to Lake Merced as the light goes soft. Phones count as cameras.'],
  [6, '17:00', 120, 'Manga drawing session', 'Fine Arts', 'FA 229', 'Manga Club', 'Arts', 'Draw together, swap tips, trade sketchbooks at the end.'],
  [6, '18:30', 90, 'Commuter dinner before the drive home', 'Cesar Chavez Student Center', 'Student Center food court', 'Commuter Collective', 'Social', 'For everyone who usually leaves at five. Eat together, then hit the road.'],
  [6, '20:00', 90, 'Stargazing from the roof', 'Thornton Hall', 'Thornton Hall observatory deck', 'Astronomy Club', 'ThoughtfulLearning', 'Telescopes out if the fog stays away. Warm layers recommended.'],
]

/** Dated relative to today, so the demo always has a full week ahead. */
export function sampleEvents() {
  const now = Date.now()
  return POSTS.filter(([, , , , place]) => placeNames.includes(place))
    .map(([days, time, minutes, title, place, where, host, theme, description], index) => {
      const start = campusTime(dayAt(now + days * 24 * HOUR), time)
      return {
        id: `s_${index}`,
        title,
        start,
        end: start + minutes * 60 * 1000,
        where,
        place,
        placedBy: 'sample',
        host,
        theme,
        description,
        image: null,
        url: null,
        rsvps: 0,
        source: 'community',
        sample: true,
      }
    })
    .filter((event) => event.end > now)
}
