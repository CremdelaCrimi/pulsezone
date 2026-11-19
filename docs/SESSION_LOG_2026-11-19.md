# Session log, 2026-11-19: v57 from the VR fitness research

Gio asked Morty (Muse) and Gemini (Pro, "Detailed research") to research the top VR workout games, compare them with PulseZone and rank the gaps. Brief: docs/RESEARCH_ASK_2026-11-19.md. Both answers, and what was built from them: docs/VR_GAMES_RESEARCH_2026-11-19.md. Morty's full page lives in Muse ("VR Fitness vs PulseZone").

Both agreed on the headline: nobody else adapts gameplay to live heart rate, so the moat is real; what we lack is packaging (a voice, named days, levels, music variety, worlds) and power/form scoring.

## v57 (built today, not yet pushed, untried in the headset)

- **Power-graded hits** (core `hitTier`, `HEAVY_BONUS`): every plain punch is a tap, a solid hit or HEAVY (power >= 0.7): heavy = x1.5, "HEAVY!" label, bigger boom and buzz, an occasional spoken "Big one!". Average punch power shows on the end board next to calories ("312 kcal · 64%"). Power orbs keep their own grading.
- **Pose walls** (activity `pose`, wall types `poseY`, `poseT`, `poseLow`): a wall with a body-shaped hole (head circle, torso, two arm bars) and two fist rings (blue left, orange right, green while a fist is in). Keep your head in the hole and both fists in the rings for 55% of the pass (1.6-1.8 s) = a dodge + a pose rep for the learner; otherwise a wall hit and "Hold the shape - both fists in the rings!". Y and T from intensity 0.3, the squat-press pose from 0.45 (followed by a stand-tall box). On the moveset lists (Walls row, desktop "Pose walls"), in the Walls test button, booked in the lane like other walls. `pz.peek().walls[].pose` exposes the points; the XR bot holds them.
- **Voice coach** (`js/coach.js`, Web Speech API, no audio files): spoken zone news a few seconds after the status settles (in / below / above / climbing), charge, coast, landing verdicts, act starts and the finale, streak milestones (30 s / 1 min / 2 min), last 30 s, warm-up and training starts, a guided cool-down line ("slow reaches overhead, breathe four in, six out") plus a reminder at 45 s, and "Workout done". Tier-1 do-this-now cues (walls, stations, slams) are also read out; test lines never. Never talks over itself (tier 1 may interrupt). Board: Sound row -> "Coach voice on/off" (shows "Voice (none here)" when the browser has no voices). Setting `voice`, default on. **Unverified on the Quest browser**: if it has no speech voices the coach stays silent and the button says so.
- **1-minute heart-rate recovery** (core `recoveryDrop`, summary `recovery`): the BPM drop in the first 60 s of cool-down (5 s averages at both ends), shown on the end board as "1-min recovery  -NN BPM" when the cool-down ran at least a minute.
- **TCX export** on the phone bridge page (`js/tcx.js`, button under Save workout file): a Garmin TCX of the latest workout (1 Hz heart rate, calories, avg/max HR, notes) for Strava / Garmin Connect / Apple Health importers.
- Cache tags bumped to `?v57`; link.js stays `?v9`, thermo.js `?v7`.

Tests: `node test/core.test.mjs` (new v57 block: hit tiers, pose geometry/hold rules, recovery), `node test/tcx.test.mjs`. Emulator: `?emulate&warmup=0&minutes=4&cooldown=1.2&emutimer` + `runChecks()` ran through all steps with no errors; `pz.force('pose')` showed the Y wall and the bot's hold counted (held 1.65 s, no wall hit).

## Not built (ranked ideas still open)
Morty's #1 named daily workouts, #3 HR boss as the weekly finale, #4 levels/badges/cosmetic unlocks, #6 ghost of last Tuesday, #8 procedural music sets + bring-your-own audio, #9 worlds per weekday, #10 recovery-adaptive plan ("restart" session after missed days); Gemini's quick-start without HR. See the research doc for the sketches.

## Headset questions for v57
1. Does the coach voice speak at all in the Quest browser? (Board: Sound row shows "Voice (none here)" if not.) If it does, is it too chatty?
2. Pose walls: are the rings reachable (Y rings 50 cm above head height, 42 cm out; T rings 72 cm out at shoulder height)? Is 55% of the pass fair?
3. Do HEAVY hits land on real punches, or does everything read as a tap? (End board shows the average.)
4. Did the end board show the 1-min recovery number after the 2-minute cool-down?
