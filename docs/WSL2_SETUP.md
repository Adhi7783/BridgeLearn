# WSL2 Setup for BridgeLearn

## Goal

Run BridgeLearn with Ollama inside isolated WSL2 while keeping the Windows app simple to launch and test.

## Assumption

Your WSL2 environment uses mirrored networking.
That means Windows can talk to services in WSL2 through `localhost` without manual port forwarding.

## What this changes

- No `netsh portproxy` setup is needed.
- No WSL IP lookup is needed for normal launch.
- Ollama should be reachable from Windows at `http://localhost:11434`.

## Recommended startup sequence

### 1. Start Ollama inside WSL2

```bash
ollama serve
```

### 2. Verify Ollama is alive

From Windows PowerShell:

```powershell
curl http://localhost:11434/api/tags
```

You should see the model list returned by Ollama.

### 3. Verify the custom model

From WSL2 or through Windows:

```bash
ollama list
```

Look for `gemma-hackathon`.

### 4. Launch BridgeLearn from Windows

```powershell
cd c:\personal\BridgeLearn
```

Use your app launch command after that.
The app should connect to Ollama at `http://localhost:11434`.

## Troubleshooting

### If `localhost:11434` does not respond

- Make sure `ollama serve` is running in WSL2.
- Make sure mirrored networking is actually enabled in `.wslconfig`.
- Restart WSL after changing `.wslconfig`:

```powershell
wsl --shutdown
```

Then reopen WSL and start Ollama again.

### If WSL2 changed state after restart

If networking stops working after a reboot, restart WSL and Ollama again. With mirrored networking, the Windows-to-WSL bridge should still use `localhost`.

## Best practice for BridgeLearn

- Keep offline-first enabled by default.
- Treat cloud fallback as optional.
- Use the local model for the hackathon demo path.

## Related docs

- [README.md](../README.md)
- [CUSTOM_MODEL.md](CUSTOM_MODEL.md)
