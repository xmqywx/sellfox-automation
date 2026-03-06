import { chromium } from 'playwright';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { isChomeDebugPortOpen } from './chrome.js';

let browser = null;
let context = null;
let page = null;
let screenshotInterval = null;
let automationState = {
  status: 'idle', // idle, running, paused, stopped, error
  currentStep: '',
  progress: 0,
  totalSteps: 0,
  error: null,
};

// Event emitter for WebSocket
let eventCallback = null;

/**
 * Set event callback for WebSocket communication
 * @param {Function} callback - Callback function to emit events
 */
export function setEventCallback(callback) {
  eventCallback = callback;
}

/**
 * Emit event to WebSocket clients
 * @param {string} type - Event type
 * @param {Object} data - Event data
 */
function emitEvent(type, data) {
  if (eventCallback) {
    eventCallback(type, data);
  }
}

/**
 * Connect to existing Chrome instance via CDP
 * @param {number} port - Chrome debug port
 * @returns {Promise<Object>} Connection result
 */
export async function connectToChrome(port = 9222) {
  const config = loadConfig();
  const debugPort = port || config.chrome?.debugPort || 9222;

  try {
    // Check if Chrome is running
    const isRunning = await isChomeDebugPortOpen(debugPort);
    if (!isRunning) {
      throw new Error(`Chrome 未在端口 ${debugPort} 运行`);
    }

    // Connect to Chrome via CDP
    logger.info(`正在连接到 Chrome CDP: http://127.0.0.1:${debugPort}`);
    browser = await chromium.connectOverCDP(`http://127.0.0.1:${debugPort}`);
    logger.success(`已连接到 Chrome (端口: ${debugPort})`);

    // Get existing contexts and find the best page
    const contexts = browser.contexts();
    logger.info(`找到 ${contexts.length} 个浏览器上下文`);

    if (contexts.length > 0) {
      context = contexts[0];
      const pages = context.pages();
      logger.info(`找到 ${pages.length} 个页面`);

      // Log all pages for debugging
      pages.forEach((p, i) => {
        try {
          const url = p.url();
          logger.info(`页面 ${i}: ${url}`);
        } catch (e) {
          logger.info(`页面 ${i}: (无法获取URL)`);
        }
      });

      // Prefer Sellfox page if available
      let selectedPage = null;
      for (const p of pages) {
        try {
          const url = p.url();
          if (url && (url.includes('sellfox') || url.includes('orderShip'))) {
            selectedPage = p;
            logger.info(`选择 Sellfox 页面: ${url}`);
            break;
          }
        } catch {
          continue;
        }
      }

      // Otherwise use first non-internal page (skip chrome:// pages)
      if (!selectedPage && pages.length > 0) {
        for (const p of pages) {
          try {
            const url = p.url();
            if (url && !url.startsWith('chrome://') && !url.startsWith('devtools://') && !url.startsWith('about:')) {
              selectedPage = p;
              logger.info(`使用非内部页面: ${url}`);
              break;
            }
          } catch {
            continue;
          }
        }
        // If all pages are internal, use the last one (most likely the real tab)
        if (!selectedPage) {
          selectedPage = pages[pages.length - 1];
          logger.info(`所有页面都是内部页面，使用最后一个页面`);
        }
      }

      page = selectedPage;

      // Set up page event listeners for debugging
      if (page) {
        page.on('console', msg => {
          if (msg.type() === 'error') {
            logger.info(`[页面控制台错误] ${msg.text()}`);
          }
        });

        page.on('pageerror', err => {
          logger.info(`[页面错误] ${err.message}`);
        });
      }
    }

    // If no page found, create one
    if (!page && context) {
      logger.info('没有找到现有页面，创建新页面...');
      page = await context.newPage();
    }

    emitEvent('status', { status: 'connected', port: debugPort });

    return {
      success: true,
      message: '已连接到 Chrome',
      port: debugPort,
      pagesCount: context?.pages()?.length || 0,
    };
  } catch (error) {
    logger.error('连接 Chrome 失败:', error.message);
    logger.error('错误详情:', error.stack);
    emitEvent('error', { message: error.message });
    return {
      success: false,
      message: `连接失败: ${error.message}`,
      port: debugPort,
    };
  }
}

/**
 * Disconnect from Chrome
 */
export async function disconnect() {
  stopScreenshotCapture();

  if (browser) {
    try {
      await browser.close();
    } catch {
      // Browser might already be closed
    }
    browser = null;
    context = null;
    page = null;
  }

  automationState = {
    status: 'idle',
    currentStep: '',
    progress: 0,
    totalSteps: 0,
    error: null,
  };

  emitEvent('status', { status: 'disconnected' });
  logger.info('已断开与 Chrome 的连接');
}

/**
 * Get current page
 * @returns {Object|null} Current page
 */
export function getPage() {
  return page;
}

/**
 * Set current page
 * @param {Object} newPage - Page to set as current
 */
export function setPage(newPage) {
  page = newPage;
}

/**
 * Get browser instance
 * @returns {Object|null} Browser instance
 */
