// Everything the voice coach can say (v58). It lives apart from js/coach.js so tools/make-voice.ps1 can
// render every line to a clip in assets/voice, and test/coach.test.mjs can check that none is missing:
// the Quest browser has no speech voices, so a line without a clip is silent in the headset.
// After changing anything here run:  powershell -File tools/make-voice.ps1   then   node test/coach.test.mjs
// Keep lines short (about 2.5 s spoken), plain words, and true to what the build does.

/** Phrase bank: coach.line(key) says one of the lines (never the same one twice in a row). */
export const PHRASES = {
  // ---- v57 bank, unchanged
  zoneIn: ['In the zone. Hold this pace.', 'That\'s it, you\'re in. Keep it smooth.', 'Locked in. Stay right there.'],
  below: ['Heart rate\'s dropping. Pick it up.', 'Bring it back up. Bigger moves.', 'Push a little harder.'],
  above: ['Ease off. Let it settle.', 'Lighter now. Breathe.', 'Back it down a touch.'],
  climbing: ['Heart rate\'s climbing. Keep going.', 'It\'s rising. Hold this.'],
  charge: ['Charge! Thirty seconds, all out.', 'Everything you\'ve got. Thirty seconds.'],
  coast: ['Coast. Light moves, let it rise.', 'Ease off and let your heart catch up.'],
  landingPerfect: ['Perfect landing. Right in the zone.', 'Nailed it. Right where we wanted.'],
  landingNearly: ['Nearly. Just outside the zone.'],
  landingOver: ['Overshot. Breathe it back down.'],
  landingShort: ['Short. Next charge, push harder.'],
  streak30: ['Thirty seconds in the zone. Keep it rolling.'],
  streak60: ['One full minute in the zone. Beautiful.'],
  streak120: ['Two minutes in the zone. That\'s the workout.'],
  heavy: ['Heavy hit!', 'Big one!', 'That\'s power.'],
  pose: ['Hold the shape.', 'Hold it... hold it.'],
  finale: ['Last act. Empty the tank.'],
  last30: ['Thirty seconds left. Finish strong.'],
  coolDown: ['Cool-down. Slow reaches overhead, and breathe. Four in, six out.', 'Easy now. Reach up slow, breathe out long.'],
  recovery: ['Keep breathing. Let the heart rate come down.'],
  finish: ['Workout done. Great work.', 'That\'s the session. Nice work today.'],
  warmUp: ['Warm-up. Easy punches, get the blood moving.'],
  training: ['Training starts now. Let\'s climb to your zone.'],

  // ---- v58: zone news that says roughly how far off you are (the game picks the key from the gap in beats)
  below5: ['A few beats under. Bigger swings.', 'Just under the zone. Punch a little harder.', 'A few beats short. Lift the pace a touch.'],
  below10: ['About ten under. Use your legs.', 'Around ten short. Bend your knees and drive.', 'Ten or so under. Get your legs into it.'],
  below15: ['Well under. Big moves, build it up.', 'A long way under. Go big, whole body.', 'Way under the zone. Big swings, deep squats.'],
  above5: ['A few beats over. Ease off.', 'Just over the zone. Soften it a little.', 'A touch high. Lighter punches.'],
  above10: ['Well over. Light hands, long breaths.', 'Too high. Slow right down and breathe.', 'Way over the zone. Easy hands, breathe out long.'],

  // ---- v58: inside a charge and its coast
  chargeHalf: ['Halfway. Keep driving.', 'Half done. Stay on it.', 'Halfway there. Don\'t let up.'],
  chargeLast5: ['Five more seconds!', 'Last five seconds!', 'Five seconds. Everything!'],
  coastHold: ['Hold... let it rise... land it.', 'Wait for it... let it climb... land it.'],

  // ---- v58: how you are hitting
  flick: ['Those are flicks. Punch through the target.', 'Too light. Drive your fist right through.', 'No flicking. Full punches, all the way through.'],
  powerPraise: ['That\'s real power. Keep that.', 'Big hits. That\'s how it\'s done.', 'Strong punches. Stay with that.'],

  // ---- v58: acts (the last act keeps `finale`), progress, last run's ghost, the restart session
  act1: ['Act one.', 'Act one. Here we go.'],
  act2: ['Act two.', 'Act two. Keep it going.'],
  act3: ['Act three.', 'Act three. Stay with it.'],
  levelUp: ['Level up!', 'Level up! You earned that.', 'New level. Well earned.'],
  badge: ['New badge.', 'New badge. Nice one.', 'You earned a badge.'],
  ghostAhead: ['You\'re ahead of your last run.', 'Ahead of last time. Keep it there.', 'You\'re beating your last run.'],
  ghostBehind: ['Your last run is ahead. Reel it in.', 'Behind last time. Close the gap.', 'Last time you were ahead here. Catch up.'],
  restart: ['Welcome back. Short and easy today.', 'Good to see you again. Easy one today.', 'Welcome back. We\'ll keep it light today.'],

  // ---- v58: the Guardian (its states follow your zone: open in it, shield up below it, overheating above it)
  bossArrive: ['Guardian day. Break its shield while you\'re in the zone.', 'The Guardian is here. Your hits only count in the zone.'],
  bossExposed: ['It\'s open. Hit it now.', 'You\'re in the zone. It\'s wide open.', 'It\'s exposed. Every hit counts.'],
  bossGuarded: ['Shield\'s up. Get back in your zone.', 'It\'s guarded. Climb back to your zone.', 'Shield\'s back up. Bring your heart rate up.'],
  bossOverheat: ['It\'s overheating. Ease off and breathe.', 'Too hot. Back it down and breathe.', 'Overheating. Slow down, long breaths.'],
  bossBroke: ['Shield down! Go for the core.', 'The shield is gone! Hit the core.'],
  bossDefeated: ['Guardian down! That\'s the week.', 'You beat the Guardian! That\'s the week done.'],
  bossRetreat: ['It got away. It\'ll be back.', 'The Guardian slipped away. It\'ll be back.'],

  // ---- v58: today's named workout, one line each (ids and names: the table in docs/V58_BUILD_SPEC.md)
  'workout.harbour-lights': ['Today: Harbour Lights.'],
  'workout.long-road': ['Today: Long Road.'],
  'workout.morning-engine': ['Today: Morning Engine.'],
  'workout.night-shift': ['Today: Night Shift.'],
  'workout.tide-runner': ['Today: Tide Runner.'],
  'workout.storm-front': ['Today: Storm Front.'],
  'workout.canyon-echo': ['Today: Canyon Echo.'],
  'workout.rolling-hills': ['Today: Rolling Hills.'],
  'workout.summit-push': ['Today: Summit Push.'],
  'workout.furnace': ['Today: Furnace.'],
  'workout.launch-day': ['Today: Launch Day.'],
  'workout.last-round': ['Today: Last Round.'],
  'workout.fresh-start': ['Today: Fresh Start.'],
};

