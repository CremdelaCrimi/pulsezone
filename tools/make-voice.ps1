<#
.SYNOPSIS
  Renders every voice-coach line in js/coach-lines.js to assets/voice/<id>.mp3 and writes assets/voice/manifest.json.

.DESCRIPTION
  Why: the Quest browser has no speech voices, so the coach (js/coach.js) plays these clips through Web Audio
  and keeps browser speech only for text that has no clip.

  Uses only what ships with Windows 10/11, nothing is downloaded or installed:
    speech   Windows.Media.SpeechSynthesis, voice "Microsoft Zira" (16 kHz mono), a little faster than default
    tidy-up  silence trimmed off both ends, long pauses between sentences shortened, level normalised
    MP3      Windows.Media.Transcoding (the Media Foundation MP3 encoder), 48 kHz mono
  (48 kHz because at 16/24/32 kHz this encoder drops the last ~0.1 s of every file, and its fixed start-up
  delay is shortest at 48 kHz: about 11 ms once Chromium has decoded it.)

  Safe to run again: ids and file names come from the lines themselves, a clip whose line and settings have not
  changed is kept as it is (-Force renders everything again), clips whose line is gone are deleted, and the
  run ends with counts and a list of any failures (exit code 1 if anything failed).

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\make-voice.ps1
  node test\coach.test.mjs
#>
[CmdletBinding()]
param(
  [switch]$Force,                          # render every clip again, even unchanged ones
  [string]$OutDir,                         # default: <repo>\assets\voice
  [string]$Voice = 'Microsoft Zira',       # also installed here: Microsoft Mark, Microsoft David
  [double]$Rate = 1.1,                     # speaking rate, 1.0 = the voice's default
  [int]$Kbps = 48,                         # MP3 bitrate (mono); 48 keeps ~160 clips under 2 MB
  [int]$MaxPauseMs = 280                   # the voice leaves ~0.55 s between sentences: too slow for a coach
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version 2

$SampleRate = 48000  # MP3 sample rate (see above)
$LeadMs = 10         # silence kept before the first sound, so the encoder never clips a start
$TailMs = 60         # and after the last (Chromium's decoder drops the final ~11 ms)
$Peak = 0.89         # normalised peak (about -1 dBFS): every clip equally loud, headroom for MP3 overshoot
$Floor = 8           # 16-bit sample values below this count as silence (the voice's own silence is exactly 0)

$root = Split-Path -Parent $PSScriptRoot
if (-not $OutDir) { $OutDir = Join-Path $root 'assets\voice' }
$null = New-Item -ItemType Directory -Force $OutDir
$OutDir = (Resolve-Path $OutDir).Path
$settings = "voice=$Voice; rate=$Rate; pause<=${MaxPauseMs}ms; lead=${LeadMs}ms; tail=${TailMs}ms; peak=$Peak; mp3 $SampleRate Hz mono $Kbps kbps"

# ---------------------------------------------------------------- the lines (Node reads js/coach-lines.js)

$linesTool = Join-Path $root 'tools\voice-lines.mjs'
$json = (& node $linesTool) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'tools/voice-lines.mjs reported a problem with the lines (see above); nothing was rendered.' }
$lines = @(ConvertFrom-Json $json | ForEach-Object { $_ }) # (5.1 hands the whole array over as one object: unroll it)
if ($lines.Count -lt 2) { throw 'tools/voice-lines.mjs returned no lines; nothing was rendered.' }
Write-Host ("{0} lines to voice -> {1}" -f $lines.Count, $OutDir)

# ---------------------------------------------------------------- Windows Runtime plumbing

Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Media.SpeechSynthesis.SpeechSynthesizer, Windows.Media.SpeechSynthesis, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.DataReader, Windows.Storage.Streams, ContentType = WindowsRuntime]
$null = [Windows.Storage.StorageFolder, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]

# WinRT calls are asynchronous and PowerShell 5.1 cannot await them, so each one is turned into a .NET Task
# (the AsTask extension methods, found by reflection because they are generic) and waited for.
$asTask = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }
$asTaskOperation = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' } | Select-Object -First 1
$asTaskProgress = $asTask | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' } | Select-Object -First 1
function Wait-Operation($operation, [Type]$resultType) {
  $task = $asTaskOperation.MakeGenericMethod($resultType).Invoke($null, @($operation))
  if (-not $task.Wait(60000)) { throw 'timed out after 60 s' }
  $task.Result
}
function Wait-Progress($action, [Type]$progressType) {
  $task = $asTaskProgress.MakeGenericMethod($progressType).Invoke($null, @($action))
  if (-not $task.Wait(60000)) { throw 'timed out after 60 s' }
}

