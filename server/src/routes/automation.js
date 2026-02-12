import { Router } from 'express';
import {
  connectToChrome,
  disconnect,
  isConnected,
  getAutomationState,
  pauseAutomation,
  resumeAutomation,
  stopAutomation,
  resetAutomationState,
  takeScreenshot,
} from '../services/playwright.js';
import { runAutomation, getWarehouses } from '../services/sellfox.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/automation/status
 * Get current automation status
 */
router.get('/status', (req, res) => {
  try {
    const state = getAutomationState();
    const connected = isConnected();

    res.json({
      success: true,
      data: {
        ...state,
        connected,
      },
    });
  } catch (error) {
    logger.error('获取状态失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/connect
 * Connect to Chrome
 */
router.post('/connect', async (req, res) => {
  try {
    const port = parseInt(req.body.port) || undefined;
    const result = await connectToChrome(port);
    res.json({ success: result.success, data: result });
  } catch (error) {
    logger.error('连接失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/disconnect
 * Disconnect from Chrome
 */
router.post('/disconnect', async (req, res) => {
  try {
    await disconnect();
    res.json({ success: true, message: '已断开连接' });
  } catch (error) {
    logger.error('断开连接失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/start
 * Start automation
 */
router.post('/start', async (req, res) => {
  try {
    const { orderIds, warehouse } = req.body;

    if (!orderIds || !Array.isArray(orderIds) || orderIds.length === 0) {
      return res.status(400).json({
        success: false,
        error: '请提供订单ID列表',
      });
    }

    if (!isConnected()) {
      return res.status(400).json({
        success: false,
        error: '请先连接到 Chrome',
      });
    }

    // Start automation in background
    runAutomation(orderIds, warehouse)
      .then((result) => {
        logger.success('自动化完成');
      })
      .catch((error) => {
        logger.error('自动化失败:', error.message);
      });

    res.json({
      success: true,
      message: '自动化已启动',
      ordersCount: orderIds.length,
    });
  } catch (error) {
    logger.error('启动自动化失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/pause
 * Pause automation
 */
router.post('/pause', (req, res) => {
  try {
    pauseAutomation();
    res.json({ success: true, message: '自动化已暂停' });
  } catch (error) {
    logger.error('暂停失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/resume
 * Resume automation
 */
router.post('/resume', (req, res) => {
  try {
    resumeAutomation();
    res.json({ success: true, message: '自动化已恢复' });
  } catch (error) {
    logger.error('恢复失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/stop
 * Stop automation
 */
router.post('/stop', (req, res) => {
  try {
    stopAutomation();
    res.json({ success: true, message: '自动化已停止' });
  } catch (error) {
    logger.error('停止失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/automation/reset
 * Reset automation state
 */
router.post('/reset', (req, res) => {
  try {
    resetAutomationState();
    res.json({ success: true, message: '状态已重置' });
  } catch (error) {
    logger.error('重置失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/automation/screenshot
 * Get current screenshot
 */
router.get('/screenshot', async (req, res) => {
  try {
    if (!isConnected()) {
      return res.status(400).json({
        success: false,
        error: '未连接到 Chrome',
      });
    }

    const screenshot = await takeScreenshot();

    if (screenshot) {
      res.json({
        success: true,
        data: {
          image: screenshot,
          timestamp: Date.now(),
        },
      });
    } else {
      res.status(500).json({
        success: false,
        error: '截图失败',
      });
    }
  } catch (error) {
    logger.error('截图失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/automation/warehouses
 * Get available warehouses
 */
router.get('/warehouses', async (req, res) => {
  try {
    const warehouses = await getWarehouses();
    res.json({ success: true, data: warehouses });
  } catch (error) {
    logger.error('获取仓库列表失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
