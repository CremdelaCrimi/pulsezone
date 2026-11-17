# PulseZone VR: Game Design Brief

A brainstorming reference for PulseZone, a heart-rate-adaptive VR workout for Meta Quest.
Live game: https://cremdelacrimi.github.io/pulsezone/ · iPhone bridge: https://cremdelacrimi.github.io/pulsezone/bridge.html
Last updated: 2026-11-17 (v53, after five rounds of headset feedback).

## 1. Core idea

The player picks a target heart rate (for example 120 BPM). The game reads their real heart rate from a Fitbit Charge 6 and continuously adjusts how hard the game is so the player's heart rate stays in a zone around that target (target ± 5 BPM).

- Below the zone: the game speeds up, sends more and harder moves, and the music speeds up to pull the player along.
- In the zone: the game holds steady and rewards the player (double points, the world lights up, the reactor charges).
- Above the zone: the game eases off, sends easier moves, and the music slows down.

It is a fitness game where the "difficulty slider" is driven by the body, not by menus.

## 2. Platform and hardware

- Runs in the Meta Quest Browser as a WebXR web page (three.js). No install, no developer mode.
- Heart rate path: Charge 6 → Bluetooth → iPhone (Bluefy browser, bridge page) → direct WebRTC link → Quest.
  - The player pairs phone and headset with a 6-character code shown in the game.
- If the phone goes quiet (screen lock), after 6 seconds the game falls back to an estimate based on the player's movement (shown as "~118" in a muted colour, with an alert sound), then switches back when the phone reconnects (two-tone chime).
- A built-in heart simulator allows testing without a tracker.
- Performance budget: Quest browser, so everything is simple geometry, instanced meshes, no post-processing.

## 3. Workout structure

