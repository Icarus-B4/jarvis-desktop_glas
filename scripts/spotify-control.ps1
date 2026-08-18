param(
  [string]$Query = '',
  [string]$Action = ''
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes

$root = [System.Windows.Automation.AutomationElement]::RootElement
$windows = $root.FindAll(
  [System.Windows.Automation.TreeScope]::Children,
  [System.Windows.Automation.Condition]::TrueCondition
)

$spotify = $null
foreach ($window in $windows) {
  if ($window.Current.Name -like 'Spotify*' -and $window.Current.Name -notlike '*YouTube*') {
    $spotify = $window
    break
  }
}
if ($null -eq $spotify) {
  throw 'Spotify PWA window not found.'
}

function Get-SpotifyButtons {
  return $spotify.FindAll(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
      [System.Windows.Automation.ControlType]::Button
    ))
  )
}

function Find-SpotifyPlayerButton([string[]]$NamePatterns) {
  $windowRect = $spotify.Current.BoundingRectangle
  $playerThreshold = $windowRect.Top + ($windowRect.Height * 0.75)
  $buttons = Get-SpotifyButtons
  foreach ($button in $buttons) {
    if (-not $button.Current.IsEnabled) { continue }
    $rect = $button.Current.BoundingRectangle
    if ($rect.Top -lt $playerThreshold) { continue }
    foreach ($pattern in $NamePatterns) {
      if ($button.Current.Name -like $pattern) { return $button }
    }
  }
  return $null
}

function Invoke-SpotifyButton([System.Windows.Automation.AutomationElement]$Button) {
  $invokePattern = $Button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
  $invokePattern.Invoke()
}

if ($Query.Trim()) {
  $comboCondition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::ComboBox
  )
  $comboBoxes = $spotify.FindAll([System.Windows.Automation.TreeScope]::Descendants, $comboCondition)
  $search = $null
  foreach ($comboBox in $comboBoxes) {
    if ($comboBox.Current.Name -like '*wiedergeben*') {
      $search = $comboBox
      break
    }
  }
  if ($null -eq $search) {
    throw 'Spotify search field not found.'
  }

  $valuePattern = $search.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  $valuePattern.SetValue($Query)
  Start-Sleep -Milliseconds 1800

  $expected = "$Query wiedergeben"
  $match = $null
  $buttons = Get-SpotifyButtons
  foreach ($button in $buttons) {
    if ($button.Current.Name.Equals($expected, [System.StringComparison]::OrdinalIgnoreCase)) {
      $match = $button
      break
    }
  }
  if ($null -eq $match) {
    foreach ($button in $buttons) {
      $name = $button.Current.Name
      if ($name -like "*$Query*" -and $name -like '*wiedergeben*') {
        $match = $button
        break
      }
    }
  }
  if ($null -eq $match) {
    throw "No Spotify playback result found for '$Query'."
  }

  Invoke-SpotifyButton $match
  [pscustomobject]@{
    ok = $true
    query = $Query
    selected = $match.Current.Name
  } | ConvertTo-Json -Compress
  exit 0
}

$normalizedAction = $Action.Trim().ToLowerInvariant()
$buttons = Get-SpotifyButtons
$target = $null
$alreadyInState = $false

switch ($normalizedAction) {
  'play' {
    $pauseButton = Find-SpotifyPlayerButton @('Pause')
    if ($null -ne $pauseButton) { $alreadyInState = $true }
    else { $target = Find-SpotifyPlayerButton @('Play') }
  }
  'pause' {
    $target = Find-SpotifyPlayerButton @('Pause')
    if ($null -eq $target -and $null -ne (Find-SpotifyPlayerButton @('Play'))) { $alreadyInState = $true }
  }
  'stop' {
    $target = Find-SpotifyPlayerButton @('Pause')
    if ($null -eq $target -and $null -ne (Find-SpotifyPlayerButton @('Play'))) { $alreadyInState = $true }
  }
  'next' {
    $target = Find-SpotifyPlayerButton @('Weiter')
  }
  'prev' {
    $target = Find-SpotifyPlayerButton @('Zur*ck')
  }
  'mute' {
    $target = Find-SpotifyPlayerButton @('Ton aus')
    if ($null -eq $target -and $null -ne (Find-SpotifyPlayerButton @('Ton an'))) { $alreadyInState = $true }
  }
  default { throw "Unsupported Spotify action '$Action'." }
}

if ($null -ne $target) {
  Invoke-SpotifyButton $target
} elseif (-not $alreadyInState) {
  throw "Spotify control for action '$Action' not found."
}

[pscustomobject]@{
  ok = $true
  action = $normalizedAction
  changed = ($null -ne $target)
  alreadyInState = $alreadyInState
} | ConvertTo-Json -Compress
