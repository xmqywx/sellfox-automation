import express from 'express';
import cors from 'cors';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { fileURLToPath } from 'url';

import configRoutes from './routes/config.js';
import automationRoutes from './routes/automation.js';
import excelRoutes from './routes/excel.js';
import { setupWebSocket } from './websocket/handler.js';
import { loadConfig } from './utils/config.js';
import { logger } from './utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const config = loadConfig();
const PORT = config.server?.port || 7001;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static files from client build
const clientBuildPath = path.join(__dirname, '../../client/dist');
app.use(express.static(clientBuildPath));

// API Routes
app.use('/api/config', configRoutes);
app.use('/api/automation', automationRoutes);
app.use('/api/excel', excelRoutes);

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// Serve React app for all other routes (not starting with /api)
app.get('*', (req, res) => {
  // Skip API routes
  if (req.path.startsWith('/api')) {
    return res.status(404).json({ error: 'API endpoint not found' });
  }

  const indexPath = path.join(clientBuildPath, 'index.html');

  // Check if file exists
  import('fs').then(fs => {
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      res.status(200).send(`
        <!DOCTYPE html>
        <html>
        <head>
          <title>Sellfox Automation</title>
          <style>
            body { font-family: system-ui; padding: 40px; background: #1a1a2e; color: #eee; }
            h1 { color: #00d4ff; }
            code { background: #333; padding: 2px 8px; border-radius: 4px; }
          </style>
        </head>
        <body>
          <h1>Sellfox 订单自动化工具</h1>
          <p>服务器正在运行，端口: ${PORT}</p>
          <p>[WARNING] 前端文件未找到</p>
          <p>请运行: <code>npm run build</code></p>
          <p>路径: ${indexPath}</p>
        </body>
        </html>
      `);
    }
  });
});

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocketServer({ server });
setupWebSocket(wss);

// Export for use in other modules
export { wss };

// Start server
server.listen(PORT, () => {
  logger.info(`[SERVER] 服务器已启动: http://localhost:${PORT}`);
  logger.info(`[WEBSOCKET] WebSocket 已启动: ws://localhost:${PORT}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  logger.info('收到 SIGTERM 信号，正在关闭服务器...');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  logger.info('收到 SIGINT 信号，正在关闭服务器...');
  server.close(() => {
    logger.info('服务器已关闭');
    process.exit(0);
  });
});