- Phases: warm-up (30 s by default, adjustable from off to 5 min) → training (length set by the player) → cool-down (2 min) → finished screen.
- Workout shape (player's choice): Steady; Waves (target ±5 BPM on a 6-minute cycle, smooth ~40 s changes); Build & peak (from −6 to +6 BPM by 80% of training). Always ≥ 8 BPM under the safety ceiling.
- The target ramps up during warm-up instead of jumping, front-loaded (ease-out) so the player reaches the zone sooner.
- **End workout** (top of the options board) starts the cool-down; pressed again (it then reads **Finish now**) it ends straight away.
- Safety ceiling: estimated max heart rate = 208 − 0.7 × age. If heart rate gets close to it, a safety brake cuts intensity hard. (Not a medical device.)
- If the heart signal is lost, intensity holds rather than spiking.

## 4. The difficulty engine

### 4.1 Zone controller (PID)
A PID controller turns "how far am I from the target heart rate" into a single **intensity** value from 0 to 1. Intensity changes by at most about 2% per second (heart rate lags effort by 30–40 seconds, so the controller is deliberately slow). It starts at 0.25. **Catch-up:** when heart rate is well below the zone (more than 2× the zone half-width) and not yet climbing, the integral builds 3× faster and intensity may move 1.5× faster; once heart rate starts rising it returns to normal, to avoid overshooting.

### 4.2 What intensity changes
Spawn interval, orb speed, how widely orbs are spread (narrowed after play-testing: at most ±45 cm, ±50 cm with the boost), how likely walls are, minimum punch speed and travel, how often orbs need a directional swing or a cross-body punch, which moves are unlocked.

### 4.3 Challenge boost (when heart rate stalls)
If the player sits below the zone for about 15 seconds without heart rate rising (or intensity is already maxed), a **challenge boost** builds over about 45 seconds: faster spawns, faster orbs, more of the moves that work for this player, and **bursts** (speed bag, battle ropes) become the main tool. It fades once the player reaches the zone. It never builds while the effort estimate says the player is already climbing into the zone (it drains instead), to avoid overshooting above the zone, and it holds still while the heart rate is only estimated (phone asleep) or the sensor looks stuck.

### 4.4 Learning what raises THIS player's heart rate
- Model: heart rate ≈ baseline + Σ (gain × recent reps per minute of each activity), rep rates smoothed over ~35 s for heart lag, updated online (NLMS).
- Each activity starts with a prior guess; gains can't collapse below a floor.
- Below the zone, the mix shifts toward what raises this player's heart rate most; above it, toward easier punches.
- Saved in the browser; the options board shows "What raises YOUR heart rate"; the end screen names the best activity.
- Only real phone heart rate trains it (not the simulator, not the movement estimate while the phone sleeps, not a stuck sensor). New players learn ~3x faster for their first ~10 minutes of real data.
- Only reps the player actually did count: orbs hit, walls cleared, guard shots blocked, ropes followed ≥ 30% (missed or failed moves teach nothing).
- Stuck-sensor guard: the same phone BPM for > 25 s while below the zone and clearly working → no learning, the challenge boost holds, one call-out to check the band.
- This is how "fun" moves are judged: if rope tracing turns out to barely move heart rate, it gets sent less when the player needs to push.

### 4.4b Spotlight rounds
Every 4 minutes of training (first at 3:00) one move is featured for 60 s (2.5x weight). Below the zone it's picked from the player's top 3 learned heart-raisers, and only from moves unlocked at the current intensity; above the zone the round is cancelled.

### 4.5 Lane spacing (nothing overlaps)
Everything flies down one lane. Each thing books a time slot for when it reaches the player. Plain orbs can come in groups, but ropes, wall boxes, power orbs, pairs and guard shots get the lane to themselves with a short gap before and after. Bursts wait for an empty lane. Nothing flies through anything else. **Every new move must fit into this booking.**

## 5. Moves (the moveset)

| Activity | What the player does | Unlocks at intensity | Prior HR effect |
|---|---|---|---|
| Punch (jab) | Punch an orb with the matching hand | 0 | 0.5 |
| Squat punch | Orb at knee-to-hip height: squat and punch | 0.15 | 1.2 |
| Hook / uppercut | Orb with a curved guide: swing along the curve | 0.25 | 0.7 |
| Power orb | Faceted, armoured orb: needs a full, fast punch; shatters with a boom | 0.3 | 0.9 |
| Squat + reach pair | A low orb then a high orb for the other hand (squat, then uppercut up) | 0.25 | 1.4 |
| Hammer fists | A left-then-right pair of drum pads at chest height: strike DOWN with the bottom of the fist. Once warmed up, 40% of pairs come low (squat + hammer) | 0.15 | 1.0 |
| Guard & counter | (Off by default since v52: the player didn't find it fun.) A hot shot flies at your face: block, then punch the counter orb | 0.3 | 0.9 |
| Rope tracing | Keep one hand on a curving rope as it slides past a ring | 0.2 | 0.8 |
| Two-hand rope | Two ropes side by side (one per hand) sweep wide left/right and dip low | 0.3 | 1.2 |
| Duck | Duck under a wall box | 0.15 | 1.2 |
| Lean / pillar | Lean left/right, or step around a centre pillar | 0.25 | 1.0 |
| Side squat | Squat and shift left or right through a gap | 0.4 | 1.6 |
| Stand tall (auto) | After every duck/squat box: a low box you must stand fully up over | follows squats | — |
| Speed bag (burst) | 4–5 s of rapid alternating punches on a bag | 0.35, or early when stuck | 0.3 per punch |
| Heavy bag (burst) | 6 s on a big bag; a lit patch (hand-coloured) shows left hook / right hook / uppercut / power; hard punches score more, the lit patch doubles it | 0.4, or early when stuck | 0.9 per strong punch |
| Sled run (burst) | 8 s: squat into a tuck and double-pole (both fists down together); skis under your feet and a ghost coach to copy; tucked strokes 1.5x, tuck time scores | 0.45, or early when stuck | 1.5 per stroke |
| Dodge barrage | 4–6 missiles (were bombs) ~0.8 s apart that follow your head until 0.7 s out, then lock; lean/duck/shift 20 cm+ to dodge (core work). Own tally (bombs hit x/y), not counted as walls | 0.3 | 1.3 per dodge |
| Battle ropes (burst) | 6 s of pumping both arms; an intensity meter (PUMP / GOOD / HARD x1.5 / MAX x2) with sparks for going harder | 0.45, or early when stuck | 1.6 per second |
| Knee drive (station) | Grab the bar overhead, pull it down to the waist as the lit knee drives up. 4 reps, alternating knees. Judged from hands + head (knees aren't tracked) | 0.3 | 1.5 |
| Squat + ceiling press (station) | Wall ball: squat 25 cm+, stand and press both fists to the ceiling ring. 3 reps | 0.3 | 1.6 |
| Woodchopper (station) | Both hands on a high orb, chop across to the opposite hip ring. 4 reps, switching sides each chop | 0.25 | 1.2 |
| Tiptoe reach (station) | Rise onto your toes to touch a star just out of reach. 4 stars, alternating hands | 0.15 | 0.6 |
| Boxing combo | 2–4 orbs one beat apart (1-2, 1-1-2, 1-2-hook, 1-2-1-upper, squat-squat-hook-hook); bonus + floating COMBO CLEAR for clearing it | replaces a plain punch, 25–60% chance from intensity 0.25, at most ~every 9 s | (counts as its punches) |
| Side shift (footwork) | Below the zone: for 8 s plain orbs come 35 cm to one side; a floor pad shows where to step; walls/ropes/bursts wait | below zone, intensity ≥ 0.35 or boost | — (part of the orbs) |
| Finishing slam (auto) | After battle ropes and two-hand ropes: a wide gold bar at head height; smash it DOWN with both fists together (within 0.3 s) | follows ropes | — |

The player chooses their moveset with checkboxes (game page and VR options board, kept in sync). If everything is off, the game falls back to plain punches.

## 6. Mechanics in detail

### 6.1 Orbs
- Colour by hand: **blue = left, orange = right**. Wrong hand doesn't count.
- **Punch mode:** the fist must be moving fast enough AND have travelled far enough (anti wrist-flick: 13–22 cm in the last 0.15 s; 32 cm for power orbs).
- **Touch mode:** hold the hand where the orb arrives (hooks, uppercuts and power orbs are skipped).
- **Hit feel:** a brief white flash, then the orb shatters into shards; sound and haptics scale with punch power.
- Swing orbs show a glowing curve and a ghost fist; following it doubles points.

### 6.2 Walls (boxes)
- Purple boxes with an open gap; the box's length shows how long to hold (duck 1.2 s, squat 1.0 s, lean 0.8 s, pillar 0.6 s, stand tall 0.6 s).
- Hit if the head is inside the solid part while the box passes.

### 6.3 Rope tracing
- A glowing rope in the hand's colour flows toward the player, curving and dipping. A ring marks where it meets arm's reach; it turns green while the hand is on the rope, with a light buzz.
- Forgiving catch (after play-test feedback): on the rope within 20 cm sideways, anywhere 35 cm in front of or behind the ring (shown as a faint sleeve), and a wobble up to 27 cm doesn't knock you off.
- Score depends on the fraction of time on the rope.

### 6.4 Stations, coach, guard, reactor
- **Stations** (knee drive, wall ball, woodchopper, tiptoe) fly in, stop 45 cm in front of the player and wait while they do the reps; a label shows what to do, reps and time left. Arrows (like the hook guides, with a sliding dot) show the motion. A **ghost coach** to the right loops the move with captions and mirrors the player's lit side. Bursts never start while a station is waiting.
- Guard (off by default): a white shot with a teal shield glow (no hand colour, so it isn't mistaken for an orb to punch). Both fists within ~34 cm of the head, in front of the face. Block = points + a counter orb from close range.
- Reactor (right of the HUD): charges while in the zone; level-ups give bonus points; shows overheat when above the zone and "stalled" below.

### 6.5 Scoring
Points per hit, combo, best combo; double in the zone; perfect swings double again.

## 7. Feedback, visuals and HUD
- Heat gauge (thermometer) on the left: frosty below the zone, a lively flame in the zone, a hyper flame above.
- In-world scoreboard: heart rate, target, phase and time, intensity, score, combo, challenge boost, phone status and pairing code, short call-outs ("Stand tall!", "Ride the rope!", "Perfect hook!").
- **In the zone, the world lights up:** equalizer pillars pulse to the beat along the lane, embers drift up, fists leave glowing trails, the lane rails turn from blue to orange, the sky warms.
- Breathing pacer above the zone: the reactor cage breathes 4 s in / 6 s out with BREATHE IN / OUT on the scoreboard.
- Controller haptics on hits, blocks and while on the rope; a wrong-hand hit double-buzzes the correct controller.
- **Drift guard:** more than 55 cm from where you should be (centre or the side-shift spot) shows an amber floor arrow pointing back.
- **Spotlight** line on the scoreboard during a spotlight round, with a countdown; **combo clear** pops a floating "COMBO CLEAR +N".
- **First-time hints:** the first two times a player meets a guard shot, rope, two-hand rope or slam bar, see-through ghost fists demonstrate the move.
- **Call-out priority (round 5):** tier 1 do-this-now / safety, tier 2 workout news, tier 3 praise; a lower tier can't replace a higher one still showing (1.8 s). Per-hit points float at the orb in world space. CHALLENGE % text removed (the red glow past the intensity bar shows it); breathing is one steady line.
- **Heart-lag bridge:** when you're below the zone but a ~12 s effort estimate (from the learning model) says your heart rate is heading into it, the scoreboard shows a green ▲ and "CLIMBING"; above the zone, "SETTLING" with a ▼ once you've eased off enough.
- **Zone streaks:** every 15 s in the zone: a rising bell chord, the rails flare, bonus points and reactor charge; the current streak is on the scoreboard.
- **End-of-workout board:** heart-rate graph (coloured by zone) over the target band, time in zone %, average/peak, longest streak, score, reactor level, top heart-raising move.
- **Personal bests** (time in zone %, streak, score, reactor) saved in the browser, gold NEW BEST tags, and a "To beat" line during warm-up.

## 8. Music and sound (pace-leading audio)
- **Song mode:** "Hard-Knuckle Focus" (121 BPM), time-stretched 0.78×–1.25× with pitch preserved to lead the player's pace. On Quest it starts from a button press (enter VR / trigger); if blocked, the synth plays instead.
- The song is filtered by zone (muffled well below, opening as you climb, +4 dB bass in the zone) and ducks under big hits. Every 24 bars a 4-bar breakdown thins it out (high-pass ~380 Hz, no bass boost); the next big hit slams it back in. Only in the zone (below it the music keeps driving urgency); tempo and spawns untouched.
- **Synth mode:** live procedural music (kick, clap, hats, bass, pad, arpeggio); icy bells below the zone, bright arpeggio in it, a soft heartbeat at the real BPM.
- Sound effects for hits (scaled by power), power smash, block, bag taps, burst warning, perfect swing, weak punch, wrong hand, miss, wall hit, dodge, entering the zone, finishing.

## 9. Options and settings
- **Test tools:** a **Diag** toggle on the VR board shows a diagnostics line (intensity, boost, heading-to vs now, what was sent and why, learned top move, learning speed, SENSOR FLAT) and reveals **Test** buttons (Guard / 2 ropes / Shift / Combo: send that move next) and **Note** buttons (Slam missed / Guard picky / Too fast / Felt great: bookmark the CSV). With Diag on, the end board adds a test report (slams, guards, walls hit, time above zone, stuck-sensor time, notes). The CSV logs last_sent, reason, effort_bpm, trend, spotlight, shift, learned_top, note. A 20-minute plan is in docs/HEADSET_TEST_PLAN.md.
- **VR options board** (Y or B; laser + trigger; pauses the workout): target BPM, warm-up, workout length, workout shape (Steady / Waves / Build), heart rate source, game type (Punch/Touch), moveset (Orbs / More incl. 2 ropes / Bursts / Walls incl. Shift rows), music on/off and volume, music style, challenge level (Gentle/Normal/Hard), the learned ranking. Restart / End workout (then Finish now) / Save data / Close sit at the top. Rows: Orbs (incl. Hammer), More, Body (Knee, Press, Chop, Tiptoe), Bursts (incl. Missiles), Walls. Test rows: Knee / 2 ropes / Hammer / Combo; Heavy / Sled / Missiles / Speed / Ropes / Walls; Press / Chop / Tiptoe.
- **Workout data:** the headset keeps the last 12 workouts (per-second log + events such as station grabs, reps and missed pulls with how far the player pulled). At the end of each workout it's sent to the phone bridge page (Save workout file); Save data on the board downloads them all.
- **Game page (desktop):** the same plus the phone code; developer tools (tuning, workout CSV download, reset learned data).

## 10. Design principles
- The body is the difficulty slider; the player shouldn't need to manage difficulty.
- Never punish imperfect form harshly; reward good form with bonuses.
- Make timing and duration visible (box lengths, rope path, swing guides, catch zones).
- Change smoothly: heart rate lags.
- Personalise: learn which moves raise each player's heart rate.
- Music leads the pace.
- Player choice: moveset and game type are the player's call.
- Spacing: one thing at a time where it matters; nothing overlaps.
- Quest performance first.

## 11. Play-test feedback so far (2026-11-16)
- "A lot better and fun." Battle ropes were great.
- Rope tracing was too strict → loosened (done).
- Players stayed squatted between squat boxes → stand-tall boxes (done).
- Wanted a two-handed rope variation → two-hand rope (done).
- Song music was silent on Quest → fixed to start from button presses (needs re-test).
- Warm-up felt too long → 30 s default, adjustable (done).
- Second round (after more play): punch orbs too wide → narrowed (done). Loved the speed bag → added a heavy bag with hooks/uppercuts (done). Ropes fantastic → added a sled run (tuck + double-pole) (done). Core dodging of shots at the head in another game raised heart rate a lot → dodge barrage (done).
- Open question: how much does each "fun" move actually raise heart rate? (the learned ranking answers this over several workouts)

## 11b. Later play-test rounds (2026-11-16 to 17)
- Round 4: sled needed clearer skis and a demo of the motion → skis + ghost coach (done). Ropes: show intensity and reward going harder → meter + sparks (done). Bombs → missiles (done).
- After v52: "a lot of fun", but guard & counter wasn't fun → off. Wanted multi-muscle moves → four stations (done).
- After v52 play: the coach is very effective → a coach for every complex move (done). Knee drive too hard to register and needed a direction arrow → loosened + arrows (done). More hammer fists, more reps on chop and press, more squat-into-punch (done). Too slow to reach target BPM → catch-up (done). End workout didn't end → Finish now (done).

## 12. Not yet tested in the headset
Everything in v53 (coach for stations, new knee thresholds, hammer pairs, catch-up ramp, Finish now, phone hand-off on a real iPhone, Save data download in the Quest browser). Also everything added on 2026-11-16 morning (slam bar height and 1.1 m/s threshold, side-shift comfort, combos' beat timing, waves, spotlight, breathing pacer, song filter), the climbing cue's accuracy with a real heart, heavy bag patch reach, sled stroke thresholds (1.0 m/s down, both fists within 0.35 s) and tuck depth (15 cm), bomb tracking/lock time (0.7 s), guard detection distance, speed bag distance, rope pump speed, zone visuals' frame rate, the music fix, the two-hand rope, stand-tall timing.

## 12b. Robustness checks done (2026-11-16)
- Two independent code reviews (10:11 and 10:59) found 7 real bugs, all fixed (e.g. side-shift call-out spam, Build warm-up jump, simulator data being learned, test moves dropped behind stand-up boxes, spotlight on locked moves).
- A third review (14:00) of the heavy bag, sled and bombs found 4 more (stacked test bursts, buried uppercut patch, small GPU leaks, clipped options buttons), all fixed.
- A sweep of six 4-minute auto-played workouts (Touch; ropes only; walls only; Build + Hard; everything off; Waves + Gentle punches only): 0 overlaps, 0 errors, no stuck queues.

## 13. Rejected or reworked ideas
- 40/20 Tabata intervals: heart rate lags 30–40 s, so fixed short intervals fight the controller (consider effort-based or 2–3 min HR-gated intervals instead).
- 45–90° portal turns: disorienting in a tethered-lane design (small lane shifts may be OK).
- Knee strikes: no leg tracking on Quest (reworked as the pull-down knee drive, judged from the hands and head).
- Side shifts and stepping punches: off by default; players should stay on their centre line (safety).
- 45-second "pure" move-family blocks to speed up learning: postponed (touches the spawner right before a headset test; faster early learning + spotlight rounds cover part of it).
