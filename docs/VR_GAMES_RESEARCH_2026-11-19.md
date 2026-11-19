# VR workout games vs PulseZone, 2026-11-19

Brief sent to Gemini (Pro, "Detailed research") and to Morty (Muse): docs/RESEARCH_ASK_2026-11-19.md. Neither gave checkable citations; treat claims as leads.

## Gemini's answer

### Comparison (PulseZone v56 column)

| Feature | PulseZone | Who has it |
|---|---|---|
| Live HR-driven difficulty (closed loop) | have | nobody (Supernatural/FitXR/HoloFit only display HR or zone) |
| Per-player HR-move learning | have | nobody |
| Voice coaching and live form cues | missing | Supernatural, FitXR, Les Mills, Litesport, HoloFit (basic) |
| Licensed / multi-genre music | missing | Supernatural, FitXR, Litesport, Les Mills originals, Beat Saber, Synth Riders, Pistol Whip, Audio Trip |
| Scenic / swappable environments | partial | Supernatural photospheres, HoloFit 15+ worlds, VZfit Street View, FitXR/Les Mills arenas |
| Multi-week structured programs | partial | Supernatural, FitXR, Les Mills, Litesport, HoloFit (4-8 week tracks) |
| Streaks, badges, habit loops | partial | all fitness apps; Quest Move / YUR rings, streaks, XP |
| Multiplayer / async ghost pacing | missing | FitXR ghosts, HoloFit/VZfit races, Les Mills live leaderboards |
| Isometric / full-body pose holds | partial | OhShape pose walls, Hot Squat holds, Les Mills knee strikes |
| Force / power-scaled hit grading | partial | Supernatural, Les Mills power flames, Thrill of the Fight physics |
| Out-of-headset export (Apple Health / Strava) | missing | Supernatural, FitXR, HoloFit, VZfit, Quest Move |
| Zero-friction launch (< 15 s to sweat) | missing | every native app |

Per-game notes (movement, structure, coaching, music, retention, friction, praise/complaints): Supernatural (bat swings, boxing, squats, lunges, 360 portal turns; 10-40 min classes with voice coaches; licensed music; streaks, weekly goals, Together co-op; Apple Watch HR display only; complaints: subscription, region lock, no custom songs). FitXR (boxing, HIIT, dance, combat, sculpt; 5-45 min classes; coach avatars + voice form cues; streaks, levels, ghost classes, weekly plans; Apple Watch HR display; complaints: subscription, crowded ghosts, hit detection). Les Mills Bodycombat (boxing, elbow, knee strikes, rope slams, squats; 5-30 min; real coaches via voice + holographic demos; one-time purchase; complaints: repetitive coach lines, limited songs). Thrill of the Fight (physics boxing, 3-min rounds; highest cardio output; complaints: room needed, no programs). Beat Saber (slicing, ducking; easy to cheese with wrist flicks). Synth Riders (hand rails, Force mode orbs, spin). Pistol Whip (constant squats/leans; quad-dominant). OhShape (silhouette pose walls; isometric holds). Audio Trip (dance ribbons; Cardio difficulty tier). Litesport (pad boxing, Total Body, trainer-led). VZfit / HoloFit (bike/row; BLE HR for zone guidance; environments). Dance Central / Just Dance (choreo mirroring; hands-only lets you fake footwork). Eleven Table Tennis (skill ladder drives cardio by accident). Hot Squat (relentless squats; zero variety). Quest Move / YUR (cross-game rings, streaks, XP; calories without HR distrusted).

### Gemini's 10 gaps, ranked

1. **Zero-friction reconnect + "10-second sweat" launch**: persistent pair token on both ends so the bridge reconnects without typing a code; Quick Start that begins warm-up on the movement estimate and hot-swaps to live HR when the phone connects.
2. **Live HR-aware voice coaching**: 35-45 short clips (1-3 s) triggered by the HR state machine, routed through the 3-tier call-out queue so the coach never talks over itself.
3. **Act-based music palettes**: 3-4 royalty-free / procedural sound packs, switching per act or per weekly day, keeping the time-stretch and zone filter.
4. **Swappable low-poly biomes per act**: sky/fog/rail palettes cross-faded at act boundaries.
5. **Export**: .TCX with the 1 Hz HR array for Strava/Garmin/Apple Health; PNG summary card of the end board.
6. **Pose walls** (OhShape): a 2.5 s silhouette wall with two hand rings (overhead Y, low squat guard, wide cross) the player holds both hands and head inside; fits the lane booking.
7. **Power-graded hits on every strike**: Tap / Solid / Heavy tiers with sound, flash, 1.5x score and haptics; Power % on the end board.
8. **Named 4-week programs + badges**: 3 tracks nudging target BPM +2/week or length +2 min/week; 10-12 badges; one streak freeze a week.
9. **Zone-lock ghost**: save the reactor charge % per second from the best session of each weekly day; show a ghost reactor ring ahead/behind.
10. **Guided cool-down + 1-minute heart-rate recovery (HRR)**: ghost coach leads reaches, side bends, breathing; the BPM drop in the first 60 s after training becomes a fitness metric.

