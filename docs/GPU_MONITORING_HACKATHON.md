# GPU Monitoring for Hackathon Demo

This guide shows how to demonstrate GPU efficiency and model loading during your hackathon presentation.

## Why show GPU metrics?

- **Proves local execution**: Shows the 4-bit model is running on GPU (not cloud).
- **Demonstrates efficiency**: 4-bit quantization = small VRAM footprint.
- **Reproducible**: Same results every run — shows control and reliability.
- **Impresses reviewers**: Live metrics add credibility to your claims.

## Quick start: 3-step demo

### Step 1: Check baseline GPU memory (before Ollama)

In WSL2 terminal:

```bash
bash scripts/gpu-check-before.sh
```

**Note the "Memory Used" value** — this is your baseline (should be near 0 or low).

### Step 2: Start Ollama and load the model

In a separate WSL2 terminal:

```bash
ollama serve
# In another terminal, load the model:
ollama run bridgelearn-gemma-4-e2b-q4
# (Type a test prompt, then exit with Ctrl+C)
```

### Step 3: Check GPU memory after load

Back in your first WSL2 terminal:

```bash
bash scripts/gpu-check-after.sh
```

**Compare with baseline**: The difference shows how much VRAM `bridgelearn-gemma-4-e2b-q4` uses.

### Step 4 (optional): Live monitoring during demo

Open a third WSL2 terminal and run:

```bash
bash scripts/gpu-monitor-live.sh
```

This updates every 1 second and shows:
- **memory.used**: VRAM allocated to the model
- **memory.free**: Available VRAM
- **utilization.gpu**: GPU core % during inference

Keep this running while you send chat prompts in the BridgeLearn UI — reviewers will see GPU activity spike with each inference.

## How to make these scripts executable

In WSL2:

```bash
chmod +x scripts/gpu-check-before.sh
chmod +x scripts/gpu-check-after.sh
chmod +x scripts/gpu-monitor-live.sh
```

## Talking points for judges

- "The 4-bit quantized Gemma model uses [X]MB of VRAM — it fits entirely on consumer GPUs."
- "All inference happens locally on the GPU, no cloud calls. You can see the GPU utilization live during each prompt."
- "This offline-first approach ensures privacy and reduces latency — important for sensitive learning data."

## Troubleshooting

- **nvidia-smi not found**: NVIDIA GPU/CUDA not installed in WSL2. See https://docs.nvidia.com/cuda/wsl-user-guide/
- **Permission denied**: Run `chmod +x scripts/gpu-check-*.sh` in WSL2.
- **No GPU detected**: Ensure `wsl --update` and verify GPU passthrough is enabled in `.wslconfig` on Windows.

