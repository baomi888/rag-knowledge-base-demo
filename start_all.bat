@echo off
setlocal
title RAG Knowledge Base - Launcher
cd /d "%~dp0"

set "BACK_PORT=8000"
set "FRONT_PORT=3100"
set "PY=C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe"

REM ---- 0. pre-checks (ASCII only: safe under any codepage) ----
if not exist "%PY%" (
    echo [ERROR] Python not found: %PY%
    echo Edit the PY variable at the top of this script.
    pause
    exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo [ERROR] npm.cmd not found. Please install Node.js first.
    pause
    exit /b 1
)
if not exist "frontend\node_modules\next" (
    echo [INFO] First run: installing frontend dependencies...
    pushd frontend
    call npm.cmd install
    if errorlevel 1 (
        popd
        echo [ERROR] npm install failed. Check network and retry.
        pause
        exit /b 1
    )
    popd
)

REM ---- 1. backend: skip if already running ----
set "BACK_CODE=000"
for /f %%i in ('curl.exe -s -o NUL -w "%%{http_code}" --max-time 3 http://127.0.0.1:%BACK_PORT%/api/config/defaults') do set "BACK_CODE=%%i"
if "%BACK_CODE%"=="200" (
    echo [1/2] Backend already running on port %BACK_PORT%, skip.
) else (
    echo [1/2] Starting FastAPI backend on port %BACK_PORT% ...
    start "rag-backend" cmd /k "cd /d %~dp0backend && %PY% -X utf8 -m uvicorn main:app --host 0.0.0.0 --port %BACK_PORT%"
)

REM ---- 2. frontend ----
netstat -ano | findstr /C:":%FRONT_PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [INFO] Port %FRONT_PORT% busy, using 3101 instead.
    set "FRONT_PORT=3101"
)
echo [2/2] Starting Next.js frontend on port %FRONT_PORT% ...
start "rag-frontend" cmd /k "cd /d %~dp0frontend && npm.cmd run dev -- -p %FRONT_PORT%"

REM ---- 3. wait until ready, then open browser ----
echo.
echo Waiting for services (first compile may take a while)...

set /a WAITED=0
:wait_backend
if %WAITED% GEQ 60 (
    echo [WARN] Backend not ready in 60s. Check the rag-backend window.
    pause
    exit /b 1
)
curl.exe -s -o NUL --max-time 2 http://127.0.0.1:%BACK_PORT%/api/config/defaults
if errorlevel 1 (
    set /a WAITED+=2
    timeout /t 2 /nobreak >nul
    goto wait_backend
)
echo [OK] Backend is ready.

set /a WAITED=0
:wait_frontend
if %WAITED% GEQ 180 (
    echo [WARN] Frontend not ready in 180s. Check the rag-frontend window.
    echo You can also open http://localhost:%FRONT_PORT% later.
    pause
    exit /b 1
)
curl.exe -s -o NUL --max-time 3 http://127.0.0.1:%FRONT_PORT%
if errorlevel 1 (
    set /a WAITED+=3
    echo   ... compiling frontend, waited %WAITED%s
    timeout /t 3 /nobreak >nul
    goto wait_frontend
)
echo [OK] Frontend is ready.

start http://localhost:%FRONT_PORT%
echo.
echo Browser opened: http://localhost:%FRONT_PORT%
echo Keep both service windows open. Closing them stops the services.
pause
exit /b 0
