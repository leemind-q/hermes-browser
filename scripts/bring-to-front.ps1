Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Win32 {
    [DllImport("user32.dll")]
    public static extern bool SetForegroundWindow(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool IsIconic(IntPtr hWnd);
    [DllImport("user32.dll")]
    public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
}
"@

$proc = Get-Process electron | Where-Object { $_.MainWindowTitle -eq 'Miraecle' }
if (-not $proc) {
    Write-Output "Miraecle not found"
    exit 1
}

$handle = $proc.MainWindowHandle
Write-Output "Miraecle found. PID: $($proc.Id), Handle: $handle"

# Restore if minimized
$isMin = [Win32]::IsIconic($handle)
Write-Output "Minimized: $isMin"
if ($isMin) {
    [Win32]::ShowWindow($handle, 9) | Out-Null  # SW_RESTORE
    Start-Sleep -Milliseconds 500
}

# Bring to front
[Win32]::SetForegroundWindow($handle) | Out-Null
Start-Sleep -Milliseconds 1000

# Capture screen
Add-Type -AssemblyName System.Drawing
Add-Type -AssemblyName System.Windows.Forms
$screen = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
$bmp = New-Object System.Drawing.Bitmap($screen.Width, $screen.Height)
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($screen.X, $screen.Y, 0, 0, $bmp.Size)
$bmp.Save('C:\Users\qqwer\OneDrive\Desktop\hermes-browser\screenshots\miraecle-restored.png')
$g.Dispose()
$bmp.Dispose()
Write-Output "Captured restored Miraecle"
