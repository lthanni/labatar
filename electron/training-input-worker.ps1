param([switch]$Recovery)

$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = [Text.UTF8Encoding]::new($false)
[Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)

$script:GameRoot = 'C:\Program Files (x86)\Steam\steamapps\common\Avatar Legends The Fighting Game'
$script:Bindings = $null

if (-not ('LabatarTrainingInputWorker' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Threading.Tasks;
public static class LabatarTrainingInputWorker {
  [StructLayout(LayoutKind.Sequential)] private struct KeyInput { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] private struct Input { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KeyInput key; }
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  public static string ForegroundProcessName() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); if(pid==0)return "(none)"; try{using(var process=Process.GetProcessById((int)pid))return process.ProcessName;}catch{return "(unavailable)";} }
  public static bool IsGameForeground() { return ForegroundProcessName().Equals("Atla", StringComparison.OrdinalIgnoreCase); }
  public static void SendKey(string name, bool down) {
    int vk; bool ext=false;
    if(name=="UP"){vk=0x26;ext=true;} else if(name=="DOWN"){vk=0x28;ext=true;} else if(name=="LEFT"){vk=0x25;ext=true;} else if(name=="RIGHT"){vk=0x27;ext=true;} else if(name=="BACK")vk=0x08; else if(name.Length==1 && name[0]>='A' && name[0]<='Z')vk=name[0]; else throw new ArgumentException("Unsupported key: "+name);
    Input i=new Input(); i.type=1; i.key.scan=(ushort)MapVirtualKey((uint)vk,0); i.key.flags=0x0008u|(ext?0x0001u:0u)|(down?0u:0x0002u);
    if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(Input)))!=1)throw new InvalidOperationException("SendInput failed (Win32 error "+Marshal.GetLastWin32Error()+").");
  }
}

public static class LabatarRecoveryInput {
  // XINPUT_STATE has a four-byte packet number followed by XINPUT_GAMEPAD.
  [StructLayout(LayoutKind.Explicit, Size = 16)]
  private struct ControllerState {
    [FieldOffset(4)] public ushort Buttons;
  }

  [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
  private static extern uint GetState(uint index, out ControllerState state);

  public static bool? ReadBack(int index) {
    ControllerState state;
    if (GetState((uint)index, out state) != 0) return null;
    return (state.Buttons & 0x0020) != 0;
  }

  public static Task WaitForStop() {
    // Closing the parent's stdin pipe stops polling even if Labatar exits unexpectedly.
    return Task.Run(() => Console.In.ReadLine());
  }
}
'@
}

function Read-PlayerKeyboardBindings([string]$root, [int]$player, [int]$device) {
  $path = Join-Path $root 'data\button_config.ini'
  $raw = Get-Content -LiteralPath $path -Raw
  $section = [regex]::Match($raw, "(?ms)^[ \t]*Player $player\s*#-------(?<bindings>.*?)(?=^[ \t]*#-------|\z)")
  if (-not $section.Success) { throw "Player $player bindings were not found in button_config.ini." }
  $map = @{}
  foreach ($binding in [regex]::Matches($section.Groups['bindings'].Value, "Device $device KEY_(?<key>[A-Z]+) -> (?<action>\w+)")) {
    $map[$binding.Groups['action'].Value] = $binding.Groups['key'].Value
  }
  return $map
}

function Load-Bindings([string]$root) {
  if ($script:Bindings -and $root -eq $script:GameRoot) { return }
  $script:Bindings = Read-PlayerKeyboardBindings $root 1 7
  $script:GameRoot = $root
}

function Check-Focus { if (-not [LabatarTrainingInputWorker]::IsGameForeground()) { throw "Atla.exe must remain foreground; found $([LabatarTrainingInputWorker]::ForegroundProcessName())." } }
function Send-Tap([string]$key) {
  Check-Focus
  try { [LabatarTrainingInputWorker]::SendKey($key,$true); Start-Sleep -Milliseconds 70; Check-Focus }
  finally { [LabatarTrainingInputWorker]::SendKey($key,$false) }
}

