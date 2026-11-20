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

## v58: the rest of the research list (built later the same day, not yet pushed, untried in the headset)

Gio: "Work on 12 with what you can implement without me." Read as the 12 distinct ideas across Morty's and Gemini's lists; v57 built 5, v58 builds the rest that need no decision. Spec: docs/V58_BUILD_SPEC.md.

- **Named daily workouts** (js/progress.js): 12 named workouts (4 per shape) on weekly rotation, each with a colour, world, music set, act titles and a featured move (sent 1.6x as often). "TODAY: NIGHT SHIFT" on the warm-up board, spoken too. After 7+ days away: "Fresh Start", a shorter Steady session with no boss.
- **Levels, badges, embers**: levels from minutes in zone (never score), 19 badges for real behaviours, new ember colours at levels 3/6/10/15. Real heart rate only.
- **Ghost of your last run**: seconds in zone every 10 s from the last real workout of the same shape; "+0:12" next to the time in zone, a spoken update after each act, the final difference on the end board.
- **Progress board** to the right of the end board: workout, level, badges or next badge, ghost, recovery story ("best this month"), the Guardian's result, what's next.
- **The Guardian** (js/boss.js, js/bossview.js; design from docs/BOSS_SPEC_DRAFT.md): on the week's last planned workout. Reps only hurt it while you're in the zone; below, its shield stalls then creeps back; above, it overheats and asks you to breathe. Perfect landing = 25% off the shield. +500 and a badge when beaten. Board: More -> Guardian; Test -> Guardian.
- **Voice coach v2** (js/coach.js, js/coach-lines.js, assets/voice/): 159 pre-rendered clips (Windows "Microsoft Zira" for now, 1.9 MB) played through the game's audio, so the coach should speak in the Quest browser. Browser speech only for lines with numbers in them. New lines: how far off the zone you are, charge countdown, coast "hold... land it", a flick nudge (below the zone only), level-up, badge, ghost, Guardian, one per named workout. Music ducks under the coach. To re-render: `powershell -File tools/make-voice.ps1`. ElevenLabs clips can replace these file-for-file once its connector is linked.
- **Worlds** (js/worlds.js): Grid (the old look), Harbour, Reactor Yard, Snowfield, Dojo: palette plus dark horizon silhouettes, cross-faded, at most 3 extra draw calls.
- **Music sets** (js/audio.js): Night (the old synth, identical to v57 call for call: 23,991 Web Audio calls, test/audio.test.mjs), Harbour (D major, airy), Furnace (E minor, four-on-the-floor), Storm (D minor, broken beat). Board: Music style -> "By workout". Nobody has listened to the new sets yet.
- **Share card** (js/card.js): "Save summary card (PNG)" on the phone bridge page.
- Fixes found on the way: v57's last-30-seconds and recovery voice lines only spoke in the first workout after loading; the "dropping below" line almost never spoke; Pose walls had no board button.

Tests: core, progress (151), boss, coach (15), audio, card, tcx all pass. Emulator smoke run: Night Shift loaded in the Reactor Yard world, the Guardian's shield broke at ~5 min, it retreated at cool-down, end + progress boards drew, no errors.

### Headset questions for v58
1. Does the coach speak now (clips, not browser speech)? Too chatty?
2. Is the Guardian visible and readable at the far end of the lane, and does it block anything?
3. Are the worlds dark enough that orbs still pop?
4. Do the Harbour / Furnace / Storm music sets sound right (Music style -> By workout)?
## v59: ElevenLabs placeholder voice (built in the evening, not yet pushed, untried in the headset)

Gio: "you can add the audio for fun for now as placeholders and wiring". The voice choice stays Gio's; this only wires a second voice in.

- **Voice packs** (js/coach.js `VOICE_PACKS`, `setPack`, `urlFor`): a pack's clips sit on top of the Windows bank (assets/voice); any line the pack lacks plays in Zira, so a pack can be partial. Setting `voicePack`, default `'eleven'`. Board: Sound row -> "Coach on" + the voice name (Jerry / Zira, tap to switch; it says "Coach voice on." in the new voice).
- **assets/voice-eleven/** (1.4 MB): 147 of the 159 lines in ElevenLabs "Jerry B." (Multilingual v2), cut from the two long takes in FitBit Game/voice-takes. The 12 left out (listed in its manifest's `missing`) couldn't be placed for certain: powerPraise.1-2, levelUp.2, badge.0, and the rope + step cues. Some workout names came out without "Today:" ("Night Shift.").
- How it was cut: tools/voice-transcode.ps1 (MP3 -> WAV, Windows' own decoder; only its default 48 kHz stereo profile works for MP3 input), tools/voice-split.cjs (pieces at 0.9 s pauses), Windows speech recognition with the lines as a grammar to anchor which piece is which line, then tools/voice-cut.cjs (explicit piece -> line map). Take 1's piece count matched the line count yet hid a split line and two merged pairs, so a matching count alone isn't proof.
- `pz.coach` and `pz.state.voice` for checks. Cache tags -> `?v59`.

Tests: coach 29 checks (new: pack files, fallback for each line, switching, a slow switch can't override a newer one); all 7 suites pass. Browser: the pack loads, all 147 clips decode, a pack line and a fallback line both play, the board button switches and saves.

### Headset questions for v59
1. Is the Jerry voice clear over the music in the Quest? Does the switch between Jerry and the odd Zira line jar?
2. Any clip that says the wrong thing for its moment? (Placeholder cutting; tell me the line and I'll drop it to Zira.)

## First v59 headset workout (19 Nov, 19:03 local; TCX from the bridge page)

Waves, full 15 min + 30 s warm-up + 2 min cool-down, target 130 (125-135). Game: 43% in zone (my recount with the waves target: 45%). Avg 125 over training, peak 150 at ~13:45. Clean 1 Hz signal: four single-second gaps, no stuck stretches. The TCX export (v57) works end to end.

Against the 17:31 v55 run (Waves, 7 of 15 min, 18% in zone, avg 112, peak 132): a full session, more than double the time in zone, avg +13 BPM.

Still slow to warm up: below the zone for the first ~4.5 min of training (96 -> 118); first 125 at 4:49. After that it tracked the waves well (minutes 5-12: 65-95% in zone per minute), with one overshoot to 142-150 at minutes 12-13 (target ~134 there).

Cool-down: HR barely fell, 130 -> 127 in the first minute, 124 at the end. Ask Gio what he was doing in the cool-down (still moving? the guided reaches?).
