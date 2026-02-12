/**
 * Excel Reader Module
 * Reads order IDs from Excel files
 */

const XLSX = require('xlsx');
const fs = require('fs');
const path = require('path');

/**
 * Logger utility
 */
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`),
};

/**
 * Read Excel file and extract order IDs
 * @param {string} filePath - Path to the Excel file
 * @param {string} columnName - Name of the column containing order IDs
 * @returns {Promise<string[]>} Array of order IDs
 */
async function readOrderIds(filePath, columnName) {
  logger.info(`Reading Excel file: ${filePath}`);

  // Check if file exists
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  try {
    // Read the workbook
    const workbook = XLSX.readFile(filePath);

    // Get the first sheet
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      throw new Error('Excel file has no sheets');
    }

    logger.info(`Reading sheet: ${sheetName}`);
    const worksheet = workbook.Sheets[sheetName];

    // Convert to JSON
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

    if (data.length === 0) {
      throw new Error('Excel sheet is empty');
    }

    logger.info(`Found ${data.length} rows in Excel`);

    // Get available columns for debugging
    const availableColumns = Object.keys(data[0]);
    logger.debug(`Available columns: ${availableColumns.join(', ')}`);

    // Find the order ID column (try exact match first, then partial match)
    let actualColumnName = columnName;
    if (!availableColumns.includes(columnName)) {
      // Try to find a column that contains the specified name
      const matchingColumn = availableColumns.find(
        (col) => col.includes(columnName) || columnName.includes(col)
      );
      if (matchingColumn) {
        logger.warn(`Column "${columnName}" not found, using "${matchingColumn}" instead`);
        actualColumnName = matchingColumn;
      } else {
        throw new Error(
          `Column "${columnName}" not found. Available columns: ${availableColumns.join(', ')}`
        );
      }
    }

    // Extract order IDs
    const orderIds = data
      .map((row) => {
        const value = row[actualColumnName];
        return value ? String(value).trim() : '';
      })
      .filter((id) => {
        // Filter out empty values and validate order ID format
        if (!id) return false;
        // Sellfox order IDs typically start with P and contain alphanumeric characters
        // Example: P25S5C8H37812
        return /^P[A-Z0-9]+$/i.test(id);
      });

    if (orderIds.length === 0) {
      throw new Error('No valid order IDs found in Excel file');
    }

    // Remove duplicates
    const uniqueOrderIds = [...new Set(orderIds)];
    if (uniqueOrderIds.length !== orderIds.length) {
      logger.warn(
        `Removed ${orderIds.length - uniqueOrderIds.length} duplicate order IDs`
      );
    }

    logger.info(`Found ${uniqueOrderIds.length} unique order IDs`);
    return uniqueOrderIds;
  } catch (error) {
    if (error.message.includes('not found') || error.message.includes('Column')) {
      throw error;
    }
    throw new Error(`Failed to read Excel file: ${error.message}`);
  }
}

/**
 * Get Excel file info
 * @param {string} filePath - Path to the Excel file
 * @returns {Object} File info including sheets and columns
 */
function getExcelInfo(filePath) {
  if (!fs.existsSync(filePath)) {
    throw new Error(`Excel file not found: ${filePath}`);
  }

  const workbook = XLSX.readFile(filePath);
  const sheets = workbook.SheetNames.map((sheetName) => {
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });
    const columns = data.length > 0 ? Object.keys(data[0]) : [];
    return {
      name: sheetName,
      rowCount: data.length,
      columns,
    };
  });

  return {
    fileName: path.basename(filePath),
    sheets,
  };
}

module.exports = {
  readOrderIds,
  getExcelInfo,
};
