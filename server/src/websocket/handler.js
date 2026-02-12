import { setEventCallback as setPlaywrightCallback } from '../services/playwright.js';
import { setEventCallback as setSellfoxCallback } from '../services/sellfox.js';
import { logger } from '../utils/logger.js';

let clients = new Set();

/**
 * Setup WebSocket server
 * @param {WebSocketServer} wss - WebSocket server instance
 */
export function setupWebSocket(wss) {
  // Set up event callbacks for services
  const emitToClients = (type, data) => {
    broadcast({ type, data, timestamp: Date.now() });
  };

  setPlaywrightCallback(emitToClients);
  setSellfoxCallback(emitToClients);

  wss.on('connection', (ws, req) => {
    const clientId = Date.now().toString(36) + Math.random().toString(36).substr(2);
    clients.add(ws);

    logger.info(`WebSocket 客户端已连接: ${clientId} (总数: ${clients.size})`);

    // Send welcome message
    ws.send(
      JSON.stringify({
        type: 'connected',
        data: { clientId, message: '已连接到服务器' },
        timestamp: Date.now(),
      })
    );

    // Handle messages
    ws.on('message', (message) => {
      try {
        const data = JSON.parse(message.toString());
        handleMessage(ws, data);
      } catch (error) {
        logger.error('解析 WebSocket 消息失败:', error.message);
        ws.send(
          JSON.stringify({
            type: 'error',
            data: { message: '无效的消息格式' },
            timestamp: Date.now(),
          })
        );
      }
    });

    // Handle close
    ws.on('close', () => {
      clients.delete(ws);
      logger.info(`WebSocket 客户端已断开 (剩余: ${clients.size})`);
    });

    // Handle error
    ws.on('error', (error) => {
      logger.error('WebSocket 错误:', error.message);
      clients.delete(ws);
    });

    // Heartbeat
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });
  });

  // Heartbeat interval
  const heartbeatInterval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) {
        clients.delete(ws);
        return ws.terminate();
      }
      ws.isAlive = false;
      ws.ping();
    });
  }, 30000);

  wss.on('close', () => {
    clearInterval(heartbeatInterval);
  });
}

/**
 * Handle incoming WebSocket message
 * @param {WebSocket} ws - WebSocket client
 * @param {Object} data - Message data
 */
function handleMessage(ws, data) {
  const { type, payload } = data;

  switch (type) {
    case 'ping':
      ws.send(
        JSON.stringify({
          type: 'pong',
          timestamp: Date.now(),
        })
      );
      break;

    case 'subscribe':
      // Handle subscription to specific events
      logger.info(`客户端订阅: ${payload?.events?.join(', ') || 'all'}`);
      ws.subscriptions = payload?.events || ['all'];
      break;

    case 'unsubscribe':
      ws.subscriptions = [];
      break;

    default:
      logger.warn(`未知的 WebSocket 消息类型: ${type}`);
  }
}

/**
 * Broadcast message to all connected clients
 * @param {Object} message - Message to broadcast
 */
export function broadcast(message) {
  const messageStr = JSON.stringify(message);

  clients.forEach((client) => {
    if (client.readyState === 1) {
      // WebSocket.OPEN
      try {
        // Check if client is subscribed to this event type
        const subscriptions = client.subscriptions || ['all'];
        if (
          subscriptions.includes('all') ||
          subscriptions.includes(message.type)
        ) {
          client.send(messageStr);
        }
      } catch (error) {
        logger.error('发送 WebSocket 消息失败:', error.message);
      }
    }
  });
}

/**
 * Send log message to all clients
 * @param {string} level - Log level (info, success, warn, error)
 * @param {string} message - Log message
 */
export function sendLog(level, message) {
  broadcast({
    type: 'log',
    data: {
      type: level,
      message,
      timestamp: Date.now(),
    },
  });
}

/**
 * Send screenshot to all clients
 * @param {string} image - Base64 encoded image
 */
export function sendScreenshot(image) {
  broadcast({
    type: 'screenshot',
    data: {
      image,
      timestamp: Date.now(),
    },
  });
}

/**
 * Send progress update to all clients
 * @param {Object} progress - Progress data
 */
export function sendProgress(progress) {
  broadcast({
    type: 'progress',
    data: progress,
  });
}

/**
 * Send status update to all clients
 * @param {string} status - Status string
 */
export function sendStatus(status) {
  broadcast({
    type: 'status',
    data: { status },
  });
}

/**
 * Send error to all clients
 * @param {string} error - Error message
 */
export function sendError(error) {
  broadcast({
    type: 'error',
    data: { message: error },
  });
}

/**
 * Get connected client count
 * @returns {number} Number of connected clients
 */
export function getClientCount() {
  return clients.size;
}

export default {
  setupWebSocket,
  broadcast,
  sendLog,
  sendScreenshot,
  sendProgress,
  sendStatus,
  sendError,
  getClientCount,
};
