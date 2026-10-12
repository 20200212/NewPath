# 用真实输入驱动打包版：Alt+C → 单击最大化窗口 → S → 回车 → 滚轮 → 回车。中途用 inspect.ps1 看窗口状态。
param([int]$Wheel = 25)
Add-Type -Namespace W -Name In -MemberDefinition @'
[DllImport("user32.dll")] public static extern void mouse_event(uint f, int dx, int dy, int data, UIntPtr extra);
[DllImport("user32.dll")] public static extern bool SetCursorPos(int x, int y);
[DllImport("user32.dll")] public static extern void keybd_event(byte vk, byte scan, uint flags, UIntPtr extra);
'@
function Key([byte]$vk) { [W.In]::keybd_event($vk, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W.In]::keybd_event($vk, 0, 2, [UIntPtr]::Zero) }
function Click($x, $y) { [W.In]::SetCursorPos($x, $y) | Out-Null; Start-Sleep -Milliseconds 400; [W.In]::mouse_event(2, 0, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 60; [W.In]::mouse_event(4, 0, 0, 0, [UIntPtr]::Zero) }
$log = "$env:APPDATA\NewPath\logs\newpath.log"
$before = (Get-Content $log).Count
"1. Alt+C"
[W.In]::keybd_event(0x12, 0, 0, [UIntPtr]::Zero); Start-Sleep -Milliseconds 50; Key 0x43; [W.In]::keybd_event(0x12, 0, 2, [UIntPtr]::Zero)
Start-Sleep -Milliseconds 2500
"2. 单击最大化窗口 (1700,950)"
Click 1700 950
Start-Sleep -Milliseconds 600
"3. S → 回车"
Key 0x53; Start-Sleep -Milliseconds 300; Key 0x0D
Start-Sleep -Milliseconds 1500
"== 滚动阶段窗口状态 =="
& powershell -NoProfile -File "$PSScriptRoot\inspect.ps1"
"4. 滚轮 $Wheel 下"
[W.In]::SetCursorPos(960, 600) | Out-Null
for ($i = 0; $i -lt $Wheel; $i++) { [W.In]::mouse_event(0x0800, 0, 0, -120, [UIntPtr]::Zero); Start-Sleep -Milliseconds 150 }
Start-Sleep -Milliseconds 1200
"5. 回车完成"
Key 0x0D
Start-Sleep -Milliseconds 4000
"== 日志 =="
Get-Content $log | Select-Object -Skip $before | ForEach-Object { $_.Substring(0, [Math]::Min(300, $_.Length)) }
