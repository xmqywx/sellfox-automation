# Sellfox 订单自动化工具

一个用于自动化处理 Sellfox ERP 订单发货流程的工具。

## 功能特点

- 📊 Excel 文件拖拽上传，自动提取订单号
- 🌐 Chrome 浏览器远程调试连接
- 🤖 自动化订单处理流程
- 📺 实时浏览器截图预览
- 📝 详细运行日志
- 🎨 现代化深色/浅色主题 UI

## 环境要求

- **Node.js** >= 18.0.0
- **Google Chrome** 浏览器

## 安装

```bash
# 克隆项目
git clone https://github.com/xmqywx/sellfox-automation.git
cd sellfox-automation

# 安装依赖
npm install

# 构建前端
npm run build

# 首次运行需要安装 Playwright 浏览器驱动
npx playwright install chromium
```

## 使用方法

### 1. 启动服务

```bash
npm start
```

服务启动后访问 http://localhost:7001

### 2. 启动 Chrome（调试模式）

**macOS:**
```bash
/Applications/Google\ Chrome.app/Contents/MacOS/Google\ Chrome --remote-debugging-port=9222
```

**Windows:**
```bash
"C:\Program Files\Google\Chrome\Application\chrome.exe" --remote-debugging-port=9222
```

或者在界面中点击"启动 Chrome"按钮自动启动。

### 3. 使用流程

1. 在界面中点击"连接"按钮连接到 Chrome
2. 拖拽 Excel 文件到上传区域
3. 确认订单列表
4. 点击"开始自动化"

## 项目结构

```
sellfox-automation/
├── client/                 # 前端 React 应用
│   ├── src/
│   │   ├── components/    # UI 组件
│   │   ├── hooks/         # React Hooks
│   │   ├── services/      # API 服务
│   │   └── App.jsx        # 主应用
│   └── package.json
├── server/                 # 后端 Node.js 服务
│   ├── src/
│   │   ├── routes/        # API 路由
│   │   ├── services/      # 业务逻辑
│   │   └── index.js       # 服务入口
│   └── package.json
└── package.json           # 工作区配置
```

## 技术栈

**前端:**
- React 18
- Vite
- Lucide React (图标)

**后端:**
- Node.js + Express
- Playwright (浏览器自动化)
- WebSocket (实时通信)
- xlsx (Excel 解析)

## 开发

```bash
# 同时启动前端和后端开发服务器
npm run dev
```

## License

MIT
