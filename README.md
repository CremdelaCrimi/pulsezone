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

- **Orbs:** punch **blue** with your left hand and **orange** with your right. **Low orbs** (knee to hip height) mean squat and punch.
- **Swing orbs** have a glowing **white curve** through them, with a "ghost fist" sliding along it. Swing along the curve (an uppercut, or a hook from the outside in) for **double points**. Any solid punch still counts, so you're never punished for an imperfect angle.
- **Walls (purple boxes):** get your head into the open gap: **duck**, **step aside** from a centre pillar, **lean left or right**, or **squat left or right**. Each wall is a box, and its length shows how long to hold the position (about 1.2 s for a duck).
- **Tracing orbs:** a small orb arrives with its **string** (the path) attached. When it reaches arm's length it glides along the string. Keep the matching hand inside its ring (it turns green) the whole way. Points depend on how closely you followed.
- **Game type:** **Punch** (hit hard enough to pop orbs) or **Touch** (just hold your hand where the orb arrives and it pops on contact). Choose it on the options board.
- **Heat gauge (left):** frosty when you're below your zone, a lively flame in it, and a hyper flame above it.
- **Music & sound:** synthesized live. The **tempo leads you**: it speeds up when you need to pick it up and slows when you need to ease off. You also get icy bells below your zone, a bright arpeggio in it, a soft heartbeat at your real BPM, and a sound for every hit, dodge and wall.

### When your heart rate won't climb

- **Intensity:** the zone controller raises intensity whenever you're below target.
- **Challenge boost:** if you stay below for about 15 seconds without heart rate rising (or the game is already at full intensity), a **challenge boost** builds up over about 45 seconds. It brings faster spawns, faster orbs and more walls and squat punches, and the scoreboard shows `CHALLENGE +NN%`. It fades once you reach the zone.
- **What works for you:** the game **learns what raises YOUR heart rate**. It compares your heart rate with how many of each activity you've recently done (punches, squat punches, hooks and uppercuts, ducks, side steps, side squats), allowing for the heart's 30–40 second lag. When you're below the zone, it sends more of whatever works for you. When you're above it, it sends easier punches. The estimates are saved in the browser and refine over several workouts.
- **Where to see it:** in VR it's on the options board, and the end screen names your best activity.

### Options (in VR)

Press **Y** (or **B**) to open the options board on your left, point at it with the controller laser, and pull the trigger. The workout pauses while it's open. From the board you can:

- Set the target BPM and workout length.
- Choose phone or simulator heart rate.
- Turn music on or off and change the volume.
- Set the challenge level: **Gentle / Normal / Hard** changes how hard the game pushes and how fast the boost builds.
- Choose the game type (Punch or Touch) and turn tracing orbs on or off.
- Pick which walls you get: straight **Duck**, **Side squat** (left/right), **Lean** (left/right), and the centre **Pillar**.
- See the "what raises your heart rate" chart.
- Restart, end the workout, or close the board.

On desktop, press **O**.

## Desktop testing

Left click = left punch · right click = right punch · hold **C** duck · **A/D** lean · **O** options · **[ ]** target · **B** switch source · **Tab** simulator mode · **↑↓** effort (Manual) · **L** drop signal · **M** sound · **T** 5× speed · **E** end · **R** restart

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
| `test/core.test.mjs` | 67 checks: simulated workouts (time in zone, overshoot, safety brake, dropouts), packet parsing, wall shapes, hands and swings, activity mix, challenge boost, heart-rate learning, music tempo |

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

After changing a file's contents, bump the `?v6` version tags (in `index.html`, `bridge.html` and the `import` lines) so browsers don't use a cached copy.

## Developing

```bash
node test/core.test.mjs        # logic tests
node tools/serve.mjs 8080      # local server -> http://localhost:8080
```

Test URL options: `?smoke` auto-plays, `&speed=4` runs faster, and `&warmup=0.5&minutes=2&cooldown=0.5` shortens the workout. In the browser console, `pz.state` shows live state and `pz.step(seconds)` advances the game even when the tab isn't drawing.

## Publishing (GitHub Pages)

Push this folder to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**. The site appears at `https://<user>.github.io/<repo>/`, with the bridge at `.../bridge.html`. HTTPS comes free, and both WebXR and Web Bluetooth require it.
