# What raises heart rate most, and how to make it play (research, 2026-11-17)

Sources were read mostly as abstracts and search snippets; study sizes are small (8–40 people). Industry MET ratings (VR Health Institute) are not peer-reviewed.

## Key findings

| Finding | What it means for PulseZone | Source |
|---|---|---|
| Tempo drives energy cost steeply: bag boxing 7.0 METs at 60 strikes/min, 8.5 at 120, 10.8 at 180 | Strike cadence is the strongest dial we have. Scale the beat, not only the number of objects | [2024 Compendium](https://pacompendium.com/sports/) |
| At the same work, arm work raises HR more than leg work (partly a blood-pressure "pressor" effect, not extra calories) | Arm and overhead bursts move HR fast: good for catching up. Legs plus arms burn more per beat | [physoc](https://www.physoc.org/?p=52725), [JSSM](https://www.jssm.org/jssm-08-401.xml-Fulltext) |
| Deeper isometric squat holds raise HR and blood pressure step by step | A squat hold with depth as the intensity dial. Cap at 30–45 s; never above the zone | [PubMed 23879248](https://pubmed.ncbi.nlm.nih.gov/23879248/) |
| Lowering (eccentric) work costs about 4–5× less than lifting/rising | Reward the drive up out of a squat, not a slow descent | [Springer review](https://link.springer.com/content/pdf/10.1007%2Fs40279-013-0052-y.pdf) |
| Squat-based VR (Hot Squat) beats upper-body-only VR on %HRR | Keep legs in most patterns | [Frontiers 2024](https://www.frontiersin.org/articles/10.3389/fspor.2024.1349521/full) |
| Supernatural Flow 8.2 METs, Boxing 7.6; BOXVR 49% HRR vs Beat Saber 30%; Thrill of the Fight about 145 bpm vs Beat Saber 119 (children) | Full-power strikes, squats/dodges and continuous combos are high. Small-range arm slicing is light | [PMC11185914](https://pmc.ncbi.nlm.nih.gov/articles/PMC11185914), [Springer VR 2024](https://link.springer.com/10.1007/s10055-024-00981-6) |
| People underrate their effort in VR (game distracts them) | Great for fun, but the HR ceiling and cool-down are the safety net | [PMC9397749](https://pmc.ncbi.nlm.nih.gov/articles/PMC9397749) |
| HR-adaptive VR hiking: about 20% more time in zone. Adaptive rival in VR cycling: more time in zone but no extra enjoyment | Adaptation works; it isn't fun by itself. Show it as story (enemy, rival), not correction | [SciTePress 2022](https://www.scitepress.org/Papers/2022/110044/110044.pdf), [arXiv 2508.13095](https://arxiv.org/abs/2508.13095v1) |
| Plain PID control overshoots because HR lags; smoothed / event-driven control works better | Slow outer loop (20–30 s steps, ±5 bpm deadband); fast inner loop from motion | [UTS](https://opus.lib.uts.edu.au/bitstream/10453/44643/1/Manuscript-SP-R3.pdf) |
| Heart-rate-scaled scoring lets fit and unfit players compete fairly; may demotivate very fit players | HR-scaled score as an option, plus a raw mode | [Queen's HR balancing](https://equis.cs.queensu.ca/projects/hrbalancing) |
| A partner moderately better than you maximises persistence (inverted U) | Ghost rival about 10–15% ahead, not far ahead | [PubMed 22920808](https://pubmed.ncbi.nlm.nih.gov/22920808/) |
| Music: small performance benefit, larger with fast tempo, no direct HR effect | Use music BPM to set cadence | [USQ meta-analysis](https://research.usq.edu.au/item/q57x6/effects-of-music-in-exercise-and-sport-a-meta-analytic-review) |

## Ideas vs what PulseZone already has (v53)

| Idea | Status in v53 | Gap |
|---|---|---|
| Cadence ramp (100 → 180 strikes/min set by the HR controller) | Speed/density adapt; combos are on the beat | Make strike cadence an explicit controller output tied to music BPM |
| Squat-drive punch (target only hittable on the way up) | Squat → reach, squat + hammer, wall ball | Score the rise speed, not just the reach |
| Overhead burst when below zone | Ceiling press, tiptoe reach | Use overhead as the fast catch-up tool; block it above zone |
| Squat-hold shield (depth = intensity) | None | New; capped 30–45 s, breathe cue, off above zone |
| Ghost rival 10–15% ahead | Ghost coach shows form only | Replay of your own best run, slightly ahead |
| HR-scaled scoring | None | Optional; keep raw mode |
| Knee-drive sprint with cadence bar | Knee drive station (4 reps) | Turn into a timed sprint with a speed bar |
| Deep duck walls, depth ramped by controller | Duck walls | Depth as a controller output |
| Boss that regenerates when HR drops | Reactor | Give the adaptation a face (story, not nagging) |
| Lag-aware feed-forward (schedule high-yield moves 30–40 s before predicted drop) | Attribution learner + catch-up gain | Use the learner's prediction to act early |
| Live effort score from motion (hand speed, squat depth) | Rope intensity meter | Extend to all moves |

## Safety flags
- No jumps (blind landing).
- Lunges only split-stance in place; pause if the head drifts more than about 25 cm.
- Holds and overhead blocks off above the zone (blood-pressure spikes).
- Keep a hard HR ceiling with automatic cool-down, because players underrate effort in VR.

## Morty's answer (Muse, 2026-11-17, after playing v53 on desktop)

**Would he play it?** "Not yet 3× a week — but it's the first version where I'd say 'give me two more builds.'" In the headset he'd trial it 3× a week but expects to drop off around week 3.
- **Keeps him:** the zone is personal (your own heart is the difficulty dial); stations as variety; the learner visibly favouring what works for you; the end-board graph gives each session a story. Climb to target is now fast and clear (65 → 131 BPM in about a minute, then held).
- **Would make him quit:** (1) setup friction: phone bridge, code, keeping the iPhone awake every session (low friction is the strongest retention predictor); (2) the orb core feels samey by minute ~6, because variety comes in 4–9 s bursts, not in acts; (3) no reason to come back across the week (no program, streak, or "beat your Tuesday"); (4) no music identity or coach voice. Supernatural's retention is coaches + music + beautiful places.
- **Stations:** ceiling press (wall ball) was "the single most fun moment" of all his PulseZone play. Knee drive has the clearest coach. Woodchopper fine. **Tiptoe reach is a dud:** no prop to grab, timed out 0/4 twice. A reach needs a target that takes the hand somewhere.

**His top 5 for highest HR, ranked:**
1. **Wall ball as the engine, not a station:** continuous 20–30 s squat → overhead press rounds on a tempo ladder. Stacks leg drive + overhead arms + cadence. "Three reps is a taster; thirty seconds is a heart-rate event."
2. **"Charge and coast" intervals that use the lag:** a 30 s all-out cadence burst, then the game predicts your peak and switches to light, playful recovery while HR coasts up. Score the landing (did you settle inside the zone?). Lag becomes a skill, like landing a plane, and it stops overshoot.
3. **Boss, with a correction:** shield regenerates slowly below the zone, vulnerable only in the zone; above the zone the boss "overheats" you into breathing recovery. Never heal fast when HR drops, because drops come from lag and planned recovery, and punishing that teaches panic sprinting. Show the CLIMBING projection next to it.
4. **Two-hand cadence work with legs under it:** ropes in a half-squat, hammer pairs alternating high/low (promote squat + hammer). Arms tire before HR peaks, so they need leg help. Pair knee drive with a head-height drop so the legs are proven.
5. **Squat holds as 5–8 s connectors, not centrepieces:** hold low, slow overhead reach, then explode up on the beat. Bridges the lag between bursts. Holds raise blood pressure more than HR.

**Pushbacks on our research:**
- The ghost can't be 10–15% ahead *in BPM* (that's a different zone). Race the ghost on output (score/rep pace at the same elapsed time), or show your best run's HR curve as a ribbon to chase.
- Overhead work inflates HR relative to real work: don't let the calorie estimate count it at face value.

**One-liner:** the hook isn't "workout, but VR", it's "the game can see my heart". Make the heart the opponent, the currency and the story (boss, charge-and-coast, zone-time banking), not a thermostat behind an orb game.
