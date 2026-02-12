import { loadConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import {
  getPage,
  setPage,
  getContext,
  isConnected,
  executeStep,
  updateAutomationState,
  startScreenshotCapture,
  stopScreenshotCapture,
  takeScreenshot,
} from './playwright.js';

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
 * Wait for selector with timeout
 * @param {Object} page - Playwright page
 * @param {string} selector - CSS selector
 * @param {number} timeout - Timeout in milliseconds
 */
async function waitForSelector(page, selector, timeout = 10000) {
  await page.waitForSelector(selector, { timeout, state: 'visible' });
}

/**
 * Click element with retry
 * @param {Object} page - Playwright page
 * @param {string} selector - CSS selector
 * @param {number} retries - Number of retries
 */
async function clickWithRetry(page, selector, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      await page.waitForSelector(selector, { timeout: 5000, state: 'visible' });
      await page.click(selector);
      return;
    } catch (error) {
      if (i === retries - 1) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
}

/**
 * Navigate to Sellfox order ship page
 * @param {Object} page - Playwright page
 */
async function navigateToOrderShipPage(page) {
  const config = loadConfig();
  // Use the correct Sellfox URL
  const url = config.sellfox?.orderShipUrl || 'http://sellfox.cn/amzup-web-main/web/orderShip/index.html';

  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  // Wait for page to fully load
  await page.waitForTimeout(2000);

  // Handle "订单异常提醒" popup if it appears
  await handleExceptionReminderPopup(page);
}

/**
 * Handle the order exception reminder popup
 * @param {Object} page - Playwright page
 */
async function handleExceptionReminderPopup(page) {
  try {
    // Wait a short time for popup to appear
    await page.waitForTimeout(1000);

    // Check for popup with various selectors
    const popupSelectors = [
      'text=订单异常提醒',
      '.el-dialog:has-text("订单异常")',
      '.el-message-box:has-text("异常")',
      '[class*="dialog"]:has-text("异常提醒")',
      '[class*="modal"]:has-text("异常提醒")',
    ];

    let popupFound = false;
    for (const selector of popupSelectors) {
      try {
        const popup = await page.$(selector);
        if (popup) {
          popupFound = true;
          logger.info('检测到订单异常提醒弹框');
          break;
        }
      } catch {
        continue;
      }
    }

    if (popupFound) {
      // Click "稍后处理" button to close the popup
      const closeButtonSelectors = [
        'text=稍后处理',
        'button:has-text("稍后处理")',
        '.el-button:has-text("稍后处理")',
        '[class*="dialog"] button:has-text("稍后")',
        '[class*="modal"] button:has-text("稍后")',
        // Also try close button or cancel
        '.el-dialog__close',
        '.el-message-box__close',
        'text=取消',
        'text=关闭',
      ];

      for (const selector of closeButtonSelectors) {
        try {
          const button = await page.$(selector);
          if (button) {
            await button.click();
            logger.info('已关闭订单异常提醒弹框');
            await page.waitForTimeout(500);
            return;
          }
        } catch {
          continue;
        }
      }

      // JavaScript fallback to close popup
      await page.evaluate(() => {
        // Try to find and click "稍后处理" button
        const buttons = document.querySelectorAll('button, [class*="btn"]');
        for (const btn of buttons) {
          if (btn.textContent.includes('稍后处理') || btn.textContent.includes('稍后') || btn.textContent.includes('关闭')) {
            btn.click();
            return;
          }
        }
        // Try to click close icon
        const closeIcon = document.querySelector('.el-dialog__close, .el-message-box__close, [class*="close-icon"]');
        if (closeIcon) {
          closeIcon.click();
        }
      });

      await page.waitForTimeout(500);
    }
  } catch (error) {
    // Popup handling is optional, don't fail the automation
    logger.info('未检测到订单异常提醒弹框或已关闭');
  }
}

/**
 * Click "未分配渠道" tab
 * @param {Object} page - Playwright page
 */
async function clickUnassignedChannelTab(page) {
  // Try different selectors for the tab
  const selectors = [
    'text=未分配渠道',
    '[data-tab="unassigned"]',
    '.tab-item:has-text("未分配渠道")',
    'button:has-text("未分配渠道")',
    'div[role="tab"]:has-text("未分配渠道")',
  ];

  for (const selector of selectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      continue;
    }
  }

  // Try JavaScript injection as fallback
  await page.evaluate(() => {
    const tabs = document.querySelectorAll('[class*="tab"], [role="tab"], .ant-tabs-tab');
    for (const tab of tabs) {
      if (tab.textContent.includes('未分配渠道')) {
        tab.click();
        return;
      }
    }
  });

  await page.waitForTimeout(1000);
}

