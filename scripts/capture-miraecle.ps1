Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$procs = Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowTitle -eq 'Miraecle' }
if (-not $procs) { Write-Output 'no Miraecle window'; exit 1 }
$bounds = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap $bounds.Width, $bounds.Height
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($bounds.Location, [System.Drawing.Point]::Empty, $bounds.Size)
$out = 'C:\Users\qqwer\OneDrive\Desktop\hermes-browser\screenshots\aside-gap-features.png'
$bmp.Save($out, [System.Drawing.Imaging.ImageFormat]::Png)
$g.Dispose()
$bmp.Dispose()
Write-Output $out
