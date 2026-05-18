#!/bin/bash
# GPU Real-time Monitoring
# Run this during the hackathon demo to show GPU activity during inference

echo "=== Real-time GPU Monitoring (Live) ==="
echo "Updates every 1 second. Press Ctrl+C to stop."
echo ""
echo "Columns:"
echo "  - memory.used: MB of VRAM currently used by model"
echo "  - memory.free: MB of VRAM available"
echo "  - utilization.gpu: % GPU core utilization during inference"
echo ""

if ! command -v nvidia-smi &> /dev/null; then
    echo "ERROR: nvidia-smi not found."
    exit 1
fi

# Real-time GPU monitoring
watch -n 1 "nvidia-smi --query-gpu=memory.used,memory.free,utilization.gpu --format=csv,noheader"
