# Session log 2026-11-20

## Workout 2026-11-20 19:58 (v61, TCX)

12.5 min, average 118, peak 139, 97 kcal. Minute by minute: 88, 106, 111, 118, 125, 122, 127, 123, 120, 128, 126, 119, 116.
Time in bands: under 100 = 60 s, 100-109 = 66 s, 110-114 = 79 s, 115-125 = 366 s (49%), over 125 = 177 s (24%).
The climb from 73 to 118 took about 3 minutes, then the rate stayed between 116 and 133 with one push to 139 at minute 9.

Gio's feedback after it:
- The new moves he designed (the kettlebell "hammer upwards" and the others) weren't in the game. Right: they were
  only proposals. v62 builds the hammer swing; the one-sided tree chop and arm jacks x5 are still to do.
- The move picker was "very blurry and goes left and right".
- Punches: "let's not make the balls random. Let's give it actual 1, 2, 3, 4, 5, 6 ... and some foot shifting ...
  so your jab is left hand or right hand depending on it, and go straight for the ones that need to be straight".

## v62

### Boxing numbers (js/core.js NUMBER_COMBOS, numberSteps, pickNumberCombo, STANCE; game.js spawnCombo / updateStance)
- Every punch the game picks (a jab or a hook/uppercut pick) is now a called combination, never a random orb:
  1 jab, 2 cross, 3 lead hook, 4 rear hook, 5 lead uppercut, 6 rear uppercut. Odd = lead hand, even = rear hand.
- Each orb wears its number (a sprite above it, tinted by hand). The call-out shows the combo, e.g. "1 - 2 - 3".
- 14 combos from 1-2 / 1-1-2 (warm-up) up to 1-2-3-4-5-6 (75%+ intensity). Picks lean toward the combos that just
  unlocked and never repeat the last one. Hooks/uppercuts switched off (or Touch mode) = straights only.
- Straights come down the middle: the jab 10 cm to the lead side, the cross 5 cm to the rear side. Hooks stay wide
  (28 cm), uppercuts low and 12 cm out.
- Stance: orthodox (left foot forward, left hand leads) to start. 90 s into training, then every 75 s, the coach
  calls "SWITCH STANCE! RIGHT foot forward - your 1 is now the RIGHT hand" and the numbers flip hands. It waits
  for bursts, stations and combos to finish, and the next combo waits 2.5 s so you can settle.
  Safety: a stance switch is swapping your feet front-to-back where you stand. No sideways step, so it keeps the
  stay-centred rule. Footprints on the floor at your feet show the stance (the lead foot is lit and pulses on a switch).
- Board: Diag -> Test 4 -> Stance switches stance now; Test -> Combo sends a numbered combo.
- Logged events: `numbers` (combo, stance) and `stance`.

### Hammer swing (Gio's kettlebell idea; station 'kettle')
- A sledgehammer stands low in front of you (about knee height, never under 42 cm off the floor) and a heavy bag
  hangs out front with its top lit at chest height.
- Rep (core.js kettleSwing): hinge (head 10 cm+ down) with both hands together low (92 cm+ below eye height) grabs
  it, then within 1.4 s hands up to chest height, 22 cm+ out in front, standing tall again = a swing. If the hands
  rose at 1.1 m/s or faster at some point it's a SMASH; slower still counts, with "Snap your hips - swing it faster!".
- 5 reps in 10 s. The hammer rides in your hands and tips forward as it rises; a smash jolts the bag; after the
  last one the bag drops away. The ghost coach shows the hinge -> snap.
- In the mix from 30% intensity (heaviest in THE BURN act), a spotlight candidate, a picker card with a preview,
  a board toggle (Body -> Swing) and a test button (Diag -> Test 4 -> Hammer swing). Logged `kettle` events carry
  fast and peakVy, so the speed threshold can be tuned from a real run.

### Move picker fixes
- It no longer follows your head: it's anchored where it opened, 1.3 m in front, and moves again only if you
  recentre or your standing height changes by 15 cm+. Before, it was re-placed from your head every frame (it swam
  as you moved) and could jump sideways when recentring landed just after it opened.
- Sharper: the grid canvas is drawn at 2x (2680x1920) and the preview at 1.5x, with the maximum anisotropic
  filtering, and it sits closer (1.3 m instead of 1.5 m).
- 7 columns now, for 19 cards (the new Hammer swing card). The punching card is now "Boxing numbers".

### Checks
- All 9 suites pass (core has 19 new v62 checks; movepicker expects 19 cards). The old "stuck below zone" check's
  learned-gains table needed a value for the new move.
- Emulator: combos come out right for both stances (orthodox 1-6-3-2 = left jab, right uppercut, left hook, right
  cross; southpaw 1-2-3-4 = right jab, left cross, right hook, left hook), every punch orb is numbered and none is
  random. The stance switched at 90 s and back 75 s later. The hammer swing station arrives and times out cleanly
  (the emulator can't swing). The picker anchors, the Hammer swing preview draws, no new console errors.
- Not checked: anything in the headset. The swing thresholds (hand height, hinge, speed) are first guesses.

## Still open
- Gio's one-sided tree chop with tilted cuts, and arm jacks x5 replacing the tiptoe reach.
- Three-pace blocks (Base / Push / All out / Recover) and beat sync: waiting on a go-ahead.
- Knee lab file from the headset.
