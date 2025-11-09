#!/bin/bash

# View backend server logs in real-time
# Run this in a Cursor terminal to see backend activity

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
LOG_FILE="$SCRIPT_DIR/logs/backend.log"

if [ ! -f "$LOG_FILE" ]; then
    echo "❌ Backend log file not found: $LOG_FILE"
    echo "💡 Make sure the backend server is running with: ./start-background.sh"
    exit 1
fi

echo "📊 Viewing backend server logs..."
echo "📍 Log file: $LOG_FILE"
echo "🛑 Press Ctrl+C to stop viewing (server will keep running)"
echo ""

tail -f "$LOG_FILE"

