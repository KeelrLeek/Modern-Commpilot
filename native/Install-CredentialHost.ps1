# Run once per Windows user after extracting the extension package.
# Registers the helper for Chrome, Edge, and Firefox without administrator rights.
$ErrorActionPreference = 'Stop'
$hostName = 'com.broadworks.enhancer.credentials'
$chromeId = 'gahgpfcnalnjfnlchhlhknidgnpllojg'
$firefoxId = 'broadworks-enhancer-pjax@example.com'
$sourceExe = Join-Path $PSScriptRoot 'BroadWorksCredentialHost.exe'
if (-not (Test-Path -LiteralPath $sourceExe -PathType Leaf)) {
    throw "Missing credential helper: $sourceExe"
}

$installDir = Join-Path ([Environment]::GetFolderPath('LocalApplicationData')) 'BroadWorksEnhancer\CredentialHost'
New-Item -ItemType Directory -Path $installDir -Force | Out-Null
$installedExe = Join-Path $installDir 'BroadWorksCredentialHost.exe'
Copy-Item -LiteralPath $sourceExe -Destination $installedExe -Force

$chromeManifest = Join-Path $installDir "$hostName.chrome.json"
$firefoxManifest = Join-Path $installDir "$hostName.firefox.json"
$common = @{
    name = $hostName
    description = 'BroadWorks Enhancer Windows Credential Manager helper'
    path = $installedExe
    type = 'stdio'
}
$chromeConfig = $common.Clone()
$chromeConfig.allowed_origins = @("chrome-extension://$chromeId/")
$firefoxConfig = $common.Clone()
$firefoxConfig.allowed_extensions = @($firefoxId)
$utf8 = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($chromeManifest, ($chromeConfig | ConvertTo-Json -Depth 4), $utf8)
[System.IO.File]::WriteAllText($firefoxManifest, ($firefoxConfig | ConvertTo-Json -Depth 4), $utf8)

$registrations = @(
    @{ Root = 'Google\Chrome'; Manifest = $chromeManifest },
    @{ Root = 'Microsoft\Edge'; Manifest = $chromeManifest },
    @{ Root = 'Mozilla'; Manifest = $firefoxManifest }
)
foreach ($registration in $registrations) {
    $key = "HKCU:\Software\$($registration.Root)\NativeMessagingHosts\$hostName"
    New-Item -Path $key -Force | Out-Null
    Set-Item -Path $key -Value $registration.Manifest
}

Write-Output "Windows credential helper installed for Chrome, Edge, and Firefox."
Write-Output "Location: $installDir"
Write-Output 'No credentials are saved until you enter them on the CommPilot login page and select Auto sign in.'
