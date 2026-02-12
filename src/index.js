/**
 * Sellfox Order Channel Assignment Automation
 *
 * Main entry point for automating order channel assignment in Sellfox.
 *
 * Features:
 * - Read order IDs from Excel file
 * - Open Sellfox in browser (uses existing login session)
 * - Navigate to order processing page
 * - Select orders by checkbox
 * - Batch assign channel
 * - Does NOT auto-save (safety feature)
 */

const path = require('path');
const { config, validateConfig, getExcelPath } = require('./config');
const { readOrderIds, getExcelInfo } = require('./excel-reader');
const SellfoxAutomation = require('./sellfox');

/**
 * Logger utility
 */
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`),
  divider: () => console.log('='.repeat(60)),
};

/**
 * Print banner
 */
function printBanner() {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║         Sellfox Order Channel Assignment Automation        ║
║                                                            ║
║  安全提示: 本程序不会自动保存，请手动确认后再保存！        ║
╚════════════════════════════════════════════════════════════╝
  `);
}

/**
 * Print configuration
 */
function printConfig() {
  logger.divider();
  logger.info('Current Configuration:');
  logger.info(`  Excel File: ${getExcelPath()}`);
  logger.info(`  Order ID Column: ${config.excel.orderIdColumn}`);
  logger.info(`  Channel to Assign: ${config.channel.name}`);
  logger.info(`  Headless Mode: ${config.browser.headless}`);
  logger.info(`  Browser Data: ${config.browser.userDataDir}`);
  logger.divider();
}

/**
 * Print summary
 */
function printSummary(summary) {
  logger.divider();
  logger.info('Processing Summary:');
  logger.info(`  Total Orders: ${summary.totalOrders}`);
  logger.success(`  Successfully Selected: ${summary.successCount}`);
  if (summary.failureCount > 0) {
    logger.warn(`  Failed to Select: ${summary.failureCount}`);
    logger.warn(`  Failed Order IDs: ${summary.failedOrders.join(', ')}`);
  }
  logger.divider();
}

/**
 * Main function
 */
async function main() {
  printBanner();

  // Validate configuration
  const validation = validateConfig();
  if (!validation.isValid) {
    logger.error('Configuration validation failed:');
    validation.errors.forEach((error) => logger.error(`  - ${error}`));
    logger.info('Please check your .env file and try again.');
    process.exit(1);
  }

  printConfig();

  let automation = null;

  try {
    // Step 1: Read order IDs from Excel
    logger.info('Step 1: Reading order IDs from Excel...');
    const excelPath = getExcelPath();

    // Show Excel info
    try {
      const excelInfo = getExcelInfo(excelPath);
      logger.info(`Excel file: ${excelInfo.fileName}`);
      excelInfo.sheets.forEach((sheet) => {
        logger.info(`  Sheet "${sheet.name}": ${sheet.rowCount} rows`);
        logger.info(`  Columns: ${sheet.columns.join(', ')}`);
      });
    } catch (error) {
      logger.error(`Failed to read Excel info: ${error.message}`);
      process.exit(1);
    }

    const orderIds = await readOrderIds(excelPath, config.excel.orderIdColumn);
    logger.success(`Found ${orderIds.length} order IDs to process`);

    if (orderIds.length === 0) {
      logger.error('No order IDs found. Exiting.');
      process.exit(1);
    }

    // Show first few order IDs
    const previewCount = Math.min(5, orderIds.length);
    logger.info(`Preview of order IDs: ${orderIds.slice(0, previewCount).join(', ')}...`);

    // Step 2: Initialize browser
    logger.divider();
    logger.info('Step 2: Initializing browser...');
    automation = new SellfoxAutomation(config);
    await automation.init();

    // Step 3: Navigate to order page
    logger.divider();
    logger.info('Step 3: Navigating to Sellfox order page...');
    await automation.navigateToOrderPage();

    // Step 4: Click on unassigned channel tab
    logger.divider();
    logger.info('Step 4: Clicking on "未分配渠道" tab...');
    await automation.clickUnassignedChannelTab();

    // Step 5: Process orders (search and select)
    logger.divider();
    logger.info('Step 5: Processing orders...');
    await automation.processOrders(orderIds);

    // Step 6: Get selected orders count and proceed if any
    const summary = automation.getSummary();

    if (summary.successCount > 0) {
      // Step 7: Open assign channel dialog
      logger.divider();
      logger.info('Step 6: Opening assign channel dialog...');
      await automation.openAssignChannelDialog();

      // Step 8: Select channel
      logger.info('Step 7: Selecting channel...');
      await automation.selectChannel(config.channel.name);

      logger.divider();
      logger.success('Channel assignment prepared successfully!');
      logger.warn('重要提示: 请手动检查并确认后再点击保存按钮！');
      logger.warn('IMPORTANT: Please review and confirm before clicking save!');
    } else {
      logger.warn('No orders were selected. Please check your order IDs.');
    }

    // Print summary
    printSummary(summary);

    // Keep browser open for manual review
    logger.info('Browser will remain open for manual review.');
    logger.info('Press Ctrl+C to close the program when done.');

    // Wait indefinitely (user will close manually)
    await new Promise(() => {});

  } catch (error) {
    logger.error(`Fatal error: ${error.message}`);
    console.error(error);

    // Take screenshot for debugging
    if (automation && automation.page) {
      try {
        await automation.takeScreenshot('error');
      } catch (e) {
        // Ignore screenshot errors
      }
    }

    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', async () => {
  logger.info('\nReceived SIGINT. Shutting down gracefully...');
  process.exit(0);
});

process.on('SIGTERM', async () => {
  logger.info('\nReceived SIGTERM. Shutting down gracefully...');
  process.exit(0);
});

// Run main function
main().catch((error) => {
  logger.error(`Unhandled error: ${error.message}`);
  process.exit(1);
});
