$ErrorActionPreference = 'Stop'
$projectRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$desktopFolder = [Environment]::GetFolderPath('Desktop')
$shortcutPath = Join-Path $desktopFolder 'Anti IA Local.lnk'
$shell = New-Object -ComObject WScript.Shell
$shortcut = $shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath = Join-Path $env:SystemRoot 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments = '-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File "' + (Join-Path $PSScriptRoot 'start-local.ps1') + '"'
$shortcut.WorkingDirectory = $projectRoot
$shortcut.Description = 'Anti IA Local — usa a cota do ChatGPT autorizada por você'
$shortcut.WindowStyle = 7
$shortcut.Save()
Write-Output $shortcutPath
