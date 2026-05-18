# BridgeLearn — Judge demo package (v2)

This package is prepared for judge evaluation. It contains the application source (no node_modules), a working SQLite DB, helper scripts, and a short runbook so a judge can launch the demo on a Windows laptop.

Contents
- The ZIP: BridgeLearn_demo_for_judges_v2.zip — extracts to a project root with these top-level items: `backend/`, `frontend/`, `data/bridgelearn.db`, `scripts/`, `validate_demo.js`, and this `README_FOR_JUDGES.md`. There is NO nested ZIP inside.

Prerequisites
- Windows laptop with:
	- Node.js (LTS, >=16). Verify: `node --version`
	- npm (comes with Node). Verify: `npm --version`
	- Ollama (only required if you want the local Gemma model). Verify: `ollama --version`

Notes on Ollama/WSL2
- If you run Ollama inside WSL2, ensure it is reachable from Windows. The app expects an HTTP URL (for example `http://localhost:11434`). Use the environment variables documented below to point the demo to the correct host/port and model name.

Quick Start — safe dry-run (PowerShell)
1. Extract `BridgeLearn_demo_for_judges_v2.zip` to a folder and open PowerShell in that folder.

2. Dry-run the demo starter (this will NOT modify the DB):

```powershell
cd .\BridgeLearn_demo_for_judges_v2\
powershell -ExecutionPolicy Bypass -File .\start_demo.ps1
```

3. If the dry-run output looks correct, run the full prepare (installs + DB restore + start services). The package includes `config/.env.local` with demo defaults; keep it as-is or edit if your Ollama runs on a different host/port.

```powershell
powershell -ExecutionPolicy Bypass -File .\start_demo.ps1 -Install -ExecuteRestore
```

What the script does
- `-Install`: runs `npm install` in `backend/` and `frontend/` (only when passed).
- `-ExecuteRestore`: runs the DB restore script `scripts/restore_grade8_students.js --execute` to reinsert demo enrollments (useful if DB was altered).
- Default (no flags): performs a dry-run of the restore and attempts to start backend and frontend (safe preview).

Use alternate Ollama host/model
Set these environment variables in PowerShell before running the starter if your Ollama is on a different host/port or the model name differs:

```powershell
$env:OLLAMA_URL='http://localhost:11434'
$env:OLLAMA_MODEL='bridgelearn-gemma-4-e2b-q4'

Note: The extracted package contains `config/.env.local` already set to these demo defaults (PORT=5000). You do not need to set these environment variables unless you want to override them.
```

Validation script
- After the services start, run the bundled validator to confirm health, enrollments, and model responses:

```powershell
cd .\BridgeLearn_demo_for_judges_v2\
node .\validate_demo.js
```

Manual startup (if needed)
- Backend only:

```powershell
cd backend
npm install
node server.js
```

- Frontend only:

```powershell
cd frontend
npm install
npm run dev
```

Checks you can run by hand
- Backend health: `curl http://localhost:5000/api/health`
- Check Ollama tags: `curl $env:OLLAMA_URL/api/tags`
- Frontend root: check the Vite URL printed in the frontend terminal (often `http://localhost:5173` or `5174`)

Recommended demo flow for judges
1. Open the frontend URL printed by the starter script.
2. Log in as Teacher via the UI.
3. Upload a curriculum PDF (sample files are in `data/`).
4. Assign a session to Student 8-1, switch to student view, and run the Q&A flow.

Troubleshooting highlights
- If the PowerShell script is blocked, use `-ExecutionPolicy Bypass` when invoking it.
- If `npm` appears as a shim and Start-Process fails to launch, run `npm run dev` manually from the `frontend` folder.
- If Ollama is not reachable, set `OLLAMA_URL` to the correct address and re-run the validator.
- If DB restore fails, re-run the starter with `-ExecuteRestore` after confirming dry-run output.

Files to include when submitting artifacts
- `Demo/BridgeLearn_demo_for_judges_v2.zip` (final ZIP)
- This file: `Demo/README_FOR_JUDGES.md` ([Demo/README_FOR_JUDGES.md](Demo/README_FOR_JUDGES.md))
- `Demo/validate_demo.js` ([Demo/validate_demo.js](Demo/validate_demo.js))
- `start_demo.ps1` ([scripts/start_demo.ps1](scripts/start_demo.ps1))

If you want, I can now run the full smoke test (install + execute restore + validate) inside the extracted package so you have a verified submission artifact. Request that and I'll run the following commands in order:

```powershell
cd Demo\package_v2_check
powershell -ExecutionPolicy Bypass -File .\start_demo.ps1 -ExecuteRestore -Install
node .\validate_demo.js
```

If you prefer, review this README and tell me edits to wording or steps before I run the full smoke test.

*BridgeLearn — Judge demo package (v2)*
