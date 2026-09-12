@echo off
setlocal EnableDelayedExpansion
chcp 65001 >nul
title RAG 知识库问答 - 一键启动
cd /d "%~dp0"

set "BACK_PORT=8000"
set "FRONT_PORT=3100"
set "PY=C:\Users\HUAWEI\AppData\Local\Programs\Python\Python313\python.exe"

REM ============================================================
REM 0. 环境预检
REM ============================================================
if not exist "%PY%" (
    echo [错误] 未找到 Python: %PY%
    echo 请把脚本顶部的 PY 变量改成你本机的 python.exe 路径。
    pause
    exit /b 1
)
where npm.cmd >nul 2>nul
if errorlevel 1 (
    echo [错误] 未找到 npm，请先安装 Node.js: https://nodejs.org
    pause
    exit /b 1
)
if not exist "frontend\node_modules\next" (
    echo [提示] 首次运行，正在安装前端依赖，约需 1-2 分钟...
    pushd frontend
    call npm.cmd install
    if errorlevel 1 (
        popd
        echo [错误] npm install 失败，请检查网络后重试。
        pause
        exit /b 1
    )
    popd
)

REM ============================================================
REM 1. 后端：若已在运行则跳过，否则启动
REM ============================================================
set "BACK_CODE=000"
for /f %%i in ('curl.exe -s -o NUL -w "%%{http_code}" --max-time 3 http://127.0.0.1:%BACK_PORT%/api/config/defaults') do set "BACK_CODE=%%i"
if "%BACK_CODE%"=="200" (
    echo [1/2] 检测到后端已在端口 %BACK_PORT% 运行，跳过启动。
) else (
    echo [1/2] 启动 FastAPI 后端，端口 %BACK_PORT% ...
    start "rag-backend" cmd /k "cd backend && %PY% -X utf8 -m uvicorn main:app --host 0.0.0.0 --port %BACK_PORT%"
)

REM ============================================================
REM 2. 前端：自动挑选空闲端口
REM    注意：3000 常被 VMware 的 vmnat.exe 抢占，表现为浏览器
REM    一直转圈打不开页面，因此默认使用 3100。
REM ============================================================
:pick_port
netstat -ano | findstr /C:":%FRONT_PORT% " | findstr "LISTENING" >nul 2>nul
if not errorlevel 1 (
    echo [提示] 端口 %FRONT_PORT% 已被占用，尝试下一个端口...
    set /a FRONT_PORT+=1
    if %FRONT_PORT% GEQ 3110 (
        echo [错误] 3100-3109 端口均被占用，请手动调整脚本中的 FRONT_PORT。
        pause
        exit /b 1
    )
    goto pick_port
)
echo [2/2] 启动 Next.js 前端，端口 %FRONT_PORT% ...
start "rag-frontend" cmd /k "cd frontend && npm.cmd run dev -- -p %FRONT_PORT%"

REM ============================================================
REM 3. 健康检查：等服务真正可访问后再打开浏览器
REM    （旧脚本固定等 8 秒就开浏览器，首次编译没完成时
REM      会打开一个打不开的页面）
REM ============================================================
echo.
echo 正在等待服务就绪，首次编译可能需要几十秒，请稍候...

set /a WAITED=0
:wait_backend
if %WAITED% GEQ 60 (
    echo [警告] 后端 60 秒内未就绪，请查看 rag-backend 窗口中的报错。
    pause
    exit /b 1
)
curl.exe -s -o NUL --max-time 2 http://127.0.0.1:%BACK_PORT%/api/config/defaults
if errorlevel 1 (
    set /a WAITED+=2
    timeout /t 2 /nobreak >nul
    goto wait_backend
)
echo √ 后端就绪

set /a WAITED=0
:wait_frontend
if %WAITED% GEQ 180 (
    echo [警告] 前端 180 秒内未就绪，请查看 rag-frontend 窗口中的报错。
    echo 也可以稍后手动访问 http://localhost:%FRONT_PORT%
    pause
    exit /b 1
)
curl.exe -s -o NUL --max-time 3 http://127.0.0.1:%FRONT_PORT%
if errorlevel 1 (
    set /a WAITED+=3
    echo   ... 前端编译中，已等待 %WAITED% 秒
    timeout /t 3 /nobreak >nul
    goto wait_frontend
)
echo √ 前端就绪

start http://localhost:%FRONT_PORT%
echo.
echo 浏览器已打开 http://localhost:%FRONT_PORT%
echo 两个服务窗口保持开着即可使用；关闭它们 = 停止服务。
pause
exit /b 0