/**
 * Search orders by putting order IDs into the search input
 * @param {Object} page - Playwright page
 * @param {Array<string>} orderIds - Array of order IDs to search
 */
async function searchOrders(page, orderIds) {
  // Target the search input inside .sel_ipt container
  const searchInputSelector = '.sel_ipt .multi_search_input input.el-input__inner, .sel_ipt input[placeholder*="双击可批量搜索"]';

  try {
    // Wait for search input to be visible
    await page.waitForSelector(searchInputSelector, { timeout: 5000 });

    // Double-click to activate batch search mode (opens a textarea/popup)
    await page.dblclick(searchInputSelector);
    await page.waitForTimeout(1000);

    // After double-click, a textarea might appear for batch input
    // Try to find the textarea or input that accepts batch content
    const batchInputSelectors = [
      'textarea.el-textarea__inner',
      '.el-dialog textarea',
      '.el-message-box textarea',
      '[class*="batch"] textarea',
      '.el-textarea textarea',
    ];

    let batchInput = null;
    for (const selector of batchInputSelectors) {
      batchInput = await page.$(selector);
      if (batchInput) break;
    }

    if (batchInput) {
      // Found batch textarea, enter order IDs one per line (with space before newline)
      const searchText = orderIds.map(id => id + ' ').join('\n');
      await batchInput.fill(searchText);
      await page.waitForTimeout(500);

      // Click search button in the popup
      await page.waitForTimeout(500);

      // The search button is inside the batch search popup
      // Use locator with force click
      try {
        // Try to find the search button in the popup using locator
        const searchBtnLocator = page.locator('button.el-button--primary.el-button--mini').filter({ hasText: '搜索' });
        const count = await searchBtnLocator.count();
        logger.info(`找到 ${count} 个搜索按钮`);

        if (count > 0) {
          // Click the last one (most likely the one in the popup)
          await searchBtnLocator.last().click({ force: true });
          logger.info('已点击搜索按钮 (locator方式)');
        } else {
          // Fallback: use getByRole
          await page.getByRole('button', { name: '搜索' }).click({ force: true });
          logger.info('已点击搜索按钮 (getByRole方式)');
        }
      } catch (e) {
        logger.info(`Playwright点击失败: ${e.message}, 尝试JS方式`);

        // JavaScript fallback with more aggressive click
        await page.evaluate(() => {
          // Find all elements containing "搜索"
          const allElements = document.querySelectorAll('*');
          for (const el of allElements) {
            if (el.tagName === 'BUTTON' && el.textContent.trim().includes('搜索') && el.classList.contains('el-button--primary')) {
              // Scroll into view
              el.scrollIntoView({ behavior: 'instant', block: 'center' });
              // Focus
              el.focus();
              // Multiple click attempts
              el.click();
              el.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true, view: window }));
              el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
              console.log('JS clicked search button');
              return true;
            }
          }
          return false;
        });
        logger.info('已尝试JS点击搜索按钮');
      }

      // Wait a moment for input to be registered
      await page.waitForTimeout(500);

      // Click search icon once to trigger search
      logger.info('点击搜索图标触发搜索...');
      try {
        const iconLocator = page.locator('.sel_ipt_btn .icon_find');
        const count = await iconLocator.count();
        if (count > 0) {
          await iconLocator.first().click({ force: true });
          logger.info('已点击搜索图标');
        }
      } catch (e) {
        // JavaScript fallback
        await page.evaluate(() => {
          const iconFind = document.querySelector('.sel_ipt_btn .icon_find');
          if (iconFind) iconFind.click();
        });
      }

      // Wait for search results to load
      await page.waitForTimeout(3000);
      logger.info('等待搜索结果加载完成...');
    } else {
      // No batch textarea found, type directly into input one by one
      // Clear existing content first
      await page.fill(searchInputSelector, '');
      await page.waitForTimeout(200);

      // Type each order ID followed by Enter
      for (let i = 0; i < orderIds.length; i++) {
        await page.type(searchInputSelector, orderIds[i]);
        if (i < orderIds.length - 1) {
          // Press Enter to add newline
          await page.keyboard.press('Enter');
        }
        await page.waitForTimeout(100);
      }

      // Final Enter to search
      await page.keyboard.press('Enter');
    }

    logger.info(`已搜索 ${orderIds.length} 个订单号`);
  } catch (error) {
    // Fallback: use JavaScript to set value with proper newlines
    logger.info('尝试备用搜索方式...');

    await page.evaluate((orderIds) => {
      // Add space after each order ID before joining with newline
      const searchText = orderIds.map(id => id + ' ').join('\n');

      // Try to find textarea first (batch mode)
      const textarea = document.querySelector('textarea.el-textarea__inner, .el-dialog textarea');
      if (textarea) {
        textarea.value = searchText;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        // Click confirm button
        const confirmBtn = document.querySelector('.el-dialog button.el-button--primary, .el-message-box button.el-button--primary');
        if (confirmBtn) confirmBtn.click();
        return;
      }

      // Otherwise use input
      const inputs = document.querySelectorAll('input.el-input__inner');
      for (const input of inputs) {
        if (input.placeholder && input.placeholder.includes('搜索')) {
          input.value = searchText;
          input.dispatchEvent(new Event('input', { bubbles: true }));
          input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
          return;
        }
      }
    }, orderIds);
  }

  // Wait for search results to load
  await page.waitForTimeout(2000);
}

