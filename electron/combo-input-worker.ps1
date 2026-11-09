$ErrorActionPreference = 'Stop'

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;

[StructLayout(LayoutKind.Sequential)]
public struct ComboGamepad {
    public ushort Buttons;
    public byte LeftTrigger;
    public byte RightTrigger;
    public short LeftX;
    public short LeftY;
    public short RightX;
    public short RightY;
}

[StructLayout(LayoutKind.Sequential)]
public struct ComboXInputState {
    public uint Packet;
    public ComboGamepad Gamepad;
}

public static class ComboXInput {
    [DllImport("xinput1_4.dll", EntryPoint = "XInputGetState")]
    public static extern uint GetState(uint userIndex, out ComboXInputState state);
}
'@

function Send-Event($value) {
    [Console]::Out.WriteLine(($value | ConvertTo-Json -Compress -Depth 4))
    [Console]::Out.Flush()
}

try {
    $selected = -1
    for ($i = 0; $i -lt 4; $i++) {
        $probe = [ComboXInputState]::new()
        if ([ComboXInput]::GetState([uint32]$i, [ref]$probe) -eq 0) {
            $selected = $i
            break
        }
    }
    if ($selected -lt 0) {
        throw 'No XInput controller is connected. Connect an Xbox-compatible controller or enable Steam Input, then retry.'
    }
    Send-Event @{ type = 'ready'; deviceIndex = $selected }
    $previous = ''
    while ($true) {
        $state = [ComboXInputState]::new()
        if ([ComboXInput]::GetState([uint32]$selected, [ref]$state) -ne 0) {
            throw 'The controller disconnected during combo recording.'
        }
        $mask = [int]$state.Gamepad.Buttons
        $left = (($mask -band 0x0004) -ne 0)
        $right = (($mask -band 0x0008) -ne 0)
        $up = (($mask -band 0x0001) -ne 0)
        $down = (($mask -band 0x0002) -ne 0)
        $horizontal = if ($left -and -not $right) { -1 } elseif ($right -and -not $left) { 1 } else { 0 }
        $vertical = if ($up -and -not $down) { 1 } elseif ($down -and -not $up) { -1 } else { 0 }
        $direction = 5 + $horizontal + (3 * $vertical)
        $stickHorizontal = if ($state.Gamepad.LeftX -lt -16000) { -1 } elseif ($state.Gamepad.LeftX -gt 16000) { 1 } else { 0 }
        $stickVertical = if ($state.Gamepad.LeftY -gt 16000) { 1 } elseif ($state.Gamepad.LeftY -lt -16000) { -1 } else { 0 }
        $stickDirection = 5 + $stickHorizontal + (3 * $stickVertical)
        $buttons = [System.Collections.Generic.List[string]]::new()
        foreach ($entry in @(
            @('A', 0x1000), @('B', 0x2000), @('X', 0x4000), @('Y', 0x8000),
            @('LB', 0x0100), @('RB', 0x0200), @('Start', 0x0010), @('Back', 0x0020)
        )) {
            if (($mask -band [int]$entry[1]) -ne 0) { $buttons.Add([string]$entry[0]) }
        }
        if ($state.Gamepad.LeftTrigger -gt 30) { $buttons.Add('LT') }
        if ($state.Gamepad.RightTrigger -gt 30) { $buttons.Add('RT') }
        $signature = "$direction|$stickDirection|$($buttons -join ',')"
        if ($signature -ne $previous) {
            Send-Event @{ type = 'state'; atMs = [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds(); direction = $direction; stickDirection = $stickDirection; buttons = @($buttons) }
            $previous = $signature
        }
        Start-Sleep -Milliseconds 8
    }
} catch {
    Send-Event @{ type = 'error'; message = $_.Exception.Message }
    exit 1
}
