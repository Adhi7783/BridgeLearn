# Custom Gemma4 Model for BridgeLearn

## Goal

Use a VRAM-friendly local Gemma 4 model for the hackathon path.

## Model choice

- Base model: `batiai/gemma4-e2b:q4`
- Custom Ollama model name: `bridgelearn-gemma-4-e2b-q4`
- Base model: Google's Gemma 4 E2B (via `batiai/gemma4-e2b:q4`)
- Quantization: 4-bit (`q4`)

This choice is intended to fit your GPU more comfortably than the full precision model.

## Modelfile

```dockerfile
FROM batiai/gemma4-e2b:q4

PARAMETER num_ctx 2048
PARAMETER num_batch 128
PARAMETER num_gpu 999
PARAMETER temperature 0.3
PARAMETER top_p 0.95
PARAMETER top_k 64
PARAMETER min_p 0.0
```

## Why these settings

- `num_ctx 2048`: enough context for learning and tutoring prompts
- `num_batch 128`: good balance for consumer GPUs
- `num_gpu 999`: push all layers to GPU
- `temperature 0.3`: more precise and consistent output
- `top_p 0.95` and `top_k 64`: keep generation focused
- `min_p 0.0`: standard default

## Build the model

In WSL2:

```bash
ollama create bridgelearn-gemma-4-e2b-q4 -f ./Modelfile
```

## Verify the model

```bash
ollama list
```

You should see `bridgelearn-gemma-4-e2b-q4` in the model list.

## Use in BridgeLearn

BridgeLearn should reference the custom model name:

- `OLLAMA_MODEL=bridgelearn-gemma-4-e2b-q4`
- `OLLAMA_URL=http://localhost:11434`

## Launch behavior

- Local model is the default hackathon path
- Offline-first should stay enabled by default
- Cloud fallback should only be used when explicitly enabled

## Related docs

- [README.md](../README.md)
- [WSL2_SETUP.md](WSL2_SETUP.md)
