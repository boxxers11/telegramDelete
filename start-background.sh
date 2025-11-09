#!/bin/bash

# Telegram Message Deleter - Background Start Script
# This script runs the servers in the background so they continue running
# even after closing Cursor or the terminal

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Log directory
LOG_DIR="$SCRIPT_DIR/logs"
mkdir -p "$LOG_DIR"

# PID file directory
PID_DIR="$SCRIPT_DIR"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"

# Function to stop existing servers
stop_servers() {
    echo "🛑 Stopping existing servers..."
    
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
}

# Check if stop was requested
if [ "$1" == "stop" ]; then
    stop_servers
    exit 0
fi

# Stop existing servers first
stop_servers

# Activate virtual environment
if [ ! -d "venv" ]; then
    echo "❌ Virtual environment not found. Please run 'run.sh' first to set up."
    exit 1
fi

source venv/bin/activate

# Start backend server with nohup
echo "🚀 Starting backend server in background..."
nohup python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8001 --reload > "$LOG_DIR/backend.log" 2>&1 &
BACKEND_PID=$!
echo $BACKEND_PID > "$BACKEND_PID_FILE"
echo "✅ Backend server started (PID: $BACKEND_PID)"
echo "📝 Logs: $LOG_DIR/backend.log"

# Wait for backend to be ready
echo "⏳ Waiting for backend server to start..."
for i in {1..30}; do
    if curl -s -o /dev/null -w "%{http_code}" http://127.0.0.1:8001/accounts | grep -q "200"; then
        echo "✅ Backend server is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Backend server failed to start after 30 seconds"
        kill $BACKEND_PID 2>/dev/null
        rm -f "$BACKEND_PID_FILE"
        exit 1
    fi
    sleep 1
done

# Install npm dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

# Start frontend server with nohup
echo "🚀 Starting frontend server in background..."
nohup npm run dev > "$LOG_DIR/frontend.log" 2>&1 &
FRONTEND_PID=$!
echo $FRONTEND_PID > "$FRONTEND_PID_FILE"
echo "✅ Frontend server started (PID: $FRONTEND_PID)"
echo "📝 Logs: $LOG_DIR/frontend.log"

echo ""
echo "✅ Both servers are running in the background!"
echo ""
echo "📊 Server Status:"
echo "   Backend:  http://127.0.0.1:8001 (PID: $BACKEND_PID)"
echo "   Frontend: http://localhost:5173 (PID: $FRONTEND_PID)"
echo ""
echo "📝 View logs:"
echo "   Backend:  tail -f $LOG_DIR/backend.log"
echo "   Frontend: tail -f $LOG_DIR/frontend.log"
echo ""
echo "🛑 To stop servers, run:"
echo "   ./start-background.sh stop"
echo ""
echo "💡 Tip: You can safely close Cursor now - servers will keep running!"

