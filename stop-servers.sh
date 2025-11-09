#!/bin/bash

# Quick script to stop all servers

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

BACKEND_PID_FILE="$SCRIPT_DIR/backend.pid"
FRONTEND_PID_FILE="$SCRIPT_DIR/frontend.pid"

echo "🛑 Stopping servers..."

if [ -f "$BACKEND_PID_FILE" ]; then
    BACKEND_PID=$(cat "$BACKEND_PID_FILE")
    if ps -p "$BACKEND_PID" > /dev/null 2>&1; then
        kill "$BACKEND_PID" 2>/dev/null
        echo "✅ Stopped backend server (PID: $BACKEND_PID)"
    fi
    rm -f "$BACKEND_PID_FILE"
fi

if [ -f "$FRONTEND_PID_FILE" ]; then
    FRONTEND_PID=$(cat "$FRONTEND_PID_FILE")
    if ps -p "$FRONTEND_PID" > /dev/null 2>&1; then
        kill "$FRONTEND_PID" 2>/dev/null
        echo "✅ Stopped frontend server (PID: $FRONTEND_PID)"
    fi
    rm -f "$FRONTEND_PID_FILE"
fi

# Kill any remaining processes
pkill -f "uvicorn.*8001" 2>/dev/null
pkill -f "vite.*5173" 2>/dev/null

echo "✅ All servers stopped"

