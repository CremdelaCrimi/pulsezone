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

- **Orbs:** punch **blue** with your left hand and **orange** with your right. A **white ring** means hit it twice. A **white arrow** means swing that way: an uppercut, or a hook from the outside in. Arrow orbs score ×1.5. At high intensity, some orbs cross over to the other side for twisting cross-body punches.
- **Walls (purple):** get your head into the open gap as the wall passes: **duck**, **step aside** from a centre pillar, **lean left or right**, or **squat left or right** (the open gap is low on one side). Duck walls start at 30% intensity, and side squats at 55%.
- **Heat gauge (left):** frosty and icy when you're below your zone, a lively flame in it, and a hyper flame with embers above it. The green mark shows your target zone.
- **Music & sound:** synthesized live, with no audio files. The tempo (about 95–145 BPM) and the layers rise with intensity. You get icy bells below your zone, a bright arpeggio in it, and driving hats above it. A soft heartbeat plays at your real BPM, and every hit, miss, dodge and wall has its own sound. **M** toggles it, or use the checkbox on the panel.

**No tracker yet?** The game runs on a simulated heart. In the headset it responds to how hard you actually move. The bridge also has a **Test without a tracker** switch that sends a fake heart rate, which is handy for checking the phone link.

## Desktop testing

Left click = left punch · right click = right punch · hold **C** duck · **A/D** lean · **[ ]** target · **B** switch source · **Tab** simulator mode · **↑↓** effort (Manual) · **L** drop signal · **M** sound · **T** 5× speed · **E** end · **R** restart

## Files

| File | What it is |
|---|---|
| `index.html`, `js/game.js` | The game: three.js + WebXR, fists, orbs, ducking bars, in-world scoreboard |
| `bridge.html`, `js/bridge.js` | iPhone bridge: Web Bluetooth Heart Rate client, reconnects automatically |
| `js/link.js` | Pairing code + WebRTC link (PeerJS), with heartbeat and auto-reconnect |
| `js/core.js` | Engine-free logic: heart simulator, PID zone controller, difficulty curve, wall shapes, hand/swing rules, Bluetooth packet parser |
| `js/thermo.js` | Heat gauge shader (frost / flame / hyper flame) |
| `js/audio.js` | Adaptive soundtrack + sound effects (Web Audio) |
| `test/core.test.mjs` | 49 checks: simulated workouts (time in zone, overshoot, safety brake, dropouts), packet parsing, wall shapes, hands and swings |

No build step: these are plain files. three.js and PeerJS load from jsDelivr at pinned versions.

## Developing

```bash
node test/core.test.mjs        # logic tests
node tools/serve.mjs 8080      # local server -> http://localhost:8080
```

Test URL options: `?smoke` auto-plays, `&speed=4` runs faster, and `&warmup=0.5&minutes=2&cooldown=0.5` shortens the workout. In the browser console, `pz.state` shows live state and `pz.step(seconds)` advances the game even when the tab isn't drawing.

## Publishing (GitHub Pages)

Push this folder to a GitHub repo, then **Settings → Pages → Deploy from a branch → `main` / root**. The site appears at `https://<user>.github.io/<repo>/`, with the bridge at `.../bridge.html`. HTTPS comes free, and both WebXR and Web Bluetooth require it.
