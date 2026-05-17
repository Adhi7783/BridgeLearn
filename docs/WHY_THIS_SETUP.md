# Why BridgeLearn Uses a Prerequisite Check and Bootstrap Script

## Purpose

BridgeLearn is meant to be easy to pilot on team members' machines without spending the first 20 minutes debugging missing tools. The prerequisite check and bootstrap script exist to make the setup predictable.

## Why this is necessary

Your BridgeLearn setup depends on two separate environments:

- Windows runs the BridgeLearn app itself.
- WSL2 runs Ollama and the local Gemma model.

That means the app only works smoothly when both sides are ready:

- Windows must have Node.js and npm so the frontend and backend can start.
- WSL2 must have Ollama running so the local model can answer prompts.
- Mirrored networking must be in place so Windows can reach Ollama on `localhost:11434`.

Without a check, the app can fail with confusing errors like `npm is not recognized` or `cannot reach Ollama`, which wastes pilot time.

## What the bootstrap script does

The script checks the essentials before launch:

- whether `node` is installed
- whether `npm` is available
- whether the Ollama endpoint is reachable
- whether Node.js can be installed automatically with `winget`

If Node.js is missing, the script can install it for you, then ask you to open a new terminal so PATH refreshes.

## Why we keep the app offline-first

The hackathon path is designed around the local model:

- faster pilot testing
- no dependency on internet access
- no cloud cost or API key requirement for the main demo
- privacy-friendly local inference

Hybrid cloud fallback stays optional because it is a production resilience feature, not the default pilot path.

## What team members should do

Before starting the app:

1. Run the prerequisite check if this is the first setup.
2. Confirm Ollama is running in WSL2.
3. Confirm the custom model `gemma-hackathon` is available.
4. Start BridgeLearn from Windows.

## Related docs

- [Prerequisites](PREREQUISITES.md)
- [Pilot Run](PILOT_RUN.md)
- [Launch Quickstart](LAUNCH_QUICKSTART.md)

## Why WSL2 for Ollama and the local model

We run Ollama inside an isolated WSL2 environment for several practical and security reasons:

- **Isolation:** WSL2 provides a lightweight VM boundary that keeps model binaries, runtimes, and large artifacts separated from the Windows host filesystem by default.
- **Reproducibility:** A well-defined Linux runtime in WSL2 makes onboarding consistent across developer machines and reduces "works on my machine" issues during the hackathon.
- **Data privacy & security:** Keeping model artifacts and inference traffic inside the VM reduces accidental exposure of sensitive data to host processes, and limits the blast radius if an untrusted package behaves unexpectedly.
- **Resource control & snapshotting:** WSL2 allows you to manage disk and memory usage, create exportable VM snapshots, and keep large model files out of the host OS image.

For a deeper explanation and suggested wording to include in hackathon materials, see [WSL2 Rationale](WSL2_RATIONALE.md).