/**
 * Click the "select all" checkbox in VXE table header
 * @param {Object} page - Playwright page
 */
async function selectAllOrders(page) {
  // Wait for table to fully load after search
  logger.info('等待表格数据加载...');
  await page.waitForTimeout(2000);

  // Try using Playwright locator first
  try {
    // The checkbox is in th.col--checkbox with title="全选/取消"
    const checkboxLocator = page.locator('th.col--checkbox span.vxe-cell--checkbox[title="全选/取消"]');
    const count = await checkboxLocator.count();
    logger.info(`找到 ${count} 个全选复选框`);

    if (count > 0) {
      await checkboxLocator.first().click({ force: true });
      logger.info('已点击全选复选框 (locator方式)');
      await page.waitForTimeout(500);
      return;
    }
  } catch (e) {
    logger.info(`Locator方式失败: ${e.message}`);
  }

  // Try other selectors
  const headerCheckboxSelectors = [
    'span.vxe-cell--checkbox[title="全选/取消"]',
    'th.col--checkbox .vxe-cell--checkbox',
    '.vxe-header--column.col--checkbox .vxe-cell--checkbox',
    'thead th:first-child .vxe-cell--checkbox',
  ];

  for (const selector of headerCheckboxSelectors) {
    try {
      const checkbox = await page.$(selector);
      if (checkbox) {
        await checkbox.click({ force: true });
        logger.info(`已点击全选复选框 (${selector})`);
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      continue;
    }
  }

  // JavaScript fallback
  await page.evaluate(() => {
    // Method 1: Find by title attribute
    const checkboxByTitle = document.querySelector('span.vxe-cell--checkbox[title="全选/取消"]');
    if (checkboxByTitle) {
      checkboxByTitle.click();
      console.log('JS clicked checkbox by title');
      return true;
    }

    // Method 2: Find in th.col--checkbox
    const thCheckbox = document.querySelector('th.col--checkbox .vxe-cell--checkbox');
    if (thCheckbox) {
      thCheckbox.click();
      console.log('JS clicked th checkbox');
      return true;
    }

    // Method 3: Find first th in thead and click its checkbox
    const firstTh = document.querySelector('.vxe-table--header thead tr th:first-child .vxe-cell--checkbox');
    if (firstTh) {
      firstTh.click();
      console.log('JS clicked first th checkbox');
      return true;
    }

    return false;
  });

  logger.info('已尝试JS点击全选复选框');
  await page.waitForTimeout(500);
}

/**
 * Select orders by order IDs - NEW WORKFLOW:
 * 1. Search for orders using the search input
 * 2. Click select all checkbox
 * @param {Object} page - Playwright page
 * @param {Array<string>} orderIds - Array of order IDs to select
 * @returns {Object} Selection result
 */
async function selectOrdersByIds(page, orderIds) {
  // Step 1: Search for orders
  await searchOrders(page, orderIds);

  // Step 2: Select all visible orders
  await selectAllOrders(page);

  return {
    selected: orderIds,
    notFound: []
  };
}

/**
 * Open batch modify menu and select assign channel
 * @param {Object} page - Playwright page
 */
async function openBatchAssignChannel(page) {
  // Click "批量修改" button
  const batchModifySelectors = [
    'text=批量修改',
    'button:has-text("批量修改")',
    '[class*="batch"]:has-text("修改")',
  ];

  for (const selector of batchModifySelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        await page.waitForTimeout(500);
        break;
      }
    } catch {
      continue;
    }
  }

  // Click "分配渠道" option - using Element UI dropdown menu item
  await page.waitForTimeout(500);

  // Try Playwright locator first
  try {
    const assignChannelLocator = page.locator('li.el-dropdown-menu__item.dropDownBtnItem').filter({ hasText: '分配渠道' });
    const count = await assignChannelLocator.count();
    logger.info(`找到 ${count} 个"分配渠道"菜单项`);

    if (count > 0) {
      await assignChannelLocator.first().click({ force: true });
      logger.info('已点击"分配渠道" (locator方式)');
      await page.waitForTimeout(1000);
      return;
    }
  } catch (e) {
    logger.info(`Locator方式失败: ${e.message}`);
  }

  // Try other selectors
  const assignChannelSelectors = [
    'li.el-dropdown-menu__item.dropDownBtnItem:has-text("分配渠道")',
    'li.el-dropdown-menu__item:has-text("分配渠道")',
    '.el-dropdown-menu__item:has-text("分配渠道")',
    '.dropDownBtnItem:has-text("分配渠道")',
    'text=分配渠道',
  ];

  for (const selector of assignChannelSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        logger.info(`已点击"分配渠道" (${selector})`);
        await page.waitForTimeout(1000);
        return;
      }
    } catch {
      continue;
    }
  }

  // JavaScript fallback
  await page.evaluate(() => {
    // Find li with class el-dropdown-menu__item containing "分配渠道"
    const items = document.querySelectorAll('li.el-dropdown-menu__item, .dropDownBtnItem');
    for (const item of items) {
      if (item.textContent.includes('分配渠道')) {
        item.click();
        console.log('JS clicked 分配渠道');
        return true;
      }
    }
    return false;
  });

  logger.info('已尝试JS点击"分配渠道"');
  await page.waitForTimeout(1000);
}

