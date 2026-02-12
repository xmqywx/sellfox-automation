import { Router } from 'express';
import { loadConfig, saveConfig, updateConfig, resetConfig } from '../utils/config.js';
import { getConnectionStatus, launchChrome, closeChrome } from '../services/chrome.js';
import { logger } from '../utils/logger.js';

const router = Router();

/**
 * GET /api/config
 * Get current configuration
 */
router.get('/', (req, res) => {
  try {
    const config = loadConfig();
    res.json({ success: true, data: config });
  } catch (error) {
    logger.error('获取配置失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * PUT /api/config
 * Update configuration
 */
router.put('/', (req, res) => {
  try {
    const updates = req.body;
    const success = updateConfig(updates);

    if (success) {
      const newConfig = loadConfig();
      res.json({ success: true, data: newConfig });
    } else {
      res.status(500).json({ success: false, error: '保存配置失败' });
    }
  } catch (error) {
    logger.error('更新配置失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/config/reset
 * Reset configuration to defaults
 */
router.post('/reset', (req, res) => {
  try {
    const success = resetConfig();

    if (success) {
      const config = loadConfig();
      res.json({ success: true, data: config, message: '配置已重置' });
    } else {
      res.status(500).json({ success: false, error: '重置配置失败' });
    }
  } catch (error) {
    logger.error('重置配置失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/config/chrome/status
 * Get Chrome connection status
 */
router.get('/chrome/status', async (req, res) => {
  try {
    const port = parseInt(req.query.port) || undefined;
    const status = await getConnectionStatus(port);
    res.json({ success: true, data: status });
  } catch (error) {
    logger.error('获取 Chrome 状态失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/config/chrome/launch
 * Launch Chrome with debug port
 */
router.post('/chrome/launch', async (req, res) => {
  try {
    const port = parseInt(req.body.port) || undefined;
    const result = await launchChrome(port);
    res.json({ success: result.success, data: result });
  } catch (error) {
    logger.error('启动 Chrome 失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/config/chrome/close
 * Close Chrome process
 */
router.post('/chrome/close', async (req, res) => {
  try {
    const result = await closeChrome();
    res.json({ success: result.success, data: result });
  } catch (error) {
    logger.error('关闭 Chrome 失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
