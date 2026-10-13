$ErrorActionPreference = 'Stop'
$projectDirectory = $PSScriptRoot
Start-Process -FilePath (Join-Path $projectDirectory 'index.html')