/**
 * Select logistics comparison mode
 * @param {Object} page - Playwright page
 */
async function selectLogisticsCompareMode(page) {
  const modeSelectors = [
    'text=物流比价',
    '[class*="radio"]:has-text("物流比价")',
    'label:has-text("物流比价")',
    'input[value="compare"]',
  ];

  for (const selector of modeSelectors) {
    try {
      const element = await page.$(selector);
      if (element) {
        await element.click();
        await page.waitForTimeout(500);
        return;
      }
    } catch {
      continue;
    }
  }

  // JavaScript fallback
  await page.evaluate(() => {
    const radios = document.querySelectorAll('[class*="radio"], label');
    for (const radio of radios) {
      if (radio.textContent.includes('物流比价')) {
        radio.click();
        return;
      }
    }
  });

  await page.waitForTimeout(500);
}

/**
 * Click batch warehouse button and select warehouse
 * Handles both one-level and two-level warehouse menus dynamically
 * Uses Element UI cascader component structure
 * @param {Object} page - Playwright page
 * @param {string} warehouseName - Warehouse name to select (optional, will auto-select first available)
 */
async function selectWarehouse(page, warehouseName) {
  logger.info('准备选择店铺仓库...');

  // Wait for the page to stabilize after previous action
  await page.waitForTimeout(1000);

  // Click "批量" button in the store warehouse column header to open warehouse selector
  logger.info('点击店铺仓库"批量"按钮...');

  const clickBatchResult = await page.evaluate(() => {
    // Find the dialog
    const dialog = document.querySelector('.el-dialog__wrapper:not([style*="display: none"])');
    if (!dialog) return { success: false, error: '未找到对话框' };

    // Find all table headers with "店铺仓库" and "批量"
    const headers = dialog.querySelectorAll('.vxe-cell--title');
    for (const h of headers) {
      if (h.textContent.includes('店铺仓库') && h.textContent.includes('批量')) {
        const batchBtn = h.querySelector('button.el-button--text');
        if (batchBtn) {
          batchBtn.click();
          return { success: true, message: '已点击店铺仓库批量按钮' };
        }
      }
    }
    return { success: false, error: '未找到店铺仓库批量按钮' };
  });

  if (!clickBatchResult.success) {
    logger.info(`点击批量按钮失败: ${clickBatchResult.error}`);
    throw new Error('无法打开仓库选择器');
  }

  logger.info(clickBatchResult.message);

  // Wait for dropdown to appear
  await page.waitForTimeout(1500);

  // Detect menu type and select warehouses
  const menuInfo = await page.evaluate(() => {
    // Check for cascader menu (two-level) or simple checkbox list (one-level)
    const cascaderMenus = document.querySelectorAll('.el-cascader-menu');
    if (cascaderMenus.length >= 2) {
      // Two-level menu: has multiple cascader menu panels
      return { type: 'two-level', menuCount: cascaderMenus.length };
    }

    // Check for items with arrows (another indicator of two-level)
    const items = document.querySelectorAll('.el-cascader-node');
    for (const item of items) {
      const arrow = item.querySelector('.el-icon-arrow-right, .el-cascader-node__postfix');
      if (arrow) {
        return { type: 'two-level', menuCount: 1 };
      }
    }

    return { type: 'one-level', menuCount: 1 };
  });

  logger.info(`检测到仓库菜单类型: ${menuInfo.type}`);

  if (menuInfo.type === 'one-level') {
    // One-level menu: select the first option after "全选"
    await handleOneLevelWarehouseMenu(page);
  } else {
    // Two-level menu: iterate through each first-level item and select from second level
    await handleTwoLevelWarehouseMenu(page);
  }

  // Wait a moment then click confirm button
  await page.waitForTimeout(1000);
  logger.info('准备点击确定按钮...');

  // Click confirm button in the dropdown
  const confirmResult = await page.evaluate(() => {
    // Find visible confirm button
    const buttons = document.querySelectorAll('button');
    for (const btn of buttons) {
      if (btn.textContent.trim() === '确定' && btn.offsetParent !== null) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0 && rect.y > 300) {
          btn.click();
          return { success: true, message: '已点击确定按钮' };
        }
      }
    }
    return { success: false, error: '未找到确定按钮' };
  });

  if (confirmResult.success) {
    logger.info(confirmResult.message);
  } else {
    logger.info(`确定按钮点击失败: ${confirmResult.error}`);
  }

  await page.waitForTimeout(500);
}

