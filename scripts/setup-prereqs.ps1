[CmdletBinding()]
param(
  [switch]$InstallNode,
  [switch]$SkipOllamaCheck
)

$ErrorActionPreference = 'Stop'

function Write-Step([string]$Message) {
  Write-Host $Message -ForegroundColor Cyan
}

function Write-Ok([string]$Message) {
  Write-Host $Message -ForegroundColor Green
}

function Write-Warn([string]$Message) {
  Write-Host $Message -ForegroundColor Yellow
}

function Test-Command([string]$Name) {
  return [bool](Get-Command $Name -ErrorAction SilentlyContinue)
}

Write-Step 'BridgeLearn prerequisite check'

$results = @{}

$results.node = Test-Command 'node'
$results.npm = Test-Command 'npm'
$results.winget = Test-Command 'winget'
$results.curlexe = Test-Command 'curl'

if ($results.node) {
  Write-Ok "node: found ($(& node -v))"
} else {
  Write-Warn 'node: missing'
}

if ($results.npm) {
  Write-Ok "npm: found ($(& npm -v))"
} else {
  Write-Warn 'npm: missing'
}

if ($results.winget) {
  Write-Ok 'winget: found'
} else {
  Write-Warn 'winget: missing'
}

if (-not $SkipOllamaCheck) {
  try {
    $response = Invoke-WebRequest -Uri 'http://localhost:11434/api/tags' -UseBasicParsing -TimeoutSec 5
    Write-Ok 'Ollama: reachable at http://localhost:11434'
  } catch {
    Write-Warn 'Ollama: not reachable at http://localhost:11434'
    Write-Warn 'Start Ollama in WSL2 with: ollama serve'
  }
}

$missingNode = -not $results.node -or -not $results.npm

if ($missingNode -and $InstallNode) {
  if (-not $results.winget) {
    throw 'winget is not available, so automatic Node.js installation cannot continue. Install Node.js manually from https://nodejs.org/ and reopen the terminal.'
  }

  Write-Step 'Installing Node.js LTS with winget...'
  winget install --id OpenJS.NodeJS.LTS -e --accept-package-agreements --accept-source-agreements
  Write-Ok 'Node.js installation finished. Open a new terminal, then rerun this script.'
  exit 0
}

if ($missingNode) {
  Write-Warn 'Node.js/npm are missing. Use -InstallNode to install Node.js with winget, or install it manually from https://nodejs.org/'
}

if (-not $results.node -or -not $results.npm) {
  exit 1
}

Write-Ok 'All required Windows-side prerequisites are ready.'
