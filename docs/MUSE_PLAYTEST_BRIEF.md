Hi Morty! Could you playtest a VR workout game I'm building and send feedback and ideas?

**PulseZone** is a heart-rate-adaptive workout game for Meta Quest that runs in the browser (WebXR). A Fitbit Charge 6 streams heart rate through an iPhone bridge page, and the game keeps you inside a target heart-rate zone: it speeds up when you're below the zone and eases off above it. It also learns which moves raise *your* heart rate most and uses them more.

**Play it:** https://cremdelacrimi.github.io/pulsezone/
- **Without a headset:** open it on a desktop browser. A simulated heart rate stands in for the Fitbit. Left click = left punch, right click = right punch, hold **G** to guard, hold **C** to duck, **A/D** to lean, **O** for options, **T** for 5× speed, **E** to end, **R** to restart. Adding `?smoke` to the URL makes it auto-play so you can watch a whole workout.
- **With a Quest:** open the same link in the Quest browser and press Enter VR. The heart rate is simulated unless a phone is paired.

**Moves:** punch orbs (left = blue, right = orange), power orbs, squat-then-reach, guard & counter, swing orbs, walls to duck or lean past, rope tracing, a two-hand rope with a finishing slam, boxing combos on the beat, side-shift footwork, and bursts: speed bag, battle ropes, heavy bag (hooks/uppercuts), sled run (tuck + double-pole), and a dodge barrage (bombs follow your head and lock 0.7 s before they arrive).

**Heart-rate feedback:** a heat gauge and reactor, a CLIMBING cue while your heart is still catching up with your effort, workout shapes (Steady / Waves / Build), spotlight rounds, a breathing pacer above the zone, and music that brightens in the zone.

**The test tools are on the options board (Y/B in VR, O on desktop):** turn on **Diag**, then the **Test** and **Test 2** rows send any move on demand.

**What I'd love feedback on:**
1. Anything confusing on screen: call-outs, HUD, the end-of-workout board.
2. Bugs: overlapping obstacles, moves that never register, anything stuck.
3. Which moves feel like they'd raise heart rate most, and which feel like filler.
4. Ideas for new moves or feedback that keep the heart-rate-first design (nothing overlapping in the lane, works on Quest performance).
5. Whether the difficulty response (speeding up / easing off) feels right in the simulated runs.

Design notes, if useful: `docs/GAME_DESIGN_BRIEF.md` and `README.md` in https://github.com/CremdelaCrimi/pulsezone. Thank you!
