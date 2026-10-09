param(
  [Parameter(Mandatory = $true)][string]$ElectronPath,
  [Parameter(Mandatory = $true)][string]$WatcherScript,
  [Parameter(Mandatory = $true)][string]$BackupRoot
)

$ErrorActionPreference = 'Stop'
$env:ELECTRON_RUN_AS_NODE = '1'
$arguments = @('"' + $WatcherScript + '"', '--watch', '"' + $BackupRoot + '"')
Start-Process -FilePath $ElectronPath -ArgumentList $arguments -WorkingDirectory (Split-Path -Path $WatcherScript -Parent) -WindowStyle Hidden