# ---------------------------------------------------------------- sample work (C#: a PowerShell loop over every sample is far too slow)

Add-Type -TypeDefinition @'
using System;
using System.Collections.Generic;
using System.IO;
using System.Text;

public static class PulseVoiceDsp
{
    /// 16-bit PCM samples (first channel) out of a RIFF/WAVE file held in memory.
    public static short[] ReadWav(byte[] wav, out int rate)
    {
        rate = 0;
        int channels = 1, pos = 12;
        while (pos + 8 <= wav.Length)
        {
            string id = Encoding.ASCII.GetString(wav, pos, 4);
            int len = BitConverter.ToInt32(wav, pos + 4);
            if (id == "fmt ")
            {
                if (BitConverter.ToInt16(wav, pos + 8) != 1 || BitConverter.ToInt16(wav, pos + 22) != 16) throw new InvalidDataException("the voice did not return 16-bit PCM");
                channels = BitConverter.ToInt16(wav, pos + 10);
                rate = BitConverter.ToInt32(wav, pos + 12);
            }
            else if (id == "data")
            {
                int n = Math.Min(len, wav.Length - pos - 8) / (2 * channels);
                short[] x = new short[n];
                for (int i = 0; i < n; i++) x[i] = BitConverter.ToInt16(wav, pos + 8 + i * 2 * channels);
                return x;
            }
            pos += 8 + len + (len & 1);
        }
        throw new InvalidDataException("no audio in the voice's reply");
    }

    /// Trims the silence off both ends (keeping leadMs / tailMs), shortens any silent stretch inside to
    /// maxPauseMs, and scales the loudest sample to `peak`. Returns no samples if there was no sound at all.
    public static short[] Tidy(short[] x, int rate, int floor, int leadMs, int tailMs, int maxPauseMs, double peak)
    {
        int first = -1, last = -1;
        for (int i = 0; i < x.Length; i++) if (Math.Abs((int)x[i]) >= floor) { if (first < 0) first = i; last = i; }
        if (first < 0) return new short[0];
        int lead = rate * leadMs / 1000, tail = rate * tailMs / 1000, maxPause = rate * maxPauseMs / 1000;
        List<short> y = new List<short>(last - first + lead + tail + 2);
        for (int i = first - lead; i < first; i++) y.Add(i >= 0 ? x[i] : (short)0);
        int quiet = 0;
        for (int i = first; i <= last; i++)
        {
            if (Math.Abs((int)x[i]) < floor) { if (++quiet > maxPause) continue; } else quiet = 0;
            y.Add(x[i]);
        }
        for (int i = last + 1; i <= last + tail; i++) y.Add(i < x.Length ? x[i] : (short)0);

        int max = 1;
        foreach (short s in y) max = Math.Max(max, Math.Abs((int)s));
        double gain = peak * 32767.0 / max;
        int n = y.Count, fadeIn = Math.Max(1, rate * 3 / 1000), fadeOut = Math.Max(1, rate * 8 / 1000);
        short[] o = new short[n];
        for (int i = 0; i < n; i++)
        {
            double g = gain;
            if (i < fadeIn) g *= (double)i / fadeIn;            // the ends are already near silent: these ramps
            if (n - 1 - i < fadeOut) g *= (double)(n - 1 - i) / fadeOut; // only make sure they start and end at exactly 0
            o[i] = (short)Math.Max(-32768, Math.Min(32767, Math.Round(y[i] * g)));
        }
        return o;
    }

    /// A 16-bit mono RIFF/WAVE file.
    public static byte[] WriteWav(short[] x, int rate)
    {
        MemoryStream ms = new MemoryStream(44 + x.Length * 2);
        BinaryWriter w = new BinaryWriter(ms);
        w.Write(Encoding.ASCII.GetBytes("RIFF")); w.Write(36 + x.Length * 2); w.Write(Encoding.ASCII.GetBytes("WAVEfmt "));
        w.Write(16); w.Write((short)1); w.Write((short)1); w.Write(rate); w.Write(rate * 2); w.Write((short)2); w.Write((short)16);
        w.Write(Encoding.ASCII.GetBytes("data")); w.Write(x.Length * 2);
        foreach (short s in x) w.Write(s);
        w.Flush();
        return ms.ToArray();
    }
}
'@

