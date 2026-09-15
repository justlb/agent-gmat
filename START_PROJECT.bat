@echo off
setlocal EnableExtensions
title GMAT Agent - local launcher

rem This file must remain in the project root. %~dp0 is its Windows folder.
rem wsl.exe --cd accepts that Windows path and opens the matching /mnt/... path.
set "PROJECT_DIR=%~dp0"

echo Starting GMAT Agent from:
echo %PROJECT_DIR%
echo.
wsl.exe -d Ubuntu --cd "%PROJECT_DIR%" python3 scripts/start_local_web.py
set "LAUNCH_EXIT_CODE=%ERRORLEVEL%"

echo.
if not "%LAUNCH_EXIT_CODE%"=="0" (
  echo The project did not start. Read the message above, correct config.json if needed, then double-click this file again.
) else (
  echo Project started. Open the Frontend URL printed above in your browser.
)
echo.
pause
exit /b %LAUNCH_EXIT_CODE%
