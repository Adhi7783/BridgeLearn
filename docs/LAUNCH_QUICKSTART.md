# BridgeLearn Launch Quickstart

## Goal

Launch BridgeLearn against the WSL2-hosted local model and try it quickly with team members.

For the explanation of why we check prerequisites first, see [Why This Setup](WHY_THIS_SETUP.md).

## Normal path for the hackathon

- Ollama runs in WSL2.
- WSL2 uses mirrored networking.
- BridgeLearn connects to the local model at `http://localhost:11434`.
- Local mode is the default.
- Hybrid cloud fallback is optional.

## Launch steps

### 1. Start Ollama in WSL2

```bash
ollama serve
```

### 2. Confirm the custom model exists

```bash
ollama list
```

You should see `gemma-hackathon`.

### 3. Start BridgeLearn from Windows

```powershell
cd c:\personal\BridgeLearn
```

Then run your app launch command.

### 4. Open the app

Use the frontend URL your app exposes locally.

## Quick validation

- Open `http://localhost:11434/api/tags`
- Confirm the local model is available
- Send one prompt and verify the response comes from the local model

## Demo scenarios for team feedback

1. Local-only offline learning
2. Repeated prompt to test consistent behavior
3. Cloud fallback when explicitly enabled
4. Different prompt types for learning and tutoring

## Notes

- Do not use cloud fallback unless you explicitly enable it.
- The hackathon path should stay local-first and offline-first.
