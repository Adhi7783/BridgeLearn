# WSL2 Rationale — Isolation, Privacy, and Hackathon Value

Summary
-------

This document explains why we chose WSL2 as the runtime for Ollama and the local `gemma-hackathon` model, and how that choice helps with security, reproducibility, and hackathon presentation.

Technical benefits
------------------

- Isolation: WSL2 runs a lightweight VM with its own kernel and filesystem namespaces. Model binaries, large weights, and inference runtimes remain inside that VM unless explicitly shared with the host.
- Reproducibility: Using a Linux runtime avoids Windows-specific differences (paths, tooling, build artifacts) and makes it easier for contributors to reproduce results and runtime behavior.
- Resource & lifecycle control: WSL2 makes it straightforward to control resources and export/import VM state; teams can snapshot a working environment that includes Ollama and the model for repeatable demos.
- Optional hardware access: WSL2 supports GPU passthrough on supported systems, which can be important for local acceleration without changing host configurations.

Security & privacy considerations
---------------------------------

- Reduced attack surface: Running the model server inside an isolated VM reduces the chances that a malicious library or misconfigured model will affect other Windows processes.
- Local-only inference: By keeping model artifacts and inference endpoints inside WSL2, you reduce accidental leakage of user data to other apps or to cloud services unless explicitly configured.
- Controlled sharing: Network and file sharing between WSL2 and Windows is explicit; sensitive directories can be kept inside the VM and excluded from shared mounts.

Operational and collaboration benefits
-------------------------------------

- Faster onboarding: With a documented WSL2 image and a short setup script, new teammates can get a matching environment quickly.
- Easier debugging: Logs, package versions, and kernel messages are consistent across developers using the same WSL2 image.
- CI parity: A Linux-based dev image simplifies reproducing the environment in CI or containerized builds.

Why this matters for the hackathon submission
--------------------------------------------

Including a short rationale in your hackathon README or demo notes adds value:

- Shows responsibility: Judges and reviewers appreciate teams that consider privacy and security, especially when working with local models and potentially sensitive data.
- Reduces friction for judges: Clear instructions about WSL2 reduce setup questions and increase the chance the demo runs smoothly during evaluation.
- Demonstrates reproducibility: Documenting the runtime choice signals that your demo can be replicated by others, improving credibility.

Suggested short wording for a submission or README
-------------------------------------------------

"We run Ollama inside an isolated WSL2 environment to keep large model artifacts and inference traffic separated from the host OS. This improves reproducibility, reduces accidental data exposure during demos, and makes onboarding reviewers and teammates faster. Detailed setup notes are in the repository under `docs/WSL2_RATIONALE.md`."

How to include in slides or submission notes
-----------------------------------------

- One slide bullet: "Local model runs in isolated WSL2 VM — reproducible, private, and easy to snapshot."
- Demo notes: Include the single-line suggested wording above and a pointer to `docs/WSL2_RATIONALE.md` for reviewers who want the security details.

Further reading and links
-------------------------

- Official WSL docs: https://learn.microsoft.com/windows/wsl
- Ollama and local model hosting notes: see the repository `docs` folder.