/**
 * Handle one-level warehouse menu selection
 * @param {Object} page - Playwright page
 */
async function handleOneLevelWarehouseMenu(page) {
  logger.info('处理一级仓库菜单...');

  const result = await page.evaluate(() => {
    // Find checkboxes in the dropdown
    const labels = document.querySelectorAll('.el-checkbox__label, label');
    let selected = null;

    for (const label of labels) {
      const text = label.textContent.trim();
      // Skip "全选" and empty labels
      if (text && text !== '全选' && !text.includes('全选')) {
        // Find the checkbox input or the parent checkbox element
        const checkboxWrapper = label.closest('.el-checkbox') || label.closest('label');
        if (checkboxWrapper) {
          const input = checkboxWrapper.querySelector('input[type="checkbox"]') ||
                       checkboxWrapper.querySelector('.el-checkbox__input');
          if (input) {
            input.click();
            selected = text;
            break;
          }
        }
      }
    }

    return selected ? { success: true, selected } : { success: false, error: '未找到可选仓库' };
  });

  if (result.success) {
    logger.info(`一级菜单已选择: ${result.selected}`);
  } else {
    logger.info(`一级菜单选择失败: ${result.error}`);
  }
}

/**
 * Handle two-level warehouse menu selection
 * Iterates through each first-level item and selects the first warehouse from each second level
 * IMPORTANT: Must HOVER (not click/select) on first-level items to expand submenu,
 * then select ONLY the first non-"全选" item from the second-level menu
 * @param {Object} page - Playwright page
 */
