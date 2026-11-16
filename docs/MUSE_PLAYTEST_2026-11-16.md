# Muse (Morty) playtest, 2026-11-16, 3:21–3:32 PM

Morty, the Muse agent, played the live v46 build on a desktop browser with a simulated heart rate: a ~7-minute normal run, the options/Diag test buttons, and a short `?smoke` run (`?smoke&speed=4&warmup=0.5&minutes=2&cooldown=0.5`) to the end board. Not tested: Quest/WebXR, the phone bridge, Touch mode, sustained holds, real head tracking, console errors.

Claude's first triage notes are in *italics*; none are verified yet.

## Bugs reported

1. **End-board numbers disagree.** Time in zone 1:03 / 53% on the top board vs 0:58 / 52% on the lower one (0:58 is 48% of 2 min). Longest streak also 1:03. Final combo 91 vs 55 hits + 14 dodges. "55 hits (0 perfect)" after a clean auto-play. No personal-bests section appeared.
   *Likely real: the two boards probably use different clocks (whole workout vs training only), the combo counts bomb dodges (bombDodge, added in v43) and burst bonuses, and bests need real training time. Worth fixing so the numbers agree.*
2. **3D objects render over the HUD.** Walls, a pole and a big red ball covered the heart-rate digits; the sled call-out was clipped at both edges.
   *Probably real on desktop, where the camera is close to the scoreboard. Morty's fix (fade objects in the last metre in front of the scoreboard) is cheap.*
3. **"VR NOT SUPPORTED" button stays on desktop** and covers the options board's End workout button and the end board's test line.
   *Real on desktop: it's the WebXR button. Could hide or shrink it when XR isn't available.*
4. **Test buttons don't reliably send the named move.** Guard → diag said "sent: jab (shift)"; 2 ropes → a sled came ("sent: sled (boost)"); Speed → announced, but no bag within 8 s. Shift, Combo and Bombs worked.
   *Partly expected: test moves wait for a free lane slot, and the diag shows what was sent meanwhile. But Guard and 2 ropes being pre-empted by a shift or a boost burst looks like a real priority bug: a test move should go next.*
5. **Score rises with no input on desktop** (+62 in 5 s idle), even after switching the simulator to Manual.
   *Need to check: the desktop auto-player may stay on outside `?smoke`, or the simulator's "AutoPlayer" mode also plays. It shouldn't score when you're idle.*
6. **Desktop holds (G guard, C duck) give no visible feedback**; the sled tuck meter stayed at 0 in manual play. (Morty tapped keys rather than holding them.)
   *Desktop has no head movement, so the tuck can't happen; a desktop hint or key for tuck would help testing.*
7. **Manual simulator adaptation looks opaque.** Up arrow ×5: HR 121 → 118; after Down ×6, HR sat at ~100 while intensity and boost went to 100%. CLIMBING / SETTLING never appeared. Warm-up sent a combo and showed "IN THE ZONE · target 67 -> 120" at HR 66.
   *Need to check: the Manual simulator's effort keys, whether CLIMBING ever shows with a simulated heart (learning only uses real heart rate, so the projection may stay empty), and why warm-up says IN THE ZONE while the target ramps.*
8. **Minor:** the bridge URL wraps mid-word on the landing panel; the game auto-starts with no Start button.

**Worked:** no lane overlaps, nothing froze or got stuck; punches near arrival registered; T, O, E, R and ] worked; E goes to cool-down first (sensible, but could be labelled).

## Confusing on screen
- Heat gauge has no scale or label: it's unclear whether it tracks heart rate, intensity or distance from the zone; the green tick is unexplained.
- Reactor says **STALLED** 4–5 BPM below the zone (reads as failure when almost there); its % resets on level-up without explanation.
- Diag line is tiny, clipped and full of jargon.
- **Red spiky balls look the same whether you should punch them or dodge them (bombs).** Dangerous in VR.
- Early punches fail silently (no "too early"); orbs arrive huge and cut off at the bottom of the desktop view.
- End graph has no legend; the top-3 bars have no numbers.

