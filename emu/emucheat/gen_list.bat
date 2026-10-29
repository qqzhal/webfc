@echo off
rem Regenerate emucheat\list.json from the *.cht files in this folder.
rem Put your own .cht files here, run this script, then refresh the emulator page.
cd /d "%~dp0"
set PYTHONIOENCODING=utf-8
where python >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Python not found. Install Python 3 first.
  pause
  exit /b 1
)
python gen_list.py %*
if errorlevel 1 (
  echo.
  echo [ERROR] gen_list.py failed.
  pause
  exit /b 1
)
pause
