// TCX export checks for js/tcx.js.
// Run:  node test/tcx.test.mjs     (exit code 0 = all passed)
import { workoutToTcx, latestRecord } from '../js/tcx.js';

let failures = 0;
const check = (ok, what) => {
  console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${what}`);
  if (!ok) failures++;
};
const count = (s, re) => (s.match(re) || []).length;
const all = (s, re) => [...s.matchAll(re)].map((m) => m[1]);

const cols = ['t', 'phase', 'bpm', 'status', 'target'];
const rec = {
  date: '2026-11-19T07:30:00.000Z', version: 'v56',
  summary: { seconds: 6, trainingSeconds: 4, inZoneSeconds: 3, pct: 75.4, avgBpm: 120, peakBpm: 140, score: 10, kcal: 12.6 },
  settings: { targetBpm: 125, minutes: 20 },
  cols,
  rows: [
    [0, 'WarmUp', '', 'NoSignal', 100],
    [1, 'WarmUp', 100, 'Below', 100],
    [2, 'Training', 120, 'InZone', 125],
    [3, 'Training', '', 'NoSignal', 125],
    [4, 'Training', 140, 'Above', 125],
    [5, 'CoolDown', 0, 'NoSignal', 110],
  ],
  events: [],
};

console.log('\n== empty');
check(workoutToTcx({ ...rec, rows: [] }) === '', 'no rows -> empty string');
check(workoutToTcx(null) === '', 'null record -> empty string');

console.log('\n== structure');
const xml = workoutToTcx(rec);
check(xml.startsWith('<?xml version="1.0"'), 'starts with the XML declaration');
check(xml.includes('xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2"'), 'TCX v2 namespace');
check(xml.includes('<Activity Sport="Other">'), 'Sport="Other"');
check(xml.includes(`<Id>${rec.date}</Id>`), 'Id is the start date');
check(xml.includes(`<Lap StartTime="${rec.date}">`), 'Lap starts at the start date');
check(xml.includes('<TotalTimeSeconds>6</TotalTimeSeconds>'), 'TotalTimeSeconds = rows.length');
check(xml.includes('<Calories>13</Calories>'), 'Calories rounded to an integer');
check(xml.includes('<Intensity>Active</Intensity>') && xml.includes('<TriggerMethod>Manual</TriggerMethod>'), 'Intensity Active, TriggerMethod Manual');

console.log('\n== trackpoints');
check(count(xml, /<Trackpoint>/g) === 3, 'one trackpoint per row with a numeric bpm > 0 (3)');
const times = all(xml, /<Time>([^<]+)<\/Time>/g);
const expected = [1, 2, 4].map((t) => new Date(Date.parse(rec.date) + t * 1000).toISOString());
check(JSON.stringify(times) === JSON.stringify(expected), `times advance by t seconds: ${times.join(', ')}`);
const hrs = all(xml, /<Trackpoint>[\s\S]*?<HeartRateBpm><Value>(\d+)<\/Value>/g);
check(JSON.stringify(hrs) === JSON.stringify(['100', '120', '140']), 'trackpoint heart rates in row order');

console.log('\n== heart-rate summary');
check(xml.includes('<AverageHeartRateBpm><Value>120</Value></AverageHeartRateBpm>'), 'average HR = 120');
check(xml.includes('<MaximumHeartRateBpm><Value>140</Value></MaximumHeartRateBpm>'), 'max HR = 140');
check(xml.includes('<Notes>PulseZone v56, target 125 BPM, 75% in zone</Notes>'), 'notes line');

console.log('\n== no readings / no summary');
const noHr = workoutToTcx({ ...rec, summary: null, rows: [[0, 'WarmUp', '', 'NoSignal', 100]] });
check(noHr !== '' && count(noHr, /<Trackpoint>/g) === 0, 'rows without bpm -> document with an empty track');
check(!noHr.includes('AverageHeartRateBpm') && !noHr.includes('MaximumHeartRateBpm'), 'no HR summary when unknown');
check(noHr.includes('<Calories>0</Calories>'), 'Calories 0 when summary is null');

console.log('\n== escaping');
const nasty = workoutToTcx({ ...rec, version: 'v56 <"beta" & \'x\'>' });
check(nasty.includes('PulseZone v56 &lt;&quot;beta&quot; &amp; &apos;x&apos;&gt;'), 'XML special characters escaped in Notes');
check(!/<Notes>[^<]*[<&"'][^<]*<\/Notes>/.test(nasty.replace(/&(lt|gt|amp|quot|apos);/g, '')), 'no raw markup left inside Notes');

console.log('\n== saved-file wrapper');
check(latestRecord({ app: 'PulseZone', workouts: [rec] }) === rec, 'latestRecord unwraps { workouts: [rec] }');
check(latestRecord(rec) === rec, 'latestRecord accepts a bare record');
check(latestRecord({}) === null && latestRecord(null) === null, 'latestRecord rejects other shapes');

console.log(failures ? `\n${failures} check(s) FAILED` : '\nAll TCX checks passed');
process.exit(failures ? 1 : 0);