function Invoke-Move($request, [bool]$dryRun = $false) {
  $notation = [string]$request.notation
  if ([regex]::IsMatch($notation, '^j\.[ABC]$', [Text.RegularExpressions.RegexOptions]::IgnoreCase)) {
    $notation = 'j.5' + $notation.Substring(2)
  }
  $match = [regex]::Match($notation, '^(j\.)?(236|214|[1-9])(AA|\[(?:EX|[ABCF])\]|EX|[ABCF])$', [Text.RegularExpressions.RegexOptions]::IgnoreCase)
  if (-not $match.Success) { throw 'Move notation must be 1-9, 236, or 214 followed by A, B, C, F, or EX; charged buttons use brackets. Neutral jump A, B, C and grounded 2AA, 5AA are also supported.' }
  $facing = if ($request.facing) { [string]$request.facing } else { 'Right' }
  if ($facing -notin @('Right','Left')) { throw 'Facing must be Right or Left.' }
  $jump = $match.Groups[1].Success
  $motion = $match.Groups[2].Value
  $buttonToken = $match.Groups[3].Value.ToUpperInvariant()
  $charged = $buttonToken.StartsWith('[')
  $button = $buttonToken.Trim('[',']')
  $chargeHoldMs = if ($null -ne $request.chargeHoldMs) { [int]$request.chargeHoldMs } else { 1000 }
  if ($chargeHoldMs -lt 100 -or $chargeHoldMs -gt 5000) { throw 'Charge hold must be between 100 and 5000 milliseconds.' }
  $attackMs = if ($charged) { $chargeHoldMs } else { 50 }
  if ($button -eq 'AA' -and ($jump -or $motion -notin @('2','5'))) { throw 'AA is supported only as 2AA or 5AA.' }
  $attackActions = @{ A=@('Atk1'); AA=@('Atk1'); B=@('Atk2'); C=@('Atk3'); F=@('Atk4'); EX=@('Atk1','Atk2') }[$button]
  $forward = if($facing -eq 'Right'){'Right'}else{'Left'}; $away = if($forward -eq 'Right'){'Left'}else{'Right'}
  $keys = @{}
  foreach($a in @('Atk1','Atk2','Atk3','Atk4','Up','Down','Left','Right')) { if($script:Bindings.ContainsKey($a)){$keys[$a]=$script:Bindings[$a]} }
  $directionActions = switch ($motion) {
    '1' { @('Down',$away) }
    '2' { @('Down') }
    '3' { @('Down',$forward) }
    '4' { @($away) }
    '5' { @() }
    '6' { @($forward) }
    '7' { @('Up',$away) }
    '8' { @('Up') }
    '9' { @('Up',$forward) }
    '236' { @('Down',$forward) }
    '214' { @('Down',$away) }
  }
  $requiredActions = @($attackActions)
  if($motion -ne '5') { $requiredActions += @($directionActions) }
  if($jump) { $requiredActions += @('Down','Up') }
  foreach($action in $requiredActions) { if(-not $keys.ContainsKey($action)) { throw "No Player 1 keyboard binding for $action." } }
  $attackKeys = @($attackActions | ForEach-Object { $keys[$_] })
  $steps = [System.Collections.Generic.List[object]]::new()
  if($jump) {
    # Release Down before pressing Up. At 60 fps, each 20 ms direction is
    # intended to be visible to a game poll; the motion attack starts 85 ms
    # after Up in the scheduled sequence (25 + 3 * 20).
    $steps.Add(@{Keys=@($keys.Down);Ms=40})
    $steps.Add(@{Keys=@($keys.Up);Ms=25})
  }
  $directionMs = if($jump) { 20 } else { 50 }
  if($motion -eq '236' -or $motion -eq '214') {
    $dir=if($motion -eq '236'){$forward}else{$away}
    $steps.Add(@{Keys=@($keys.Down);Ms=$directionMs});$steps.Add(@{Keys=@($keys.Down,$keys[$dir]);Ms=$directionMs});$steps.Add(@{Keys=@($keys[$dir]);Ms=$directionMs});$steps.Add(@{Keys=@($keys[$dir]) + $attackKeys;Ms=$attackMs})
  } elseif($motion -eq '5') {
    $steps.Add(@{Keys=$attackKeys;Ms=$attackMs})
    if($button -eq 'AA') { $steps.Add(@{Keys=@();Ms=100});$steps.Add(@{Keys=$attackKeys;Ms=50}) }
  }
  else {
    $directionKeys = @($directionActions | ForEach-Object { $keys[$_] })
    $steps.Add(@{Keys=$directionKeys;Ms=$directionMs});$steps.Add(@{Keys=$directionKeys + $attackKeys;Ms=$attackMs})
    if($button -eq 'AA') { $steps.Add(@{Keys=$directionKeys;Ms=100});$steps.Add(@{Keys=$directionKeys + $attackKeys;Ms=50}) }
  }
  $steps.Add(@{Keys=@();Ms=0})
  if ($dryRun) { return $steps.ToArray() }
  $held=[System.Collections.Generic.HashSet[string]]::new()
  try {
    foreach($step in $steps){ Check-Focus; $next=[System.Collections.Generic.HashSet[string]]::new(); foreach($key in $step.Keys){[void]$next.Add($key)}
      foreach($key in @($held)){if(-not $next.Contains($key)){[LabatarTrainingInputWorker]::SendKey($key,$false);[void]$held.Remove($key)}}
      foreach($key in $step.Keys){if($held.Add($key)){[LabatarTrainingInputWorker]::SendKey($key,$true)}}
      $remaining = [int]$step.Ms
      while ($remaining -gt 0) {
        $slice = [Math]::Min(50, $remaining)
        Start-Sleep -Milliseconds $slice
        $remaining -= $slice
        Check-Focus
      }
    }
  } finally { foreach($key in @($held)){[LabatarTrainingInputWorker]::SendKey($key,$false)} }
}

