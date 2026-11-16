# PulseZone VR: Game Design Brief

A brainstorming reference for PulseZone, a heart-rate-adaptive VR workout for Meta Quest.
Live game: https://cremdelacrimi.github.io/pulsezone/ · iPhone bridge: https://cremdelacrimi.github.io/pulsezone/bridge.html
Last updated: 2026-11-16 (after the first headset play test).

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
- If the phone goes quiet (screen lock), after 6 seconds the game falls back to an estimate based on the player's movement, then switches back when the phone reconnects.
- A built-in heart simulator allows testing without a tracker.
- Performance budget: Quest browser, so everything is simple geometry, instanced meshes, no post-processing.

## 3. Workout structure

- Phases: warm-up (30 s by default, adjustable from off to 5 min) → training (length set by the player) → cool-down (2 min) → finished screen.
- Workout shape (player's choice): Steady; Waves (target ±5 BPM on a 6-minute cycle, smooth ~40 s changes); Build & peak (from −6 to +6 BPM by 80% of training). Always ≥ 8 BPM under the safety ceiling.
- The target ramps up gradually during warm-up instead of jumping.
- Safety ceiling: estimated max heart rate = 208 − 0.7 × age. If heart rate gets close to it, a safety brake cuts intensity hard. (Not a medical device.)
- If the heart signal is lost, intensity holds rather than spiking.

## 4. The difficulty engine

### 4.1 Zone controller (PID)
A PID controller turns "how far am I from the target heart rate" into a single **intensity** value from 0 to 1. Intensity changes by at most about 2% per second (heart rate lags effort by 30–40 seconds, so the controller is deliberately slow).

### 4.2 What intensity changes
Spawn interval, orb speed, how widely orbs are spread, how likely walls are, minimum punch speed and travel, how often orbs need a directional swing or a cross-body punch, which moves are unlocked.

### 4.3 Challenge boost (when heart rate stalls)
If the player sits below the zone for about 15 seconds without heart rate rising (or intensity is already maxed), a **challenge boost** builds over about 45 seconds: faster spawns, faster orbs, more of the moves that work for this player, and **bursts** (speed bag, battle ropes) become the main tool. It fades once the player reaches the zone. It never builds while the effort estimate says the player is already climbing into the zone (it drains instead), to avoid overshooting above the zone.

### 4.4 Learning what raises THIS player's heart rate
- Model: heart rate ≈ baseline + Σ (gain × recent reps per minute of each activity), rep rates smoothed over ~35 s for heart lag, updated online (NLMS).
- Each activity starts with a prior guess; gains can't collapse below a floor.
- Below the zone, the mix shifts toward what raises this player's heart rate most; above it, toward easier punches.
- Saved in the browser; the options board shows "What raises YOUR heart rate"; the end screen names the best activity.
- This is how "fun" moves are judged: if rope tracing turns out to barely move heart rate, it gets sent less when the player needs to push.

### 4.5 Lane spacing (nothing overlaps)
Everything flies down one lane. Each thing books a time slot for when it reaches the player. Plain orbs can come in groups, but ropes, wall boxes, power orbs, pairs and guard shots get the lane to themselves with a short gap before and after. Bursts wait for an empty lane. Nothing flies through anything else. **Every new move must fit into this booking.**

## 5. Moves (the moveset)

| Activity | What the player does | Unlocks at intensity | Prior HR effect |
|---|---|---|---|
| Punch (jab) | Punch an orb with the matching hand | 0 | 0.5 |
| Squat punch | Orb at knee-to-hip height: squat and punch | 0.2 | 1.2 |
| Hook / uppercut | Orb with a curved guide: swing along the curve | 0.25 | 0.7 |
| Power orb | Faceted, armoured orb: needs a full, fast punch; shatters with a boom | 0.3 | 0.9 |
| Squat + reach pair | A low orb then a high orb for the other hand (squat, then uppercut up) | 0.3 | 1.4 |
| Guard & counter | A red "hot shot" flies at your face: raise both fists to your chin to block, then punch the counter orb | 0.3 | 0.9 |
| Rope tracing | Keep one hand on a curving rope as it slides past a ring | 0.2 | 0.8 |
| Two-hand rope | Two ropes side by side (one per hand) sweep wide left/right and dip low | 0.3 | 1.2 |
| Duck | Duck under a wall box | 0.15 | 1.2 |
| Lean / pillar | Lean left/right, or step around a centre pillar | 0.25 | 1.0 |
| Side squat | Squat and shift left or right through a gap | 0.4 | 1.6 |
| Stand tall (auto) | After every duck/squat box: a low box you must stand fully up over | follows squats | — |
| Speed bag (burst) | 4–5 s of rapid alternating punches on a bag | 0.35, or early when stuck | 0.3 per punch |
| Battle ropes (burst) | 6 s of pumping both arms; staying low scores 1.5× | 0.45, or early when stuck | 1.6 per second |
| Boxing combo | 2–4 orbs one beat apart (1-2, 1-1-2, 1-2-hook, 1-2-1-upper, squat-squat-hook-hook); bonus for clearing it | replaces a plain punch, 25–60% chance from intensity 0.25 | (counts as its punches) |
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

### 6.4 Guard & counter, bursts, reactor
- Guard: both fists within ~34 cm of the head, in front of the face. Block = points + a counter orb from close range.
- Reactor (right of the HUD): charges while in the zone; level-ups give bonus points; shows overheat when above the zone and "stalled" below.

### 6.5 Scoring
Points per hit, combo, best combo; double in the zone; perfect swings double again.

## 7. Feedback, visuals and HUD
- Heat gauge (thermometer) on the left: frosty below the zone, a lively flame in the zone, a hyper flame above.
- In-world scoreboard: heart rate, target, phase and time, intensity, score, combo, challenge boost, phone status and pairing code, short call-outs ("Stand tall!", "Ride the rope!", "Perfect hook!").
- **In the zone, the world lights up:** equalizer pillars pulse to the beat along the lane, embers drift up, fists leave glowing trails, the lane rails turn from blue to orange, the sky warms.
- Breathing pacer above the zone: the reactor cage breathes 4 s in / 6 s out with BREATHE IN / OUT on the scoreboard.
- Controller haptics on hits, blocks and while on the rope; a wrong-hand hit double-buzzes the correct controller.
- **First-time hints:** the first two times a player meets a guard shot, rope, two-hand rope or slam bar, see-through ghost fists demonstrate the move.
- **Heart-lag bridge:** when you're below the zone but a ~12 s effort estimate (from the learning model) says your heart rate is heading into it, the scoreboard shows a green ▲ and "CLIMBING – KEEP IT UP"; above the zone, "SETTLING" with a ▼ once you've eased off enough.
- **Zone streaks:** every 15 s in the zone: a rising bell chord, the rails flare, bonus points and reactor charge; the current streak is on the scoreboard.
- **End-of-workout board:** heart-rate graph (coloured by zone) over the target band, time in zone %, average/peak, longest streak, score, reactor level, top heart-raising move.
- **Personal bests** (time in zone %, streak, score, reactor) saved in the browser, gold NEW BEST tags, and a "To beat" line during warm-up.

## 8. Music and sound (pace-leading audio)
- **Song mode:** "Hard-Knuckle Focus" (121 BPM), time-stretched 0.78×–1.25× with pitch preserved to lead the player's pace. On Quest it starts from a button press (enter VR / trigger); if blocked, the synth plays instead.
- The song is filtered by zone (muffled well below, opening as you climb, +4 dB bass in the zone) and ducks under big hits.
- **Synth mode:** live procedural music (kick, clap, hats, bass, pad, arpeggio); icy bells below the zone, bright arpeggio in it, a soft heartbeat at the real BPM.
- Sound effects for hits (scaled by power), power smash, block, bag taps, burst warning, perfect swing, weak punch, wrong hand, miss, wall hit, dodge, entering the zone, finishing.

## 9. Options and settings
- **VR options board** (Y or B; laser + trigger; pauses the workout): target BPM, warm-up, workout length, heart rate source, game type (Punch/Touch), moveset (Orbs / More / Bursts / Walls rows), music on/off and volume, music style, challenge level (Gentle/Normal/Hard), the learned ranking, Restart / End workout / Close.
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
- Open question: how much does each "fun" move actually raise heart rate? (the learned ranking answers this over several workouts)

## 12. Not yet tested in the headset
The slam bar's height and downward-speed threshold, the climbing cue's accuracy with a real heart, guard detection distance, speed bag distance, rope pump speed, zone visuals' frame rate, the music fix, the two-hand rope, stand-tall timing.

## 13. Rejected or reworked ideas
- 40/20 Tabata intervals: heart rate lags 30–40 s, so fixed short intervals fight the controller (consider effort-based or 2–3 min HR-gated intervals instead).
- 45–90° portal turns: disorienting in a tethered-lane design (small lane shifts may be OK).
- Knee strikes: no leg tracking on Quest.
