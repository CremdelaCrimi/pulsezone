# Session log, 2026-11-18

## Overnight work (NJ PC)
A Claude session on the NJ PC worked on branch `overnight/2026-11-18` overnight. Because both PCs share this OneDrive folder, its branch switch synced to this checkout. Only its first commit (e24c32f: charge & coast edge-case tests + test/hr-sim.mjs) and an uncommitted guard (wallBallGoal/stationHold can't loop forever on 0/NaN) reached this PC. Both are now on main (7bf2acd). Its other commits (analyzer tools/analyze-workout.mjs, BOSS_SPEC_DRAFT.md, more tests, OVERNIGHT_REPORT) are in a bundle at `FitBit Game\overnight-2026-11-18.bundle` on the NJ PC, not synced here yet. Its report's 6 questions for Gio are listed below.

## Consulted
- **Gemini** (chat "VR Fitness Mechanics for Heart Rate"): v55 = weekly program & streak (#1) + acts (#2); cut the boss and the ghost race (the boss "teaches panic-sprinting" with a 30-40 s lag); remember the pairing code (already done).
- **Morty** (Muse, after playing v54): wall-ball rounds pace well but the beat isn't visible and two cues fight; charge -> coast reads well but the **landing verdict never showed on screen**; tiptoe now doable, star still small. v55 ranking: weekly program, less setup friction, acts; the boss later as the program's "Sunday boss fight" (v56).

## v55
- **Acts:** training split into ~4-minute themed chapters (15 min = GROOVE -> THE BURN -> THE FIGHT -> THE FINALE; 10 min = 3 acts; 8 min = 2; none under 6 min). Each act re-weights the mix (the Burn leans on squats, wall balls, sled; the Fight on combos, heavy bag, missiles; the Finale on what raises YOUR heart rate most), tints the sky, and announces itself. No charges in the opening act. Scoreboard shows "ACT 2/4 THE BURN". Option: Acts (More row / Workout plan list).
- **Weekly plan:** 3 workouts a week (Mon-Sun): Steady, then Waves, then Build & peak; extras repeat the cycle. Warm-up line: "This week ●○○ · today: WAVES · beat 72% in zone" (the last workout of the same shape). End board: week dots, week streak (weeks in a row with all 3), and +/- % in zone vs last time. Only real-heart-rate workouts of 3+ min count (stored in `pulsezone.week`). Picking a shape by hand turns the plan off; "Week plan" button on the shape row turns it back on.
- **Landing verdict banner** (Morty's bug): PERFECT / NEARLY / OVERSHOT / SHORT with your BPM and the zone, 6 s on its own scoreboard line (call-outs only last 1.8 s and got replaced), and "landing <verdict>" in the CSV note column.
- **Wall-ball rounds:** one cue (the label shows the coach's step, flipping with the beat; the "Now PRESS it up!" call-out is off in rounds), the label flashes white on each beat; rounds never come in the warm-up.
- **Tiptoe star** bigger again (13 cm) with a halo ring.
- **Setup friction:** the phone bridge reconnects the heart-rate band picked last time without the chooser, where the browser allows it (Web Bluetooth getDevices; unknown in Bluefy, falls back to the button).

Checks: core tests pass (new acts + weekly plan checks). VR emulator: 15-min run showed acts switching on time; 10-min bot run Groove -> Burn -> Finale to the end board with no errors; test charge landed SHORT with the banner on screen; week line shown in warm-up with a seeded past workout (then cleared). Not tried in the headset.

## Open questions for Gio (overnight report)
1. Wall-ball ladder: also respond to the zone? (A yes / B time-only / C after headset test)
2. Landing with no real HR: A skip it / B score on estimate or 0 / C score but mark "(estimated)"
3. "ALL OUT" overshoots in the simulator (~55-60% effort lands best): A say "HARD - not all out" / B keep, check real files / C shorter charge
4. Predicted peak reads ~7 BPM high: A leave, check real files / B show a range
5. A coast that ends by going over can still score NEARLY: A leave / B always OVERSHOT
6. NaN frame-time guard in ZoneController.tick: A add / B not needed

## v56 (from Gio's first v55 headset workout, 17:31)

Workout: Waves, 7 of 15 min, 18% in zone, avg 112 / peak 132 vs target 125-135. HR sat ~105 for the
first 4 min (Groove act) at full intensity with the challenge boost at 0; only the wall-ball round
(+19 BPM in 30 s) got him into the zone. Landing: NEARLY (131 vs 125; predicted peak 141, real 132).

Fixes:
- Challenge boost dead since v54 (the charge line split boost.update from its else; the cool-down
  drain ran every frame). Restored; emulator: 0 -> 1 in ~50 s when stuck.
- Tiptoe: one reach with both hands up counted 3 reps in one frame. 0.6 s between reps.

Gio's 8 notes, and what v56 does:
1. Woodchopper unforgiving (40 grabs, 28 reps, 12 timeouts) -> TREE CHOP: a tree, hands together by
   one shoulder, swing across through the trunk (no exact targets), notch deepens, tree falls.
2. Heavy bag 20 cm higher so the uppercut spot is in view.
3. Orbs "all over the place" -> spread narrowed (horizontal 0.45 -> 0.36, vertical 0.55 -> 0.42).
   HR data: orbs alone held ~105; the whole-body moves raise it.
4. Missiles only made him lean -> duck-and-weave volleys: pairs that pick your side and rows of three
   to duck under (L, D, R, D, L), about 2 in 3 barrages.
5. Quick dips -> SLALOM: 4-6 quick side-squat boxes alternating left/right (in place: no stepping).
6. Squat punch unclear -> "Squat + hook": low orb, then a hook orb with the dashed link (like squat + uppercut).
7. Scoreboard -> in the headset while working out: compact strip, 5 m out and high above the lane.
8. Coach popped up while the station was still flying in, hiding the orbs ahead -> shows on arrival.
