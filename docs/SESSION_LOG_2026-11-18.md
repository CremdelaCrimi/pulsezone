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