export function getBrowser() {
  return browser;
}

/**
 * Get context
 * @returns {Object|null} Browser context
 */
export function getContext() {
  return context;
}

/**
 * Check if connected
 * @returns {boolean} Whether connected to Chrome
 */
export function isConnected() {
  return browser !== null && browser.isConnected();
}

/**
 * Navigate to URL
 * @param {string} url - URL to navigate to
 * @returns {Promise<Object>} Navigation result
 */
export async function navigateTo(url) {
  if (!page) {
    throw new Error('没有可用的页面');
  }

  try {
    await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
    logger.info(`已导航到: ${url}`);
    return { success: true, url };
  } catch (error) {
    logger.error(`导航失败: ${error.message}`);
    throw error;
  }
}

/**
 * Take screenshot of current page
 * @returns {Promise<string>} Base64 encoded screenshot
 */
export async function takeScreenshot() {
  if (!page) {
    return null;
  }

  try {
    const buffer = await page.screenshot({
      type: 'jpeg',
      quality: 60,
      fullPage: false,
      timeout: 5000,
    });
    return buffer.toString('base64');
  } catch (error) {
    logger.error(`截图失败: ${error.message}`);
    return null;
  }
}

/**
 * Start periodic screenshot capture
 * @param {number} interval - Interval in milliseconds
 */
export function startScreenshotCapture(interval = 1000) {
  stopScreenshotCapture();

  let taking = false;
  screenshotInterval = setInterval(async () => {
    if (taking) return; // Skip if previous screenshot still in progress
    if (isConnected() && page) {
      taking = true;
      try {
        const screenshot = await takeScreenshot();
        if (screenshot) {
          emitEvent('screenshot', { image: screenshot, timestamp: Date.now() });
        }
      } finally {
        taking = false;
      }
    }
  }, interval);

  logger.info(`已启动截图捕获 (间隔: ${interval}ms)`);
}

/**
 * Stop screenshot capture
 */
export function stopScreenshotCapture() {
  if (screenshotInterval) {
    clearInterval(screenshotInterval);
    screenshotInterval = null;
    logger.info('已停止截图捕获');
  }
}

/**
 * Get automation state
 * @returns {Object} Current automation state
 */
export function getAutomationState() {
  return { ...automationState };
}

/**
 * Update automation state
 * @param {Object} updates - State updates
 */
export function updateAutomationState(updates) {
  automationState = { ...automationState, ...updates };
  emitEvent('progress', automationState);
}

/**
 * Execute a step with logging and error handling
 * @param {string} stepName - Name of the step
 * @param {Function} stepFn - Step function to execute
 * @returns {Promise<any>} Step result
 */
export async function executeStep(stepName, stepFn) {
  const config = loadConfig();

  updateAutomationState({
    currentStep: stepName,
    progress: automationState.progress + 1,
  });

  emitEvent('log', {
    type: 'info',
    message: `执行: ${stepName}`,
    timestamp: Date.now(),
  });

  try {
    // Check if paused or stopped
    while (automationState.status === 'paused') {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }

    if (automationState.status === 'stopped') {
      throw new Error('自动化已停止');
    }

    const result = await stepFn();

    emitEvent('log', {
      type: 'success',
      message: `完成: ${stepName}`,
      timestamp: Date.now(),
    });

    // Delay between steps
    await new Promise((resolve) =>
      setTimeout(resolve, config.sellfox?.operationDelay || 500)
    );

    return result;
  } catch (error) {
    emitEvent('log', {
      type: 'error',
      message: `失败: ${stepName} - ${error.message}`,
      timestamp: Date.now(),
    });
    throw error;
  }
}

/**
 * Pause automation
 */
export function pauseAutomation() {
  if (automationState.status === 'running') {
    automationState.status = 'paused';
    emitEvent('status', { status: 'paused' });
    logger.info('自动化已暂停');
  }
}

/**
 * Resume automation
 */
export function resumeAutomation() {
  if (automationState.status === 'paused') {
    automationState.status = 'running';
    emitEvent('status', { status: 'running' });
    logger.info('自动化已恢复');
  }
}

/**
 * Stop automation
 */
export function stopAutomation() {
  automationState.status = 'stopped';
  stopScreenshotCapture();
  emitEvent('status', { status: 'stopped' });
  logger.info('自动化已停止');
}

/**
 * Reset automation state
 */
export function resetAutomationState() {
  automationState = {
    status: 'idle',
    currentStep: '',
    progress: 0,
    totalSteps: 0,
    error: null,
  };
  emitEvent('status', { status: 'idle' });
}

export default {
  setEventCallback,
  connectToChrome,
  disconnect,
  getPage,
  setPage,
  getBrowser,
  getContext,
  isConnected,
  navigateTo,
  takeScreenshot,
  startScreenshotCapture,
  stopScreenshotCapture,
  getAutomationState,
  updateAutomationState,
  executeStep,
  pauseAutomation,
  resumeAutomation,
  stopAutomation,
  resetAutomationState,
};
