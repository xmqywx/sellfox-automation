@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion

:: Sellfox 订单自动化工具 - Windows 启动脚本
:: =============================================

title Sellfox 订单自动化工具

echo.
echo ╔════════════════════════════════════════════════╗
echo ║     Sellfox 订单自动化工具                     ║
echo ╚════════════════════════════════════════════════╝
echo.

:: 切换到脚本目录
cd /d "%~dp0"

:: 设置 Chrome 端口
if "%CHROME_PORT%"=="" set CHROME_PORT=9222

:: 检查 Node.js
echo [1/4] 检查 Node.js...
where node >nul 2>&1
if %ERRORLEVEL% neq 0 (
    echo 错误: 未找到 Node.js
    echo 请先安装 Node.js (版本 ^>= 18.0.0^)
    echo 下载地址: https://nodejs.org/
    pause
    exit /b 1
)

for /f "tokens=1 delims=v" %%a in ('node -v') do set NODE_VER=%%a
for /f "tokens=1 delims=." %%a in ('node -v') do set NODE_MAJOR=%%a
set NODE_MAJOR=%NODE_MAJOR:v=%

if %NODE_MAJOR% LSS 18 (
    echo 错误: Node.js 版本过低
    echo 请升级到 Node.js 18.0.0 或更高版本
    pause
    exit /b 1
)

echo Node.js 版本:
node -v

:: 安装依赖
echo.
echo [2/4] 检查依赖...

if not exist "node_modules" (
    echo 正在安装依赖...
    call npm install
    if %ERRORLEVEL% neq 0 (
        echo 安装依赖失败
        pause
        exit /b 1
    )

    echo 正在安装 Playwright...
    cd server
    call npx playwright install chromium
    cd ..
) else (
    echo 依赖已安装
)

:: 构建前端
echo.
echo [3/4] 构建前端...

if not exist "client\dist" (
    echo 正在构建前端...
    call npm run build
    if %ERRORLEVEL% neq 0 (
        echo 构建前端失败
        pause
        exit /b 1
    )
) else (
    echo 前端已构建
)

:: 检查并启动 Chrome
echo.
echo [4/4] 检查 Chrome...

:: 检查 Chrome 是否已运行
curl -s "http://127.0.0.1:%CHROME_PORT%/json/version" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Chrome 已在端口 %CHROME_PORT% 运行
    goto start_server
)

:: 查找 Chrome 路径
set CHROME_PATH=

if exist "C:\Program Files\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files\Google\Chrome\Application\chrome.exe"
)

if exist "C:\Program Files (x86)\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=C:\Program Files (x86)\Google\Chrome\Application\chrome.exe"
)

if exist "%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe" (
    set "CHROME_PATH=%LOCALAPPDATA%\Google\Chrome\Application\chrome.exe"
)

if "%CHROME_PATH%"=="" (
    echo 提示: 未找到 Chrome，请手动启动 Chrome
    echo 启动命令: chrome --remote-debugging-port=%CHROME_PORT%
    goto start_server
)

echo 正在启动 Chrome (调试端口: %CHROME_PORT%^)...
start "" "%CHROME_PATH%" --remote-debugging-port=%CHROME_PORT% --no-first-run --no-default-browser-check

:: 等待 Chrome 启动
timeout /t 3 /nobreak >nul

curl -s "http://127.0.0.1:%CHROME_PORT%/json/version" >nul 2>&1
if %ERRORLEVEL% equ 0 (
    echo Chrome 已启动
) else (
    echo Chrome 可能未成功启动，请手动检查
)

:start_server
echo.
echo ════════════════════════════════════════════════
echo   启动服务器...
echo ════════════════════════════════════════════════
echo.
echo   访问地址: http://localhost:7001
echo.
echo   按 Ctrl+C 停止服务器
echo.

:: 延迟打开浏览器
start /b cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:7001"

:: 启动服务器
call npm run start

pause
