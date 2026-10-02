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
  [0, '15:00', 60, 'Crochet circle', 'J. Paul Leonard Library', 'LIB 2nd floor lounge', 'Fiber Arts Circle', 'Arts', 'Bring a hook or borrow one. We have yarn for anyone starting out.'],
  [0, '17:30', 90, 'Beginner swing dance', 'Mashouf Wellness Center', 'Studio 121', 'Swing Gators', 'Arts', 'Lindy hop basics, no partner needed. Sneakers are fine.'],
  [0, '20:00', 120, 'Late-night study with snacks', 'Hensill Hall', 'HH 112', 'Night Owls', 'ThoughtfulLearning', 'Quiet room, shared snacks, pomodoro timer on the screen.'],
  [1, '09:00', 120, 'Campus clean-up', 'Cesar Chavez Student Center', 'Meet at the Student Center steps', 'Students for Sustainability', 'CommunityService', 'Gloves and bags provided. Coffee for everyone who shows up before nine.'],
  [1, '11:30', 90, 'Dumpling making', 'Towers Conference Center', 'Towers Conference Center kitchen', 'Taiwanese Student Association', 'Cultural', 'Fold, steam, eat. Vegetarian filling available.'],
  [1, '14:30', 120, 'Smash Bros. tournament', 'Cesar Chavez Student Center', 'The Depot', 'Fighting Game Community', 'Social', 'Double elimination, bring a controller if you have one. Spectators welcome.'],
  [1, '19:30', 120, 'Acoustic night', 'Mary Ward Hall', 'Mary Ward courtyard', 'Dorm Music Nights', 'Arts', 'Unplugged sets from residents. Bring a blanket; it gets cold.'],
  [2, '10:00', 90, 'Morning hike planning meeting', 'Burk Hall', 'BH 120', 'Outdoors Club', 'Social', 'Picking the next three weekend trips and sorting carpools.'],
  [2, '12:30', 120, 'Sunday brunch potluck', 'Manzanita Square', 'Manzanita Square community room', 'Manzanita Residents', 'Social', 'Pancakes from the kitchen crew; bring a side if you can.'],
  [2, '15:30', 90, 'Life drawing', 'Fine Arts', 'FA 204', 'Figure Drawing Group', 'Arts', 'Short poses first, longer ones after the break. Paper provided.'],
  [2, '19:00', 120, 'Anime marathon', 'Humanities', 'HUM 133', 'Anime & Film Society', 'Arts', 'Three episodes, votes decide the show. Snacks in the back.'],
  [3, '09:30', 60, 'Coffee with the career peers', 'Business', 'BUS 108', 'Career peer coaches', 'ThoughtfulLearning', 'Ask anything about internships over coffee. No sign-up.'],
  [3, '13:30', 90, 'Pickleball for beginners', 'Gymnasium', 'Gym, court 3', 'Pickleball Club', 'Athletics', 'Paddles provided. Learn the rules and play a few games.'],
  [3, '16:00', 90, 'Robotics build session', 'Science and Engineering Innovation Center', 'SEIC robotics lab', 'Robotics Club', 'ThoughtfulLearning', 'Work on the line-following bots. Drop in, no experience needed.'],
  [3, '18:00', 60, 'Meditation and tea', 'Thornton Hall', 'TH 818', 'Zen Meditation Club', 'Spirituality', 'A guided sit, then tea. Chairs available if the floor is not for you.'],
  [4, '10:00', 60, 'French conversation', 'Humanities', 'HUM 383', 'Language Exchange', 'Cultural', 'All levels, in a circle, with pastries.'],
  [4, '12:00', 90, 'Free lunch and letters to lawmakers', 'Hensill Hall', 'HH 544', 'Students for Sustainability', 'CommunityService', 'Write to the city about campus transit while you eat.'],
  [4, '14:30', 90, 'Ultimate frisbee', 'Cox Stadium', 'Cox Stadium field', 'Ultimate Club', 'Athletics', 'Pickup game, cleats optional.'],
  [4, '19:30', 120, 'Jazz jam', 'Creative Arts', 'Knuth Hall', 'Jazz Society', 'Arts', 'Bring an instrument and sit in. Standards and whatever else comes up.'],
  [5, '11:00', 60, 'Walk and talk around Lake Merced', 'Mashouf Wellness Center', 'Meet at the Mashouf entrance', 'Wellness Peers', 'Social', 'An hour of walking with people who also needed a break.'],
  [5, '13:00', 60, 'Résumé photos', 'Cesar Chavez Student Center', 'Rosa Parks A', 'Photo Collective', 'ThoughtfulLearning', 'Free headshots for your profile. Five minutes each.'],
  [5, '15:30', 90, 'Debate practice', 'Burk Hall', 'BH 229', 'Debate Society', 'ThoughtfulLearning', 'This week: should campus parking be free. Newcomers argue first.'],
  [5, '18:00', 120, 'Mario Kart night', 'Mary Ward Hall', 'Mary Ward lounge', 'Dorm Game Nights', 'Social', 'Four screens, snacks, loud.'],
  [6, '10:30', 60, 'Bike repair clinic', 'Science', 'Science building loading dock', 'Bike Co-op', 'CommunityService', 'Flat tyres, brakes and gears fixed while you wait, free.'],
  [6, '13:30', 90, 'Salsa at lunch', 'Towers Conference Center', 'Towers Conference Center', 'Salsa Gators', 'Cultural', 'A short lesson and open dancing before afternoon classes.'],
  [6, '16:30', 90, 'Film club: short films by students', 'Creative Arts', 'McKenna Theatre', 'Student Filmmakers', 'Arts', 'Six shorts, then the people who made them answer questions.'],
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
