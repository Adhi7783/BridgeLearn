cat << 'EOF' > Modelfile
# Use your updated base name
FROM bridgelearn-gemma-4-e2b-q4:latest

# HARDWARE OPTIMIZATION
PARAMETER num_gpu 999
PARAMETER num_ctx 2048
PARAMETER num_batch 128

# RESPONSE LOGIC
PARAMETER temperature 0.3
PARAMETER top_p 0.95
PARAMETER top_k 64

SYSTEM "You are a logical AI assistant optimized for edge computing."
EOF