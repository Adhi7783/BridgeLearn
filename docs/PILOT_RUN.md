# BridgeLearn Pilot Run

This is the shortest path to run the pilot with your WSL2-hosted Ollama model.

If you want the reasoning behind the prerequisites and bootstrap step, read [Why This Setup](WHY_THIS_SETUP.md) first.

## Assumptions

- Ollama is already running inside isolated WSL2.
- WSL2 uses mirrored networking.
- The custom local model is `gemma-hackathon`.
- The model is built from `batiai/gemma4-e2b:q4`.
- Offline mode is the default.
- Hybrid cloud fallback is optional and disabled unless you turn it on.

## Pilot launch steps

### 1. Start Ollama in WSL2

In your WSL2 terminal:

```bash
ollama serve
```

### 2. Verify the model is available

```bash
ollama list
```

Confirm `gemma-hackathon` appears.

### 3. Start BridgeLearn from Windows

In Windows PowerShell or Command Prompt:

```powershell
cd c:\personal\BridgeLearn
start.bat
```

If you prefer manual launch, use:

```powershell
npm run dev
```

### 4. Open the app

Open:

```text
http://localhost:5173
```

### 5. Test the pilot scenario

Try these prompts:

- Explain offline-first AI in simple terms.
- Compare local-only and hybrid AI deployment.
- Summarize the benefit of using a 4-bit model for VRAM savings.

### 6. Check the result

You should see:

- Local model response from `gemma-hackathon`
- Status showing local model availability
- No cloud usage unless you explicitly enable hybrid fallback

## Optional hybrid fallback test

Only if you want to test cloud fallback, set your cloud API key and enable hybrid mode in `config/.env.local`.

## Troubleshooting

- If the app cannot reach Ollama, confirm `ollama serve` is still running in WSL2.
- If the model is missing, rebuild it with your Modelfile and `ollama create gemma-hackathon -f ./Modelfile`.
- If WSL has been restarted, restart Ollama and relaunch the app.