async function handleTwoLevelWarehouseMenu(page) {
  logger.info('处理二级仓库菜单...');

  // Known warehouse names (first-level items) - use this list directly
  // to avoid issues with dynamic rendering or scrolling
  const validWarehouseNames = ['Bostra', 'SekamInnovation', 'Sekam', 'Atrisec'];

  // First, scroll the cascader menu to make sure all items are visible
  await page.evaluate(() => {
    const menus = document.querySelectorAll('.el-cascader-menu');
    for (const menu of menus) {
      const rect = menu.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        // Scroll to top to ensure all items render
        menu.scrollTop = 0;
      }
    }
  });

  await page.waitForTimeout(500);

  // Get list of first-level items - search for known warehouse names in the DOM
  const firstLevelItems = await page.evaluate((warehouseNames) => {
    // Platform names to EXCLUDE
    const platformNames = ['Amazon', 'TikTok', 'SHEIN', 'Temu半托管', '无平台标识', 'eBay', 'Shopify', 'Walmart'];

    // Find items by searching for known warehouse names
    const foundItems = [];
    const allLabels = document.querySelectorAll('.el-cascader-node__label');

    for (const label of allLabels) {
      const text = label.textContent.trim();

      // Check if this is a known warehouse name
      if (warehouseNames.includes(text)) {
        // Verify it's visible
        const rect = label.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          foundItems.push({ text, hasArrow: true });
        }
      }
    }

    // Deduplicate by text
    const uniqueItems = [];
    const seen = new Set();
    for (const item of foundItems) {
      if (!seen.has(item.text)) {
        seen.add(item.text);
        uniqueItems.push(item);
      }
    }

    // If we found known warehouse names, use them
    if (uniqueItems.length > 0) {
      console.log('Found warehouse items by name:', uniqueItems.map(i => i.text));
      return uniqueItems;
    }

    // Fallback: scan visible menus for any non-platform items
    const cascaderMenus = document.querySelectorAll('.el-cascader-menu');
    const visibleMenus = Array.from(cascaderMenus)
      .map(menu => ({
        menu,
        rect: menu.getBoundingClientRect()
      }))
      .filter(m => m.rect.width > 0 && m.rect.height > 0)
      .sort((a, b) => a.rect.left - b.rect.left);

    for (const { menu } of visibleMenus) {
      const nodes = menu.querySelectorAll('.el-cascader-node');
      const menuItems = [];
      let hasPlatformItem = false;

      for (const node of nodes) {
        const label = node.querySelector('.el-cascader-node__label');
        if (!label) continue;

        const text = label.textContent.trim();
        if (!text || text === '全选') continue;

        if (platformNames.includes(text)) {
          hasPlatformItem = true;
        } else {
          menuItems.push({ text, hasArrow: true });
        }
      }

      if (!hasPlatformItem && menuItems.length > 0) {
        console.log('Found warehouse menu (fallback):', menuItems.map(i => i.text));
        return menuItems;
      }
    }

    return [];
  }, validWarehouseNames);

  const itemNames = firstLevelItems.map(i => i.text);
  logger.info(`找到 ${firstLevelItems.length} 个一级菜单项: ${itemNames.join(', ')}`);

  // If no items found, try alternative selection method
  if (firstLevelItems.length === 0) {
    logger.info('尝试备用选择方法...');
    await handleWarehouseSelectionFallback(page);
    return;
  }

  // Process each first-level item
  for (const item of firstLevelItems) {
    const itemName = item.text;
    logger.info(`处理一级菜单: ${itemName}`);

    // Find the cascader node element and hover on it using JavaScript
    // This is more reliable than Playwright's hover for Element UI components
    const hoverResult = await page.evaluate((name) => {
      // Find the cascader node with matching label text
      const allNodes = document.querySelectorAll('.el-cascader-node');
      for (const node of allNodes) {
        const label = node.querySelector('.el-cascader-node__label');
        if (label && label.textContent.trim() === name) {
          const rect = node.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;

          // Trigger multiple hover events to ensure submenu expands
          const events = ['mouseenter', 'mouseover', 'mousemove'];
          for (const eventType of events) {
            node.dispatchEvent(new MouseEvent(eventType, {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: rect.left + rect.width / 2,
              clientY: rect.top + rect.height / 2
            }));
          }

          // Also trigger on the label itself
          const labelRect = label.getBoundingClientRect();
          for (const eventType of events) {
            label.dispatchEvent(new MouseEvent(eventType, {
              bubbles: true,
              cancelable: true,
              view: window,
              clientX: labelRect.left + labelRect.width / 2,
              clientY: labelRect.top + labelRect.height / 2
            }));
          }

          return { success: true, nodeRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } };
        }
      }
      return { success: false, error: '未找到匹配的cascader节点' };
    }, itemName);

    if (!hoverResult.success) {
      logger.info(`无法hover到: ${itemName}, ${hoverResult.error}`);
      continue;
    }
    logger.info(`已hover到一级菜单: ${itemName}`);

    // Also use Playwright's mouse to move to the element position for better reliability
    try {
      const nodeRect = hoverResult.nodeRect;
      await page.mouse.move(nodeRect.x + nodeRect.w / 2, nodeRect.y + nodeRect.h / 2);
    } catch (e) {
      // Ignore mouse move errors
    }

    // Wait for submenu to appear (longer wait for reliability)
    await page.waitForTimeout(1000);

    // Select the first option after "全选" in the second level submenu
    const selectResult = await page.evaluate((parentName) => {
      // First-level items (parent names) should NOT appear in second-level
      const firstLevelNames = ['Bostra', 'SekamInnovation', 'Sekam', 'Atrisec'];
      const platformNames = ['Amazon', 'TikTok', 'SHEIN', 'Temu半托管', '无平台标识', 'eBay', 'Shopify', 'Walmart'];

      // Find all visible cascader menus and their positions
      const cascaderMenus = document.querySelectorAll('.el-cascader-menu');
      const visibleMenus = [];

      for (const menu of cascaderMenus) {
        const rect = menu.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visibleMenus.push({ menu, x: rect.left });
        }
      }

      // Sort by X position to find the rightmost one (submenu)
      visibleMenus.sort((a, b) => b.x - a.x);

      if (visibleMenus.length < 2) {
        // Log what menus we found for debugging
        const menuInfo = visibleMenus.map(m => `x=${m.x}`).join(', ');
        return { success: false, error: `二级菜单未显示 (仅找到 ${visibleMenus.length} 个菜单: ${menuInfo})` };
      }

      // The rightmost menu is the submenu
      const submenu = visibleMenus[0].menu;

      // Get all items in submenu for debugging
      const submenuNodes = submenu.querySelectorAll('.el-cascader-node');
      const allItems = [];

      for (const node of submenuNodes) {
        const label = node.querySelector('.el-cascader-node__label');
        if (!label) continue;

        const text = label.textContent.trim();
        allItems.push(text);

        // Skip "全选"
        if (text === '全选') continue;

        // Skip first-level names
        if (firstLevelNames.includes(text)) continue;

        // Skip platform names
        if (platformNames.includes(text)) continue;

        // Find and click the checkbox
        const checkboxInner = node.querySelector('.el-checkbox__inner');
        const checkboxInput = node.querySelector('.el-checkbox__input');
        const anyCheckbox = node.querySelector('[class*="checkbox"]');

        if (checkboxInner) {
          checkboxInner.click();
          return { success: true, selected: text, parent: parentName };
        } else if (checkboxInput) {
          checkboxInput.click();
          return { success: true, selected: text, parent: parentName };
        } else if (anyCheckbox) {
          anyCheckbox.click();
          return { success: true, selected: text, parent: parentName };
        }
      }

      return {
        success: false,
        error: `${parentName} 的二级菜单中未找到可选项`,
        submenuItems: allItems
      };
    }, itemName);

    if (selectResult.success) {
      logger.info(`已选择: ${selectResult.parent} > ${selectResult.selected}`);
    } else {
      logger.info(`选择失败: ${selectResult.error}`);
      if (selectResult.submenuItems) {
        logger.info(`二级菜单内容: ${selectResult.submenuItems.join(', ')}`);
      }
    }

    // Small delay before processing next item
    await page.waitForTimeout(500);
  }
}

