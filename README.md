# Atlas AI Desktop

> **Local-First Native macOS AI Assistant for Transcription, Screen OCR, & Session Intelligence**

## Overview

Atlas AI Desktop is a lightweight native desktop app for macOS designed to capture audio sessions, transcribe them live using `whisper.cpp`, perform region-based OCR on screen content, and provide contextual AI chat using a local Ollama LLM (`llama3.2:3b`).

## Project Structure

```
atlas-ai-desktop/
├── implementation_plan.md   # Architectural overview & execution roadmap
├── README.md                # Project documentation
├── src-tauri/               # Rust backend (Tauri 2.0 core, STT bindings, OCR bridge)
├── src/                     # React + TypeScript + Vite + Tailwind frontend
└── sessions/                # Local crash-safe session storage (.gitignored)
```

## Quick Start

Refer to [implementation_plan.md](file:///Users/jalajbalodi/.gemini/antigravity-ide/scratch/atlas-ai-desktop/implementation_plan.md) for full prerequisites and setup steps.
