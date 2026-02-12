/**
 * Configuration module for Sellfox automation
 * Loads settings from environment variables
 */

require('dotenv').config();
const path = require('path');

const config = {
  // Excel configuration
  excel: {
    filePath: process.env.EXCEL_FILE_PATH || './data/orders.xlsx',
    orderIdColumn: process.env.ORDER_ID_COLUMN || '订单号',
  },

  // Sellfox configuration
  sellfox: {
    baseUrl: 'https://www.sellfox.com',
    orderShipUrl: 'https://www.sellfox.com/amzup-web-main/web/orderShip/index.html',
  },

  // Channel configuration
  channel: {
    name: process.env.CHANNEL_NAME || '',
  },

  // Browser configuration
  browser: {
    headless: process.env.HEADLESS === 'true',
    userDataDir: path.resolve(process.env.BROWSER_USER_DATA_DIR || './browser-data'),
    slowMo: 100, // Slow down operations for stability
    timeout: 30000, // 30 seconds timeout
  },

  // Logging configuration
  logging: {
    level: process.env.LOG_LEVEL || 'info',
  },
};

/**
 * Validate configuration
 * @returns {Object} Validation result with isValid and errors
 */
function validateConfig() {
  const errors = [];

  if (!config.excel.filePath) {
    errors.push('EXCEL_FILE_PATH is required');
  }

  if (!config.channel.name) {
    errors.push('CHANNEL_NAME is required - please set the channel to assign');
  }

  return {
    isValid: errors.length === 0,
    errors,
  };
}

/**
 * Get absolute path for Excel file
 * @returns {string} Absolute path to Excel file
 */
function getExcelPath() {
  const filePath = config.excel.filePath;
  if (path.isAbsolute(filePath)) {
    return filePath;
  }
  return path.resolve(process.cwd(), filePath);
}

module.exports = {
  config,
  validateConfig,
  getExcelPath,
};