// Wall labels (WALL_TYPES in js/core.js) and the nudges when you clip one. They come first and are
// decoded before they are needed: a wall call that is late is useless.
const WALL_CUES = [
  'Duck!', 'Step aside!', 'Lean left!', 'Lean right!', 'Squat left!', 'Squat right!', 'Stand tall!',
  'Arms up - make a Y!', 'Arms out - make a T!', 'Squat + press up!',
  'Stand up!', 'Get lower!', 'Move over!',
];

/**
 * The game's "do this now" call-outs: the exact text it shows on the scoreboard and hands to
 * coach.say(). The match is on the whole string (after trimming), so a cue must be copied from
 * js/game.js character for character, double spaces and arrows included, or its clip is never found.
 * Left out on purpose: call-outs built from numbers or names (they fall back to browser speech),
 * and ones the game follows with a coach.line() of its own (the phrase is the spoken version).
 */
export const CUES = Object.freeze([
  ...WALL_CUES,
  'Hold the shape - both fists in the rings!',
  // stations and bursts
  'KNEE DRIVE! Grab the bar overhead, pull it down and drive your knee up',
  'WALL BALL ROUND! Squat, drive up, press it to the ring - on the beat, all the way',
  'CHOP THE TREE! Hands together by your shoulder, swing across through the trunk',
  'TIPTOE REACH! Up on your toes and touch the star',
  'SQUAT + HAMMER FISTS!',
  'SPEED BAG! Hit it fast!',
  'HEAVY BAG! Hooks and uppercuts - hit the lit spot hard',
  'SLED RUN! Copy the coach: stand tall, arms up... then squat and push both poles down and back',
  'BATTLE ROPES! Pump both arms, stay low!',
  'SLALOM! Dip left, dip right - quick!',
  'DUCK AND WEAVE! Lean away, duck under the row, come up the other side',
  'MISSILES! Lean or duck out of the way',
  'Hit! Keep your head moving',
  // guard, slam, ropes
  'Incoming! GUARD UP - both fists by your chin',
  'Guard: both fists up to your chin!',
  'SLAM IT - both fists, down!',
  'Ride the rope!',
  'Both hands on the ropes!',
  'Keep your hand inside the ring as the rope slides by',
  'One hand on each rope - follow the rings!',
  // where you stand
  '<<  Step back to the centre',
  'Step back to the centre  >>',
  'STEP RIGHT  >>',
  '<<  STEP LEFT',
  // the heart-rate link
  'Phone went quiet - estimating from movement',
  'Phone heart rate is back',
  'Heart rate looks stuck - check the band is snug',
  // the coach itself (the board's 'Coach voice' switch)
  'Coach voice on.',
]);

