$ErrorActionPreference = 'Continue'
$userData = 'C:\Users\qqwer\AppData\Roaming\hermes-browser'
Get-CimInstance Win32_Process | Where-Object {
  $_.Name -eq 'electron.exe' -and $_.CommandLine -like '*hermes-browser*'
} | ForEach-Object {
  try { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue } catch {}
}
Start-Sleep -Milliseconds 500
$dirs = @(
  'Cache',
  'GPUCache',
  'Code Cache',
  'Service Worker\CacheStorage',
  'Service Worker\Database',
  'DawnCache',
  'ShaderCache'
)
foreach ($rel in $dirs) {
  $dir = Join-Path $userData $rel
  if (Test-Path $dir) {
    Remove-Item $dir -Recurse -Force -ErrorAction SilentlyContinue
  }
}
Write-Output "cache-cleaned=$userData"
Write-Output "exists=$(Test-Path $userData)"
