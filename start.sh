#!/bin/bash

# Sellfox 订单自动化工具 - macOS/Linux 启动脚本
# =============================================

set -e

# 颜色定义
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# 项目目录
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BLUE}"
echo "╔════════════════════════════════════════════════╗"
echo "║     Sellfox 订单自动化工具                     ║"
echo "╚════════════════════════════════════════════════╝"
echo -e "${NC}"

# 检查 Node.js
check_node() {
    echo -e "${YELLOW}[1/4] 检查 Node.js...${NC}"

    if ! command -v node &> /dev/null; then
        echo -e "${RED}错误: 未找到 Node.js${NC}"
        echo "请先安装 Node.js (版本 >= 18.0.0)"
        echo "下载地址: https://nodejs.org/"
        exit 1
    fi

    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt 18 ]; then
        echo -e "${RED}错误: Node.js 版本过低 (当前: $(node -v))${NC}"
        echo "请升级到 Node.js 18.0.0 或更高版本"
        exit 1
    fi

    echo -e "${GREEN}Node.js 版本: $(node -v)${NC}"
}

# 安装依赖
install_deps() {
    echo -e "${YELLOW}[2/4] 检查依赖...${NC}"

    if [ ! -d "node_modules" ] || [ ! -d "server/node_modules" ] || [ ! -d "client/node_modules" ]; then
        echo "正在安装依赖..."
        npm install

        # 安装 Playwright 浏览器
        echo "正在安装 Playwright..."
        cd server
        npx playwright install chromium
        cd ..
    else
        echo -e "${GREEN}依赖已安装${NC}"
    fi
}

# 构建前端
build_client() {
    echo -e "${YELLOW}[3/4] 构建前端...${NC}"

    if [ ! -d "client/dist" ]; then
        echo "正在构建前端..."
        npm run build
    else
        echo -e "${GREEN}前端已构建${NC}"
    fi
}

# 启动 Chrome
start_chrome() {
    echo -e "${YELLOW}[4/4] 检查 Chrome...${NC}"

    CHROME_PORT=${CHROME_PORT:-9222}

    # 检查 Chrome 是否已在运行
    if curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1; then
        echo -e "${GREEN}Chrome 已在端口 ${CHROME_PORT} 运行${NC}"
        return 0
    fi

    # macOS Chrome 路径
    CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"

    # Linux Chrome 路径
    if [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v google-chrome &> /dev/null; then
            CHROME_PATH="google-chrome"
        elif command -v google-chrome-stable &> /dev/null; then
            CHROME_PATH="google-chrome-stable"
        elif command -v chromium-browser &> /dev/null; then
            CHROME_PATH="chromium-browser"
        fi
    fi

    if [ ! -f "$CHROME_PATH" ] && ! command -v "$CHROME_PATH" &> /dev/null; then
        echo -e "${YELLOW}提示: 未找到 Chrome，请手动启动 Chrome${NC}"
        echo "启动命令: chrome --remote-debugging-port=${CHROME_PORT}"
        return 0
    fi

    echo "正在启动 Chrome (调试端口: ${CHROME_PORT})..."

    "$CHROME_PATH" \
        --remote-debugging-port=${CHROME_PORT} \
        --no-first-run \
        --no-default-browser-check \
        &>/dev/null &

    # 等待 Chrome 启动
    sleep 2

    if curl -s "http://127.0.0.1:${CHROME_PORT}/json/version" > /dev/null 2>&1; then
        echo -e "${GREEN}Chrome 已启动${NC}"
    else
        echo -e "${YELLOW}Chrome 可能未成功启动，请手动检查${NC}"
    fi
}

# 启动服务器
start_server() {
    echo ""
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo -e "${GREEN}  启动服务器...${NC}"
    echo -e "${GREEN}════════════════════════════════════════════════${NC}"
    echo ""
    echo -e "  访问地址: ${BLUE}http://localhost:7001${NC}"
    echo ""
    echo "  按 Ctrl+C 停止服务器"
    echo ""

    # 在 macOS 上自动打开浏览器
    if [[ "$OSTYPE" == "darwin"* ]]; then
        (sleep 2 && open "http://localhost:7001") &
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        (sleep 2 && xdg-open "http://localhost:7001" 2>/dev/null) &
    fi

    npm run start
}

# 主流程
main() {
    check_node
    install_deps
    build_client
    start_chrome
    start_server
}

main
