import XLSX from 'xlsx';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const UPLOADS_DIR = path.join(__dirname, '../../uploads');

// Ensure uploads directory exists
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

/**
 * Parse Excel file and extract data
 * @param {string} filePath - Path to Excel file
 * @returns {Object} Parsed data with sheets, columns, and rows
 */
export function parseExcelFile(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    const result = {
      fileName: path.basename(filePath),
      sheets: [],
      data: {},
    };

    for (const sheetName of workbook.SheetNames) {
      const worksheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json(worksheet, { header: 1 });

      if (jsonData.length === 0) {
        continue;
      }

      // First row is headers
      const headers = jsonData[0].map((h) => String(h || '').trim());
      const rows = jsonData.slice(1).filter((row) =>
        row.some((cell) => cell !== undefined && cell !== null && cell !== '')
      );

      result.sheets.push({
        name: sheetName,
        headers,
        rowCount: rows.length,
      });

      result.data[sheetName] = {
        headers,
        rows: rows.map((row) => {
          const rowObj = {};
          headers.forEach((header, index) => {
            rowObj[header] = row[index] !== undefined ? String(row[index]) : '';
          });
          return rowObj;
        }),
      };
    }

    logger.success(`解析 Excel 成功: ${result.fileName}`);
    return result;
  } catch (error) {
    logger.error(`解析 Excel 失败: ${error.message}`);
    throw new Error(`解析 Excel 失败: ${error.message}`);
  }
}

/**
 * Extract order IDs from parsed Excel data
 * @param {Object} parsedData - Parsed Excel data
 * @param {string} sheetName - Sheet name to extract from
 * @param {string} columnName - Column name containing order IDs
 * @returns {Array<string>} Array of order IDs
 */
export function extractOrderIds(parsedData, sheetName, columnName) {
  const config = loadConfig();
  const orderColumn = columnName || config.excel?.defaultOrderColumn || '订单号';

  if (!parsedData.data[sheetName]) {
    throw new Error(`工作表 "${sheetName}" 不存在`);
  }

  const sheetData = parsedData.data[sheetName];

  if (!sheetData.headers.includes(orderColumn)) {
    throw new Error(`列 "${orderColumn}" 不存在于工作表 "${sheetName}"`);
  }

  const orderIds = sheetData.rows
    .map((row) => row[orderColumn])
    .filter((id) => id && id.trim() !== '')
    .map((id) => id.trim());

  // Remove duplicates
  const uniqueOrderIds = [...new Set(orderIds)];

  logger.info(`提取到 ${uniqueOrderIds.length} 个订单号`);
  return uniqueOrderIds;
}

/**
 * Get available columns from parsed data
 * @param {Object} parsedData - Parsed Excel data
 * @param {string} sheetName - Sheet name
 * @returns {Array<string>} Array of column names
 */
export function getColumns(parsedData, sheetName) {
  if (!parsedData.data[sheetName]) {
    return [];
  }
  return parsedData.data[sheetName].headers;
}

/**
 * Get preview of data
 * @param {Object} parsedData - Parsed Excel data
 * @param {string} sheetName - Sheet name
 * @param {number} limit - Number of rows to return
 * @returns {Array<Object>} Preview rows
 */
export function getPreview(parsedData, sheetName, limit = 10) {
  if (!parsedData.data[sheetName]) {
    return [];
  }
  return parsedData.data[sheetName].rows.slice(0, limit);
}

/**
 * Validate Excel file
 * @param {string} filePath - Path to Excel file
 * @returns {Object} Validation result
 */
export function validateExcelFile(filePath) {
  const config = loadConfig();
  const supportedTypes = config.excel?.supportedTypes || ['.xlsx', '.xls'];
  const maxFileSize = (config.excel?.maxFileSize || 10) * 1024 * 1024; // Convert MB to bytes

  // Check extension
  const ext = path.extname(filePath).toLowerCase();
  if (!supportedTypes.includes(ext)) {
    return {
      valid: false,
      error: `不支持的文件类型: ${ext}。支持的类型: ${supportedTypes.join(', ')}`,
    };
  }

  // Check file size
  try {
    const stats = fs.statSync(filePath);
    if (stats.size > maxFileSize) {
      return {
        valid: false,
        error: `文件过大: ${(stats.size / 1024 / 1024).toFixed(2)} MB。最大允许: ${config.excel?.maxFileSize || 10} MB`,
      };
    }
  } catch (error) {
    return {
      valid: false,
      error: `无法读取文件: ${error.message}`,
    };
  }

  return { valid: true };
}

/**
 * Save uploaded file
 * @param {Object} file - Multer file object
 * @returns {string} Saved file path
 */
export function saveUploadedFile(file) {
  const timestamp = Date.now();
  const safeName = file.originalname.replace(/[^a-zA-Z0-9.\-_\u4e00-\u9fa5]/g, '_');
  const fileName = `${timestamp}_${safeName}`;
  const filePath = path.join(UPLOADS_DIR, fileName);

  fs.writeFileSync(filePath, file.buffer);
  logger.info(`文件已保存: ${fileName}`);

  return filePath;
}

/**
 * Clean up old uploaded files
 * @param {number} maxAge - Maximum age in milliseconds
 */
export function cleanupOldFiles(maxAge = 24 * 60 * 60 * 1000) {
  try {
    const files = fs.readdirSync(UPLOADS_DIR);
    const now = Date.now();

    for (const file of files) {
      if (file === '.gitkeep') continue;

      const filePath = path.join(UPLOADS_DIR, file);
      const stats = fs.statSync(filePath);

      if (now - stats.mtimeMs > maxAge) {
        fs.unlinkSync(filePath);
        logger.info(`已清理旧文件: ${file}`);
      }
    }
  } catch (error) {
    logger.error(`清理文件失败: ${error.message}`);
  }
}

// Clean up old files on startup
cleanupOldFiles();

export default {
  parseExcelFile,
  extractOrderIds,
  getColumns,
  getPreview,
  validateExcelFile,
  saveUploadedFile,
  cleanupOldFiles,
};