# ---------------------------------------------------------------- voice + encoder

$synth = New-Object Windows.Media.SpeechSynthesis.SpeechSynthesizer
$voiceInfo = [Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | Where-Object { $_.DisplayName -eq $Voice } | Select-Object -First 1
if (-not $voiceInfo) {
  $have = ([Windows.Media.SpeechSynthesis.SpeechSynthesizer]::AllVoices | ForEach-Object { $_.DisplayName }) -join ', '
  throw "Voice '$Voice' is not installed. Installed voices: $have"
}
$synth.Voice = $voiceInfo
$synth.Options.SpeakingRate = $Rate

$work = Join-Path ([IO.Path]::GetTempPath()) ('pulsezone-voice-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$null = New-Item -ItemType Directory -Force $work
$workFolder = Wait-Operation ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync($work)) ([Windows.Storage.StorageFolder])
$transcoder = New-Object Windows.Media.Transcoding.MediaTranscoder
$transcoder.AlwaysReencode = $true

function New-Mp3Profile {
  $p = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
  $p.Audio.SampleRate = [uint32]$SampleRate
  $p.Audio.ChannelCount = [uint32]1
  $p.Audio.Bitrate = [uint32]($Kbps * 1000)
  $p
}

# Speaks one line and returns its tidied 16-bit samples plus their sample rate.
function Get-Speech([string]$text) {
  $stream = Wait-Operation ($synth.SynthesizeTextToStreamAsync($text)) ([Windows.Media.SpeechSynthesis.SpeechSynthesisStream])
  try {
    $size = [uint32]$stream.Size
    $reader = New-Object Windows.Storage.Streams.DataReader($stream.GetInputStreamAt(0))
    $null = Wait-Operation ($reader.LoadAsync($size)) ([uint32])
    $bytes = New-Object byte[] $size
    $reader.ReadBytes($bytes)
    $reader.Dispose()
  } finally { $stream.Dispose() }
  $rate = 0
  $pcm = [PulseVoiceDsp]::ReadWav($bytes, [ref]$rate)
  $tidy = [PulseVoiceDsp]::Tidy($pcm, $rate, $Floor, $LeadMs, $TailMs, $MaxPauseMs, $Peak)
  if ($tidy.Length -lt $rate / 10) { throw 'the voice returned silence' }
  @{ Samples = $tidy; Rate = $rate }
}

# WAV in the work folder -> MP3 in the work folder; returns the MP3's path.
function Convert-ToMp3([string]$wavName, [string]$mp3Name) {
  $src = Wait-Operation ($workFolder.GetFileAsync($wavName)) ([Windows.Storage.StorageFile])
  $dst = Wait-Operation ($workFolder.CreateFileAsync($mp3Name, [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
  $prep = Wait-Operation ($transcoder.PrepareFileTranscodeAsync($src, $dst, (New-Mp3Profile))) ([Windows.Media.Transcoding.PrepareTranscodeResult])
  if (-not $prep.CanTranscode) {
    throw "Windows cannot encode MP3 here ($($prep.FailureReason)). On an N edition of Windows, add the Media Feature Pack."
  }
  Wait-Progress ($prep.TranscodeAsync()) ([double])
  Join-Path $work $mp3Name
}

# ---------------------------------------------------------------- render

# What the last run produced: a clip is reused only if it said the same words with the same settings.
$old = $null
$manifestPath = Join-Path $OutDir 'manifest.json'
if (-not $Force -and (Test-Path $manifestPath)) {
  try {
    $m = [IO.File]::ReadAllText($manifestPath, [Text.Encoding]::UTF8) | ConvertFrom-Json
    if ($m.settings -ceq $settings) { $old = $m.clips }
  } catch { $old = $null }
}

$done = [ordered]@{}
$failed = New-Object System.Collections.Generic.List[string]
$rendered = 0; $reused = 0; $n = 0
try {
  foreach ($line in $lines) {
    $n++
    $file = "$($line.id).mp3"
    $target = Join-Path $OutDir $file
    $was = if ($old) { $old.PSObject.Properties[$line.id] } else { $null }
    if ($was -and (Test-Path $target) -and (Get-Item $target).Length -gt 1024) {
      $said = if ($was.Value.PSObject.Properties['spoken']) { $was.Value.spoken } else { $was.Value.text }
      if ($said -ceq $line.say -and $was.Value.file -ceq $file) {
        $done[$line.id] = [ordered]@{ file = $file; ms = [int]$was.Value.ms }
        $reused++
        continue
      }
    }
    try {
      $speech = Get-Speech $line.say
      $ms = [int][Math]::Round($speech.Samples.Length * 1000.0 / $speech.Rate)
      [IO.File]::WriteAllBytes((Join-Path $work "$n.wav"), [PulseVoiceDsp]::WriteWav($speech.Samples, $speech.Rate))
      $mp3 = Convert-ToMp3 "$n.wav" "$n.mp3"
      $bytes = (Get-Item $mp3).Length
      # A whole clip is its duration at the bitrate (plus a ~0.4 KB tag): much less means the encoder stopped early.
      if ($bytes -lt 0.9 * $ms * $Kbps / 8) { throw "the MP3 is only $bytes bytes for $ms ms of speech" }
      Copy-Item $mp3 $target -Force
      $done[$line.id] = [ordered]@{ file = $file; ms = $ms }
      $rendered++
      Write-Host ("  {0,-46} {1,5:n2} s {2,6:n1} KB  {3}" -f $line.id, ($ms / 1000), ($bytes / 1KB), $line.say)
    } catch {
      $why = $_.Exception.GetBaseException().Message
      $failed.Add("$($line.id): $why")
      Write-Host ("  FAILED {0}: {1}" -f $line.id, $why) -ForegroundColor Red
    }
  }
} finally {
  $synth.Dispose()
  Remove-Item $work -Recurse -Force -ErrorAction SilentlyContinue
}

# Clips whose line no longer exists would be served and counted against the size budget for nothing.
$wanted = @($lines | ForEach-Object { "$($_.id).mp3" })
$removed = @(Get-ChildItem $OutDir -File -Filter *.mp3 | Where-Object { $wanted -cnotcontains $_.Name })
foreach ($f in $removed) { Remove-Item $f.FullName -Force; Write-Host "  removed $($f.Name) (its line is gone)" }

# ---------------------------------------------------------------- manifest (Node writes it: it has the texts, and plain UTF-8 JSON)

$result = [ordered]@{ dir = $OutDir; voice = $Voice; format = 'mp3'; sampleRate = $SampleRate; kbps = $Kbps; settings = $settings; clips = $done }
$resultPath = Join-Path ([IO.Path]::GetTempPath()) ('pulsezone-voice-' + [Guid]::NewGuid().ToString('N').Substring(0, 8) + '.json')
[IO.File]::WriteAllText($resultPath, ($result | ConvertTo-Json -Depth 5), (New-Object Text.UTF8Encoding($false)))
try {
  & node $linesTool --manifest $resultPath
  if ($LASTEXITCODE -ne 0 -and $failed.Count -eq 0) { $failed.Add('manifest.json is incomplete (see above)') }
} finally { Remove-Item $resultPath -Force -ErrorAction SilentlyContinue }

# ---------------------------------------------------------------- report

$files = @(Get-ChildItem $OutDir -File)
$totalKb = ($files | Measure-Object Length -Sum).Sum / 1KB
$seconds = ($done.Values | ForEach-Object { $_.ms } | Measure-Object -Sum).Sum / 1000
$long = @($lines | Where-Object { $done.Contains($_.id) -and $done[$_.id].ms -gt 3500 })
Write-Host ''
Write-Host ("{0} clips: {1} rendered, {2} unchanged, {3} failed, {4} removed" -f $lines.Count, $rendered, $reused, $failed.Count, $removed.Count)
Write-Host ("{0:n1} s of speech, {1:n0} KB in {2} files (target: under about 2000 KB)" -f $seconds, $totalKb, $files.Count)
if ($long.Count) {
  Write-Host 'Longer than 3.5 s (a cue this long blocks the next one; consider shortening):'
  foreach ($l in $long) { Write-Host ("  {0,5:n2} s  {1}  {2}" -f ($done[$l.id].ms / 1000), $l.id, $l.say) }
}
if ($failed.Count) {
  Write-Host ("FAILED ({0}):" -f $failed.Count) -ForegroundColor Red
  foreach ($f in $failed) { Write-Host "  $f" -ForegroundColor Red }
  exit 1
}
Write-Host 'Voice bank is complete. Next: node test\coach.test.mjs'
exit 0
