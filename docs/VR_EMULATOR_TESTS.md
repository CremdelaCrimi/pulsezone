# Desktop VR emulator tests

PulseZone can run in a pretend Quest 3 on a computer, using Meta's **Immersive Web Emulation Runtime (IWER)** (`iwer` 2.8.0, MIT, loaded from jsDelivr). In this mode the game runs its real VR code: fist tracking, punch speed and travel, swing direction, the guard zones, sled reps and rope pumping. `?smoke` skips all of these.

The emulator only loads when the address has `?emulate`. Normal play, including on the Quest, never loads it.

## Run it

1. Start the local server (`node tools/serve.mjs`, or the `pulsezone-web` preview) and open:
   `http://localhost:8080/?emulate&warmup=0&minutes=5&cooldown=0`
   - Add `&emutimer` if the window is covered or hidden. It runs frames off a timer, because browsers stop animation frames in hidden windows.
2. In the browser console:
   ```js
   const bot = await import('/test/xr-bot.js');
   bot.runChecks();          // about 2 minutes; window.xrReport fills in step by step
   ```
   - Or `bot.start()` to let the bot play along with the normal workout, and `bot.stop()` to end it.

## What the bot does

`test/xr-bot.js` moves the emulated headset and controllers like a player who stays on the centre line:
- punches each orb with the right hand, along its arrow (straight, hooks, uppercuts, hammer fists);
- holds the guard for the called zone (face, left, right or body);
- leans or squats under walls and away from missiles (up to 40 cm lean, 50 cm squat; never a step);
- does sled reps (stand tall with arms up, then squat and push both poles down and back);
- pumps the ropes at four effort levels, to check the intensity meter;
- slams the bar with both fists;
- does the whole-body stations: knee drive, ceiling press, woodchopper and tiptoe reach.

`runChecks()` sends each test move in turn and records what changed. The steps are: free play, guard ×2, hammer, walls ×2, missiles, sled, ropes, combo, then knee, press, chop, tiptoe, knee, chop. (Guard is off in normal play now, but its test still sends one, so the code stays checked.) For each step it records hits, misses, weak / wrong-hand hits, blocks, dodges, wall and missile hits, sled reps and the rope level reached.

## Hooks it uses

- `pz.xr`: the emulated device (`position`, `controllers.left/right.position`).
- `pz.enterVR()`: presses ENTER VR.
- `pz.peek()`: a read-only snapshot of the head, fists, orbs, walls, guards, missiles, slams, sled and ropes.

## First results (v50, 2026-11-16)

Full `runChecks()` run, after giving the bot deep enough leans and squats:
- 41 hits, 0 misses, 0 weak, 0 wrong hand.
- Hooks, uppercuts and hammer fists: 13 of 15 perfect.
- Guards: 0 missed. Walls: 10 dodged, 0 hit. Missiles: 6 dodged, 0 hit.
- Sled: 6 pushes, 6 reps counted.
- Ropes: the meter read PUMP / GOOD / HARD / MAX at the four effort levels.
- No console errors. No game bugs found in this run.

The bot's first try hit a pillar and a side-squat wall, because its lean (30 cm) and squat (42 cm) were too shallow:
- The pillar needs the head about 31 cm off centre.
- The side-squat walls need the head about 41 cm below standing height.

Worth checking in the headset: are those comfortable without stepping?