/**
 * Fallback warehouse selection when standard cascader detection fails
 * @param {Object} page - Playwright page
 */
async function handleWarehouseSelectionFallback(page) {
  logger.info('使用备用方法选择仓库...');

  // Try to find and click any visible checkbox that's not "全选"
  const result = await page.evaluate(() => {
    const selected = [];

    // Find all checkbox labels in cascader menus
    const menus = document.querySelectorAll('.el-cascader-menu');

    for (const menu of menus) {
      const nodes = menu.querySelectorAll('.el-cascader-node');

      for (const node of nodes) {
        const label = node.querySelector('.el-cascader-node__label');
        if (!label) continue;

        const text = label.textContent.trim();
        if (text === '全选') continue;

        // Check if this node has a checkbox
        const checkbox = node.querySelector('.el-checkbox__input');
        if (checkbox && !checkbox.classList.contains('is-checked')) {
          checkbox.click();
          selected.push(text);
          break; // Only select first available in each menu
        }
      }
    }

    return { success: selected.length > 0, selected };
  });

  if (result.success) {
    logger.info(`备用方法已选择: ${result.selected.join(', ')}`);
  } else {
    logger.info('备用方法未能选择任何仓库');
  }
}

/**
 * Click auto compare button
 * @param {Object} page - Playwright page
 */
async function clickAutoCompare(page) {
  logger.info('准备点击"自动比价"按钮...');

  // Wait for page to stabilize
  await page.waitForTimeout(1000);

  // Find and click the VISIBLE "自动比价" button using JavaScript
  // This is more reliable because we can check visibility before clicking
  const clickResult = await page.evaluate(() => {
    // Find all buttons with "自动比价" text
    const buttons = document.querySelectorAll('button');
    const candidateButtons = [];

    for (const btn of buttons) {
      if (btn.textContent.includes('自动比价')) {
        const rect = btn.getBoundingClientRect();
        // Check if button is visible
        if (rect.width > 0 && rect.height > 0 && rect.top > 0 && rect.left > 0) {
          candidateButtons.push({
            button: btn,
            rect,
            // Prefer buttons that are inside the visible dialog
            inDialog: !!btn.closest('.el-dialog__wrapper:not([style*="display: none"])')
          });
        }
      }
    }

    console.log('Found candidate 自动比价 buttons:', candidateButtons.length);

    // Prefer button inside the dialog
    const dialogButton = candidateButtons.find(c => c.inDialog);
    if (dialogButton) {
      dialogButton.button.click();
      return { success: true, message: '点击对话框内的"自动比价"按钮', y: dialogButton.rect.top };
    }

    // Otherwise click the first visible one
    if (candidateButtons.length > 0) {
      candidateButtons[0].button.click();
      return { success: true, message: '点击可见的"自动比价"按钮', y: candidateButtons[0].rect.top };
    }

    return { success: false, error: '未找到可见的"自动比价"按钮' };
  });

  if (clickResult.success) {
    logger.info(`${clickResult.message} (y=${clickResult.y})`);
  } else {
    logger.info(clickResult.error);

    // Fallback: try using Playwright's locator with visibility check
    try {
      const autoCompareLocator = page.locator('button:has-text("自动比价"):visible');
      const count = await autoCompareLocator.count();
      logger.info(`Playwright可见定位器找到 ${count} 个按钮`);

      if (count > 0) {
        await autoCompareLocator.first().click({ force: true });
        logger.info('已点击"自动比价"按钮 (Playwright可见定位器)');
      }
    } catch (e) {
      logger.info(`Playwright可见定位器失败: ${e.message}`);
    }
  }

  await page.waitForTimeout(1000);
}

