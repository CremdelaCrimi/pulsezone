<#
.SYNOPSIS
  Converts audio files with what ships with Windows (Windows.Media.Transcoding): MP3 -> WAV (16-bit mono)
  or WAV -> MP3 (mono, low bitrate for speech). Used to turn the ElevenLabs takes into the coach's clips
  (tools/voice-split.cjs, tools/voice-cut.cjs); nothing is downloaded or installed.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File tools\voice-transcode.ps1 -List jobs.txt
  (jobs.txt: one "input<TAB>output" pair per line, Windows paths; the output's extension picks WAV or MP3)
#>
param(
  [Parameter(Mandatory)][string]$List,
  [int]$SampleRate = 48000,  # MP3 at 48 kHz: this encoder trims the tail at lower rates (see make-voice.ps1)
  [int]$Kbps = 48
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Transcoding.MediaTranscoder, Windows.Media.Transcoding, ContentType = WindowsRuntime]
$null = [Windows.Media.MediaProperties.MediaEncodingProfile, Windows.Media.MediaProperties, ContentType = WindowsRuntime]
$asTask = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
$asTaskP = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncActionWithProgress`1' })[0]
function Wait-Op($op, [Type]$t) { $task = $asTask.MakeGenericMethod($t).Invoke($null, @($op)); $task.Wait(-1) | Out-Null; $task.Result }
function Wait-Prog($op) { $task = $asTaskP.MakeGenericMethod([double]).Invoke($null, @($op)); $task.Wait(-1) | Out-Null }

$tx = New-Object Windows.Media.Transcoding.MediaTranscoder
$tx.AlwaysReencode = $true
$failed = 0
foreach ($line in [IO.File]::ReadAllLines((Resolve-Path $List))) {
  if (-not $line.Trim()) { continue }
  $in, $out = $line -split "`t"
  try {
    if ($out -like '*.mp3') {
      $p = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateMp3([Windows.Media.MediaProperties.AudioEncodingQuality]::Low)
      $p.Audio.SampleRate = [uint32]$SampleRate; $p.Audio.ChannelCount = [uint32]1; $p.Audio.Bitrate = [uint32]($Kbps * 1000)
    } else {
      # Windows' default PCM profile (48 kHz stereo 16-bit): setting the rate or channels is refused for MP3 input ("Unknown").
      $p = [Windows.Media.MediaProperties.MediaEncodingProfile]::CreateWav([Windows.Media.MediaProperties.AudioEncodingQuality]::High)
    }
    $src = Wait-Op ([Windows.Storage.StorageFile]::GetFileFromPathAsync((Resolve-Path $in).Path)) ([Windows.Storage.StorageFile])
    $dir = Wait-Op ([Windows.Storage.StorageFolder]::GetFolderFromPathAsync([IO.Path]::GetDirectoryName([IO.Path]::GetFullPath($out)))) ([Windows.Storage.StorageFolder])
    $dst = Wait-Op ($dir.CreateFileAsync([IO.Path]::GetFileName($out), [Windows.Storage.CreationCollisionOption]::ReplaceExisting)) ([Windows.Storage.StorageFile])
    $prep = Wait-Op ($tx.PrepareFileTranscodeAsync($src, $dst, $p)) ([Windows.Media.Transcoding.PrepareTranscodeResult])
    if (-not $prep.CanTranscode) { throw "cannot transcode: $($prep.FailureReason)" }
    Wait-Prog ($prep.TranscodeAsync())
  } catch { $failed++; Write-Host "FAILED $in -> $out : $_" }
}
Write-Host "transcode done, $failed failed"
if ($failed) { exit 1 }
