Get-Process electron -ErrorAction SilentlyContinue |
  Where-Object { $_.MainWindowTitle -ne '' } |
  Select-Object Id, MainWindowTitle |
  Format-Table -AutoSize
