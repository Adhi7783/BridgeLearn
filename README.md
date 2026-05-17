# BridgeLearn

BridgeLearn is an offline-first AI learning app for the Gemma 4 Good Hackathon.

## Assumptions in this setup

- Ollama runs inside isolated WSL2.
- WSL2 uses mirrored networking, so Windows can reach Ollama directly on `localhost:11434`.
- The local model is a custom Ollama model named `bridgelearn-gemma-4-e2b-q4`.
- It's based on Google's Gemma 4 E2B model, 4-bit quantized via Ollama.
- Built from `batiai/gemma4-e2b:q4` to fit in GPU VRAM (3.8 GB).
- The app is offline-first by default.
- Hybrid cloud fallback is optional and only enabled when you explicitly configure it for V2.

## Prerequisites

- Windows 10 or 11
- PowerShell 5.1+
- WSL2 enabled
- Ollama running inside WSL2
- Node.js installed on Windows
- `npm` available on the Windows PATH

BridgeLearn uses a Windows app plus a WSL2 model runtime, so the prerequisites matter. See [Why This Setup](docs/WHY_THIS_SETUP.md) for the reasoning.

If Node.js or `npm` is missing, run the bootstrap script first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-prereqs.ps1 -InstallNode
```
## Local model details

- Base model: `batiai/gemma4-e2b:q4`
- Custom model name: `bridgelearn-gemma-4-e2b-q4` (Gemma 4 E2B, 4-bit quantized)
- Purpose: keep the model fully on GPU while staying within VRAM limits
- Suggested Ollama settings:
  - `num_ctx 2048`
  - `num_batch 128`
  - `num_gpu 999`
  - `temperature 0.3`
  - `top_p 0.95`
  - `top_k 64`
  - `min_p 0.0`

### Ollama API note

For this model, `ollama run bridgelearn-gemma-4-e2b-q4` and `POST /api/chat` return usable assistant output, but `POST /api/generate` can return an empty `response` even when the model is working correctly. BridgeLearn therefore uses `/api/chat` and reads the assistant text from `message.thinking` when `message.content` is empty.

## How to launch

### WSL2 Model Setup (One-time, first time only)

**Important:** You need to rename the base model to match the app's configuration:

In your WSL2 terminal (after Ollama is installed):

```bash
# Create the custom model with the correct name
ollama cp batiai/gemma4-e2b:q4 bridgelearn-gemma-4-e2b-q4

# Verify it exists
ollama list | grep bridgelearn-gemma-4-e2b-q4
```

You should see:
```
bridgelearn-gemma-4-e2b-q4:latest    3.8 GB
```

**Note:** This is a one-time setup. The app will automatically find this model via Ollama's API.

---

### 1. Start Ollama in WSL2

In your WSL2 terminal:

```bash
ollama serve
```

### 2. Verify the custom model exists

```bash
ollama list
```

You should see `bridgelearn-gemma-4-e2b-q4` in the list.

### New: Local Session & Curriculum APIs (Teacher/Student flows)

We added lightweight local APIs to support Teacher/Student MVP flows (curriculum upload, session creation/join, answers, hints, and a simple teacher dashboard). These use a local SQLite database stored in `data/bridgelearn.db` and uploaded curriculum files are saved in `data/uploads/`.

Install the extra dependencies required for these APIs:

```powershell
cd C:\personal\BridgeLearn\backend
npm install sqlite3 multer uuid
```

Available endpoints (local-only):

- `POST /api/teacher/upload` - multipart form-data (`file`, `metadata` JSON) → saves curriculum and returns `curriculumId`
- `POST /api/session/create` - { title, curriculumId, startTime, endTime } → creates session and returns `joinCode`
- `POST /api/session/join` - { joinCode, userName } → join session as student, returns `sessionId` and `studentId`
- `POST /api/session/answer` - { sessionId, studentId, questionId, answer, correct, hintRequested } → store progress
- `POST /api/session/hint` - { sessionId, studentId, questionId } → records hint request and returns a short hint
- `GET /api/teacher/dashboard?sessionId=<id>` - returns aggregated session metrics

These APIs are intentionally local-first and store all data on disk; no external network calls are made by the server for these features.

### 3. Start BridgeLearn from Windows

Run from **Command Prompt (cmd.exe)** for best results (not PowerShell):

```cmd
cd C:\personal\BridgeLearn
start.bat
```

Keep this Command Prompt window open — it will show the dev server logs.

If you want to check prerequisites manually first:

```powershell
powershell -ExecutionPolicy Bypass -File scripts\setup-prereqs.ps1
```

Alternatively, you can manually launch the app:

```cmd
cd C:\personal\BridgeLearn
npm run dev
```

Because WSL2 is using mirrored networking, the app should connect to Ollama through `http://localhost:11434`.