function Publish-Recovery([string]$status, [string]$direction, [string]$errorMessage, [switch]$FlowHeld) {
  $event = @{ status = $status }
  if ($direction) { $event.direction = $direction }
  if ($errorMessage) { $event.error = $errorMessage }
  if ($FlowHeld) { $event.flowHeld = $true }
  [Console]::Out.WriteLine(($event | ConvertTo-Json -Compress))
  [Console]::Out.Flush()
}

function Release-RecoveryKeys($held) {
  $releaseError = $null
  foreach ($key in $held.ToArray()) {
    try {
      [LabatarTrainingInputWorker]::SendKey($key, $false)
      [void]$held.Remove($key)
    } catch {
      $releaseError = $_
    }
  }
  if ($releaseError) { throw $releaseError }
}

function Invoke-Recovery($request, $stop) {
  $bindings = Read-PlayerKeyboardBindings ([string]$request.gameRoot) 2 8
  $directionKeys = @{}
  foreach ($direction in $request.directions) {
    $directionKeys[$direction] = @($direction.Split('-') | ForEach-Object {
      if (-not $bindings.ContainsKey($_)) { throw "No Player 2 keyboard binding for $_." }
      $bindings[$_]
    } | Select-Object -Unique)
  }
  $flowKey = $null
  if ($request.flowMode -in @('always', 'random')) {
    $flowKey = $bindings['Atk4']
    if (-not $flowKey) { throw 'No Player 2 keyboard binding for Flow.' }
  }
  $delayMs = [long]$request.delayMs
  $holdMs = [long]$request.holdMs
  $held = [System.Collections.Generic.List[string]]::new()
  $clock = [System.Diagnostics.Stopwatch]::StartNew()
  $device = -1
  $previousBack = $null
  $phase = 'waiting-for-controller'
  $direction = $null
  $deadline = 0
  Publish-Recovery $phase

  try {
    while (-not $stop.IsCompleted) {
      $back = $null
      if ($device -ge 0) {
        $back = [LabatarRecoveryInput]::ReadBack($device)
      } else {
        for ($i = 0; $i -lt 4; $i++) {
          $back = [LabatarRecoveryInput]::ReadBack($i)
          if ($null -ne $back) { $device = $i; break }
        }
      }
      if ($null -eq $back) {
        if ($phase -ne 'waiting-for-controller') {
          Release-RecoveryKeys $held
          $phase = 'waiting-for-controller'
          Publish-Recovery $phase
        }
        $previousBack = $null
        Start-Sleep -Milliseconds 100
        continue
      }
      if ($phase -eq 'waiting-for-controller') {
        $phase = 'ready'
        Publish-Recovery $phase
      }

      $pressed = $back -and $previousBack -eq $false
      $previousBack = $back
      $now = $clock.ElapsedMilliseconds
      $gameFocused = ($pressed -or $phase -ne 'ready') -and [LabatarTrainingInputWorker]::IsGameForeground()
      if ($pressed -and $gameFocused) {
        Release-RecoveryKeys $held
        $deadline = $clock.ElapsedMilliseconds + $delayMs
        $phase = 'delay'
        Publish-Recovery $phase
      } elseif ($phase -ne 'ready' -and (-not $gameFocused -or ($phase -eq 'holding' -and $now -ge $deadline))) {
        Release-RecoveryKeys $held
        $phase = 'ready'
        Publish-Recovery $phase
      }

      if ($phase -eq 'delay' -and $clock.ElapsedMilliseconds -ge $deadline -and -not $stop.IsCompleted) {
        if ([LabatarTrainingInputWorker]::IsGameForeground()) {
          $direction = Get-Random -InputObject $request.directions
          $flowHeld = $request.flowMode -eq 'always' -or ($request.flowMode -eq 'random' -and (Get-Random -Maximum 2) -eq 1)
          $keys = $directionKeys[$direction]
          if ($flowHeld -and $keys -notcontains $flowKey) { $keys = $keys + $flowKey }
          foreach ($key in $keys) {
            [LabatarTrainingInputWorker]::SendKey($key, $true)
            $held.Add($key)
          }
          $deadline = $clock.ElapsedMilliseconds + $holdMs
          $phase = 'holding'
          Publish-Recovery $phase $direction -FlowHeld:$flowHeld
        } else {
          $phase = 'ready'
          Publish-Recovery $phase
        }
      }
      Start-Sleep -Milliseconds 8
    }
  } finally {
    Release-RecoveryKeys $held
  }
}

