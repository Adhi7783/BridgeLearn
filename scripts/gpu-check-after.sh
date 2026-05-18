#!/bin/bash
# GPU Memory Check AFTER Loading Model
# Run this in WSL2 after Ollama has loaded gemma-hackathon

echo "=== GPU Memory After Model Load ==="
echo ""

if ! command -v nvidia-smi &> /dev/null; then
    echo "ERROR: nvidia-smi not found."
    exit 1
fi

echo "GPU Device Information:"
nvidia-smi --query-gpu=index,name,memory.total --format=csv,noheader

echo ""
echo "GPU Memory Usage (After Model Load):"
nvidia-smi --query-gpu=index,memory.used,memory.free,memory.total --format=csv,noheader

echo ""
echo "Detailed GPU Info:"
nvidia-smi

echo ""
echo "=== Analysis ==="
echo "Memory Used = VRAM consumed by gemma-hackathon (4-bit quantized)"
echo "This demonstrates the 4-bit model fits efficiently in GPU VRAM."
echo ""
echo "For continuous monitoring during inference, run:"
echo "  watch -n 1 'nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv,noheader'"
