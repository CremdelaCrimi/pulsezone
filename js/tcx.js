// Garmin TCX export of one PulseZone workout record (see workoutRecord() in game.js).
// TCX is the heart-rate file format Strava, Garmin Connect and most fitness apps import.
// Pure function, no DOM: node test/tcx.test.mjs checks it.

const escapeXml = (s) => String(s).replace(/[<>&"']/g, (c) => (
  { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]
));

const toNumber = (v) => {
  if (v === '' || v == null) return NaN;
  const n = typeof v === 'number' ? v : Number(v);
  return Number.isFinite(n) ? n : NaN;
};

/** Accept either a bare record or the saved-file wrapper { workouts: [rec] }. */
export function latestRecord(data) {
  if (!data) return null;
  if (Array.isArray(data.workouts)) return data.workouts[data.workouts.length - 1] || null;
  return Array.isArray(data.rows) ? data : null;
}

/** Build a TCX (TrainingCenterDatabase v2) document string; '' when the record has no rows. */
export function workoutToTcx(rec) {
  const rows = rec?.rows;
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const cols = Array.isArray(rec.cols) ? rec.cols : [];
  const iT = cols.indexOf('t'), iBpm = cols.indexOf('bpm');
  if (iT < 0 || iBpm < 0) return '';

  const startMs = Date.parse(rec.date);
  const start = Number.isFinite(startMs) ? new Date(startMs) : new Date(0);
  const startIso = start.toISOString();
  const summary = rec.summary || null;
  const settings = rec.settings || {};

  const points = [];
  let hrSum = 0, hrMax = 0;
  for (const row of rows) {
    const bpm = toNumber(row[iBpm]);
    if (!(bpm > 0)) continue;
    const t = toNumber(row[iT]);
    const when = new Date(start.getTime() + (Number.isFinite(t) ? t : 0) * 1000).toISOString();
    const hr = Math.round(bpm);
    hrSum += hr; hrMax = Math.max(hrMax, hr);
    points.push(`          <Trackpoint>\n            <Time>${when}</Time>\n            <HeartRateBpm><Value>${hr}</Value></HeartRateBpm>\n          </Trackpoint>`);
  }

  const avg = points.length ? Math.round(hrSum / points.length) : toNumber(summary?.avgBpm);
  const max = points.length ? hrMax : toNumber(summary?.peakBpm);
  const kcal = Math.max(0, Math.round(toNumber(summary?.kcal) || 0));

  const noteBits = [];
  if (rec.version != null && rec.version !== '') noteBits.push(`PulseZone ${rec.version}`);
  else noteBits.push('PulseZone');
  if (Number.isFinite(toNumber(settings.targetBpm))) noteBits.push(`target ${Math.round(toNumber(settings.targetBpm))} BPM`);
  if (Number.isFinite(toNumber(summary?.pct))) noteBits.push(`${Math.round(toNumber(summary.pct))}% in zone`);
  const notes = noteBits.join(', ');

  const hrXml = [
    Number.isFinite(avg) && avg > 0 ? `        <AverageHeartRateBpm><Value>${avg}</Value></AverageHeartRateBpm>\n` : '',
    Number.isFinite(max) && max > 0 ? `        <MaximumHeartRateBpm><Value>${max}</Value></MaximumHeartRateBpm>\n` : '',
  ].join('');

  return `<?xml version="1.0" encoding="UTF-8"?>
<TrainingCenterDatabase xmlns="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.garmin.com/xmlschemas/TrainingCenterDatabase/v2 http://www.garmin.com/xmlschemas/TrainingCenterDatabasev2.xsd">
  <Activities>
    <Activity Sport="Other">
      <Id>${startIso}</Id>
      <Lap StartTime="${startIso}">
        <TotalTimeSeconds>${rows.length}</TotalTimeSeconds>
        <DistanceMeters>0</DistanceMeters>
        <Calories>${kcal}</Calories>
${hrXml}        <Intensity>Active</Intensity>
        <TriggerMethod>Manual</TriggerMethod>
        <Track>
${points.join('\n')}
        </Track>
      </Lap>
      <Notes>${escapeXml(notes)}</Notes>
    </Activity>
  </Activities>
  <Author xsi:type="Application_t">
    <Name>PulseZone</Name>
    <Build><Version><VersionMajor>0</VersionMajor><VersionMinor>0</VersionMinor></Version></Build>
    <LangID>en</LangID>
    <PartNumber>000-00000-00</PartNumber>
  </Author>
</TrainingCenterDatabase>
`;
}
