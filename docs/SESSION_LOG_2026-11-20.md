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

## v63 (2026-11-22, built on Gio's "keep moving with your recommendations")

v62 was pushed and live on Nov 20. v63 builds the two remaining moves from Gio's designs and the pace blocks.
It is committed locally only, not pushed yet.

### Pace blocks (core.js PACES / PACE_LAYOUTS / paceBlocks / paceOffset / paceStatus; game.js updatePace)
- Training runs in timed blocks instead of one zone. With a target of 120: BASE 115-125, PUSH 125-135 (+10),
  ALL OUT 133 and up (+18; the safety brake still applies), RECOVER under 113 (-12).
- Each workout shape is a block layout (15 min; other lengths scale; under 8 min it's one Base block):
  - Steady: Base 3:00, Push 1:30, Base 3:00, Push 1:30, Base 2:30, Push 1:00, Base 2:30.
  - Waves: Base and Push in turns, with one Recover.
  - Build: the layout from the proposal, climbing to two 45 s All outs:
    Base 3:00, Push 2:00, Base 2:00, Push 1:30, ALL OUT 0:45, Recover 1:15, Base 2:00, Push 1:00, ALL OUT 0:45, Base 0:45.
- 30 s before a block: a call-out ("PUSH IN 30 s - pick it up now"). The target and the move mix change then, eased over
  20 s, because heart rate lags effort. At the start: a voice line ("PUSH for 2 minutes - heart rate 125-135").
- Moves follow the pace: Base uses the Groove mix, Push the Burn mix (big moves), All out the Fight mix. Each All out
  starts with the wall-ball round, then the ropes circuit.
- On pace: All out counts anything above its band, Recover anything below. From 30 s before a change to 30 s after it,
  anywhere between the old band and the new one counts.
- The scoreboard reads e.g. "PUSH: ON PACE". The end board adds "On pace: base 6:10 · push 2:40 · all out 1:05 · recover 0:50".
- While blocks are on, automatic charges are off (the blocks plan the all-outs), and the old wave/build call-outs are off.
- On by default. Turn it off with the Blocks button (board: Workout shape row) or the page checkbox (Workout plan).

### One-sided tree chop (station 'chop'; core.js treeCut / pickTilt / TREE_TILTS / TREE_SIDE)
- The tree stands 30 cm out on one side. You wind up on the other side at the lit spot and chop into the tilted cut
  mark on the trunk. 5 cuts, then the tree slides over and you do 5 from the other side (10 per station, 16 s).
- Every cut has a tilt: HIGH TO LOW (over the shoulder down to the hip), STRAIGHT ACROSS (chest height), or
  LOW TO HIGH (from 40% intensity). The same tilt never comes three times running.
- A swing at the cut's angle is a CLEAN CUT (+10). The wrong angle still counts, with "Follow the cut - high to low!".
- Logged `cut` events carry tilt, clean and slope, for tuning.
- I first put the tree on the wind-up side, 16 cm out. In the emulator it hid the scoreboard, so it moved to the side you chop toward.

### Arm jacks (replace the tiptoe reach; the station keeps the key 'tiptoe' so saved settings carry over)
- Two stars up and out (34 cm to each side), set from how high you've been seen to reach, so they're reachable
  without going up on your toes.
- Both fists down by your sides, then both up to the stars = a jack. 5 on a beat that quickens with intensity
  (1.6 s to 1.15 s). ON THE BEAT pays 1.5x; up on your toes at the top earns +5 bonus points.
- New ghost-coach pose, preview figure and picker card ("Arm jacks"). The board buttons now say Jacks.

### Checks
- All 9 suites pass; core has 36 new v63 checks (block layouts, offsets, statuses and grace; the controller visiting all four
  paces and counting on-pace time per pace; clean, rough and late cuts for each tilt, mirrored; jacks: down, up, toes, one arm).
- Emulator: blocks change on schedule with the 30 s heads-up. The chop and jack stations spawn at the right spots; the cut mark
  tilts with the arrow. An 8-minute workout ran to the end board with the On-pace line. No errors apart from PeerJS.
- Not checked: anything in the headset. The emulator can't move hands, so cuts and jacks are tested only in Node. The pace
  offsets (+10 / +18 / -12) are the proposal's numbers, untried on a real heart.
