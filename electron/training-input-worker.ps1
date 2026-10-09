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
public static class LabatarTrainingInputWorker {
  [StructLayout(LayoutKind.Sequential)] private struct KeyInput { public ushort vk; public ushort scan; public uint flags; public uint time; public IntPtr extra; }
  [StructLayout(LayoutKind.Explicit, Size = 40)] private struct Input { [FieldOffset(0)] public uint type; [FieldOffset(8)] public KeyInput key; }
  [DllImport("user32.dll", SetLastError=true)] private static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] private static extern uint MapVirtualKey(uint code, uint mapType);
  [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint processId);
  public static string ForegroundProcessName() { uint pid; GetWindowThreadProcessId(GetForegroundWindow(), out pid); if(pid==0)return "(none)"; try{return Process.GetProcessById((int)pid).ProcessName;}catch{return "(unavailable)";} }
  public static bool IsGameForeground() { return ForegroundProcessName().Equals("Atla", StringComparison.OrdinalIgnoreCase); }
  public static void SendKey(string name, bool down) {
    int vk; bool ext=false;
    if(name=="UP"){vk=0x26;ext=true;} else if(name=="DOWN"){vk=0x28;ext=true;} else if(name=="LEFT"){vk=0x25;ext=true;} else if(name=="RIGHT"){vk=0x27;ext=true;} else if(name=="BACK")vk=0x08; else if(name.Length==1 && name[0]>='A' && name[0]<='Z')vk=name[0]; else throw new ArgumentException("Unsupported key: "+name);
    Input i=new Input(); i.type=1; i.key.scan=(ushort)MapVirtualKey((uint)vk,0); i.key.flags=0x0008u|(ext?0x0001u:0u)|(down?0u:0x0002u);
    if(SendInput(1,new[]{i},Marshal.SizeOf(typeof(Input)))!=1)throw new InvalidOperationException("SendInput failed (Win32 error "+Marshal.GetLastWin32Error()+").");
  }
}
'@
}

function Load-Bindings([string]$root) {
  if ($script:Bindings -and $root -eq $script:GameRoot) { return }
  $path = Join-Path $root 'data\button_config.ini'
  $raw = Get-Content -LiteralPath $path -Raw
  $p1 = [regex]::Match($raw, '(?s)Player 1\s*#-------(?<bindings>.*?)#-------\s*Player 2')
  if (-not $p1.Success) { throw 'Player 1 bindings were not found in button_config.ini.' }
  $map = @{}
  foreach ($m in [regex]::Matches($p1.Groups['bindings'].Value, 'Device 7 KEY_(?<key>[A-Z]+) -> (?<action>\w+)')) { $map[$m.Groups['action'].Value] = $m.Groups['key'].Value }
  $script:Bindings = $map; $script:GameRoot = $root
}

function Check-Focus { if (-not [LabatarTrainingInputWorker]::IsGameForeground()) { throw "Atla.exe must remain foreground; found $([LabatarTrainingInputWorker]::ForegroundProcessName())." } }
function Send-Tap([string]$key) {
  Check-Focus
  try { [LabatarTrainingInputWorker]::SendKey($key,$true); Start-Sleep -Milliseconds 70; Check-Focus }
  finally { [LabatarTrainingInputWorker]::SendKey($key,$false) }
}

function Invoke-Move($request, [bool]$dryRun = $false) {
  $match = [regex]::Match([string]$request.notation, '^(236|214|[1-9])(EX|[ABCF])$')
  if (-not $match.Success) { throw 'Move notation must be 1-9, 236, or 214 followed by A, B, C, F, or EX.' }
  $facing = if ($request.facing) { [string]$request.facing } else { 'Right' }
  if ($facing -notin @('Right','Left')) { throw 'Facing must be Right or Left.' }
  $motion = $match.Groups[1].Value; $button = $match.Groups[2].Value
  $attackActions = @{ A=@('Atk1'); B=@('Atk2'); C=@('Atk3'); F=@('Atk4'); EX=@('Atk1','Atk2') }[$button]
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
  foreach($action in $requiredActions) { if(-not $keys.ContainsKey($action)) { throw "No Player 1 keyboard binding for $action." } }
  $attackKeys = @($attackActions | ForEach-Object { $keys[$_] })
  $steps = [System.Collections.Generic.List[object]]::new()
  if($motion -eq '236' -or $motion -eq '214') {
    $dir=if($motion -eq '236'){$forward}else{$away}
    $steps.Add(@{Keys=@($keys.Down);Ms=50});$steps.Add(@{Keys=@($keys.Down,$keys[$dir]);Ms=50});$steps.Add(@{Keys=@($keys[$dir]);Ms=50});$steps.Add(@{Keys=@($keys[$dir]) + $attackKeys;Ms=50})
  } elseif($motion -eq '5') { $steps.Add(@{Keys=$attackKeys;Ms=50}) }
  else {
    $directionKeys = @($directionActions | ForEach-Object { $keys[$_] })
    $steps.Add(@{Keys=$directionKeys;Ms=50});$steps.Add(@{Keys=$directionKeys + $attackKeys;Ms=50})
  }
  $steps.Add(@{Keys=@();Ms=0})
  if ($dryRun) { return $steps.ToArray() }
  $held=[System.Collections.Generic.HashSet[string]]::new()
  try {
    foreach($step in $steps){ Check-Focus; $next=[System.Collections.Generic.HashSet[string]]::new(); foreach($key in $step.Keys){[void]$next.Add($key)}
      foreach($key in @($held)){if(-not $next.Contains($key)){[LabatarTrainingInputWorker]::SendKey($key,$false);[void]$held.Remove($key)}}
      foreach($key in $step.Keys){if($held.Add($key)){[LabatarTrainingInputWorker]::SendKey($key,$true)}}
      if($step.Ms){Start-Sleep -Milliseconds $step.Ms}
    }
  } finally { foreach($key in @($held)){[LabatarTrainingInputWorker]::SendKey($key,$false)} }
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
