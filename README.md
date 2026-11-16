# PulseZone VR (WebXR)

A VR workout for Meta Quest that runs in the **Quest Browser**, with no install and no developer mode. Punch orbs and duck bars. The game speeds up or eases off to **keep your heart rate at a target BPM**, and your Fitbit Charge 6 heart rate reaches it through your iPhone.

```
Charge 6 ──Bluetooth──► iPhone (Bluefy browser, bridge.html) ──direct WebRTC link──► Quest Browser (index.html)
```

The Quest Browser can't talk to Bluetooth devices from a web page, so the phone relays the heart rate. The public PeerJS server only introduces the two devices to each other. After that, heart-rate readings go straight from phone to headset.

> Not a medical device. The safety ceiling is a rough estimate (208 − 0.7 × age). Stop if you feel unwell.

## Playing

1. **On the Quest:** open the game page in the Quest Browser and note the **phone code**. It's on the panel and on the scoreboard in VR.
2. **On the iPhone:** open `bridge.html` in the free **[Bluefy](https://apps.apple.com/app/id1492822055)** browser (Safari can't use Bluetooth) and enter the code.
3. **On the Charge 6:** swipe down from the clock face and tap **Broadcast HR** (or use the exercise menu during a workout). Then tap **Connect Charge 6** in the bridge and pick it (if it isn't listed, use **Show all Bluetooth devices**). When the tracker asks to share your heart rate, tap **Share**, then **Start**.
4. **Back on the Quest:** press **Enter VR**. The game switches to your phone's heart rate as soon as readings arrive.

**Keep the iPhone awake:** iOS pauses web pages when the phone locks, which cuts off your heart rate. The bridge tries to keep the screen on, but the reliable fix is iPhone **Guided Access**, which locks the phone into Bluefy with the screen on. Set it up once: Settings → Accessibility → Guided Access → on, set a passcode, and set **Display Auto-Lock → Never**. Then triple-click the side button to start or end it each workout. Turn off Low Power Mode first, because it forces a 30-second lock. Setting **Auto-Lock → Never** in Display & Brightness also works. If the phone still goes quiet, the game switches to an estimate based on your movement after 6 seconds, starting from your last real BPM. It switches back as soon as the phone wakes, and the bridge reconnects by itself.

**B/Y** switches between the simulator and phone heart rate. **A/X** restarts after a workout.

## The game

- **Orbs:** punch **blue** with your left hand and **orange** with your right. **Low orbs** (knee to hip height) mean squat and punch. In Punch mode a hit needs a real punch: your fist has to travel about 13–22 cm just before contact (more at higher intensity), so wrist flicks don't count.
- **Power orbs** are faceted and wrapped in a spinning wireframe shell. They need a full punch from the shoulder (fast, with 30+ cm of travel) and score up to 3× depending on how hard you hit.
- **Squat, then reach up:** a low orb for one hand, then a high orb for the other hand about 0.85 s later, joined by a dashed line. It's a squat jump without leaving the floor.
- **Guard & counter:** a red-hot shot with a GUARD badge flies at your face. Don't punch it: bring both fists up by your chin and hold them there as it arrives. Block it and a counter orb comes straight in from close range for double points. Miss the guard and the sky flashes red.
- **Hit feel:** a hit orb flashes white for a split second, then shatters, with the pieces flying the way your fist was going. Harder punches throw more pieces, sound bigger (a soft punch is a hollow thud, a hard one adds a bass thump and a glassy crack) and buzz harder.
- **Swing orbs** have a glowing **white curve** through them, with a "ghost fist" sliding along it. Swing along the curve (an uppercut, or a hook from the outside in) for **double points**. Any solid punch still counts, so you're never punished for an imperfect angle.
- **Walls (purple boxes):** get your head into the open gap: **duck**, **step aside** from a centre pillar, **lean left or right**, or **squat left or right**. Each wall is a box, and its length shows how long to hold the position (about 1.2 s for a duck). After every duck or squat box comes a low **Stand tall!** box, so you have to stand all the way back up instead of staying down.
- **Rope tracing:** a long glowing rope in your hand's colour flows toward you along the lane, curving left, right, up and down (low dips mean squats). Where it crosses arm's length there's a ring: keep that hand on the rope as it slides past, and the ring turns green while you're on it. The catch is forgiving: your hand counts as on the rope within 20 cm of it, anywhere from 35 cm in front of the ring to 35 cm behind it (shown by a faint sleeve), and a small wobble won't knock you off. Points depend on how much of the rope you stayed on.
- **Two-hand rope:** two ropes side by side, one per hand, that sweep wide from side to side and dip low, so you step, shift your weight and squat while following them. Score is the average of both hands.
- **Game type:** **Punch** (hit hard enough to pop orbs) or **Touch** (just hold your hand where the orb arrives and it pops on contact). Choose it on the options board.
- **Heat gauge (left):** frosty when you're below your zone, a lively flame in it, and a hyper flame above it.
- **Reactor (right):** a core that only charges while you're in your zone (about a minute of zone time per level, with a points bonus each level). Above the zone it overheats and stops charging until you ease off; below it stalls and turns icy. The end screen shows your reactor level.
- **In the zone, the world lights up:** equalizer pillars rise along the lane to the music's beat, embers drift up, your fists leave glowing trails, and the lane rails turn from blue to orange.
- **Your heart is on its way:** heart rate lags effort by 30–40 seconds. When you're below the zone but already working hard enough to get there, the scoreboard shows a green ▲ and **CLIMBING – KEEP IT UP** instead of "pick it up" (and **SETTLING** with a ▼ when you've eased off enough above it). It's estimated from what you've done in the last ~12 seconds, using what the game has learned about your heart.
- **Zone streaks:** every 15 seconds you hold the zone, a bell chord rings (a little higher each time), the lane rails flare, and you get bonus points and reactor charge. The scoreboard shows your current streak.
- **Workout summary:** when you finish, a board below the scoreboard graphs your heart rate over the whole workout (coloured by zone) against your target band, with time in zone, average and peak BPM, longest zone streak, score, reactor level and the move that raises YOUR heart rate most.
- **Personal bests:** time in zone (%), longest streak, score and reactor level are saved in the browser. Beat one and it's marked **NEW BEST** in gold. During warm-up the scoreboard shows what to beat. Workouts under 3 minutes of training don't set records.
- **Finishing slam:** battle ropes and two-hand ropes end with a wide gold bar at head height. Raise both fists and smash it **down** together (within 0.3 s of each other), like a medicine-ball slam. In Touch mode, reaching it with both hands is enough.
- **Side shifts (footwork):** when you're below your zone (and not already climbing), the game may call **STEP RIGHT** or **STEP LEFT**: for 8 seconds the orbs come 35 cm to that side, and a glowing pad on the floor shows where to stand. The scoreboard, walls, ropes and bursts stay centred; walls and ropes wait until the shift is over. At most one every ~40 s. Switch it off with **Shift** in the Walls row.
- **First-time hints:** the first two times you ever meet a guard shot, a rope, a two-hand rope or a slam bar, see-through ghost fists show the move (fists up by your chin, a hand riding each ring, both fists smashing down) with a short call-out. Use the wrong hand on an orb and the correct controller gives a double buzz. What you've seen is remembered in the browser (`pulsezone.seen`).
- **Drift guard:** if your head wanders more than 55 cm from where you should be (the lane centre, or the side-shift spot), an amber arrow on the floor and a call-out point you back; it clears once you're within 30 cm.
- **Boxing combos on the beat:** once intensity is up, a plain punch sometimes becomes a short combination (1-2, 1-1-2, 1-2-hook, 1-2-1-uppercut, squat-squat-hook-hook) with one orb per beat of the music (two beats when it's fast), the first landing on a beat. Clear the whole combo for a bonus. Combos only use moves you have switched on, and like other solo moves they get the lane to themselves.
- **Spacing:** everything shares one lane, so the game books a time slot for when each thing reaches you. Plain orbs can come in groups, but a rope, a wall box, a power orb, a squat-and-reach pair or a guard shot always gets the lane to itself, with a short gap before and after. Nothing flies through anything else.
- **Soundtrack:** "Hard-Knuckle Focus", an instrumental track made with Gemini's music tool (`assets/music/hard-knuckle-focus.mp3`, 121 BPM). The game **time-stretches it to your pace** with the pitch preserved, from 0.78× to 1.25×. It loops over 87 whole bars and skips the intro and the silent ending. Switch between **Song** and **Synth** on the options board. On the Quest the song can only start from a button press, so it starts when you enter VR or pull a trigger. If it's ever blocked, the synth music plays instead and the game says so.
- **Music & sound (Synth):** synthesized live. The **tempo leads you**: it speeds up when you need to pick it up and slows when you need to ease off. You also get icy bells below your zone, a bright arpeggio in it, a soft heartbeat at your real BPM, and a sound for every hit, dodge and wall.

### When your heart rate won't climb

- **Intensity:** the zone controller raises intensity whenever you're below target.
- **Challenge boost:** if you stay below for about 15 seconds without heart rate rising (or the game is already at full intensity), a **challenge boost** builds up over about 45 seconds. It brings faster spawns, faster orbs and more walls and squat punches, and the scoreboard shows `CHALLENGE +NN%`. It fades once you reach the zone.
- **Bursts:** the boost's main tool is a short all-out effort, sent once the lane is clear:
  - **Speed bag:** a bag hangs in front of your chest for 4–5 seconds. Hit it as many times as you can (5 points a hit, more for a big flurry). No aiming or reaction time needed, just effort.
  - **Battle ropes:** two ropes run from your hands down the lane for 6 seconds. Pump both arms up and down fast; the waves you make travel down the ropes. Staying low (half squat) scores 1.5×.
  - Each can come at most every 20 s (speed bag) or 30 s (ropes). You'll see the odd one in the zone too, for variety, and hardly any above it.
- **What works for you:** the game **learns what raises YOUR heart rate**. It compares your heart rate with how many of each activity you've recently done (punches, squat punches, hooks and uppercuts, power punches, squat-and-reach pairs, guard and counter, rope tracing, two-hand rope, speed bag, battle ropes, ducks, side steps, side squats), allowing for the heart's 30–40 second lag. When you're below the zone, it sends more of whatever works for you. When you're above it, it sends easier punches. The estimates are saved in the browser and refine over several workouts.
- **Where to see it:** in VR it's on the options board, and the end screen names your best activity.

### Options (in VR)

Press **Y** (or **B**) to open the options board on your left, point at it with the controller laser, and pull the trigger. The workout pauses while it's open. From the board you can:

- Set the target BPM and workout length.
- Choose phone or simulator heart rate.
- Pick a **workout shape**: **Steady** (hold your target), **Waves** (the target rolls between +5 and −5 BPM on a 6-minute cycle, with "WAVE UP" / "RECOVERY WAVE" call-outs) or **Build** (start 6 BPM easier and climb to 6 BPM harder by 80% of the workout). The end-of-workout graph's target band follows the shape. Shaped targets always stay 8 BPM under the safety ceiling.
- Set the **warm-up**: off, 15 s up to 5 min (30 s by default). It also changes the workout in progress.
- Turn music on or off and change the volume.
- Set the challenge level: **Gentle / Normal / Hard** changes how hard the game pushes and how fast the boost builds.
- Choose the game type (Punch or Touch).
- Pick your **moveset**: orbs (**Punch**, **Squat punch**, **Hook/uppercut**, **Rope**), more (**Power**, **Squat+reach**, **Guard**, **2 ropes**), bursts (**Speed bag**, **Battle ropes**) and walls & footwork (**Duck**, **Side squat**, **Lean**, **Pillar**, **Shift**). Highlighted means on. Hooks, uppercuts and power orbs need Punch mode. The same checklist is on the game page under **Moveset**, and the two stay in sync. If you pick moves that normally unlock later (e.g. only ducks), you get them straight away.
- See the "what raises your heart rate" chart.
- Restart, end the workout, or close the board.

On desktop, press **O**.

## Desktop testing

Left click = left punch · right click = right punch · hold **G** guard · hold **C** duck · **A/D** lean · **O** options · **[ ]** target · **B** switch source · **Tab** simulator mode · **↑↓** effort (Manual) · **L** drop signal · **M** sound · **T** 5× speed · **E** end · **R** restart

## Files

| File | What it is |
|---|---|
| `index.html`, `js/game.js` | The game: three.js + WebXR, fists, orbs, ducking bars, in-world scoreboard |
| `bridge.html`, `js/bridge.js` | iPhone bridge: Web Bluetooth Heart Rate client, reconnects automatically |
| `js/link.js` | Pairing code + WebRTC link (PeerJS), with heartbeat and auto-reconnect |
| `js/core.js` | Engine-free logic: heart simulator, PID zone controller, difficulty, activity mix, challenge boost, heart-rate learning, music tempo, wall shapes, hand/swing rules, Bluetooth packet parser |
| `js/options.js` | In-VR options board |
| `js/dev.js` | Developer tuning panel |
| `js/thermo.js` | Heat gauge shader (frost / flame / hyper flame) |
| `js/audio.js` | Adaptive soundtrack + sound effects (Web Audio) |
| `test/core.test.mjs` | 109 checks: simulated workouts (time in zone, overshoot, safety brake, dropouts), packet parsing, wall shapes, hands and swings, lane spacing, rope catch zone, two-hand rope path, stand-up boxes, punch quality, activity mix and bursts, challenge boost, heart-rate learning, music tempo |

No build step: these are plain files. three.js and PeerJS load from jsDelivr at pinned versions.

## Editing the game yourself

**No code: the Developer tools panel.** On desktop, click **Developer tools** on the game page, or open the game with `?dev` at the end of the address. From there you can:

- Change the difficulty (the easy and hard ends of spawn rate, orb speed, spread and punch speed), the activity mix, the heart-rate controller, and how fast the challenge boost builds. **Apply & restart** saves the settings in that browser.
- **Download last workout (CSV)**, which has one row per second: heart rate, intensity, boost, and reps of each activity. Open it in Excel or Google Sheets to see what moved your heart rate.
- **Copy settings JSON** to share a setup, or **Reset** to defaults.

**Code: the GitHub web editor, with nothing to install.**

1. Open https://github.dev/CremdelaCrimi/pulsezone (or press `.` on the repository page). It's VS Code in your browser.
2. Edit files, then use **Source Control** (left bar) → write a message → **Commit & Push**.
3. GitHub Pages republishes in about a minute. Reload the game, and on the Quest close and reopen the tab.

**Where things live:**

| To change… | Edit |
|---|---|
| Difficulty defaults, activity mix, unlock levels, heart-rate learning | `js/core.js` (`EASY`, `HARD`, `ACTIVITIES`, `ChallengeBoost`, `HeartRateAttribution`) |
| Controller gains, zone width, warm-up behaviour | `js/core.js` (`defaultZoneSettings`, `ZoneController`) |
| Music tempo rules | `js/core.js` (`musicTempo`), with instruments in `js/audio.js` |
| Orbs, walls, swing curves, HUD, scoring | `js/game.js` |
| Options board layout | `js/options.js` |
| Heat gauge look | `js/thermo.js` |
| Phone bridge | `bridge.html`, `js/bridge.js` |
| Soundtrack file, tempo and loop points | `assets/music/`, plus the `SONG` line near the top of `js/game.js` |

**Adding another song:** make an instrumental, steady-tempo track with no intro or fade (Gemini's **Create music**, set to Instrumental, works well), drop the MP3 in `assets/music/`, and update `SONG` in `js/game.js`: its `url`, its `bpm`, and the loop points in seconds (start and end on bar lines).

After changing a file's contents, bump the `?v21` version tags (in `index.html`, `bridge.html` and the `import` lines) so browsers don't use a cached copy.

## Developing

```bash
node test/core.test.mjs        # logic tests
node tools/serve.mjs 8080      # local server -> http://localhost:8080
```

Test URL options: `?smoke` auto-plays, `&speed=4` runs faster, and `&warmup=0.5&minutes=2&cooldown=0.5` shortens the workout. In the browser console, `pz.state` shows live state and `pz.step(seconds)` advances the game even when the tab isn't drawing.

## Publishing (GitHub Pages)

Push this folder to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**. The site appears at `https://<user>.github.io/<repo>/`, with the bridge at `.../bridge.html`. HTTPS comes free, and both WebXR and Web Bluetooth require it.
