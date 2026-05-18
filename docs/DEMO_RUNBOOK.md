# Demo Runbook for Judges

Prerequisites
- Windows machine with Node.js (>=16) and npm in PATH
-- Ollama installed and running with the `bridgelearn-gemma-4-e2b-q4` model available
- Repository cloned and `data/bridgelearn.db` present

Quick start (recommended)
1. Open PowerShell in the repository root.
2. Run the demo starter (dry-run):

```powershell
.\start_demo.ps1
```

3. If the dry-run looks good, prepare DB and start services:

```powershell
.\start_demo.ps1 -Install -ExecuteRestore
```

4. Open the frontend at: http://localhost:5173 and follow the recorded demo steps (login, select Student 8-1, ask a question).

Stopping
- Close the PowerShell window(s) or stop the `node`/`npm` processes via Task Manager.

Safety notes
- `start_demo.ps1` runs `scripts/restore_grade8_students.js` by default in dry-run mode; pass `-ExecuteRestore` to apply changes.
- Always inspect `--dry-run` outputs before executing destructive scripts.

Troubleshooting
- If frontend doesn't load, run `cd frontend; npm run dev` manually and inspect logs.
- If Ollama isn't running, start it using your Ollama instructions (this repo assumes a local Ollama daemon).

Files referenced
- `start_demo.ps1` — demo starter script (root)
- `scripts\restore_grade8_students.js` — restores demo enrollments
- `scripts\delete_demo_grade8_nlp.js` — safe delete/reset (use `--dry-run` first)
