import { Router } from 'express';
import multer from 'multer';
import {
  parseExcelFile,
  extractOrderIds,
  getColumns,
  getPreview,
  validateExcelFile,
  saveUploadedFile,
} from '../services/excel.js';
import { logger } from '../utils/logger.js';

const router = Router();

// Configure multer for file uploads
const storage = multer.memoryStorage();
const upload = multer({
  storage,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
  },
  fileFilter: (req, file, cb) => {
    const ext = file.originalname.toLowerCase().match(/\.[^.]+$/)?.[0];
    if (['.xlsx', '.xls'].includes(ext)) {
      cb(null, true);
    } else {
      cb(new Error('只支持 .xlsx 和 .xls 文件'));
    }
  },
});

// Store parsed data in memory (for simplicity)
let currentParsedData = null;
let currentFilePath = null;

/**
 * POST /api/excel/upload
 * Upload and parse Excel file
 */
router.post('/upload', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: '请选择文件上传',
      });
    }

    // Save file
    const filePath = saveUploadedFile(req.file);
    currentFilePath = filePath;

    // Validate file
    const validation = validateExcelFile(filePath);
    if (!validation.valid) {
      return res.status(400).json({
        success: false,
        error: validation.error,
      });
    }

    // Parse file
    currentParsedData = parseExcelFile(filePath);

    res.json({
      success: true,
      data: {
        fileName: currentParsedData.fileName,
        sheets: currentParsedData.sheets,
      },
    });
  } catch (error) {
    logger.error('上传文件失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/excel/sheets
 * Get list of sheets
 */
router.get('/sheets', (req, res) => {
  try {
    if (!currentParsedData) {
      return res.status(400).json({
        success: false,
        error: '请先上传 Excel 文件',
      });
    }

    res.json({
      success: true,
      data: currentParsedData.sheets,
    });
  } catch (error) {
    logger.error('获取工作表失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/excel/columns/:sheetName
 * Get columns for a sheet
 */
router.get('/columns/:sheetName', (req, res) => {
  try {
    if (!currentParsedData) {
      return res.status(400).json({
        success: false,
        error: '请先上传 Excel 文件',
      });
    }

    const { sheetName } = req.params;
    const columns = getColumns(currentParsedData, sheetName);

    res.json({
      success: true,
      data: columns,
    });
  } catch (error) {
    logger.error('获取列名失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/excel/preview/:sheetName
 * Get preview data for a sheet
 */
router.get('/preview/:sheetName', (req, res) => {
  try {
    if (!currentParsedData) {
      return res.status(400).json({
        success: false,
        error: '请先上传 Excel 文件',
      });
    }

    const { sheetName } = req.params;
    const limit = parseInt(req.query.limit) || 10;
    const preview = getPreview(currentParsedData, sheetName, limit);

    res.json({
      success: true,
      data: preview,
    });
  } catch (error) {
    logger.error('获取预览失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * POST /api/excel/extract-orders
 * Extract order IDs from Excel
 */
router.post('/extract-orders', (req, res) => {
  try {
    if (!currentParsedData) {
      return res.status(400).json({
        success: false,
        error: '请先上传 Excel 文件',
      });
    }

    const { sheetName, columnName } = req.body;

    if (!sheetName) {
      return res.status(400).json({
        success: false,
        error: '请选择工作表',
      });
    }

    const orderIds = extractOrderIds(currentParsedData, sheetName, columnName);

    res.json({
      success: true,
      data: {
        orderIds,
        count: orderIds.length,
      },
    });
  } catch (error) {
    logger.error('提取订单号失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * DELETE /api/excel/clear
 * Clear current parsed data
 */
router.delete('/clear', (req, res) => {
  try {
    currentParsedData = null;
    currentFilePath = null;

    res.json({
      success: true,
      message: '数据已清除',
    });
  } catch (error) {
    logger.error('清除数据失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

/**
 * GET /api/excel/status
 * Get current Excel file status
 */
router.get('/status', (req, res) => {
  try {
    if (!currentParsedData) {
      return res.json({
        success: true,
        data: {
          hasFile: false,
        },
      });
    }

    res.json({
      success: true,
      data: {
        hasFile: true,
        fileName: currentParsedData.fileName,
        sheetsCount: currentParsedData.sheets.length,
        sheets: currentParsedData.sheets,
      },
    });
  } catch (error) {
    logger.error('获取状态失败:', error.message);
    res.status(500).json({ success: false, error: error.message });
  }
});

export default router;
