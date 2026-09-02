@echo off
setlocal EnableExtensions

set "SCRIPT_DIR=%~dp0"
set "CLI=%SCRIPT_DIR%lib\bin.js"

if not exist "%CLI%" (
  echo [ERROR] Missing "%CLI%".
  echo Run pnpm run build from this directory first.
  pause
  exit /b 1
)

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js 22.19 or newer is required but was not found on PATH.
  pause
  exit /b 1
)

if not defined WORKBUDDY_PROXY_API_KEY (
  set "WORKBUDDY_PROXY_API_KEY=wb-local"
  echo [INFO] WORKBUDDY_PROXY_API_KEY is not set; using local key: wb-local
)

node "%CLI%" serve
set "EXIT_CODE=%ERRORLEVEL%"

if not "%EXIT_CODE%"=="0" pause
exit /b %EXIT_CODE%