## Heart-raisers vs filler (Morty's view)
- Biggest raisers: side squats, squat+reach, sled tuck, battle ropes, dodge barrage (the smoke end board's top 3 agreed: side squats, battle ropes, sled run).
- Filler: plain jabs at low intensity, rope tracing when it stays high and flat (a good recovery move), guard on its own (only pays off as the counter setup).
- Speed-up / ease-off: felt right with AutoPlayer; felt wrong in Manual (maxed out while heart rate sat still, with no CLIMBING cue to explain the lag). Couldn't confirm the music change on desktop.

## Ideas
1. **"Too early / too late" ring** that closes on each orb at the hit window.
2. **Make bombs unmistakable:** a different shape and a ticking sound as they lock; never reuse that silhouette for anything you punch.
3. **"Breathe-and-reach" recovery move** above the zone: slow high reaches synced to the 4-in / 6-out pacer.
4. **Step-back lunge punch:** the orb arrives, then a floor pad behind you lights as you punch (legs + arms, one lane slot).
5. **Show the learner working:** real numbers on the end board's top-3 bars plus one line like "Side squats sent 2.5x more in minute 4 because they raise you fastest."
6. **HUD protection rule:** nothing in the lane renders in front of the scoreboard; fade objects out in the last metre.

## What was done (v47)

| Report | Verdict | Change |
|---|---|---|
| End-board numbers disagree | Real: the scoreboard and the board below used different clocks | Both now use the same workout summary; longest streak can't exceed time in zone; "(0 perfect)" hidden; dodges include bombs |
| 3D objects over the HUD | Real | Walls fade to faint once they're within 1 m (you've already seen them); long call-outs shrink to fit; sled call-out shortened |
| "VR NOT SUPPORTED" button on desktop | Real | Hidden whenever VR isn't available; the Quest still gets Enter VR |
| Test buttons send the wrong move | Real: an automatic burst or side shift that hadn't started yet went first | A test press cancels a pending automatic burst and blocks new shifts until it's sent; the call-out says "after this burst / side shift" when one is already running. Checked: Guard 1.5 s, 2 ropes 0.5–1.3 s, Speed 4.5 s, Combo 3.3 s, Sled 3.8 s |
| Score rises with no input | Real: walls that never reached your head, and stand-tall boxes without a squat, paid out as dodges | Dodges only count if standing still would have hit the wall; stand-tall boxes only if you were low in the last 4 s. Idle desktop now only earns zone-streak bonuses (rewards for being in the zone) |
| Desktop holds give no feedback | Partly: holds work, taps barely move anything | Manual simulator shows its effort level ("SIM HR (Manual, effort 30%)"); holding C on desktop counts as a tuck for the sled |
| Manual adaptation looks broken; no CLIMBING | Not a bug: heart rate lags effort by 30–40 s, and with no reps there's nothing to project | Effort level now visible (above). Warm-up says "WARM-UP: ON PACE" instead of IN THE ZONE; no combos during warm-up |
| Bridge URL wraps mid-word | Real | Breaks only before `?code=` |
| Red spiky balls ambiguous | Real | Bombs are now black with a hazard-yellow glow and longer spikes; nothing you punch uses those colours |
| Reactor "STALLED" reads as failure | Real | Now "REACTOR WAITING · get into your zone to charge" |
| End graph has no legend; bars have no numbers | Real | Legend under the graph; each top-3 bar shows its BPM gain |

Not changed: no Start button (the game auto-starts so the Quest flow stays one step), the heat gauge and Diag line wording, and the ideas list (kept for after the headset test).

Checks: core tests pass; idle desktop run (2 min) earned no dodge points; test buttons each sent their move within 5 s; a 3-minute auto-play to the end board had 0 overlaps, no errors, and matching numbers (128 s in zone, 72%, streak 2:08).

## Morty's re-check of v47 (4:23–4:36 PM)

**Verified fixed:** no idle dodge points (0 hits, 0 dodges after a full idle run); WAITING / WARM-UP: ON PACE / Manual effort labels; score, reactor, average and zone % match between boards; streak ≤ time in zone; "(0 perfect)" gone; graph legend and bar numbers; dodges = walls + bombs exactly; VR button hidden; call-outs fit; Guard, 2 ropes and Combo test buttons fire immediately.

**Still failing (Morty), with Claude's first read (not verified yet):**
- **Idle score still leaks** (0 → 15 → 35 after ~5.5 min, no zone time). *A third scoring source; needs finding.*
- **Sled and Heavy test buttons don't deliver** (a pair, a barrage, a jab shift or a boost burst came instead). *Likely: when the burst can't start yet (stand-up box or side shift), the normal picker runs and an automatic burst overwrites the test one.*
- **In-zone time 0:47 (scoreboard corner) vs 0:42 (board below).** *The small "in zone" counter on the scoreboard still uses the live controller timer.*
- **Combo 95 vs hits + dodges 93.** *Guard blocks count toward the combo; the board should say so or count them.*
- **Top-3 bars identical on an idle run.** *They're the starting estimates (priors) until real heart rate teaches them; the label should say so.*
- **Bombs are yellow-green, not black.** *That is the v47 look (hazard yellow glow on a dark body); the description to Morty overstated "black".*
- **Walls don't fade in the last metre** (a red pillar, an orange duck bar). *Red/orange is the "you got hit" colour: hit walls were excluded from the fade. Should fade too.*
- **Bridge URL still breaks mid-word.** *The URL is longer than the panel, so it still breaks inside "bridge.html"; needs break points at each "/".*
- **Walls can cover the options board while it's open.**
- **Suggestion:** show the version number on screen.
