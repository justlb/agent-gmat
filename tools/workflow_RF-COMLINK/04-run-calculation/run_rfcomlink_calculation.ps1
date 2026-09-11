<#
.SYNOPSIS
Runs one run-local RF-COMLINK scenario through its Windows UI.

.DESCRIPTION
RF-COMLINK has no supported command-line calculation mode. This script uses
its accessible UI controls to open the supplied .rfcl, calculate and open the
budget for each link, save the calculated copy, and close it. The caller must
pass a copy inside the current mission run, never a library or vendor example.
#>

[CmdletBinding()]
param(
    [Parameter(Mandatory = $true)]
    [string]$CasePath,

    [Parameter(Mandatory = $true)]
    [string]$ApplicationPath,

    [ValidateRange(1, 3600)]
    [int]$WaitSeconds = 3
)

$ErrorActionPreference = 'Stop'

function Close-ExistingRFComlinkProcesses {
    # A prior GUI calculation can leave its main window or result dialog open.
    # RF-COMLINK permits only one process, so close all stale instances before
    # opening this run's isolated scenario. A bounded graceful close preserves
    # normal application shutdown; a forced stop is the deterministic fallback.
    $existing = @(Get-Process -Name 'rf-comlink' -ErrorAction SilentlyContinue)
    foreach ($instance in $existing) {
        Write-Output "Closing existing RF-COMLINK process (PID $($instance.Id))."
        if ($instance.MainWindowHandle -ne 0) {
            [void]$instance.CloseMainWindow()
            [void]$instance.WaitForExit(3000)
        }
        $instance.Refresh()
        if (-not $instance.HasExited) {
            Stop-Process -Id $instance.Id -Force
            [void]$instance.WaitForExit(5000)
        }
        if (-not $instance.HasExited) {
            throw "RF-COMLINK process (PID $($instance.Id)) did not close."
        }
    }
}

if (-not (Test-Path -LiteralPath $CasePath -PathType Leaf)) {
    throw "RF-COMLINK scenario not found: $CasePath"
}
if (-not (Test-Path -LiteralPath $ApplicationPath -PathType Leaf)) {
    throw "RF-COMLINK executable not found: $ApplicationPath"
}
Close-ExistingRFComlinkProcesses

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

Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

# F5 opens the simulation command but does not create a budget report for
# every link.  Invoke RF-COMLINK's named controls through UI Automation so
# each link produces its result files and its HTML report before saving.
$window = [System.Windows.Automation.AutomationElement]::FromHandle($process.MainWindowHandle)
if ($null -eq $window) { throw 'RF-COMLINK main window is not available to UI Automation.' }
$buttonCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button
)

function Invoke-RFComlinkButton([string]$Name) {
    $buttons = $window.FindAll([System.Windows.Automation.TreeScope]::Descendants, $buttonCondition)
    $button = @($buttons | Where-Object { $_.Current.Name -eq $Name })[0]
    if ($null -eq $button) { throw "RF-COMLINK button was not found: $Name" }
    $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
}

$tabControl = $window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        'mainTabContol'
    ))
)
if ($null -eq $tabControl) { throw 'RF-COMLINK link tab control was not found.' }
$tabItems = $tabControl.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
        [System.Windows.Automation.ControlType]::TabItem
    ))
)
if ($tabItems.Count -eq 0) { throw 'RF-COMLINK scenario contains no link tabs.' }

Write-Output "RF-COMLINK scenario opened with $($tabItems.Count) link(s)."
foreach ($tab in $tabItems) {
    $tab.GetCurrentPattern([System.Windows.Automation.SelectionItemPattern]::Pattern).Select()
    Start-Sleep -Seconds 1
    Invoke-RFComlinkButton 'Run simulation'
    Start-Sleep -Seconds $WaitSeconds
    Invoke-RFComlinkButton 'Budget'
    Start-Sleep -Seconds 1
}

# Save only the per-run working copy. The prepared scenario remains immutable
# and the saved .rfcl is therefore the raw calculation artifact.
$saveButton = $window.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
        [System.Windows.Automation.AutomationElement]::AutomationIdProperty,
        'saveButton'
    ))
)
if ($null -eq $saveButton) { throw 'RF-COMLINK save button was not found.' }
$saveButton.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()
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
