/**
 * Sellfox Browser Automation Module
 * Uses Playwright to automate order channel assignment
 */

const { chromium } = require('playwright');
const path = require('path');

/**
 * Logger utility
 */
const logger = {
  info: (msg) => console.log(`[INFO] ${new Date().toISOString()} - ${msg}`),
  error: (msg) => console.error(`[ERROR] ${new Date().toISOString()} - ${msg}`),
  warn: (msg) => console.warn(`[WARN] ${new Date().toISOString()} - ${msg}`),
  debug: (msg) => console.log(`[DEBUG] ${new Date().toISOString()} - ${msg}`),
  success: (msg) => console.log(`[SUCCESS] ${new Date().toISOString()} - ${msg}`),
};

/**
 * Sellfox automation class
 */
class SellfoxAutomation {
  constructor(config) {
    this.config = config;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.selectedOrders = [];
    this.failedOrders = [];
  }

  /**
   * Initialize browser with persistent context
   */
  async init() {
    logger.info('Initializing browser...');

    try {
      // Use persistent context to maintain login session
      this.context = await chromium.launchPersistentContext(
        this.config.browser.userDataDir,
        {
          headless: this.config.browser.headless,
          slowMo: this.config.browser.slowMo,
          viewport: { width: 1920, height: 1080 },
          args: [
            '--start-maximized',
            '--disable-blink-features=AutomationControlled',
          ],
        }
      );

      // Get the first page or create a new one
      const pages = this.context.pages();
      this.page = pages.length > 0 ? pages[0] : await this.context.newPage();

      // Set default timeout
      this.page.setDefaultTimeout(this.config.browser.timeout);

      logger.success('Browser initialized successfully');
    } catch (error) {
      logger.error(`Failed to initialize browser: ${error.message}`);
      throw error;
    }
  }

  /**
   * Navigate to order ship page
   */
  async navigateToOrderPage() {
    logger.info(`Navigating to: ${this.config.sellfox.orderShipUrl}`);

    try {
      await this.page.goto(this.config.sellfox.orderShipUrl, {
        waitUntil: 'networkidle',
        timeout: 60000,
      });

      // Wait for the page to load
      await this.page.waitForTimeout(2000);

      // Check if we need to login
      const currentUrl = this.page.url();
      if (currentUrl.includes('login') || currentUrl.includes('signin')) {
        logger.warn('Login required. Please login manually in the browser window.');
        logger.info('After logging in, press Enter in the terminal to continue...');
        await this.waitForUserInput();
        await this.page.goto(this.config.sellfox.orderShipUrl, {
          waitUntil: 'networkidle',
        });
      }

      logger.success('Successfully navigated to order page');
    } catch (error) {
      logger.error(`Failed to navigate to order page: ${error.message}`);
      throw error;
    }
  }

