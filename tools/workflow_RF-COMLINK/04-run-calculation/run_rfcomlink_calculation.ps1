<#
.SYNOPSIS
Runs one run-local RF-COMLINK scenario through its Windows UI.

.DESCRIPTION
RF-COMLINK has no supported command-line calculation mode.  This script uses
the same UI sequence validated in the local example: open the supplied .rfcl,
press F5, wait, save the calculated copy, and close it.  The caller must pass
a copy inside the current mission run, never a library or vendor example.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CasePath,

    [Parameter(Mandatory = $true)]
    [string]$ApplicationPath,

    [ValidateRange(1, 3600)]
    [int]$WaitSeconds = 5
)

$ErrorActionPreference = 'Stop'

if (-not (Test-Path -LiteralPath $CasePath -PathType Leaf)) {
    throw "RF-COMLINK scenario not found: $CasePath"
}
if (-not (Test-Path -LiteralPath $ApplicationPath -PathType Leaf)) {
    throw "RF-COMLINK executable not found: $ApplicationPath"
}
if (Get-Process -Name 'rf-comlink' -ErrorAction SilentlyContinue) {
    throw 'RF-COMLINK is already open. Close it before running the automated calculation.'
}

$process = Start-Process -FilePath $ApplicationPath -WorkingDirectory (Split-Path -Parent $ApplicationPath) -ArgumentList ('"{0}"' -f $CasePath) -PassThru
if (-not $process.WaitForInputIdle(30000)) {
    throw 'RF-COMLINK did not respond within 30 seconds.'
}

$deadline = (Get-Date).AddSeconds(30)
do {
    Start-Sleep -Milliseconds 500
    $process.Refresh()
    if ($process.HasExited) { throw 'RF-COMLINK exited before its main window opened.' }
} while ($process.MainWindowHandle -eq 0 -and (Get-Date) -lt $deadline)
if ($process.MainWindowHandle -eq 0) { throw 'RF-COMLINK main window was not found within 30 seconds.' }

$shell = New-Object -ComObject WScript.Shell
if (-not $shell.AppActivate($process.Id)) { throw "Unable to activate RF-COMLINK (PID $($process.Id))." }
Start-Sleep -Milliseconds 500
$shell.SendKeys('{F5}')
Write-Output "RF-COMLINK calculation started; waiting $WaitSeconds second(s)."
Start-Sleep -Seconds $WaitSeconds

# Save only the per-run working copy.  The prepared scenario remains immutable
# and the saved .rfcl therefore becomes the raw calculation artifact.
if (-not $shell.AppActivate($process.Id)) { throw 'RF-COMLINK is no longer active; calculation output was not saved.' }
$shell.SendKeys('^s')
Start-Sleep -Seconds 2

# Never use Alt+F4 here: once RF-COMLINK closes a result window, a second
# global keystroke can reach the browser that launched this workflow. Close
# only windows owned by the RF-COMLINK PID, then terminate that PID as a
# bounded fallback. The calculated case was already saved above.
$process.Refresh()
if (-not $process.HasExited) {
    [void]$process.CloseMainWindow()
    Start-Sleep -Seconds 1
    $process.Refresh()
}
if (-not $process.HasExited -and $process.MainWindowHandle -ne 0) {
    [void]$process.CloseMainWindow()
    Start-Sleep -Seconds 1
    $process.Refresh()
}
if (-not $process.HasExited) {
    Stop-Process -Id $process.Id -Force
    if (-not $process.WaitForExit(5000)) { throw "RF-COMLINK (PID $($process.Id)) did not close." }
}

Write-Output 'RF-COMLINK calculation completed and the run-local scenario was saved.'