## Testing the pilot

After running `start.bat`, the app should be running in the background. Follow these steps to verify:

### 1. Open the frontend

Open your browser and go to:

```text
http://localhost:5173
```

You should see the BridgeLearn chat UI.

### 2. Verify backend health

In a new terminal, check the backend is reachable:

```powershell
curl http://localhost:5000/api/health
```

Expected response: `200 OK` with a status message.

### 3. Verify Ollama and the model

```powershell
curl http://localhost:11434/api/tags
```

Confirm `bridgelearn-gemma-4-e2b-q4` appears in the response.

### 4. Test the pilot scenario

Try these prompts in the chat:

**Basic pilot prompt**

1. "Explain offline-first AI in simple terms."

**GPU verification**

2. Verify the model is fully loaded into GPU VRAM:

   ```bash
   ollama ps
   ```

   Confirm the row for `bridgelearn-gemma-4-e2b-q4:latest` shows `100% GPU` in the `PROCESSOR` column.

**Follow-up demo prompts**

3. "Compare local-only and hybrid AI deployment."
4. "Summarize the benefit of using a 4-bit model for VRAM savings."
5. "Explain the difference between offline-first and hybrid AI tutoring."
6. "Why does a 4-bit model help with VRAM usage?"

You should receive responses from the local `bridgelearn-gemma-4-e2b-q4` model running inside WSL2, and `ollama ps` should show it loaded on GPU.

UI tips:

- If a response is trimmed for the demo, click **Show more** next to the assistant bubble to fetch the full (untrimmed) output.
- Use the **Summarize response** checkbox in the composer to ask the model to return a concise 2–3 sentence summary (runs locally).

### 5. Verify local-only mode

Check `config/.env.local`:

- `MODEL_STRATEGY=offline` (local model is the default)
- `OFFLINE_ONLY=true` (cloud fallback is disabled)
- `OLLAMA_URL=http://localhost:11434`
- `OLLAMA_MODEL=bridgelearn-gemma-4-e2b-q4`

If these are set, the app uses only the local model. No cloud calls are made unless you explicitly change these settings.

## GPU demo verification

If you want to show the model is loading in GPU VRAM during the hackathon, use the WSL2 GPU scripts:

- `scripts/gpu-check-before.sh`: capture the baseline GPU memory before loading the model
- `scripts/gpu-check-after.sh`: capture GPU memory after `bridgelearn-gemma-4-e2b-q4` is loaded
- `scripts/gpu-monitor-live.sh`: watch live GPU usage during inference

See [GPU Monitoring for Hackathon Demo](docs/GPU_MONITORING_HACKATHON.md) for the exact demo flow and talking points.

Success state: `ollama ps` should show `bridgelearn-gemma-4-e2b-q4:latest` using `100% GPU`, which confirms the model is fully loaded into VRAM.

## Quick verification

- Ollama tags endpoint: `http://localhost:11434/api/tags`
- Local model availability should show `bridgelearn-gemma-4-e2b-q4`
- If cloud fallback is disabled, the app should continue to work offline with the local model only

## When to enable hybrid fallback

Enable cloud fallback only if you want the app to call a cloud Gemma API when the local model is unavailable.

That mode should be treated as optional production fallback, not the default hackathon path.

## Supporting docs

- [WSL2_SETUP.md](docs/WSL2_SETUP.md)
- [CUSTOM_MODEL.md](docs/CUSTOM_MODEL.md)
- [README.txt](README.txt)


### Documentation & Quick Links
- `docs/PREREQUISITES.md`: full prerequisite checklist and the `scripts/setup-prereqs.ps1` bootstrapper.
- `docs/WHY_THIS_SETUP.md`: high-level explanation of the offline-first design and preflight checks.
- `docs/WSL2_RATIONALE.md`: detailed rationale for running Ollama inside WSL2 (isolation, privacy, reproducibility) and suggested hackathon wording.
- `docs/PILOT_RUN.md`: step-by-step pilot run checklist and common troubleshooting tips.
- `docs/LAUNCH_QUICKSTART.md`: one-line commands to get a demo running quickly.

Suggested hackathon blurb (short):
"We run Ollama inside an isolated WSL2 environment to keep large model artifacts and inference traffic separated from the host OS. This improves reproducibility, reduces accidental data exposure during demos, and makes onboarding reviewers and teammates faster. See docs/WSL2_RATIONALE.md."

Helpful commands
```powershell
# start Ollama in WSL2
wsl -d <your-distro> -- ollama serve

# start the BridgeLearn pilot from Windows
cd C:\personal\BridgeLearn
start.bat
```
