$procs = Get-CimInstance Win32_Process -Filter "name = 'electron.exe'" -ErrorAction SilentlyContinue
foreach ($p in $procs) {
  try {
    Write-Host "Killing PID $($p.ProcessId) PPID $($p.ParentProcessId) $($p.CommandLine)"
    Stop-Process -Id $p.ProcessId -Force -ErrorAction SilentlyContinue
  } catch {}
}
Start-Sleep -Seconds 3
Get-Process electron -ErrorAction SilentlyContinue | Select-Object Id, MainWindowTitle | Format-Table -AutoSize
