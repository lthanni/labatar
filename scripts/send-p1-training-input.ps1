param(
  [Parameter(Mandatory = $true)]
  [ValidatePattern('^(5|2|236|214)[ABCF]$')]
  [string]$Move,
  [ValidateSet('Right', 'Left')]
  [string]$Facing = 'Right',
  [ValidateRange(20, 500)]
  [int]$StepMs = 50,
  [ValidateRange(20, 500)]
  [int]$HoldMs = 50,
  [ValidateRange(0, 30)]
  [int]$CountdownSeconds = 3,
  [switch]$DryRun,
  [string]$GameRoot = 'C:\Program Files (x86)\Steam\steamapps\common\Avatar Legends The Fighting Game'
)

$ErrorActionPreference = 'Stop'
if ([IntPtr]::Size -ne 8) { throw 'This pilot requires 64-bit PowerShell.' }
$configPath = Join-Path $GameRoot 'data\button_config.ini'
$config = Get-Content -LiteralPath $configPath -Raw
$playerOne = [regex]::Match($config, '(?s)Player 1\s*#-------(?<bindings>.*?)#-------\s*Player 2')
if (-not $playerOne.Success) { throw 'Player 1 bindings were not found.' }

$bindings = @{}
foreach ($match in [regex]::Matches($playerOne.Groups['bindings'].Value, 'Device 7 KEY_(?<key>[A-Z]+) -> (?<action>\w+)')) {
  $bindings[$match.Groups['action'].Value] = $match.Groups['key'].Value
}

$buttonAction = @{ A = 'Atk1'; B = 'Atk2'; C = 'Atk3'; F = 'Atk4' }
$button = $Move.Substring($Move.Length - 1)
$motion = $Move.Substring(0, $Move.Length - 1)
$forward = if ($Facing -eq 'Right') { 'Right' } else { 'Left' }
$required = @($buttonAction[$button])
if ($motion -ne '5') { $required += 'Down' }
if ($motion -eq '236' -or $motion -eq '214') { $required += @('Left', 'Right') }
foreach ($action in $required) {
  if (-not $bindings.ContainsKey($action)) { throw "Player 1 has no keyboard binding for $action." }
}

$attack = $bindings[$buttonAction[$button]]
$down = $bindings['Down']
$left = $bindings['Left']
$right = $bindings['Right']
$toward = $bindings[$forward]
$away = $bindings[ $(if ($forward -eq 'Right') { 'Left' } else { 'Right' }) ]

$steps = [System.Collections.Generic.List[object]]::new()
if ($motion -eq '2') {
  $steps.Add(@{ Keys = @($down); DurationMs = $StepMs })
  $steps.Add(@{ Keys = @($down, $attack); DurationMs = $HoldMs })
} elseif ($motion -eq '236' -or $motion -eq '214') {
  $finalDirection = if ($motion -eq '236') { $toward } else { $away }
  $steps.Add(@{ Keys = @($down); DurationMs = $StepMs })
  $steps.Add(@{ Keys = @($down, $finalDirection); DurationMs = $StepMs })
  $steps.Add(@{ Keys = @($finalDirection); DurationMs = $StepMs })
  $steps.Add(@{ Keys = @($finalDirection, $attack); DurationMs = $HoldMs })
} else {
  $steps.Add(@{ Keys = @($attack); DurationMs = $HoldMs })
}
$steps.Add(@{ Keys = @(); DurationMs = 0 })

Write-Output "Player 1 $Move facing $Facing, using $configPath"
foreach ($step in $steps) {
  $label = if ($step.Keys.Count) { $step.Keys -join '+' } else { 'neutral' }
  Write-Output "  $label for $($step.DurationMs) ms"
}
if ($DryRun) { return }

if (-not ('LabatarTrainingInput' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;

public static class LabatarTrainingInput {
  [StructLayout(LayoutKind.Sequential)]
  private struct KeyInput {
    public ushort vk;
    public ushort scan;
    public uint flags;
    public uint time;
    public IntPtr extra;
  }

  [StructLayout(LayoutKind.Explicit, Size = 40)]
  private struct Input {
    [FieldOffset(0)]
    public uint type;
    [FieldOffset(8)]
    public KeyInput key;
  }

  [DllImport("user32.dll", SetLastError = true)]
  private static extern uint SendInput(uint count, Input[] inputs, int size);

  [DllImport("user32.dll")]
  private static extern uint MapVirtualKey(uint code, uint mapType);

  [DllImport("user32.dll")]
  private static extern IntPtr GetForegroundWindow();

  [DllImport("user32.dll")]
  private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);

  public static string ForegroundProcessName() {
    uint processId;
    GetWindowThreadProcessId(GetForegroundWindow(), out processId);
    if (processId == 0) return "(none)";
    try { return Process.GetProcessById((int)processId).ProcessName; }
    catch { return "(unavailable)"; }
  }

  public static bool IsGameForeground() {
    return ForegroundProcessName().Equals("Atla", StringComparison.OrdinalIgnoreCase);
  }

  public static void SendKey(string name, bool pressed) {
    int vk;
    if (name == "UP") vk = 0x26;
    else if (name == "DOWN") vk = 0x28;
    else if (name == "LEFT") vk = 0x25;
    else if (name == "RIGHT") vk = 0x27;
    else if (name.Length == 1 && name[0] >= 'A' && name[0] <= 'Z') vk = name[0];
    else throw new ArgumentException("Unsupported key: " + name);

    Input input = new Input();
    input.type = 1;
    input.key.scan = (ushort)MapVirtualKey((uint)vk, 0);
    bool extended = name == "UP" || name == "DOWN" || name == "LEFT" || name == "RIGHT";
    input.key.flags = 0x0008u | (extended ? 0x0001u : 0u) | (pressed ? 0u : 0x0002u);
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
      throw new InvalidOperationException("SendInput failed (Win32 error " + Marshal.GetLastWin32Error() + ").");
  }
}
'@
}

for ($seconds = $CountdownSeconds; $seconds -gt 0; $seconds--) {
  Write-Output "Focus offline training now: $seconds"
  Start-Sleep -Seconds 1
}
if (-not [LabatarTrainingInput]::IsGameForeground()) {
  throw "Atla.exe must be the foreground window. Found $([LabatarTrainingInput]::ForegroundProcessName()). No keys were sent."
}

$pressed = [System.Collections.Generic.HashSet[string]]::new()
try {
  foreach ($step in $steps) {
    if (-not [LabatarTrainingInput]::IsGameForeground()) { throw 'Game focus was lost.' }
    $next = [System.Collections.Generic.HashSet[string]]::new()
    foreach ($key in $step.Keys) { [void]$next.Add($key) }
    foreach ($key in @($pressed)) {
      if (-not $next.Contains($key)) {
        [LabatarTrainingInput]::SendKey($key, $false)
        [void]$pressed.Remove($key)
      }
    }
    foreach ($key in $step.Keys) {
      if ($pressed.Add($key)) { [LabatarTrainingInput]::SendKey($key, $true) }
    }
    if ($step.DurationMs) { Start-Sleep -Milliseconds $step.DurationMs }
  }
} finally {
  foreach ($key in @($pressed)) {
    [LabatarTrainingInput]::SendKey($key, $false)
  }
}
