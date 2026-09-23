# Rebuild the Windows native messaging helper from the included C# source.
$ErrorActionPreference = 'Stop'
$framework = if ([Environment]::Is64BitOperatingSystem) { 'Framework64' } else { 'Framework' }
$compiler = Join-Path $env:WINDIR "Microsoft.NET\$framework\v4.0.30319\csc.exe"
if (-not (Test-Path -LiteralPath $compiler -PathType Leaf)) {
    throw "The .NET Framework C# compiler was not found: $compiler"
}
$source = Join-Path $PSScriptRoot 'BroadWorksCredentialHost.cs'
$output = Join-Path $PSScriptRoot 'BroadWorksCredentialHost.exe'
& $compiler /nologo /optimize+ /target:exe /platform:anycpu /r:System.Web.Extensions.dll "/out:$output" $source
if ($LASTEXITCODE -ne 0) { throw 'Credential helper build failed.' }
Write-Output "Built $output"
