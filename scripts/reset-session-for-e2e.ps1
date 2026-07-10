Get-Process electron -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
$dirs = @(
  "$env:APPDATA\hermes-browser",
  "$env:APPDATA\Hermes Browser",
  "$env:APPDATA\Miraecle",
  "$env:APPDATA\Electron"
)
foreach ($d in $dirs) {
  if (Test-Path $d) {
    Get-ChildItem -Path $d -Filter session.json -Recurse -ErrorAction SilentlyContinue | ForEach-Object {
      $backup = "$($_.FullName).bak-$(Get-Date -Format yyyyMMddHHmmss)"
      Move-Item $_.FullName $backup -Force
      Write-Output "BACKUP $backup"
    }
  }
}
