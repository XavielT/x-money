# Uploads the Android signing key to the GitHub repository SECRETS (encrypted, write-only).
# Run it ONCE, in your own terminal, from the project folder:   .\scripts\set-release-secrets.ps1
# It reads android\x-money-release.jks and android\keystore.properties (both ignored by git) and never prints them.
# Needs the GitHub CLI logged in (gh auth status).
param([string]$Repo = 'XavielT/x-money')
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
$jks = Join-Path $root 'android\x-money-release.jks'
$props = Join-Path $root 'android\keystore.properties'
if (-not (Test-Path $jks) -or -not (Test-Path $props)) { throw 'android\x-money-release.jks or keystore.properties not found' }

$p = @{}
Get-Content $props | ForEach-Object { if ($_ -match '^\s*([^#=]+?)\s*=\s*(.*)$') { $p[$Matches[1]] = $Matches[2] } }
foreach ($k in 'storePassword', 'keyAlias', 'keyPassword') { if (-not $p[$k]) { throw "keystore.properties has no $k" } }

[Convert]::ToBase64String([IO.File]::ReadAllBytes($jks)) | gh secret set ANDROID_KEYSTORE_B64 --repo $Repo
$p['storePassword'] | gh secret set ANDROID_KEYSTORE_PASSWORD --repo $Repo
$p['keyAlias'] | gh secret set ANDROID_KEY_ALIAS --repo $Repo
$p['keyPassword'] | gh secret set ANDROID_KEY_PASSWORD --repo $Repo
Write-Host 'Done. Secrets set (their values cannot be read back from GitHub):'
gh secret list --repo $Repo
Write-Host 'Keep your OFFLINE copy of the .jks and keystore.properties: GitHub cannot give them back.'
