# BridgeLearn Prerequisites

## Why this page exists

BridgeLearn spans Windows and WSL2. The app runs on Windows, while Ollama and the local Gemma model run inside WSL2. A small prerequisite check prevents avoidable pilot failures such as missing `npm`, a stale PATH, or Ollama not being reachable from Windows.

This matters because the pilot should focus on model quality and feedback, not environment debugging.

## Required

- Windows 10/11
- PowerShell 5.1 or newer
- WSL2 enabled
- Ollama installed inside WSL2
- Node.js installed on Windows for the BridgeLearn frontend and backend

## Recommended

- `winget` available on Windows so Node.js can be installed automatically if missing
- Git for future updates
- A GPU with enough VRAM for `batiai/gemma4-e2b:q4`

## BridgeLearn runtime assumptions

- Ollama runs inside isolated WSL2
- WSL2 uses mirrored networking
- Windows can reach Ollama at `http://localhost:11434`
- Local model: `gemma-hackathon`
- Base model: `batiai/gemma4-e2b:q4`
- Offline mode is the default
- Hybrid cloud fallback is optional and must be enabled explicitly

## What the pilot app needs

### Windows side

- `node`
- `npm`
- `curl`

### WSL2 side

- `ollama`
- the custom model `gemma-hackathon`

## Install options

### Node.js on Windows

Preferred install method:

```powershell
winget install OpenJS.NodeJS.LTS
```

If `winget` is not available, install Node.js manually from https://nodejs.org/

### Ollama in WSL2

Install and start Ollama inside WSL2, then confirm the model list:

```bash
ollama serve
ollama list
```

## Validation checklist

- `node -v` works in PowerShell
- `npm -v` works in PowerShell
- `curl http://localhost:11434/api/tags` returns Ollama data
- `ollama list` shows `gemma-hackathon`

## Troubleshooting

If `npm` is not recognized, Node.js is either not installed or not on PATH. Install Node.js or open a new terminal after installation so PATH refreshes.

If `localhost:11434` is unreachable, confirm Ollama is running in WSL2 and mirrored networking is active.
