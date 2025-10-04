fd@echo off
echo 🚀 Starting Telegram Message Deleter...

:: Check if Python is available
python --version >nul 2>&1
if %errorlevel% neq 0 (
    echo ❌ Python is required but not found. Please install Python 3.10 or higher.
    pause
    exit /b 1
)

echo ✅ Python detected

:: Create virtual environment if it doesn't exist
if not exist "venv" (
    echo 📦 Creating virtual environment...
    python -m venv venv
)

:: Activate virtual environment
call venv\Scripts\activate.bat

:: Ensure pip is available in the virtual environment
echo 🔧 Ensuring pip is available...
python -m ensurepip --upgrade

:: Install dependencies
echo 📥 Installing dependencies...
python -m pip install --upgrade pip
pip install -r requirements.txt
pip install uvicorn

:: Create session directory if it doesn't exist
if not exist "sessions" mkdir sessions

:: Start the application
echo 🌐 Starting FastAPI server at http://127.0.0.1:8000
echo 🌐 Starting React development server...
echo 📖 Check the README.md for setup instructions
echo.
echo To stop the servers, press Ctrl+C

:: Start Python server in background
start /B python -m uvicorn app.main:app --host 127.0.0.1 --port 8000 --reload

:: Wait for Python server to be ready
echo 🔄 Waiting for Python server to start...
set /a counter=0
:wait_loop
curl -s http://127.0.0.1:8000/accounts >nul 2>&1
if %errorlevel% equ 0 (
    echo ✅ Python server is ready!
    goto start_react
)
set /a counter+=1
if %counter% geq 30 (
    echo ❌ Python server failed to start within 30 seconds
    echo Please check the Python server logs above
    pause
    exit /b 1
)
timeout /t 1 /nobreak >nul
goto wait_loop

:start_react
:: Give Python server extra time to fully initialize
timeout /t 5 /nobreak >nul

:: Install npm dependencies if node_modules doesn't exist
if not exist "node_modules" (
    echo 📦 Installing npm dependencies...
    npm install
)

echo 🌐 Starting React development server...
:: Start React dev server
npm run dev

pause