/**
 * Run Sellfox automation
 * @param {Array<string>} orderIds - Order IDs to process
 * @param {string} warehouseName - Warehouse name
 * @returns {Promise<Object>} Automation result
 */
export async function runAutomation(orderIds, warehouseName) {
  if (!isConnected()) {
    throw new Error('未连接到 Chrome');
  }

  const page = getPage();
  if (!page) {
    throw new Error('没有可用的页面');
  }

  const config = loadConfig();
  const totalSteps = 7;

  updateAutomationState({
    status: 'running',
    progress: 0,
    totalSteps,
    error: null,
  });

  // Start screenshot capture
  startScreenshotCapture(config.sellfox?.screenshotInterval || 1000);

  try {
    // Step 1: Navigate to order ship page
    await executeStep('导航到订单发货页面', async () => {
      await navigateToOrderShipPage(page);
    });

    // Step 2: Click unassigned channel tab
    await executeStep('点击"未分配渠道"标签', async () => {
      await clickUnassignedChannelTab(page);
    });

    // Step 3: Select orders by checkbox
    await executeStep(`选择订单 (共 ${orderIds.length} 个)`, async () => {
      const result = await selectOrdersByIds(page, orderIds);
      emitEvent('log', {
        type: 'info',
        message: `已选择 ${result.selected.length} 个订单，未找到 ${result.notFound.length} 个`,
        timestamp: Date.now(),
      });
      if (result.notFound.length > 0) {
        emitEvent('log', {
          type: 'warn',
          message: `未找到的订单: ${result.notFound.join(', ')}`,
          timestamp: Date.now(),
        });
      }
      return result;
    });

    // Step 4: Open batch assign channel
    await executeStep('打开"批量修改" > "分配渠道"', async () => {
      await openBatchAssignChannel(page);
    });

    // Step 5: Select logistics compare mode
    await executeStep('选择"物流比价"模式', async () => {
      await selectLogisticsCompareMode(page);
    });

    // Step 6: Select warehouse
    await executeStep(`选择仓库: ${warehouseName || '默认'}`, async () => {
      await selectWarehouse(page, warehouseName || config.sellfox?.defaultWarehouse);
    });

    // Step 7: Click auto compare
    await executeStep('点击"物流比价 自动比价"', async () => {
      await clickAutoCompare(page);
    });

    // Notify user that automation is complete but NOT auto-saved
    emitEvent('log', {
      type: 'success',
      message: '自动化流程完成！请检查比价结果后手动保存。',
      timestamp: Date.now(),
    });

    emitEvent('notification', {
      type: 'warning',
      title: '需要手动确认',
      message: '物流比价已完成，请检查结果后手动点击保存按钮。',
    });

    // Take final screenshot
    const screenshot = await takeScreenshot();
    if (screenshot) {
      emitEvent('screenshot', { image: screenshot, timestamp: Date.now() });
    }

    stopScreenshotCapture();

    updateAutomationState({
      status: 'completed',
      currentStep: '完成',
      progress: totalSteps,
    });

    return {
      success: true,
      message: '自动化流程完成，请手动确认保存',
      ordersProcessed: orderIds.length,
    };
  } catch (error) {
    stopScreenshotCapture();

    updateAutomationState({
      status: 'error',
      error: error.message,
    });

    emitEvent('error', {
      message: error.message,
      timestamp: Date.now(),
    });

    throw error;
  }
}

/**
 * Get available warehouses from page
 * @returns {Promise<Array<string>>} List of warehouse names
 */
export async function getWarehouses() {
  if (!isConnected()) {
    return [];
  }

  const page = getPage();
  if (!page) {
    return [];
  }

  try {
    const warehouses = await page.evaluate(() => {
      const warehouseElements = document.querySelectorAll(
        '[class*="warehouse"] option, [class*="warehouse"] li, .warehouse-item'
      );
      return Array.from(warehouseElements).map((el) => el.textContent.trim()).filter(Boolean);
    });
    return warehouses;
  } catch {
    return [];
  }
}

export default {
  setEventCallback,
  runAutomation,
  getWarehouses,
};
