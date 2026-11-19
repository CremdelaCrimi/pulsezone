# v58 build spec ("the packaging round")

Source: docs/VR_GAMES_RESEARCH_2026-11-19.md (Morty's and Gemini's ranked gaps). v57 built 5 of the
12 distinct ideas; v58 builds the rest that need no decision from Gio. Everything below is LOCAL
(no server, no accounts), keeps the player on the centre line, and leaves zone targets, the lag
model, safety caps and scoring thresholds alone.

Work is split into packages with fixed contracts so they can be built side by side. New modules
import siblings with the `?v58` tag (e.g. `./core.js?v58`); Node tests import `../js/x.js` directly.
Code style: plain ES modules, no bundler, no dependencies, comments say WHY (see js/core.js).
House rules: no em dashes in player-facing text; short imperative call-outs; nothing a player reads
may promise something the build doesn't do.

## Shared names (fixed: several packages use them)

Worlds: `grid` (today's look, the default), `harbour`, `reactor`, `snow`, `dojo`.
Music sets (synth only): `night` (today's synth, unchanged), `harbour`, `furnace`, `storm`.

Named workouts (id, name, shape, world, music, colour, featured move, 4 act titles):

| id | name | shape | world | music | colour | feature | acts |
|---|---|---|---|---|---|---|---|
| harbour-lights | Harbour Lights | steady | harbour | harbour | #5fd0c5 | trace | Cast Off / Open Water / The Crossing / Home Lights |
| long-road | Long Road | steady | grid | night | #7c9cff | hammer | First Mile / Cruise / Headwind / Last Mile |
| morning-engine | Morning Engine | steady | dojo | harbour | #ffb36b | chop | Ignition / Idle Up / Full Steam / Whistle |
| night-shift | Night Shift | steady | reactor | night | #b48cff | bag | Clock In / The Line / Overtime / Clock Out |
| tide-runner | Tide Runner | waves | harbour | storm | #4db8ff | sweep | Low Tide / Swell / Breakers / High Tide |
| storm-front | Storm Front | waves | snow | storm | #9fb4ff | barrage | Still Air / First Gusts / The Squall / Clear Sky |
| canyon-echo | Canyon Echo | waves | dojo | harbour | #ff9a5c | pose | Trailhead / Switchbacks / The Rim / Echo |
| rolling-hills | Rolling Hills | waves | snow | night | #8fe08a | knee | Foothills / Crest / Valley / Summit View |
| summit-push | Summit Push | build | snow | furnace | #cfe6ff | press | Base Camp / The Ridge / Thin Air / The Summit |
| furnace | Furnace | build | reactor | furnace | #ff6a3d | ropes | Kindling / Stoke / White Heat / Meltdown |
| launch-day | Launch Day | build | grid | storm | #ffd34d | heavy | Countdown / Ignition / Max Q / Orbit |
| last-round | Last Round | build | dojo | furnace | #ff4f6d | swing | Bell / Trading Blows / Championship Rounds / Final Bell |
| fresh-start | Fresh Start (the restart session) | steady | harbour | harbour | #7cffb0 | jab | Ease In / Find It / Hold It / Done |

The boss is called THE GUARDIAN.

## A. js/progress.js + test/progress.test.mjs (pure logic, Node-testable)

```js
import { weekStart, weekSummary, WEEK_GOAL, PLAN_SHAPES } from './core.js?v58';

// --- named workouts
export const WORKOUT_BANK   // { steady: [...4], waves: [...4], build: [...4] }, entries { id, name, shape, world, music, colour, feature, acts: [4 titles] }
export const RESTART_WORKOUT // the fresh-start entry, plus restart: true
export const RESTART_GAP_DAYS = 7;
export function todayWorkout({ log, now = Date.now(), minutes = 15, bossOn = true })
// -> { ...bank entry, restart: bool, minutes, boss: bool, n, goal, next: { id, name, shape } }
export function actTitles(workout, n)  // n acts (2..4): first n-1 titles + always the LAST title as the finale; [] for n < 2
```
Rules for todayWorkout:
- `week = weekSummary(log, now)`; shape = week.nextShape (Steady, Waves, Build in order).
- Name: `bank[shape][(weekIndex + Math.floor(week.done / WEEK_GOAL)) % 4]`, weekIndex = whole weeks since
  the epoch of `weekStart(now)` (so a week's three workouts keep their names all week, and next week
  rotates to the next names).
- `n` = week.done + 1, `goal` = WEEK_GOAL.
- `boss` = bossOn and not a restart and `week.done % WEEK_GOAL === WEEK_GOAL - 1` (the week's last
  planned workout; with the default plan that is the Build day).
- Restart: the log has at least one counted workout (trainingSec >= 180) and the last one is
  RESTART_GAP_DAYS or more days before `now` -> return the Fresh Start entry with restart: true,
  shape 'steady', minutes = max(6, round(minutes * 0.6)), boss false. Otherwise minutes passes through.
- `next`: what the plan gives after this one is done (same rule with done + 1; if that rolls past the
  goal it is next week's first workout, i.e. weekIndex + 1 and shape steady). After a restart, `next`
  is today's normal workout (the one the restart replaced).

```js
// --- levels (fed by minutes in zone, not score)
export const levelMinutes = (L) => 4 * (L - 1) + 1.5 * (L - 1) ** 2; // cumulative in-zone minutes to reach level L
export const LEVEL_TITLES  // [[1,'Spark'],[3,'Ember'],[5,'Flame'],[8,'Blaze'],[12,'Furnace'],[16,'Reactor'],[20,'Star']]
export function levelFor(zoneSeconds) // -> { level, title, intoSec, needSec, frac (0..1 toward the next level) }
export function levelUp(beforeSec, afterSec) // -> { from, to, title } or null
export const TRAIL_UNLOCKS // [{ level: 1, key: 'ember', name: 'Ember trails', colour: 0xffa040 }, { level: 3, key: 'gold', name: 'Gold trails', colour: 0xffd34d }, { level: 6, key: 'violet', name: 'Violet trails', colour: 0xb48cff }, { level: 10, key: 'aqua', name: 'Aqua trails', colour: 0x4fd1c5 }, { level: 15, key: 'white', name: 'White-hot trails', colour: 0xf2f5ff }]
export function trailFor(level) // highest unlocked entry
export function trailUnlocked(fromLevel, toLevel) // the entry unlocked by this level-up, or null

// --- badges (real behaviours; all local)
export const BADGES // [{ id, name, hint }]  (hint = how to earn it, one short line)
export function newBadges(ctx, have = {}) // -> [{ id, name }] earned by this workout and not already in `have`
```
ctx = `{ w, landings, week, bests, heavy, poses, bossWon, restart }` where w is the workout summary
(`pct, inZoneSeconds, trainingSeconds, streak, recovery, profile`), landings is a list of verdict
strings ('perfect' | 'nearly' | 'over' | 'short'), week is weekSummary AFTER this workout was logged,
bests is the saved bests AFTER this workout (`workouts, totalZoneSeconds`).
Badges (id: rule): first (any finished workout with trainingSeconds >= 180), zone50 / zone80 (pct >= 50 / 80
with trainingSeconds >= 360), streak2 / streak5 (streak >= 120 / 300 s), landing (a 'perfect' landing),
landing3 (3+ perfect in one workout), week3 (week.done >= 3), weeks2 / weeks4 (week.streak >= 2 / 4),
waves / build (finished that shape, trainingSeconds >= 360), boss (bossWon), heavy25 (heavy >= 25),
poses10 (poses >= 10), recovery20 (recovery >= 20), comeback (restart finished), ten (bests.workouts >= 10),
hour (bests.totalZoneSeconds >= 3600).

```js
// --- ghost of your last run (same shape)
export const GHOST_STEP = 10;
export function ghostTrace(rows)                 // cumulative in-zone seconds after every 10 s of TRAINING (rows: { phase, status })
export function ghostAt(trace, t)                // ghost's in-zone seconds at training second t (linear between samples, flat after the end); null without a trace
export function ghostDelta(trace, t, inZoneNow)  // inZoneNow - ghostAt (seconds, signed); null without a trace
export function ghostLabel(delta)                // '+0:12' | '-0:08' | '0:00'

// --- heart-rate recovery as a story
export function recoveryStory(log, recovery, now = Date.now())
// log entries may carry { date, recovery }. '' when recovery is null; 'first one on record' when no
// earlier entry in the last 30 days has one; 'best this month' when it beats them all; otherwise
// '+N vs your month' / '-N vs your month' (difference from the 30-day average, rounded; '' if 0).
```

## B. js/boss.js + test/boss.test.mjs (pure) and js/bossview.js (three.js view)

Design: docs/BOSS_SPEC_DRAFT.md (its five fixed decisions hold). The boss gives the zone
controller a face; it adds no moves. Open questions answered conservatively: it only appears on the
week's last planned workout (plus a Test button), it can be switched off, knee-drive scoring is NOT
tightened, and the shield shows as the ring plus a small number.

```js
export const BOSS = Object.freeze({ shieldShare: 0.42, coreShare: 0.28, graceBelow: 20, regenPerSec: 1 / 3,
  activeWindow: 3, perfect: 25, nearly: 10, coreLandingScale: 0.4, quality: { tap: 0.7, solid: 1, heavy: 1.3 } });
export function newBoss(trainingSeconds) // { shield: 100, core: 100, state: 'guarded', secsBelow: 0, lastHitAt: -99, shieldBrokeAt: null, defeatedAt: null, T }
export function bossStateFor(status)      // Below -> 'guarded', InZone -> 'exposed', Above -> 'overheating', SafetyBrake -> 'stunned', NoSignal -> 'paused'
export function bossTick(boss, { status, climbing = false, dt, now }) // sets boss.state; below the zone for > graceBelow s and not climbing: shield += regenPerSec * dt (max 100). No regen once defeated. Returns boss.
export function bossHit(boss, { now, quality = 1 }) // a scored rep. Only while 'exposed' and not defeated; returns null otherwise.
// chip = (100 / (share * T)) * min(now - lastHitAt, activeWindow) * quality, share = shieldShare while shield > 0 else coreShare.
// Shield first; leftover does NOT spill into the core. Returns { shield, core (damage dealt), broke, defeated }.
export function bossLanding(boss, verdict, now) // 'perfect' / 'nearly': knock BOSS.perfect / BOSS.nearly % off the shield (or x coreLandingScale off the core once the shield is down). Others: nothing. Returns same shape as bossHit, or null.
export function bossSummary(boss) // { defeated, shield, core (rounded), text } e.g. 'GUARDIAN DOWN at 11:20' / 'Guardian: shield 0% · core 35% left. It will be back.'
```
Sizing check (a test): a player in the zone and hitting steadily for 70% of T breaks the shield at
~60% of the workout and finishes the core near the end; a full 45 s coast below the zone regenerates
at most ~9% (20 s grace, then 1% per 3 s).

```js
// js/bossview.js  (import * as THREE from 'three')
export class BossView {
  constructor(scene)                 // builds everything once, hidden. < 12 draw calls, no per-frame allocation
  show() / hide() / get visible
  update(boss, { dt, time, beat = 0 }) // ring segments by shield %, core glow by core %, looks per boss.state; label redraw only on change
  flash(kind)                        // 'hit' | 'broke' | 'landing' | 'defeated'
}
```
Placement: far end of the lane, centred, about z = -18, figure about 3 m tall with the core at about
y = 2.3; materials use `fog: false` so it reads through the fog (scene fog is 14..32 m). The player
never has to look away from the lane to see it. States: guarded = steady blue ring; exposed = ring
cracks/glows orange, core pulses on `beat`; overheating = red pulse + "COOL ME DOWN - BREATHE" label;
stunned = kneels (sinks ~0.6 m); paused = dim, "WAITING FOR YOUR HEART RATE". Defeated: the core
bursts once, then the figure sinks away. A small canvas label above it: "GUARDIAN  SHIELD 62%" or
"CORE 40%" plus the state line.

## C. Voice coach v2: clips that work in the Quest browser

Quest Browser very likely has no speech voices, so v57's coach would be silent there. Ship a
pre-rendered clip bank and keep browser speech as the fallback for text that has no clip.

- `js/coach-lines.js`: `export const PHRASES` (key -> [lines]) and `export const CUES` (exact call-out
  texts the game passes to `coach.say()`, e.g. 'Duck!', 'Stand tall!').
- `tools/make-voice.ps1` (and a small node driver if useful): renders every line with a Windows voice
  (Microsoft Zira), trims silence, writes `assets/voice/<id>.mp3` (or the fallback format) and
  `assets/voice/manifest.json`: `{ voice, format, clips: { '<key>.<i>': { file, text }, 'cue.<slug>': { file, text } } }`.
  Use only what ships with Windows (System.Speech / Windows.Media.SpeechSynthesis for speech;
  Windows.Media.Transcoding MediaTranscoder for MP3 or AAC). Do not download encoders or packages.
- `js/coach.js`: same public API as v57 plus:
```js
attach(audioCtx, destination)  // Web Audio output for clips
load(base = 'assets/voice/')   // async; fetches the manifest; clips are fetched + decoded on first use and cached; a few common ones prefetched
get mode()                     // 'clips' | 'speech' | 'none'
get available()                // mode !== 'none'
onSpeak                        // optional callback(seconds) so the game can duck the music
line(key, tier) / say(text, tier) // clip if the manifest has one (say(): exact CUES text), else browser speech, else nothing
```
  Same tier rules as v57 (never talks over itself; tier 1 may interrupt).

New phrase keys (2-3 lines each unless noted):
below5 ("A few beats under. Bigger swings."), below10 ("About ten under. Use your legs."),
below15 ("Well under. Big moves, build it up."), above5 ("A few beats over. Ease off."),
above10 ("Well over. Light hands, long breaths."), chargeHalf ("Halfway. Keep driving."),
chargeLast5 ("Five more seconds!"), coastHold ("Hold... let it rise... land it."),
flick ("Those are flicks. Punch through the target."), powerPraise ("That's real power. Keep that."),
act1 / act2 / act3 ("Act one." ...), levelUp ("Level up!"), badge ("New badge."),
ghostAhead ("You're ahead of your last run."), ghostBehind ("Your last run is ahead. Reel it in."),
restart ("Welcome back. Short and easy today."), bossArrive ("Guardian day. Break its shield while you're in the zone."),
bossExposed ("It's open. Hit it now."), bossGuarded ("Shield's up. Get back in your zone."),
bossOverheat ("It's overheating. Ease off and breathe."), bossBroke ("Shield down! Go for the core."),
bossDefeated ("Guardian down! That's the week."), bossRetreat ("It got away. It'll be back."),
and one per named workout: `workout.<id>` = "Today: <Name>." (13 clips, one line each).

## D. js/worlds.js (three.js view)

```js
export const WORLDS // { grid, harbour, reactor, snow, dojo }: { name, sky, fog, floor, rail, railGlow, stripe, glow (horizon colour), sun }
export class WorldView {
  constructor(scene, { floorMat, railMat, stripeMat, sun }) // recolours the game's existing materials; builds a horizon glow band + silhouettes per world
  set(key, instant = false)  // cross-fade (about 2 s) to that world; unknown key = 'grid'
  update(dt)                 // advances the fade
  get sky()                  // THREE.Color: the world's base sky right now (the game tints scene.background and fog from it)
  get key()
}
```
`grid` must look exactly like today (sky/fog 0x0b0d18, floor 0x141826, rail 0x3f7fe6 / emissive
0x1a3d80, stripes 0x233050, no horizon objects). Other worlds stay DARK (VR comfort, and the orbs
must stay the brightest things in view): harbour = deep teal night with an amber dawn band and a few
mast/crane silhouettes; reactor = near-black with a red-orange glow and cooling-tower cylinders;
snow = blue-grey dusk with pale peaks; dojo = warm dark wood tones with lantern-like posts.
Silhouettes sit 30..40 m out (beyond the lane), `fog: false`, a handful of merged or instanced
meshes (<= 3 extra draw calls per world, only the active world visible).

## E. js/audio.js music sets

`export const MUSIC_SETS` (`night` = today's synth, bit-for-bit the same behaviour), `harbour`
(brighter, major/lydian, airy plucks), `furnace` (minor, driving bass, four-on-the-floor), `storm`
(darker, syncopated/half-time feel). `audio.setMusicSet(key)` switches on the next bar (synth mode
only; the recorded song is untouched); `audio.musicSet` reads it. Tempo, the zone filter, drop-ins
and breakdowns keep working for every set.

## F. js/card.js + phone bridge button

`drawCard(canvas, rec)` draws a 1080x1350 share card from a workout record (the JSON the bridge page
already stores; see `workoutRecord` in js/game.js and `latestRecord` in js/tcx.js): workout name (or
"PulseZone workout"), date, the heart-rate line coloured by zone over the target band, time in zone,
avg / peak, calories, longest streak, 1-min recovery when present. `cardBlob(rec)` -> PNG blob.
bridge.html gets "Save summary card (PNG)" under the TCX button.

## G. Integration (game.js, options.js, index.html, tests, docs) happens after A-F, one writer at a time.
