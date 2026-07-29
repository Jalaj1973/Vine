#!/bin/bash
# Double-clickable macOS launcher script for Atlas AI Desktop

# Always navigate to the absolute project workspace directory
PROJECT_DIR="/Users/jalajbalodi/.gemini/antigravity-ide/scratch/atlas-ai-desktop"
cd "$PROJECT_DIR" || exit 1

export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"

# Kill any stale dev server process on port 1420 to prevent port collision
lsof -ti:1420 | xargs kill -9 2>/dev/null || true

echo "=================================================="
echo "🚀 Launching Atlas AI Desktop..."
echo "=================================================="

# Check if Ollama daemon is running, start if needed
if ! pgrep -x "ollama" > /dev/null; then
    echo "Starting Ollama AI daemon..."
    /opt/homebrew/bin/ollama serve > /dev/null 2>&1 &
    sleep 1
fi

# Launch Tauri Native Desktop App
npx tauri dev