### Do NOT copy (Gemini)
Subscription/account walls; fixed difficulty tiers and non-adaptive choreography; 360 turns and room-scale footwork; raw-score leaderboards and live PvP (reward wrist flicks and panic sprinting); uncalibrated calorie counters.

## Morty's answer (Muse "space": VR Fitness vs PulseZone, sources checked 19 Nov 2026)

Headline: "Everyone displays heart rate. Almost no one plays with it." 16 titles compared. No major title verifiably changes gameplay from live HR (Supernatural legacy = display only, Supernatural Health relaunch Oct 2026 at $20/mo has HR "still to come"; FitXR none in-game; HoloFit shows HR vs a preset curve; YUR.fit overlay only; Quest Move had no HR and was discontinued 31 Mar 2025; XRWorkout claims HR-adaptive difficulty in store copy, unverified). Do not cite the buyers guide claiming Supernatural went HR-responsive in 2026.

Comparison matrix rows where PulseZone is partial/missing: human coach voice (partial: ghost, no voice), form cues / form scoring (partial: hit only), licensed music (missing), custom/user music (missing), named classes/programs (partial: shapes and acts, unnamed), leaderboards/ghost scores (partial: personal bests only), multiplayer (missing), varied worlds (partial: lighting only).

### Morty's 10 gaps, ranked (retention / HR-output scores out of 100)
1. **A named workout every day** (96/55): "Today: Steady, 22 min. Tomorrow: Harbour Lights - Waves." Same engine, a name, cover colour, act titles and one featured station per day from a template bank on weekly rotation, pinned on the landing panel. Pair with the weekly plan; a named streak stings more to break.
2. **A voice coach who talks about your heart** (92/78): one synthesised coach voice with a tight script bank: form cues, effort cues keyed to the PID state ("you're 8 below, bigger swings"), charge & coast narration ("hold... hold... land it"). Keep a mute.
3. **The HR boss as the weekly finale** (88/94): vulnerable only in zone, shield regens below, overheats into a breathing window above; the landing verdict becomes its damage numbers; ship as the plan's Sunday boss, not a random event.
4. **Levels, badges and unlocks** (90/40): a local level curve fed by minutes-in-zone (not score), badges for real behaviours (first perfect landing, 3x in one week, first Waves completion), cosmetic unlocks (world colour themes, orb trails, coach outfits). All local.
5. **One-tap start, kill the bridge tax** (89/35): remember the last bridge, auto-reconnect on page load, a pre-flight checklist that goes green line by line, "Start without HR (estimated)" fallback. Measure seconds-from-open-to-first-orb.
6. **Async ghosts and a friends-of-one leaderboard** (82/58): race "last Tuesday's you" as a pace ghost in spotlight rounds; shareable result cards.
7. **Form and power scoring** (62/92): grade every move Clean / Short / Flicked from hand velocity + travel at impact, squat depth from headset height, two-hand symmetry on ropes; feed it to the learner (a flicked jab has low HR value); gives the voice coach something true to say.
8. **Music with variety** (78/52): 6-8 procedural synth "sets" (tempo curves, timbres, act-mapped energy) so Tuesday doesn't sound like Thursday; bring-your-own-audio with on-device beat detection, no file leaves the device.
9. **Worlds that change by day and by zone** (74/45): simple-geometry themes (harbour dawn, reactor core, snowfield, dojo), one per weekday tied to the named workout; fog, palette, skybox gradient, a few silhouettes.
10. **A plan that adapts to recovery** (?): missed days become a short "restart" session, never a guilt debt; end-of-workout adds one line of interpretation ("your HR recovered 22 bpm in the first cool-down minute, best this month") so the HR graph becomes a story about fitness improving.

### Do NOT copy (Morty)
Licensed music and photoreal locations; filmed human coaches; a subscription; room-scale and stepping movement; real multiplayer / ranked PvP; machine integration (bike/rower); plus others in the page.

## Built in v57 from the two lists
- Power-graded hits (Gemini 7, Morty 7): tap / solid / HEAVY tiers, heavy x1.5 with a bigger boom, avg punch power on the end board.
- Pose walls (Gemini 6): Y, T and squat-press holds through a body-shaped wall with two fist rings.
- Voice coach (Gemini 2, Morty 2): browser speech, lines tied to zone / charge / coast / landing / acts / streaks / cool-down; "Coach voice" toggle on the board.
- 1-minute heart-rate recovery on the end board and a spoken, guided cool-down (Gemini 10, Morty 10).
- TCX export on the phone bridge page (Gemini 5).
Built in v58 (see SESSION_LOG_2026-11-19.md): named daily workouts, the Guardian boss, levels/badges, ghost of your last run, music sets, worlds, PNG share card, voice clips that work without browser speech, a restart session after a week away. Still open: quick-start without HR (Gemini 1, Morty 5), 4-week tracks that raise the target (changes the zone: needs Gio), bring-your-own music.
