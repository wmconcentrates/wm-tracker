@echo off
title WM Tracker Local Server
cd /d "%~dp0"

echo ============================================
echo   WM Tracker Local Print Server
echo ============================================
echo.

:: Check if Node.js is installed
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo ERROR: Node.js is not installed!
    echo Download from: https://nodejs.org
    pause
    exit /b 1
)

:: Install dependencies if needed
if not exist "node_modules" (
    echo Installing dependencies...
    npm install
    echo.
)

:: Get local IP address
echo Local IP Addresses:
for /f "tokens=2 delims=:" %%a in ('ipconfig ^| findstr /c:"IPv4"') do echo   http://%%a:3000
echo.
echo Staff should connect to one of these URLs on the shop WiFi
echo.
echo ============================================
echo Press Ctrl+C to stop the server
echo ============================================
echo.

:: Start the server
node server.js
