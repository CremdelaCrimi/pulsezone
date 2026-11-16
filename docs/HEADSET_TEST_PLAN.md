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
| **Guard** | Raise both fists to your chin as the shot arrives | Did blocks register? Too picky? (detection: fists within ~34 cm of your head, in front of your face) |
| **2 ropes** | Follow both ropes, then smash the gold bar down with both fists | Rope catch OK? Slam: did it register? Bar too high/low? (needs both fists moving down ≥ 1.1 m/s within 0.3 s) |
| **Shift** | Step onto the floor pad when it says STEP LEFT/RIGHT | Comfortable? Pad visible? Did the drift arrow ever appear wrongly? |
| **Combo** | Punch the 2–4 orbs on the beat | Did they land on the beat? Did COMBO CLEAR show? |

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

On the options board, the **Note** row stamps the current second in the workout log: **Slam missed**, **Guard picky**, **Too fast**, **Felt great**. Use it the moment something feels off; you won't remember the minute later.

## Afterwards (write down)

- Thresholds: slam speed (1.1 m/s), guard distance (34 cm), stand-tall gap, ±35 cm side shift.
- Music on Quest: did it play, any glitches, did the zone filter feel good?
- HUD: anything still too busy at peak effort?
- Did the top 3 moves on the end board match what felt hardest?
- On the game page (desktop or the Quest's 2D page), **Developer tools → Download last workout (CSV)**. Columns `reason`, `effort_bpm`, `trend`, `note` show what the game did and where you bookmarked.