  /**
   * Click on "未分配渠道" (Unassigned Channel) tab
   */
  async clickUnassignedChannelTab() {
    logger.info('Clicking on "未分配渠道" tab...');

    try {
      // Try multiple selectors for the tab
      const selectors = [
        'text=未分配渠道',
        '.el-tabs__item:has-text("未分配渠道")',
        '[role="tab"]:has-text("未分配渠道")',
        'div.el-tabs__item:has-text("未分配渠道")',
      ];

      let clicked = false;
      for (const selector of selectors) {
        try {
          const element = await this.page.$(selector);
          if (element) {
            await element.click();
            clicked = true;
            logger.debug(`Clicked using selector: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!clicked) {
        throw new Error('Could not find "未分配渠道" tab');
      }

      // Wait for the table to update
      await this.page.waitForTimeout(2000);
      await this.page.waitForLoadState('networkidle');

      logger.success('Successfully clicked "未分配渠道" tab');
    } catch (error) {
      logger.error(`Failed to click unassigned channel tab: ${error.message}`);
      throw error;
    }
  }

  /**
   * Search for an order by ID
   * @param {string} orderId - The order ID to search for
   */
  async searchOrder(orderId) {
    logger.debug(`Searching for order: ${orderId}`);

    try {
      // Find the search input
      const searchSelectors = [
        'input[placeholder*="订单号"]',
        'input[placeholder*="搜索"]',
        '.el-input__inner[placeholder*="订单"]',
        'input.el-input__inner',
      ];

      let searchInput = null;
      for (const selector of searchSelectors) {
        try {
          searchInput = await this.page.$(selector);
          if (searchInput) {
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!searchInput) {
        logger.warn('Search input not found, trying alternative method');
        return false;
      }

      // Clear and type the order ID
      await searchInput.click({ clickCount: 3 });
      await searchInput.fill(orderId);
      await this.page.keyboard.press('Enter');

      // Wait for search results
      await this.page.waitForTimeout(1500);
      await this.page.waitForLoadState('networkidle');

      return true;
    } catch (error) {
      logger.warn(`Failed to search for order ${orderId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Select an order by its checkbox
   * @param {string} orderId - The order ID to select
   * @returns {boolean} Whether the order was successfully selected
   */
  async selectOrder(orderId) {
    logger.debug(`Selecting order: ${orderId}`);

    try {
      // Find the row containing the order ID
      const rowSelector = `.vxe-body--row:has-text("${orderId}")`;
      const row = await this.page.$(rowSelector);

      if (!row) {
        logger.warn(`Order row not found: ${orderId}`);
        return false;
      }

      // Find the checkbox in this row
      const checkbox = await row.$('.vxe-cell--checkbox:not(.is--disabled)');
      if (!checkbox) {
        logger.warn(`Checkbox not found or disabled for order: ${orderId}`);
        return false;
      }

      // Check if already selected
      const isChecked = await row.$('.vxe-cell--checkbox.is--checked');
      if (isChecked) {
        logger.debug(`Order ${orderId} is already selected`);
        return true;
      }

      // Click the checkbox
      await checkbox.click();
      await this.page.waitForTimeout(300);

      logger.debug(`Successfully selected order: ${orderId}`);
      return true;
    } catch (error) {
      logger.warn(`Failed to select order ${orderId}: ${error.message}`);
      return false;
    }
  }

  /**
   * Process multiple orders - search and select each one
   * @param {string[]} orderIds - Array of order IDs to process
   */
  async processOrders(orderIds) {
    logger.info(`Processing ${orderIds.length} orders...`);

    this.selectedOrders = [];
    this.failedOrders = [];

    for (let i = 0; i < orderIds.length; i++) {
      const orderId = orderIds[i];
      logger.info(`Processing order ${i + 1}/${orderIds.length}: ${orderId}`);

      try {
        // Search for the order
        await this.searchOrder(orderId);

        // Try to select the order
        const selected = await this.selectOrder(orderId);

        if (selected) {
          this.selectedOrders.push(orderId);
          logger.success(`Selected order: ${orderId}`);
        } else {
          this.failedOrders.push(orderId);
          logger.warn(`Could not select order: ${orderId}`);
        }

        // Clear search for next order
        await this.clearSearch();
      } catch (error) {
        this.failedOrders.push(orderId);
        logger.error(`Error processing order ${orderId}: ${error.message}`);
      }

      // Small delay between orders
      await this.page.waitForTimeout(500);
    }

    logger.info(
      `Processed ${orderIds.length} orders. Selected: ${this.selectedOrders.length}, Failed: ${this.failedOrders.length}`
    );
  }

  /**
   * Select all visible orders on the current page
   */
  async selectAllVisibleOrders() {
    logger.info('Selecting all visible orders...');

    try {
      // Find the header checkbox (select all)
      const headerCheckbox = await this.page.$(
        '.vxe-header--column .vxe-cell--checkbox:not(.is--disabled)'
      );

      if (headerCheckbox) {
        await headerCheckbox.click();
        await this.page.waitForTimeout(500);
        logger.success('Selected all visible orders');
        return true;
      }

      logger.warn('Could not find select all checkbox');
      return false;
    } catch (error) {
      logger.error(`Failed to select all orders: ${error.message}`);
      return false;
    }
  }

  /**
   * Clear the search input
   */
  async clearSearch() {
    try {
      const searchInput = await this.page.$('input.el-input__inner');
      if (searchInput) {
        await searchInput.click({ clickCount: 3 });
        await this.page.keyboard.press('Backspace');
        await this.page.keyboard.press('Enter');
        await this.page.waitForTimeout(1000);
      }
    } catch (error) {
      // Ignore clear search errors
    }
  }

  /**
   * Open batch modify menu and click assign channel option
   */
  async openAssignChannelDialog() {
    logger.info('Opening "批量修改" > "分配渠道" dialog...');

    try {
      // Click on "批量修改" button
      const batchModifySelectors = [
        'button:has-text("批量修改")',
        '.el-button:has-text("批量修改")',
        '.el-dropdown:has-text("批量修改")',
        'text=批量修改',
      ];

      let clicked = false;
      for (const selector of batchModifySelectors) {
        try {
          const button = await this.page.$(selector);
          if (button) {
            await button.click();
            clicked = true;
            logger.debug(`Clicked batch modify using: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!clicked) {
        throw new Error('Could not find "批量修改" button');
      }

      // Wait for dropdown to appear
      await this.page.waitForTimeout(500);

      // Click on "分配渠道" option
      const assignChannelSelectors = [
        '.el-dropdown-menu__item:has-text("分配渠道")',
        'li:has-text("分配渠道")',
        'text=分配渠道',
      ];

      clicked = false;
      for (const selector of assignChannelSelectors) {
        try {
          const option = await this.page.$(selector);
          if (option) {
            await option.click();
            clicked = true;
            logger.debug(`Clicked assign channel using: ${selector}`);
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!clicked) {
        throw new Error('Could not find "分配渠道" option');
      }

      // Wait for dialog to appear
      await this.page.waitForTimeout(1000);

      logger.success('Successfully opened assign channel dialog');
    } catch (error) {
      logger.error(`Failed to open assign channel dialog: ${error.message}`);
      throw error;
    }
  }

  /**
   * Select channel in the dialog
   * @param {string} channelName - Name of the channel to select
   */
  async selectChannel(channelName) {
    logger.info(`Selecting channel: ${channelName}`);

    try {
      // Find the channel dropdown
      const dropdownSelectors = [
        '.el-select:has-text("全部渠道")',
        '.el-select:has-text("渠道")',
        '.el-dialog .el-select',
        '[placeholder*="渠道"]',
      ];

      let dropdown = null;
      for (const selector of dropdownSelectors) {
        try {
          dropdown = await this.page.$(selector);
          if (dropdown) {
            break;
          }
        } catch (e) {
          continue;
        }
      }

      if (!dropdown) {
        throw new Error('Could not find channel dropdown');
      }

      // Click to open dropdown
      await dropdown.click();
      await this.page.waitForTimeout(500);

      // Select the channel
      const channelOption = await this.page.$(
        `.el-select-dropdown__item:has-text("${channelName}")`
      );

      if (!channelOption) {
        // Try scrolling through options
        const options = await this.page.$$('.el-select-dropdown__item');
        for (const option of options) {
          const text = await option.textContent();
          if (text && text.includes(channelName)) {
            await option.click();
            logger.success(`Selected channel: ${channelName}`);
            return true;
          }
        }
        throw new Error(`Channel "${channelName}" not found in dropdown`);
      }

      await channelOption.click();
      await this.page.waitForTimeout(300);

      logger.success(`Successfully selected channel: ${channelName}`);
      return true;
    } catch (error) {
      logger.error(`Failed to select channel: ${error.message}`);
      throw error;
    }
  }

  /**
   * Wait for user input (for manual login)
   */
  async waitForUserInput() {
    return new Promise((resolve) => {
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });
      rl.question('Press Enter to continue after logging in...', () => {
        rl.close();
        resolve();
      });
    });
  }

  /**
   * Get summary of processing results
   */
  getSummary() {
    return {
      totalOrders: this.selectedOrders.length + this.failedOrders.length,
      selectedOrders: this.selectedOrders,
      failedOrders: this.failedOrders,
      successCount: this.selectedOrders.length,
      failureCount: this.failedOrders.length,
    };
  }

  /**
   * Take a screenshot for debugging
   * @param {string} name - Name for the screenshot file
   */
  async takeScreenshot(name) {
    const screenshotPath = path.join(process.cwd(), `screenshot-${name}.png`);
    await this.page.screenshot({ path: screenshotPath, fullPage: true });
    logger.info(`Screenshot saved: ${screenshotPath}`);
  }

  /**
   * Close the browser
   */
  async close() {
    logger.info('Closing browser...');
    if (this.context) {
      await this.context.close();
    }
    logger.info('Browser closed');
  }
}

module.exports = SellfoxAutomation;