if ($Recovery) {
  try {
    $line = [Console]::In.ReadLine()
    if ($null -ne $line) {
      $request = $line | ConvertFrom-Json
      Invoke-Recovery $request ([LabatarRecoveryInput]::WaitForStop())
    }
  } catch {
    Publish-Recovery 'off' '' $_.Exception.Message
    exit 1
  }
  return
}

while ($null -ne ($line = [Console]::In.ReadLine())) {
  try {
    $request = $line | ConvertFrom-Json
    if ($request.kind -eq 'configure') { Load-Bindings ([string]$request.gameRoot); $result=@{ok=$true;configured=$true} }
    elseif ($request.kind -eq 'reset') {
      if ($request.gameRoot) { Load-Bindings ([string]$request.gameRoot) } elseif (-not $script:Bindings) { Load-Bindings $script:GameRoot }
      $action = if ($script:Bindings.ContainsKey('Back')) {'Back'} elseif ($script:Bindings.ContainsKey('Select')) {'Select'} else { throw 'Player 1 has no Back or Select keyboard binding for reset.' }
      if (-not $request.dryRun) { Send-Tap $script:Bindings[$action] }
      $result=@{ok=$true;kind='reset';action=$action;dryRun=[bool]$request.dryRun}
    }
    elseif ($request.kind -eq 'move') {
      if ($request.gameRoot) { Load-Bindings ([string]$request.gameRoot) } elseif (-not $script:Bindings) { Load-Bindings $script:GameRoot }
      $moveSteps = @(Invoke-Move $request ([bool]$request.dryRun))
      $result=@{ok=$true;kind='move';notation=[string]$request.notation;facing=if($request.facing){$request.facing}else{'Right'};dryRun=[bool]$request.dryRun}
      if ($request.dryRun) { $result.steps = $moveSteps }
    } else { throw 'kind must be configure, reset, or move.' }
    $response=@{id=$request.id;result=$result}
  } catch { $response=@{id=$request.id;error=$_.Exception.Message} }
  [Console]::Out.WriteLine(($response | ConvertTo-Json -Compress -Depth 8)); [Console]::Out.Flush()
}