/**
 * What the voice says for a cue whose on-screen text does not read aloud well: arrows, "+" (read
 * as "plus"), capitals, or a how-to too long to say before the move is on you. The scoreboard
 * keeps the full text; the voice gives the short command. A cue not listed here is said as written.
 */
export const SPOKEN = Object.freeze({
  'Arms up - make a Y!': 'Arms up! Make a Y.',
  'Arms out - make a T!': 'Arms out! Make a T.',
  'Squat + press up!': 'Squat and press up!',
  'Hold the shape - both fists in the rings!': 'Hold the shape! Both fists in the rings.',
  'KNEE DRIVE! Grab the bar overhead, pull it down and drive your knee up': 'Knee drive! Pull the bar down and drive your knee up.',
  'WALL BALL ROUND! Squat, drive up, press it to the ring - on the beat, all the way': 'Wall ball round! Squat, drive up, press. On the beat.',
  'CHOP THE TREE! Hands together by your shoulder, swing across through the trunk': 'Chop the tree! Hands together, swing across the trunk.',
  'TIPTOE REACH! Up on your toes and touch the star': 'Tiptoe reach! Up on your toes and touch the star.',
  'SQUAT + HAMMER FISTS!': 'Squat and hammer fists!',
  'SPEED BAG! Hit it fast!': 'Speed bag! Hit it fast!',
  'HEAVY BAG! Hooks and uppercuts - hit the lit spot hard': 'Heavy bag! Hooks and uppercuts. Hit the lit spot hard.',
  'SLED RUN! Copy the coach: stand tall, arms up... then squat and push both poles down and back': 'Sled run! Stand tall, arms up, then squat and push.',
  'BATTLE ROPES! Pump both arms, stay low!': 'Battle ropes! Pump both arms, stay low!',
  'SLALOM! Dip left, dip right - quick!': 'Slalom! Dip left, dip right, quick!',
  'DUCK AND WEAVE! Lean away, duck under the row, come up the other side': 'Duck and weave! Duck under the row, come up the other side.',
  'MISSILES! Lean or duck out of the way': 'Missiles! Lean or duck out of the way.',
  'Hit! Keep your head moving': 'Hit! Keep your head moving.',
  'Incoming! GUARD UP - both fists by your chin': 'Incoming! Guard up, both fists by your chin.',
  'Guard: both fists up to your chin!': 'Guard! Both fists up to your chin.',
  'SLAM IT - both fists, down!': 'Slam it! Both fists, down!',
  'Keep your hand inside the ring as the rope slides by': 'Keep your hand inside the ring.',
  'One hand on each rope - follow the rings!': 'One hand on each rope. Follow the rings!',
  '<<  Step back to the centre': 'Step back to the centre.',
  'Step back to the centre  >>': 'Step back to the centre.',
  'STEP RIGHT  >>': 'Step right.',
  '<<  STEP LEFT': 'Step left.',
  'Phone went quiet - estimating from movement': 'Phone went quiet. Estimating from movement.',
  'Phone heart rate is back': 'Phone heart rate is back.',
  'Heart rate looks stuck - check the band is snug': 'Heart rate looks stuck. Check the band is snug.',
});

/**
 * Clip id of a cue: 'cue.' + its words in lower case joined by '-', up to 40 characters. The arrows
 * count as words ('<<' = left, '>>' = right) so the two "step back" call-outs get ids of their own.
 * The render tool, the manifest and the coach all use this, so the three can never disagree.
 */
export function cueId(text) {
  const words = String(text).toLowerCase().replace(/<</g, ' left ').replace(/>>/g, ' right ').split(/[^a-z0-9]+/).filter(Boolean);
  let slug = '';
  for (const w of words) {
    if (slug && slug.length + 1 + w.length > 40) break;
    slug += (slug ? '-' : '') + w;
  }
  return `cue.${slug}`;
}

/** Decoded as soon as the audio is attached, so they are never late: zone news and the wall calls. */
export const PRELOAD = Object.freeze({ keys: Object.freeze(['zoneIn', 'below', 'above', 'below5', 'above5']), cues: Object.freeze(WALL_CUES) });
