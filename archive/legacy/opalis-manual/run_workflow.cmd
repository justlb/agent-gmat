@echo off
setlocal

set "BUNDLED_PYTHON=%USERPROFILE%\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"

if exist "%BUNDLED_PYTHON%" goto bundled_python

where python.exe >nul 2>nul
if not errorlevel 1 goto system_python

echo Erreur : Python 3 est introuvable. Installez Python 3 ou ajoutez python au PATH. 1>&2
exit /b 1

:system_python
python.exe "%~dp0run_workflow.py" %*
exit /b %errorlevel%

:bundled_python
"%BUNDLED_PYTHON%" "%~dp0run_workflow.py" %*
exit /b %errorlevel%
