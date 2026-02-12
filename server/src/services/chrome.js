import { spawn, exec } from 'child_process';
import { promisify } from 'util';
import http from 'http';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const execAsync = promisify(exec);

// Chrome executable paths for different platforms
const chromePaths = {
  darwin: [
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Google Chrome Canary.app/Contents/MacOS/Google Chrome Canary',
    '/Applications/Chromium.app/Contents/MacOS/Chromium',
  ],
  win32: [
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    `${process.env.LOCALAPPDATA}\\Google\\Chrome\\Application\\chrome.exe`,
  ],
  linux: [
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium-browser',
    '/usr/bin/chromium',
  ],
};

let chromeProcess = null;

/**
 * Find Chrome executable path
 * @returns {string|null} Chrome executable path
 */
async function findChromePath() {
  const config = loadConfig();

  // Use configured path if provided
  if (config.chrome?.executablePath) {
    return config.chrome.executablePath;
  }

  const platform = process.platform;
  const paths = chromePaths[platform] || [];

  for (const chromePath of paths) {
    try {
      if (platform === 'win32') {
        const { stdout } = await execAsync(`if exist "${chromePath}" echo exists`);
        if (stdout.includes('exists')) {
          return chromePath;
        }
      } else {
        const { stdout } = await execAsync(`test -f "${chromePath}" && echo exists`);
        if (stdout.includes('exists')) {
          return chromePath;
        }
      }
    } catch {
      // Path doesn't exist, try next
    }
  }

  return null;
}

/**
 * Check if Chrome is running with debug port
 * @param {number} port - Debug port to check
 * @returns {Promise<boolean>} Whether Chrome is running with debug port
 */
export async function isChomeDebugPortOpen(port = 9222) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          const info = JSON.parse(data);
          resolve(info.Browser ? true : false);
        } catch {
          resolve(false);
        }
      });
    });

    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(false);
    });
  });
}

/**
 * Get Chrome debug info
 * @param {number} port - Debug port
 * @returns {Promise<Object|null>} Chrome debug info
 */
export async function getChromeDebugInfo(port = 9222) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/version`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve(null);
        }
      });
    });

    req.on('error', () => resolve(null));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve(null);
    });
  });
}

/**
 * Get list of Chrome pages/tabs
 * @param {number} port - Debug port
 * @returns {Promise<Array>} List of pages
 */
export async function getChromePages(port = 9222) {
  return new Promise((resolve) => {
    const req = http.get(`http://127.0.0.1:${port}/json/list`, (res) => {
      let data = '';
      res.on('data', (chunk) => (data += chunk));
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch {
          resolve([]);
        }
      });
    });

    req.on('error', () => resolve([]));
    req.setTimeout(3000, () => {
      req.destroy();
      resolve([]);
    });
  });
}

/**
 * Launch Chrome with remote debugging port
 * @param {number} port - Debug port to use
 * @returns {Promise<Object>} Result object with success status
 */
export async function launchChrome(port = 9222) {
  const config = loadConfig();
  const debugPort = port || config.chrome?.debugPort || 9222;

  // Check if already running
  const isRunning = await isChomeDebugPortOpen(debugPort);
  if (isRunning) {
    logger.info(`Chrome 已在端口 ${debugPort} 运行`);
    const info = await getChromeDebugInfo(debugPort);
    return {
      success: true,
      message: 'Chrome 已在运行',
      port: debugPort,
      info,
      alreadyRunning: true,
    };
  }

  // Find Chrome path
  const chromePath = await findChromePath();
  if (!chromePath) {
    return {
      success: false,
      message: '未找到 Chrome 浏览器，请安装 Chrome 或在配置中指定路径',
      port: debugPort,
    };
  }

  logger.info(`找到 Chrome: ${chromePath}`);

  // Build launch arguments
  const args = [
    `--remote-debugging-port=${debugPort}`,
    '--no-first-run',
    '--no-default-browser-check',
  ];

  // Use dedicated user data directory for debug instance
  // This allows running alongside regular Chrome
  const userDataDir = config.chrome?.userDataDir ||
    (process.platform === 'darwin'
      ? `${process.env.HOME}/Library/Application Support/Google/Chrome-Debug`
      : process.platform === 'win32'
        ? `${process.env.LOCALAPPDATA}\\Google\\Chrome-Debug`
        : `${process.env.HOME}/.config/google-chrome-debug`);

  args.push(`--user-data-dir=${userDataDir}`);

  try {
    // Launch Chrome
    chromeProcess = spawn(chromePath, args, {
      detached: true,
      stdio: 'ignore',
    });

    chromeProcess.unref();

    // Wait for Chrome to start
    let attempts = 0;
    const maxAttempts = 10;

    while (attempts < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, 500));
      const running = await isChomeDebugPortOpen(debugPort);
      if (running) {
        logger.success(`Chrome 已启动，调试端口: ${debugPort}`);
        const info = await getChromeDebugInfo(debugPort);
        return {
          success: true,
          message: 'Chrome 已成功启动',
          port: debugPort,
          info,
          alreadyRunning: false,
        };
      }
      attempts++;
    }

    return {
      success: false,
      message: 'Chrome 启动超时',
      port: debugPort,
    };
  } catch (error) {
    logger.error('启动 Chrome 失败:', error.message);
    return {
      success: false,
      message: `启动 Chrome 失败: ${error.message}`,
      port: debugPort,
    };
  }
}

/**
 * Get Chrome connection status
 * @param {number} port - Debug port to check
 * @returns {Promise<Object>} Connection status
 */
export async function getConnectionStatus(port = 9222) {
  const config = loadConfig();
  const debugPort = port || config.chrome?.debugPort || 9222;

  const isRunning = await isChomeDebugPortOpen(debugPort);

  if (!isRunning) {
    return {
      connected: false,
      port: debugPort,
      message: 'Chrome 未运行或调试端口未开启',
    };
  }

  const info = await getChromeDebugInfo(debugPort);
  const pages = await getChromePages(debugPort);

  return {
    connected: true,
    port: debugPort,
    browser: info?.Browser || 'Unknown',
    protocolVersion: info?.['Protocol-Version'] || 'Unknown',
    userAgent: info?.['User-Agent'] || 'Unknown',
    webSocketUrl: info?.webSocketDebuggerUrl || null,
    pagesCount: pages.length,
    pages: pages.map((p) => ({
      id: p.id,
      title: p.title,
      url: p.url,
      type: p.type,
    })),
  };
}

/**
 * Close Chrome process (if we launched it)
 */
export async function closeChrome() {
  if (chromeProcess) {
    try {
      chromeProcess.kill();
      chromeProcess = null;
      logger.info('Chrome 进程已关闭');
      return { success: true, message: 'Chrome 已关闭' };
    } catch (error) {
      return { success: false, message: `关闭 Chrome 失败: ${error.message}` };
    }
  }
  return { success: true, message: 'Chrome 进程不是由此程序启动的' };
}

export default {
  findChromePath,
  isChomeDebugPortOpen,
  getChromeDebugInfo,
  getChromePages,
  launchChrome,
  getConnectionStatus,
  closeChrome,
};
