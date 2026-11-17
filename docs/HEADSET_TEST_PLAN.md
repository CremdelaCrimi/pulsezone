# Headset test plan (about 20 minutes)

For the first headset session after the 2026-11-16 autonomous build day. Drafted with Gemini, adjusted to how the game actually behaves. Everything here is new and has only been tested on a desktop auto-player.

## Before you start (2 min)

1. iPhone: open the bridge page in Bluefy, connect the Charge 6 (Broadcast HR on), and turn on Guided Access so the phone stays awake.
2. Quest: open https://cremdelacrimi.github.io/pulsezone/ (close and reopen the tab so you get the newest version), pair with the phone code.
3. Options board (Y or B):
   - Workout length **15 min**, warm-up **30 s**, workout shape **Steady** (a flat target gives a clean baseline for judging the heart-rate control; try Waves in a second session).
   - Leave the other new features on: side shifts, spotlight rounds, song breakdowns, combos and the breathing pacer each only kick in when relevant, and the Diag line and CSV show when they did.
   - **Test** row: turn **Diag** on. The bottom line of the scoreboard now shows what the game is doing.
4. Enter VR. **Music check:** the song should start as you enter VR (or on your first trigger pull). If you see "Song blocked", note it.

## 0:00–2:00 Try each new move on demand

Open the options board and press one Test button at a time; the board closes and the move comes within a few seconds.

| Button | What to try | Write down |
|---|---|---|
| **Knee** (Test → Knee) | Grab the mint bar overhead with both hands, pull it down to your waist with a small crunch as you drive the lit knee up. 2 reps, alternating knees | Grips easy to find? Does the pull count every time? (Knees can't be tracked: it's judged from your hands and head) |
| **Press** (Test 3) | Wall ball: squat low (25 cm+), then stand and press both fists up to the ring on the ceiling | Squat depth fair? Press counting? |
| **Chop** (Test 3) | Both hands on the orb high on one side, chop diagonally down to the ring by the opposite hip | Path clear? Counting? |
| **Tiptoe** (Test 3) | Rise onto your toes and touch the star just out of reach; 2 stars, alternating hands | Star height right for your reach? Does it notice the tiptoe? |
| **2 ropes** | Follow both ropes, then smash the gold bar down with both fists | Rope catch OK? Slam: did it register? Bar too high/low? (needs both fists moving down ≥ 1.1 m/s within 0.3 s) |
| **Hammer** | Strike DOWN onto the drum pad with the bottom of your fist, alternating hands | Registers coming down? Pad height OK? |
| **Combo** | Punch the 2–4 orbs on the beat | Did they land on the beat? Did COMBO CLEAR show? |
| **Heavy** (Test 2 row) | Hit the lit patch with the called punch (hooks on the front corners, uppercut on the lower curve); a white flash shows each new target first | Patches easy to reach? Uppercut patch too low? Did hard punches feel rewarded? |
| **Sled** | Copy the ghost coach (front right): stand tall, arms up, then squat and push both poles down and back. Skis under your feet | Coach clear? Can you see your skis? Reps registering (both fists down ≥ 1.0 m/s within 0.35 s, head 15 cm lower)? |
| **Missiles** | Keep your head moving: each missile curves in from a side, above or below, whistles when it locks, then you have 0.7 s to lean or duck | Read as missiles? Fair? Did the whistle help? |
| **Speed / Ropes** | Ropes: the meter under the scoreboard shows GOOD / HARD x1.5 / MAX x2; sparks fly when you go hard | Is MAX reachable but hard? Do the sparks feel rewarding? |
| **Walls** | Test 2 → Walls sends a duck, lean or side-squat wall (whichever are on) | Clear which way to move? |

Also notice the first time each one appears: see-through ghost fists should demonstrate it (first two times ever).

## 2:00–8:00 The climb

- Push hard while below your zone. Watch the green **▲ CLIMBING** and the Diag line's `effort->X vs Y`.
  - Write down: does CLIMBING show while your heart rate is genuinely rising, and stop once you're in? Does it come on when you're not really working?
- When you enter the zone: the song should open up and get more bass; a bell chord every 15 s (zone streak).
- Song breakdowns: about every 48 seconds the song thins out for a few bars; your next big hit (power orb, slam, combo clear) brings it back.
- At **3:00 of training**, a **SPOTLIGHT** round (60 s) features one move.
- Stand-tall: after any duck or squat box, a low "Stand tall!" box follows. Write down if the gap feels too short.

## 8:00–12:00 Overshoot and recovery

- Push yourself above the zone once (or lower the target a few BPM on the board). The reactor cage should breathe (4 s in, 6 s out) with "Breathe with the reactor".
  - Write down: calming or distracting? Did your heart rate come down?
- Check the Diag line never shows **SENSOR FLAT** unless your band really stopped updating.

## 12:00–end

- Notice frame smoothness when the in-zone effects, shards and pop-ups overlap.
- Let it finish. The end board shows your heart-rate graph, time in zone, and your top 3 heart-raising moves. With Diag on it also shows a test report (slams, guards, walls, time above the zone, stuck-sensor time, notes).

## Second session (optional): Waves

Set the workout shape to **Waves**: about 30 s into training you'll get **WAVE UP** (+5 BPM), then **RECOVERY WAVE** (−5 BPM) about 3 minutes later. Check the CLIMBING/SETTLING arrows follow the moving target and the end graph's band follows the waves.

## Bookmarks during the session

On the options board, the **Note** row stamps the current second in the workout log: **Slam missed**, **Rep missed**, **Too fast**, **Felt great**. Use it the moment something feels off; you won't remember the minute later.

## Afterwards (write down)

- Thresholds: slam speed (1.1 m/s), guard distance (34 cm), stand-tall gap, ±35 cm side shift, sled stroke speed (1.0 m/s) and tuck (15 cm), bomb lock time (0.7 s).
- Which new move raised your heart rate most: heavy bag, sled or bombs? (The end board's top 3 should agree after a few workouts.)
- Music on Quest: did it play, any glitches, did the zone filter feel good?
- HUD: anything still too busy at peak effort?
- Did the top 3 moves on the end board match what felt hardest?
- On the game page (desktop or the Quest's 2D page), **Developer tools → Download last workout (CSV)**. Columns `reason`, `effort_bpm`, `trend`, `note` show what the game did and where you bookmarked.
