# Session log — 2026-11-17

## Headset feedback round 5 (v53)

Feedback after playing v52: the sled coach works well, so add one for the other complex moves. Knees are too hard to register and need an arrow like the hooks. More hammer fists. More reps for the woodchopper (with a twist back the other way) and the wall ball. It takes too long to reach the target heart rate. Mix more squats into the punching. Record the workout data. End workout didn't end.

- **End workout:** the first press starts the 2-minute cool-down (as before, now with a call-out saying so); the button then reads **Finish now** and ends the workout straight away. Restart / End / Save data / Close moved to the top of the Options board. Keyboard E does the same.
- **Ghost coach for the body moves:** a coach on the right (where the sled coach stands) loops each move with captions: knee drive (bar overhead, pull down + knee up), wall ball (squat, drive up and press, bring it down), woodchopper (hands high, chop across), tiptoe reach. It mirrors you, so its knee, chop side and reaching hand match the lit cues.
- **Knee drive easier:** grab anywhere along the bar (28 cm leeway, was 24 cm around each grip); the pull counts with hands at chest height plus a 3 cm crunch, or hands at the waist without one (was hands 45 cm down plus a 5 cm crunch); 1.6 s to finish the pull (was 1.0). Arrows like the hook guides run from the bar ends down to your waist with a sliding dot, and a bobbing up-arrow sits under the lit knee ring.
- **More reps:** knee 4 (was 2), wall ball 3 (was 1, the ball drops back after each press; an up-arrow shows once you're in the squat), woodchopper 4 alternating sides (was 1; the orb jumps to the other side after each chop), tiptoe 4 (was 2). Hold times grew to match.
- **Hammer fists:** come as a left-right pair of pads, more often (base 0.55, was 0.35) and from earlier on; once warmed up, 40% of pairs come in low for a squat + hammer.
- **More squat + punch:** squat punches and squat-then-punch-up pairs come more often and unlock earlier.
- **Reach your zone sooner:** the warm-up target climbs early (ease-out curve) instead of in a straight line, the starting intensity is 0.25 (was 0.15), and when your heart rate is well below the zone (2× the zone half-width) and not climbing yet, the game builds intensity 3× faster (and moves 1.5× faster). Once your heart rate starts rising it backs off to normal, because heart rate lags effort.
- **Workout data:** every workout (30 s or longer) is kept on the headset, the last 12, with the per-second log plus events: station grabs, reps, give-ups with how far you pulled and crunched, timeouts, weak hits, missed orbs and wall hits. At the end it's sent to the phone page, which shows a **Save workout file** button (share sheet: Save to Files → OneDrive). **Save data** on the Options board downloads all of them on the headset too.
- Test-only: `&emutimer` now uses a MessageChannel clock, so the emulator bot runs at full speed even in a hidden window.

Checks:
- Core tests pass (knee checks updated: grab anywhere along the bar; chest-height pull with a crunch, or a waist-height pull without one).
- Emulator bot (`runChecks()`): 61 hits, 0 misses, every station did its full reps, 0 clashes, 0 overlaps, no errors.
- Smoke auto-play to the end board: 50 hits, 0 misses, 0 overlaps, no errors; hammer pads came in pairs.
- End → cool-down → Finish now → summary; the Options board snapshot shows the new top row.
- Phone hand-off tested with the bridge page in a second tab: a 6-minute workout arrived in 10 pieces and the Save workout file button appeared.

Bugs found and fixed while testing:
- The new top-row buttons were drawn before the board's button helper existed, which would have broken the Options board.
- Workout pieces over ~16 KB were silently dropped by PeerJS's JSON channel; pieces are now 6000 characters.
- Emulator only: a hidden window made the emulated camera NaN (0 × 0 canvas) and throttled timers; `&emutimer` now handles both. A bad frame time can no longer freeze the game clock.

## Later — v53 pushed, waiting on workout data

- v53 pushed and confirmed live (game, phone page with the Workout data section, Finish now button).
- The user asked for insights from their last session. No workout file was on the PC (OneDrive and Downloads searched; the Quest wasn't connected over USB). Next: get the file via the phone page (Save workout file → Save to Files → OneDrive → FitBit Game) or Options → Save data on the Quest plus USB, then analyse heart rate vs moves, the knee-drive near-misses (drop / crunch), and how fast the catch-up reaches the zone. Only v53+ workouts have the full log and events.
- docs/GAME_DESIGN_BRIEF.md brought up to date with v50–v53.

## v54: Morty's top 3 (wall-ball rounds, charge & coast, star reach)

From Morty's v53 play-through and the heart-rate research (docs/HR_RESEARCH_2026-11-17.md):

- **Wall-ball rounds.** The squat + ceiling press is now a continuous round: 20 s when it's easy, 30 s at full intensity. A beat ladders from one rep every 3.2 s to one every 2.2 s. The ring pulses and a tick sounds on each beat; the ghost coach presses on the beat; reps within 0.6 s of a beat score "ON THE BEAT" (worth more). The round asks for ~7-11 reps and runs its full time; making the goal pays 20 points a rep. It holds the lane for the whole round, so it's rarer in the normal mix (weight 0.25 -> 0.07); charges send it on purpose.
- **Charge & coast.** In training (after the first minute), when you're 10+ BPM below the target and your heart isn't already climbing: CHARGE (30 s all out, built around a wall-ball round, or battle ropes if presses are off; the challenge boost is paused). Then COAST: light moves while your heart rate keeps rising on its own; the scoreboard shows the zone to land in and the predicted peak. It lands when heart rate levels off (after 15 s), goes over, or after 45 s: PERFECT LANDING (in zone, +300), NEARLY (within 3 BPM, +100), OVERSHOT or SHORT. Then 150 s before the next one. Afterwards the controller resumes from the effort that got you there. End board lists landings. Options: "Charge" in the Body row (on by default) and a Charge test button (Test 3).
- **Tiptoe reach** (Morty: "a dud", 0/4 twice): bigger star, an arrow from shoulder height up to the lit star, 22 cm catch radius (was 17). Station labels now say "click = rep" on desktop.
- The main cue reads CHARGE: ALL OUT / COASTING during a charge, instead of PICK IT UP.

Checks: core tests pass (10 new). VR emulator bot: all stations complete (knee 4/4, wall ball 41/11 in a 30 s round, chop 4/4, tiptoe 4/4), an automatic charge fired at 91 BPM -> round -> coast at 115 -> landed NEARLY at 114 (target 120); a test charge landed SHORT (started at 124, coasted down). 5-min auto-play to the end board, no console errors. Not tried in the headset; the bot squats far faster than a person, so real round rep counts will be much lower (that's what the goal is tuned for).
