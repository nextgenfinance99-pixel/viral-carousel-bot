@echo off
REM ── Reel Bot launcher ─────────────────────────────────────────────
REM Double-click this file to start BOTH servers in their own windows.
REM They stay running until you close those windows (independent of Claude).

echo Starting Reel Bot servers...

start "Reel Bot - BACKEND (:3001)"  cmd /k "cd /d %~dp0backend  && npm run dev"
start "Reel Bot - FRONTEND (:5190)" cmd /k "cd /d %~dp0frontend && npm run dev -- --port 5190 --strictPort"

REM Give the dev servers a moment to boot, then open the app.
timeout /t 5 /nobreak >nul
start "" "http://localhost:5190"

echo.
echo  Backend : http://localhost:3001
echo  Frontend: http://localhost:5190   (opening in your browser)
echo.
echo  Two new windows opened - leave them running. Close them to stop.
echo  You can close THIS window.
pause
