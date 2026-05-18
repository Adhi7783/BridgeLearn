#!/bin/bash
# GPU Memory Check BEFORE Loading Model
# Run this in WSL2 before starting Ollama to get baseline GPU memory

echo "=== GPU Memory Baseline (Before Model Load) ==="
echo ""

# Check if nvidia-smi is available
if ! command -v nvidia-smi &> /dev/null; then
    echo "ERROR: nvidia-smi not found. GPU/CUDA may not be installed in WSL2."
    echo "To install NVIDIA GPU support in WSL2, see: https://docs.nvidia.com/cuda/wsl-user-guide/"
    exit 1
fi

echo "GPU Device Information:"
nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader

echo ""
echo "Current GPU Memory Usage (Before Ollama/Model):"
nvidia-smi --query-gpu=index,memory.used,memory.free,memory.total --format=csv,noheader

echo ""
echo "Detailed GPU Info:"
nvidia-smi

echo ""
echo "Note this baseline memory usage. After starting Ollama and loading gemma-hackathon,"
echo "compare it with: ./gpu-check-after.sh"
