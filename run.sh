#!/bin/bash

# Telegram Message Deleter - Start Script (Mac/Linux)

echo "🚀 Starting Telegram Message Deleter..."

# Check if Python 3.10+ is available
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is required but not found. Please install Python 3.10 or higher."
    exit 1
fi

# Check Python version
python_version=$(python3 -c "import sys; print('.'.join(map(str, sys.version_info[:2])))")
required_version="3.10"

if [ "$(printf '%s\n' "$required_version" "$python_version" | sort -V | head -n1)" != "$required_version" ]; then
    echo "❌ Python $required_version or higher is required. Found: $python_version"
    exit 1
fi

echo "✅ Python $python_version detected"

# Create virtual environment if it doesn't exist
if [ ! -d "venv" ]; then
    echo "📦 Creating virtual environment..."
    python3 -m venv venv
fi

# Activate virtual environment
source venv/bin/activate

# Ensure pip is available in the virtual environment
echo "🔧 Ensuring pip is available..."
python3 -m ensurepip --upgrade

# Install dependencies
echo "📥 Installing dependencies..."
python3 -m pip install --upgrade pip
python3 -m pip install -r requirements.txt

# Create session directory if it doesn't exist
mkdir -p sessions

# Start the application
echo "🌐 Starting FastAPI server at http://127.0.0.1:8000"
echo "🌐 Starting React development server..."
echo "📖 Check the README.md for setup instructions"
echo ""
echo "To stop the servers, press Ctrl+C"

cd "$(dirname "$0")"

# Start Python server in background
python3 -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload &
PYTHON_PID=$!

# Wait for Python server to be ready
echo "⏳ Waiting for Python server to start..."
for i in {1..30}; do
    if curl -s http://127.0.0.1:8000/accounts > /dev/null 2>&1; then
        echo "✅ Python server is ready!"
        break
    fi
    if [ $i -eq 30 ]; then
        echo "❌ Python server failed to start after 30 seconds"
        kill $PYTHON_PID 2>/dev/null
        exit 1
    fi
    sleep 1
done

# Give Python server extra time to fully initialize
sleep 5

# Install npm dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "📦 Installing npm dependencies..."
    npm install
fi

# Start React dev server
npm run dev &
REACT_PID=$!

# Function to cleanup background processes
cleanup() {
    echo "Stopping servers..."
    kill $PYTHON_PID 2>/dev/null
    kill $REACT_PID 2>/dev/null
    exit
}

# Set trap to cleanup on script exit
trap cleanup SIGINT SIGTERM

# Wait for both processes
wait