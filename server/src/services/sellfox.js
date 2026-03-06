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

  // Log current page URL for debugging
  try {
    const currentUrl = page.url();
    logger.info(`当前页面URL: ${currentUrl}`);
  } catch (e) {
    logger.info(`无法获取当前页面URL: ${e.message}`);
  }

  try {
    // Wait for search input to be visible
    logger.info(`等待搜索输入框: ${searchInputSelector}`);
    await page.waitForSelector(searchInputSelector, { timeout: 10000 });
    logger.info('找到搜索输入框');

    // Double-click to activate batch search mode (opens a textarea/popup)
    logger.info('双击搜索输入框激活批量搜索模式...');
    await page.dblclick(searchInputSelector);
    await page.waitForTimeout(1500);
    logger.info('双击完成，等待批量输入框出现...');

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
      logger.info('找到批量输入框，正在填写订单号...');
      const searchText = orderIds.map(id => id + ' ').join('\n');
      logger.info(`填写内容: ${searchText.substring(0, 100)}${searchText.length > 100 ? '...' : ''}`);

      try {
        // Clear first then fill
        await batchInput.click();
        await batchInput.fill('');
        await page.waitForTimeout(200);
        await batchInput.fill(searchText);
        logger.info('订单号填写完成');
      } catch (fillError) {
        logger.info(`fill方法失败: ${fillError.message}，尝试type方法...`);
        // Fallback to type if fill fails
        await batchInput.click();
        await page.keyboard.press('Control+a');
        await page.keyboard.type(searchText, { delay: 10 });
        logger.info('使用type方法填写完成');
      }
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
  // Retry up to 3 times - sometimes the dropdown or menu item needs time to become available
  for (let attempt = 1; attempt <= 3; attempt++) {
    logger.info(`尝试打开"批量修改 > 分配渠道" (第${attempt}次)...`);

    // Click "批量修改" button - use hover first then click for el-dropdown
    const batchModifySelectors = [
      'text=批量修改',
      'button:has-text("批量修改")',
      '[class*="batch"]:has-text("修改")',
    ];

    for (const selector of batchModifySelectors) {
      try {
        const element = await page.$(selector);
        if (element) {
          // Hover first to trigger dropdown open, then click
          await element.hover();
          await page.waitForTimeout(300);
          await element.click();
          await page.waitForTimeout(500);
          break;
        }
      } catch {
        continue;
      }
    }

    // Wait for dropdown menu to become visible
    await page.waitForTimeout(800);

    // Try to click "分配渠道" - check if it's enabled first
    let clicked = false;

    try {
      const assignChannelLocator = page.locator('li.el-dropdown-menu__item.dropDownBtnItem').filter({ hasText: '分配渠道' });
      const count = await assignChannelLocator.count();
      logger.info(`找到 ${count} 个"分配渠道"菜单项`);

      if (count > 0) {
        // Check if the item is disabled
        const isDisabled = await assignChannelLocator.first().evaluate(el => {
          return el.classList.contains('is-disabled') || el.getAttribute('aria-disabled') === 'true';
        });

        if (isDisabled && attempt < 3) {
          logger.info(`"分配渠道"菜单项已禁用，等待后重试...`);
          // Click elsewhere to close the dropdown
          await page.mouse.click(10, 10);
          await page.waitForTimeout(2000);
          continue;
        }

        await assignChannelLocator.first().click({ force: true });
        logger.info('已点击"分配渠道" (locator方式)');
        clicked = true;
      }
    } catch (e) {
      logger.info(`Locator方式失败: ${e.message}`);
    }

    if (!clicked) {
      // JavaScript fallback - force click even if disabled
      const jsResult = await page.evaluate(() => {
        const items = document.querySelectorAll('li.el-dropdown-menu__item, .dropDownBtnItem');
        for (const item of items) {
          if (item.textContent.includes('分配渠道')) {
            // Remove disabled state before clicking
            item.classList.remove('is-disabled');
            item.removeAttribute('aria-disabled');
            item.click();
            console.log('JS clicked 分配渠道');
            return true;
          }
        }
        return false;
      });
      logger.info(`JS点击"分配渠道": ${jsResult}`);
    }

    await page.waitForTimeout(1500);

    // Verify dialog opened
    const dialogOpened = await page.evaluate(() => {
      const dialog = document.querySelector('.batchDisLogisticsDialog');
      if (dialog) {
        const wrapper = dialog.closest('.el-dialog__wrapper');
        const style = wrapper?.getAttribute('style') || '';
        return !style.includes('display: none');
      }
      return false;
    });

    if (dialogOpened) {
      logger.info('批量分配渠道对话框已打开');
      return;
    }

    if (attempt < 3) {
      logger.info('对话框未打开，重试...');
      await page.waitForTimeout(1000);
    }
  }

  logger.info('已完成打开"分配渠道"的所有尝试');
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

  // First, list ALL 批量 buttons with their context for debugging
  const debugInfo = await page.evaluate(() => {
    let dialog = document.querySelector('.batchDisLogisticsDialog');
    if (!dialog) {
      const allWrappers = document.querySelectorAll('.el-dialog__wrapper');
      for (const wrapper of allWrappers) {
        const style = wrapper.getAttribute('style') || '';
        if (!style.includes('display: none') && !style.includes('display:none')) {
          dialog = wrapper.querySelector('.el-dialog') || wrapper;
          break;
        }
      }
    }
    if (!dialog) {
      return { hasDialog: false };
    }

    // Find ALL buttons with "批量" text
    const allButtons = dialog.querySelectorAll('button');
    const batchButtons = [];

    for (let i = 0; i < allButtons.length; i++) {
      const btn = allButtons[i];
      if (btn.textContent.trim() === '批量') {
        const cell = btn.closest('.vxe-cell, .vxe-cell--title, th, td');
        const cellText = cell?.textContent?.replace(/\s+/g, ' ').substring(0, 60) || 'no cell';
        const inBatchTemuSelect = !!btn.closest('.batch_temu_select');
        const inBatchTemuCascader = !!btn.closest('.batch_temu_cascader');
        const rect = btn.getBoundingClientRect();

        batchButtons.push({
          index: i,
          cellText,
          inBatchTemuSelect,
          inBatchTemuCascader,
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          visible: rect.width > 0 && rect.height > 0
        });
      }
    }

    // Find the one specifically next to "店铺仓库" text
    const storeWarehouseButtons = [];
    const spans = dialog.querySelectorAll('span');
    for (const span of spans) {
      if (span.textContent.trim() === '店铺仓库') {
        const parent = span.parentElement;
        // Look for both batch_temu_select and batch_temu_cascader
        const batchElement = parent?.querySelector('.batch_temu_select, .batch_temu_cascader');
        if (batchElement) {
          const btn = batchElement.querySelector('button');
          if (btn) {
            const rect = btn.getBoundingClientRect();
            storeWarehouseButtons.push({
              spanText: span.textContent,
              parentTag: parent?.tagName,
              buttonText: btn.textContent.trim(),
              type: batchElement.classList.contains('batch_temu_cascader') ? 'cascader' : 'select',
              x: Math.round(rect.x),
              y: Math.round(rect.y)
            });
          }
        }
      }
    }

    return {
      hasDialog: true,
      totalBatchButtons: batchButtons.length,
      batchButtons: batchButtons.slice(0, 30),
      storeWarehouseButtons
    };
  });

  logger.info(`找到 ${debugInfo.totalBatchButtons} 个批量按钮`);
  logger.info(`店铺仓库旁的批量按钮: ${JSON.stringify(debugInfo.storeWarehouseButtons)}`);

  // Log first few batch buttons for context
  if (debugInfo.batchButtons) {
    for (const btn of debugInfo.batchButtons.slice(0, 10)) {
      logger.info(`批量按钮 #${btn.index}: "${btn.cellText}" inBatchTemuSelect=${btn.inBatchTemuSelect} pos=(${btn.x},${btn.y})`);
    }
  }

  const clickBatchResult = await page.evaluate(() => {
    // Find the dialog - try specific class first, then generic
    let dialog = document.querySelector('.batchDisLogisticsDialog');
    if (!dialog) {
      // Try finding visible dialog wrapper
      const allWrappers = document.querySelectorAll('.el-dialog__wrapper');
      for (const wrapper of allWrappers) {
        const style = wrapper.getAttribute('style') || '';
        if (!style.includes('display: none') && !style.includes('display:none')) {
          const innerDialog = wrapper.querySelector('.el-dialog');
          if (innerDialog) {
            dialog = innerDialog;
            break;
          }
        }
      }
    }
    if (!dialog) {
      const allDialogs = document.querySelectorAll('.el-dialog__wrapper');
      return { success: false, error: `未找到对话框 (共${allDialogs.length}个)` };
    }

    // Method 0 (BEST for multi-shop): Find batch_temu_cascader in 店铺仓库 column
    // Multi-shop orders use el-cascader component instead of batch_temu_select
    const cascaders = dialog.querySelectorAll('.batch_temu_cascader');
    for (const cascader of cascaders) {
      const th = cascader.closest('th');
      if (th && th.textContent.includes('店铺仓库')) {
        const btn = cascader.querySelector('button');
        if (btn) {
          const rect = btn.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
            btn.click();
            return { success: true, message: `已点击店铺仓库批量按钮 (batch_temu_cascader) pos=(${Math.round(rect.x)},${Math.round(rect.y)})`, isCascader: true };
          }
        }
      }
    }

    // Method 1: Find batch_temu_select with placeholder="选择店铺仓库" (single-shop)
    const batchSelectByPlaceholder = dialog.querySelector('.batch_temu_select[placeholder="选择店铺仓库"]');
    if (batchSelectByPlaceholder) {
      const popoverTrigger = batchSelectByPlaceholder.querySelector('.popover_trigger');
      if (popoverTrigger) {
        const rect = popoverTrigger.getBoundingClientRect();
        popoverTrigger.focus();
        popoverTrigger.dispatchEvent(new MouseEvent('mouseenter', { bubbles: true }));
        popoverTrigger.dispatchEvent(new MouseEvent('mouseover', { bubbles: true }));
        popoverTrigger.click();
        return { success: true, message: `已点击店铺仓库批量按钮 (popover_trigger) pos=(${Math.round(rect.x)},${Math.round(rect.y)})` };
      }
      const btn = batchSelectByPlaceholder.querySelector('button');
      if (btn) {
        const rect = btn.getBoundingClientRect();
        btn.click();
        return { success: true, message: `已点击店铺仓库批量按钮 (button fallback) pos=(${Math.round(rect.x)},${Math.round(rect.y)})` };
      }
    }

    // Method 2: Find any batch component (batch_temu_select or batch_temu_cascader) in header with 店铺仓库
    const headerBatchElements = dialog.querySelectorAll('thead .batch_temu_select, thead .batch_temu_cascader, .vxe-table--header .batch_temu_select, .vxe-table--header .batch_temu_cascader');
    for (const bts of headerBatchElements) {
      const th = bts.closest('th');
      if (th) {
        const headerText = th.textContent;
        if (headerText.includes('店铺仓库') && !headerText.includes('Temu仓库')) {
          const btn = bts.querySelector('button');
          if (btn) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              const isCascader = bts.classList.contains('batch_temu_cascader');
              return { success: true, message: `已点击店铺仓库批量按钮 (thead) pos=(${Math.round(rect.x)},${Math.round(rect.y)})`, isCascader };
            }
          }
        }
      }
    }

    // Method 3: Find <span>店铺仓库</span> then look for sibling batch component
    const spans = dialog.querySelectorAll('span');
    for (const span of spans) {
      const spanText = span.textContent.trim();
      if (spanText === '店铺仓库') {
        const isInHeader = span.closest('thead, .vxe-table--header');
        if (!isInHeader) continue;

        const parent = span.parentElement;
        if (!parent) continue;

        // Look for both batch_temu_select and batch_temu_cascader
        const batchElement = parent.querySelector('.batch_temu_select, .batch_temu_cascader');
        if (batchElement) {
          const btn = batchElement.querySelector('button');
          if (btn) {
            const rect = btn.getBoundingClientRect();
            if (rect.width > 0 && rect.height > 0) {
              btn.click();
              const isCascader = batchElement.classList.contains('batch_temu_cascader');
              return { success: true, message: `已点击店铺仓库批量按钮 (span sibling) pos=(${Math.round(rect.x)},${Math.round(rect.y)})`, isCascader };
            }
          }
        }

        // Also check nextElementSibling
        let sibling = span.nextElementSibling;
        while (sibling) {
          if (sibling.classList.contains('batch_temu_select') || sibling.classList.contains('batch_temu_cascader')) {
            const btn = sibling.querySelector('button');
            if (btn) {
              const rect = btn.getBoundingClientRect();
              if (rect.width > 0 && rect.height > 0) {
                btn.click();
                const isCascader = sibling.classList.contains('batch_temu_cascader');
                return { success: true, message: `已点击店铺仓库批量按钮 (nextSibling) pos=(${Math.round(rect.x)},${Math.round(rect.y)})`, isCascader };
              }
            }
          }
          sibling = sibling.nextElementSibling;
        }
      }
    }

    // Debug info
    const batchTemuSelects = dialog.querySelectorAll('.batch_temu_select');
    const batchTemuCascaders = dialog.querySelectorAll('.batch_temu_cascader');
    const batchSelectInfo = [
      ...Array.from(batchTemuSelects).map(bts => ({
        type: 'select',
        placeholder: bts.getAttribute('placeholder'),
        inTh: !!bts.closest('th'),
        thText: bts.closest('th')?.textContent?.replace(/\s+/g, ' ').substring(0, 30) || 'no th'
      })),
      ...Array.from(batchTemuCascaders).map(bts => ({
        type: 'cascader',
        inTh: !!bts.closest('th'),
        thText: bts.closest('th')?.textContent?.replace(/\s+/g, ' ').substring(0, 30) || 'no th'
      }))
    ];

    return {
      success: false,
      error: '未找到店铺仓库批量按钮',
      batchSelectCount: batchTemuSelects.length,
      batchCascaderCount: batchTemuCascaders.length,
      batchSelectInfo
    };
  });

  if (!clickBatchResult.success) {
    logger.info(`点击批量按钮失败: ${clickBatchResult.error}`);
    if (clickBatchResult.batchSelectInfo) {
      logger.info(`batch_temu_select详情: ${JSON.stringify(clickBatchResult.batchSelectInfo)}`);
    }
    throw new Error('无法打开仓库选择器');
  }

  logger.info(clickBatchResult.message);

  if (clickBatchResult.isCascader) {
    // Multi-shop cascader: the JS click already opened the panel.
    // DO NOT click anything else - it would toggle it off!
    // Just wait for the cascader panel to render.
    await page.waitForTimeout(2000);

    // Check if cascader panel is visible
    const cascaderVisible = await page.evaluate(() => {
      const menus = document.querySelectorAll('.el-cascader-menu');
      let visibleCount = 0;
      for (const menu of menus) {
        const rect = menu.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) visibleCount++;
      }
      // Also check for cascader_panel_wrapper
      const panelWrapper = document.querySelector('.cascader_panel_wrapper');
      const panelVisible = panelWrapper && panelWrapper.getBoundingClientRect().width > 0;
      return { visibleMenus: visibleCount, panelVisible: !!panelVisible };
    });

    logger.info(`cascader面板状态: 可见菜单=${cascaderVisible.visibleMenus}, 面板可见=${cascaderVisible.panelVisible}`);

    if (cascaderVisible.visibleMenus === 0 && !cascaderVisible.panelVisible) {
      // Panel didn't open - try clicking the button once more via Playwright
      logger.info('cascader面板未打开，重新点击批量按钮...');
      try {
        const cascaderBtn = page.locator('.batchDisLogisticsDialog .batch_temu_cascader button').first();
        if (await cascaderBtn.count() > 0) {
          await cascaderBtn.click({ force: true });
          await page.waitForTimeout(2000);
        }
      } catch (e) {
        logger.info(`重新点击失败: ${e.message}`);
      }
    }
  } else {
    // Single-shop: use Playwright backup click on popover trigger
    try {
      const batchTrigger = page.locator('.batchDisLogisticsDialog .batch_temu_select[placeholder="选择店铺仓库"] .popover_trigger');
      const count = await batchTrigger.count();
      if (count > 0) {
        logger.info('使用 Playwright 原生点击 popover_trigger...');
        await batchTrigger.first().click({ force: true });
      }
    } catch (e) {
      logger.info(`Playwright点击失败: ${e.message}`);
    }

    // Wait for dropdown to appear
    await page.waitForTimeout(2000);
  }

  // Debug: Check what popovers/menus appeared after clicking
  const popoverDebug = await page.evaluate(() => {
    // Check for el-popover that is now visible (not display:none)
    const allPopovers = document.querySelectorAll('.el-popover');
    const visiblePopovers = [];
    for (const p of allPopovers) {
      const style = window.getComputedStyle(p);
      if (style.display !== 'none') {
        visiblePopovers.push({
          id: p.id,
          className: p.className.substring(0, 50),
          innerText: p.innerText?.substring(0, 100) || '',
          hasSelectMenu: !!p.querySelector('.select-menu'),
          hasCascader: !!p.querySelector('.el-cascader-menu')
        });
      }
    }

    // Check for select-menu anywhere on the page
    const selectMenus = document.querySelectorAll('.select-menu');
    const visibleSelectMenus = [];
    for (const m of selectMenus) {
      const rect = m.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        const items = m.querySelectorAll('.select-dropdown__item');
        visibleSelectMenus.push({
          width: rect.width,
          height: rect.height,
          itemCount: items.length
        });
      }
    }

    return {
      visiblePopovers,
      visibleSelectMenus
    };
  });

  logger.info(`弹出菜单调试: popovers=${popoverDebug.visiblePopovers.length}, selectMenus=${popoverDebug.visibleSelectMenus.length}`);
  if (popoverDebug.visiblePopovers.length > 0) {
    logger.info(`Popover详情: ${JSON.stringify(popoverDebug.visiblePopovers)}`);
  }
  if (popoverDebug.visibleSelectMenus.length > 0) {
    logger.info(`SelectMenu详情: ${JSON.stringify(popoverDebug.visibleSelectMenus)}`);
  }

  // Detect menu type and select warehouses
  // IMPORTANT: Search in entire document, not just dialog, because popovers may be outside dialog
  const menuInfo = await page.evaluate(() => {
    // Check for custom sf_select menu (one-level)
    const selectMenu = document.querySelector('.select-menu');
    const dropdownItems = document.querySelectorAll('.select-dropdown__item');

    // Check for cascader menu (two-level)
    const cascaderMenus = document.querySelectorAll('.el-cascader-menu');
    const cascaderNodes = document.querySelectorAll('.el-cascader-node');

    // Check for Element UI checkboxes
    const checkboxes = document.querySelectorAll('.el-checkbox');

    // Check for el-select dropdown (another type of one-level menu)
    const elSelectDropdown = document.querySelector('.el-select-dropdown:not([style*="display: none"])');
    const elSelectItems = document.querySelectorAll('.el-select-dropdown__item');

    // Check for popover content (common wrapper for dropdowns)
    const popoverContent = document.querySelector('.el-popover:not([style*="display: none"]), .popover_content');

    // Count visible items
    let visibleDropdownItems = 0;
    for (const item of dropdownItems) {
      const rect = item.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) visibleDropdownItems++;
    }

    let visibleCheckboxes = 0;
    for (const cb of checkboxes) {
      const rect = cb.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) visibleCheckboxes++;
    }

    let visibleElSelectItems = 0;
    for (const item of elSelectItems) {
      const rect = item.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) visibleElSelectItems++;
    }

    // Get sample of what's visible on page for debugging
    const visiblePopups = [];
    const allPopovers = document.querySelectorAll('.el-popover, .popover_content, .el-select-dropdown, .select-menu, .el-cascader-menus');
    for (const p of allPopovers) {
      const rect = p.getBoundingClientRect();
      if (rect.width > 0 && rect.height > 0) {
        visiblePopups.push({
          className: p.className.substring(0, 50),
          childCount: p.children.length,
          innerText: p.innerText?.substring(0, 100) || ''
        });
      }
    }

    const debugInfo = {
      hasSelectMenu: !!selectMenu,
      dropdownItemCount: visibleDropdownItems,
      cascaderMenuCount: cascaderMenus.length,
      cascaderNodeCount: cascaderNodes.length,
      checkboxCount: visibleCheckboxes,
      hasElSelectDropdown: !!elSelectDropdown,
      elSelectItemCount: visibleElSelectItems,
      hasPopover: !!popoverContent,
      visiblePopups
    };

    console.log('菜单检测调试:', JSON.stringify(debugInfo));

    // Priority 1: Custom sf_select menu (one-level)
    if (selectMenu && visibleDropdownItems > 0) {
      return { type: 'one-level', menuCount: 1, debug: debugInfo };
    }

    // Priority 2: el-select dropdown (one-level)
    if (elSelectDropdown && visibleElSelectItems > 0) {
      return { type: 'el-select', menuCount: 1, debug: debugInfo };
    }

    // Priority 3: Cascader menu with 2+ menus (two-level)
    if (cascaderMenus.length >= 2) {
      return { type: 'two-level', menuCount: cascaderMenus.length, debug: debugInfo };
    }

    // Priority 4: Check for cascader items with arrows (indicates two-level)
    let hasArrows = false;
    for (const item of cascaderNodes) {
      const arrow = item.querySelector('.el-icon-arrow-right, .el-cascader-node__postfix');
      if (arrow) {
        hasArrows = true;
        break;
      }
    }

    // Single cascader menu without arrows = one-level
    if (cascaderMenus.length === 1 && !hasArrows) {
      return { type: 'one-level-cascader', menuCount: 1, debug: debugInfo };
    }

    if (cascaderMenus.length === 1 && hasArrows) {
      return { type: 'two-level', menuCount: 1, debug: debugInfo };
    }

    // Priority 5: Element UI checkboxes (one-level)
    if (visibleCheckboxes > 0 && cascaderMenus.length === 0) {
      return { type: 'one-level', menuCount: 1, debug: debugInfo };
    }

    return { type: 'unknown', menuCount: 0, debug: debugInfo };
  });

  logger.info(`检测到仓库菜单类型: ${menuInfo.type}`);
  if (menuInfo.debug) {
    logger.info(`菜单检测详情: selectMenu=${menuInfo.debug.hasSelectMenu}, items=${menuInfo.debug.dropdownItemCount}, cascader=${menuInfo.debug.cascaderMenuCount}`);
  }

  if (menuInfo.type === 'one-level' || menuInfo.type === 'one-level-cascader' || menuInfo.type === 'el-select') {
    // One-level menu: select the first option after "全选"
    await handleOneLevelWarehouseMenu(page, menuInfo.type);
  } else if (menuInfo.type === 'two-level') {
    // Two-level menu: iterate through each first-level item and select from second level
    await handleTwoLevelWarehouseMenu(page);
  } else {
    // Unknown type - try one-level first, then two-level
    logger.info('未知菜单类型，尝试一级菜单处理...');
    await handleOneLevelWarehouseMenu(page, 'unknown');
  }

  // Wait a moment then click confirm button
  await page.waitForTimeout(1000);
  logger.info('准备点击确定按钮...');

  // Click confirm button in the dropdown
  const confirmResult = await page.evaluate(() => {
    // Method 1: sf_select footer confirm button
    const sfFooter = document.querySelector('.sf_select__footer');
    if (sfFooter) {
      const confirmBtn = sfFooter.querySelector('button.el-button--primary');
      if (confirmBtn) {
        confirmBtn.click();
        return { success: true, message: '已点击确定按钮 (sf_select)' };
      }
    }

    // Method 2: el-cascader panel footer confirm button
    const cascaderPanels = document.querySelectorAll('.el-cascader-panel, .el-cascader-menus');
    for (const panel of cascaderPanels) {
      const rect = panel.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      // Look for confirm button in or after the panel
      const footer = panel.querySelector('.el-cascader__footer, footer, .footer');
      if (footer) {
        const btn = footer.querySelector('button');
        if (btn) {
          btn.click();
          return { success: true, message: '已点击确定按钮 (cascader footer)' };
        }
      }
    }

    // Method 3: Find confirm button inside popover
    const popovers = document.querySelectorAll('.el-popover, .popover_content, .popover_box');
    for (const popover of popovers) {
      const rect = popover.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const btns = popover.querySelectorAll('button');
      for (const btn of btns) {
        const text = btn.textContent.trim();
        if (text === '确定' || text === '确认') {
          btn.click();
          return { success: true, message: '已点击确定按钮 (popover)' };
        }
      }
    }

    // Method 4: Find any visible primary button with "确定" text
    const buttons = document.querySelectorAll('button');
    const candidateButtons = [];
    for (const btn of buttons) {
      const text = btn.textContent.trim();
      if ((text === '确定' || text === '确认') && btn.offsetParent !== null) {
        const rect = btn.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          candidateButtons.push({ btn, rect });
        }
      }
    }

    // Sort by position (prefer buttons lower on page, likely in dropdown)
    candidateButtons.sort((a, b) => b.rect.top - a.rect.top);

    if (candidateButtons.length > 0) {
      candidateButtons[0].btn.click();
      return { success: true, message: `已点击确定按钮 (通用, y=${candidateButtons[0].rect.top})` };
    }

    // Method 5: Just close the dropdown by clicking elsewhere or pressing Escape
    // Sometimes dropdowns auto-apply selection
    return { success: false, error: '未找到确定按钮', candidateCount: candidateButtons.length };
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
 * Supports both Element UI checkbox and custom sf_select component
 * @param {Object} page - Playwright page
 * @param {string} menuType - Type of menu detected
 */
async function handleOneLevelWarehouseMenu(page, menuType = 'one-level') {
  logger.info(`处理一级仓库菜单 (类型: ${menuType})...`);

  const result = await page.evaluate((type) => {
    // First try: Custom sf_select component (vue-recycle-scroller)
    const selectMenu = document.querySelector('.select-menu');
    if (selectMenu) {
      console.log('检测到自定义 select-menu 组件');

      // Find all dropdown items
      const items = selectMenu.querySelectorAll('.select-dropdown__item');
      console.log('找到 dropdown items:', items.length);

      for (const item of items) {
        // Get the label text
        const label = item.querySelector('.main_label');
        const text = label?.textContent?.trim() || label?.getAttribute('title') || '';

        // Skip empty or "全选"
        if (!text || text === '全选') continue;

        // Check if visible
        const rect = item.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Click the checkbox (.check_box) or the item itself
        const checkbox = item.querySelector('.check_box');
        if (checkbox) {
          checkbox.click();
          return { success: true, selected: text, method: 'sf_select_checkbox' };
        }

        // Fallback: click the item
        item.click();
        return { success: true, selected: text, method: 'sf_select_item' };
      }
    }

    // Second try: el-cascader-menu with checkboxes (single level)
    const cascaderMenus = document.querySelectorAll('.el-cascader-menu');
    console.log('找到 el-cascader-menu:', cascaderMenus.length);

    for (const menu of cascaderMenus) {
      const rect = menu.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const nodes = menu.querySelectorAll('.el-cascader-node');
      console.log('cascader menu nodes:', nodes.length);

      for (const node of nodes) {
        const label = node.querySelector('.el-cascader-node__label');
        const text = label?.textContent?.trim() || '';

        // Skip "全选"
        if (!text || text === '全选') continue;

        // Find checkbox
        const checkboxInner = node.querySelector('.el-checkbox__inner');
        const checkboxInput = node.querySelector('.el-checkbox__input');

        if (checkboxInner) {
          checkboxInner.click();
          return { success: true, selected: text, method: 'cascader_checkbox_inner' };
        }
        if (checkboxInput) {
          checkboxInput.click();
          return { success: true, selected: text, method: 'cascader_checkbox_input' };
        }

        // Try clicking the node itself
        node.click();
        return { success: true, selected: text, method: 'cascader_node' };
      }
    }

    // Third try: el-select dropdown items
    const elSelectItems = document.querySelectorAll('.el-select-dropdown__item');
    console.log('找到 el-select-dropdown__item:', elSelectItems.length);

    for (const item of elSelectItems) {
      const text = item.textContent?.trim() || '';

      if (!text || text === '全选') continue;

      const rect = item.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      item.click();
      return { success: true, selected: text, method: 'el_select_item' };
    }

    // Fourth try: Element UI checkbox anywhere
    const allCheckboxes = document.querySelectorAll('.el-checkbox');
    console.log('找到 el-checkbox:', allCheckboxes.length);

    for (const checkbox of allCheckboxes) {
      const label = checkbox.querySelector('.el-checkbox__label');
      const text = label?.textContent?.trim() || '';

      if (!text || text === '全选' || text.includes('全选')) continue;

      const rect = checkbox.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;

      const inner = checkbox.querySelector('.el-checkbox__inner');
      if (inner) {
        inner.click();
        return { success: true, selected: text, method: 'el_checkbox_inner' };
      }

      checkbox.click();
      return { success: true, selected: text, method: 'el_checkbox' };
    }

    // Debug info
    const debugInfo = {
      hasSelectMenu: !!selectMenu,
      dropdownItemCount: selectMenu?.querySelectorAll('.select-dropdown__item').length || 0,
      elCheckboxCount: allCheckboxes.length,
      cascaderMenuCount: cascaderMenus.length,
      elSelectItemCount: elSelectItems.length
    };

    return { success: false, error: '未找到可选仓库', debug: debugInfo };
  }, menuType);

  if (result.success) {
    logger.info(`一级菜单已选择: ${result.selected} (方法: ${result.method})`);
  } else {
    logger.info(`一级菜单选择失败: ${result.error}`);
    if (result.debug) {
      logger.info(`调试信息: ${JSON.stringify(result.debug)}`);
    }
  }
}

/**
 * Handle two-level warehouse menu selection
 * Dynamically detects all first-level items in the cascader panel,
 * hovers each to expand submenu, then selects the configured warehouse.
 * Uses warehouseMapping from config for specific selections.
 * @param {Object} page - Playwright page
 */
async function handleTwoLevelWarehouseMenu(page) {
  logger.info('处理二级仓库菜单...');

  // Debug: enumerate ALL cascader-related elements in the entire page
  const cascaderDebug = await page.evaluate(() => {
    const results = {
      cascaderMenus: [],
      cascaderPanels: [],
      cascaderDropdowns: [],
      poppers: []
    };

    // Check all .el-cascader-menu elements
    document.querySelectorAll('.el-cascader-menu').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const nodes = el.querySelectorAll('.el-cascader-node');
      const labels = Array.from(nodes).map(n => n.querySelector('.el-cascader-node__label')?.textContent?.trim() || '').filter(Boolean);
      results.cascaderMenus.push({
        index: i,
        visible: rect.width > 0 && rect.height > 0,
        rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
        nodeCount: nodes.length,
        labels: labels.slice(0, 10),
        parentClass: el.parentElement?.className?.substring(0, 80) || ''
      });
    });

    // Check .el-cascader-panel elements
    document.querySelectorAll('.el-cascader-panel').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      results.cascaderPanels.push({
        index: i,
        visible: rect.width > 0 && rect.height > 0,
        rect: { w: Math.round(rect.width), h: Math.round(rect.height) },
        menuCount: el.querySelectorAll('.el-cascader-menu').length
      });
    });

    // Check .el-popper elements that contain cascader content
    document.querySelectorAll('.el-popper, .el-cascader__dropdown').forEach((el, i) => {
      const rect = el.getBoundingClientRect();
      const hasCascader = el.querySelector('.el-cascader-menu, .el-cascader-panel');
      if (hasCascader) {
        const display = window.getComputedStyle(el).display;
        results.poppers.push({
          index: i,
          visible: rect.width > 0 && rect.height > 0,
          display,
          rect: { x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.width), h: Math.round(rect.height) },
          className: el.className.substring(0, 80)
        });
      }
    });

    return results;
  });

  logger.info(`Cascader调试: menus=${cascaderDebug.cascaderMenus.length}, panels=${cascaderDebug.cascaderPanels.length}, poppers=${cascaderDebug.poppers.length}`);
  for (const menu of cascaderDebug.cascaderMenus) {
    logger.info(`  menu[${menu.index}]: visible=${menu.visible} rect=${JSON.stringify(menu.rect)} nodes=${menu.nodeCount} labels=[${menu.labels.join(',')}] parent=${menu.parentClass}`);
  }
  for (const panel of cascaderDebug.cascaderPanels) {
    logger.info(`  panel[${panel.index}]: visible=${panel.visible} rect=${JSON.stringify(panel.rect)} menus=${panel.menuCount}`);
  }
  for (const popper of cascaderDebug.poppers) {
    logger.info(`  popper[${popper.index}]: visible=${popper.visible} display=${popper.display} rect=${JSON.stringify(popper.rect)}`);
  }

  // Get first-level items - search ALL cascader menus (including those inside poppers)
  const firstLevelItems = await page.evaluate(() => {
    // Find all cascader menus and get the ones that are visible OR have content
    const allMenus = document.querySelectorAll('.el-cascader-menu');
    const menusWithContent = [];

    for (const menu of allMenus) {
      const nodes = menu.querySelectorAll('.el-cascader-node');
      if (nodes.length === 0) continue;

      const rect = menu.getBoundingClientRect();
      // Include menus that are visible OR inside a visible parent
      const parentPopper = menu.closest('.el-popper, .el-cascader__dropdown, .el-cascader-panel');
      const parentRect = parentPopper?.getBoundingClientRect();
      const isInVisibleParent = parentRect && parentRect.width > 0 && parentRect.height > 0;
      const isVisible = rect.width > 0 && rect.height > 0;

      if (isVisible || isInVisibleParent) {
        menusWithContent.push({
          menu,
          rect,
          x: isVisible ? rect.left : (parentRect?.left || 0),
          nodeCount: nodes.length,
          isVisible
        });
      }
    }

    // Sort by X position (leftmost = first level)
    menusWithContent.sort((a, b) => a.x - b.x);

    if (menusWithContent.length === 0) {
      return { items: [], debug: 'no visible menus found' };
    }

    // Use the first menu (leftmost) as first-level
    const firstMenu = menusWithContent[0].menu;
    const nodes = firstMenu.querySelectorAll('.el-cascader-node');
    const items = [];

    for (const node of nodes) {
      const label = node.querySelector('.el-cascader-node__label');
      if (!label) continue;

      const text = label.textContent.trim();
      if (!text || text === '全选') continue;

      items.push({ text });
    }

    // Deduplicate
    const seen = new Set();
    const unique = items.filter(item => {
      if (seen.has(item.text)) return false;
      seen.add(item.text);
      return true;
    });

    return {
      items: unique,
      debug: `found ${menusWithContent.length} menus, first has ${nodes.length} nodes`
    };
  });

  const itemNames = firstLevelItems.items.map(i => i.text);
  logger.info(`找到 ${firstLevelItems.items.length} 个一级菜单项: ${itemNames.join(', ')} (${firstLevelItems.debug})`);

  // If no items found, try alternative selection method
  if (firstLevelItems.items.length === 0) {
    logger.info('尝试备用选择方法...');
    await handleWarehouseSelectionFallback(page);
    return;
  }

  // Process each first-level item
  for (const item of firstLevelItems.items) {
    const itemName = item.text;
    logger.info(`处理一级菜单: ${itemName} → 选第一个仓库`);

    // Hover on the first-level item to expand its submenu
    const hoverResult = await page.evaluate((name) => {
      const allNodes = document.querySelectorAll('.el-cascader-node');
      for (const node of allNodes) {
        const label = node.querySelector('.el-cascader-node__label');
        if (!label || label.textContent.trim() !== name) continue;

        const rect = node.getBoundingClientRect();
        if (rect.width === 0 || rect.height === 0) continue;

        // Trigger hover events on the node
        const events = ['mouseenter', 'mouseover', 'mousemove'];
        for (const eventType of events) {
          node.dispatchEvent(new MouseEvent(eventType, {
            bubbles: true, cancelable: true, view: window,
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2
          }));
        }

        // Also trigger on the label
        const labelRect = label.getBoundingClientRect();
        for (const eventType of events) {
          label.dispatchEvent(new MouseEvent(eventType, {
            bubbles: true, cancelable: true, view: window,
            clientX: labelRect.left + labelRect.width / 2,
            clientY: labelRect.top + labelRect.height / 2
          }));
        }

        return { success: true, nodeRect: { x: rect.left, y: rect.top, w: rect.width, h: rect.height } };
      }
      return { success: false, error: '未找到匹配的cascader节点' };
    }, itemName);

    if (!hoverResult.success) {
      logger.info(`无法hover到: ${itemName}, ${hoverResult.error}`);
      continue;
    }
    logger.info(`已hover到一级菜单: ${itemName}`);

    // Also use Playwright mouse for more reliable hover
    try {
      const nr = hoverResult.nodeRect;
      await page.mouse.move(nr.x + nr.w / 2, nr.y + nr.h / 2);
    } catch (e) { /* ignore */ }

    // Wait for submenu to appear
    await page.waitForTimeout(1000);

    // Select the first non-全选 item in the second-level submenu
    const selectArgs = { parentName: itemName, allParentNames: itemNames };
    const selectResult = await page.evaluate((args) => {
      const { parentName, allParentNames } = args;

      // Find all visible cascader menus
      const cascaderMenus = document.querySelectorAll('.el-cascader-menu');
      const visibleMenus = [];

      for (const menu of cascaderMenus) {
        const rect = menu.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          visibleMenus.push({ menu, x: rect.left });
        }
      }

      visibleMenus.sort((a, b) => b.x - a.x); // rightmost first

      if (visibleMenus.length < 2) {
        return { success: false, error: `二级菜单未显示 (可见菜单数: ${visibleMenus.length})` };
      }

      // The rightmost menu is the submenu
      const submenu = visibleMenus[0].menu;
      const submenuNodes = submenu.querySelectorAll('.el-cascader-node');
      const allItems = [];

      for (const node of submenuNodes) {
        const label = node.querySelector('.el-cascader-node__label');
        if (!label) continue;

        const text = label.textContent.trim();
        allItems.push(text);

        // Skip 全选 and parent-level names
        if (text === '全选' || allParentNames.includes(text)) continue;

        // Click the first valid item's checkbox
        const inner = node.querySelector('.el-checkbox__inner');
        const input = node.querySelector('.el-checkbox__input');

        if (inner) {
          inner.click();
          return { success: true, selected: text, parent: parentName };
        } else if (input) {
          input.click();
          return { success: true, selected: text, parent: parentName };
        }

        // Try clicking the node itself
        node.click();
        return { success: true, selected: text, parent: parentName, method: 'node_click' };
      }

      return { success: false, error: `${parentName} 的二级菜单中未找到可选项`, submenuItems: allItems };
    }, selectArgs);

    if (selectResult.success) {
      logger.info(`已选择: ${selectResult.parent} > ${selectResult.selected}`);
    } else {
      logger.info(`选择失败: ${selectResult.error}`);
      if (selectResult.submenuItems) {
        logger.info(`二级菜单内容: ${selectResult.submenuItems.join(', ')}`);
      }
    }

    await page.waitForTimeout(500);
  }
}

/**
 * Fallback warehouse selection when standard cascader detection fails
 * Strategy: Find all visible cascader nodes and try to select appropriate warehouses.
 * First tries clicking "全选" in each menu, then falls back to clicking first available item.
 * @param {Object} page - Playwright page
 */
async function handleWarehouseSelectionFallback(page) {
  logger.info('使用备用方法选择仓库...');

  // Debug: log all visible cascader content
  const debugResult = await page.evaluate(() => {
    const menus = document.querySelectorAll('.el-cascader-menu');
    const menuInfo = [];
    for (const menu of menus) {
      const rect = menu.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const nodes = menu.querySelectorAll('.el-cascader-node');
      const items = [];
      for (const node of nodes) {
        const label = node.querySelector('.el-cascader-node__label');
        const checkbox = node.querySelector('.el-checkbox__input');
        items.push({
          text: label?.textContent?.trim() || '',
          hasCheckbox: !!checkbox,
          isChecked: checkbox?.classList.contains('is-checked') || false,
          hasArrow: !!node.querySelector('.el-icon-arrow-right, .el-cascader-node__postfix')
        });
      }
      menuInfo.push({ x: Math.round(rect.left), items });
    }
    return menuInfo;
  });

  logger.info(`备用方法 - 找到 ${debugResult.length} 个可见cascader菜单`);
  for (const menu of debugResult) {
    const itemList = menu.items.map(i => `${i.text}(cb=${i.hasCheckbox},chk=${i.isChecked},arr=${i.hasArrow})`).join(', ');
    logger.info(`菜单 x=${menu.x}: ${itemList}`);
  }

  // Strategy: Try to click "全选" in the leftmost menu (select all first-level items)
  const result = await page.evaluate(() => {
    const menus = document.querySelectorAll('.el-cascader-menu');
    const visibleMenus = Array.from(menus)
      .filter(m => {
        const rect = m.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      })
      .sort((a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left);

    if (visibleMenus.length === 0) {
      return { success: false, error: '未找到可见的cascader菜单' };
    }

    const selected = [];

    // Try clicking "全选" checkbox in the first (leftmost) menu
    for (const menu of visibleMenus) {
      const nodes = menu.querySelectorAll('.el-cascader-node');
      for (const node of nodes) {
        const label = node.querySelector('.el-cascader-node__label');
        const text = label?.textContent?.trim() || '';

        if (text === '全选') {
          const checkbox = node.querySelector('.el-checkbox__input');
          if (checkbox && !checkbox.classList.contains('is-checked')) {
            const inner = node.querySelector('.el-checkbox__inner');
            if (inner) {
              inner.click();
              selected.push('全选');
              return { success: true, selected, method: '全选' };
            }
            checkbox.click();
            selected.push('全选');
            return { success: true, selected, method: '全选' };
          }
        }
      }
    }

    // If no "全选", click each non-checked item in the first menu
    const firstMenu = visibleMenus[0];
    const nodes = firstMenu.querySelectorAll('.el-cascader-node');
    for (const node of nodes) {
      const label = node.querySelector('.el-cascader-node__label');
      const text = label?.textContent?.trim() || '';
      if (!text || text === '全选') continue;

      const checkbox = node.querySelector('.el-checkbox__input');
      if (checkbox && !checkbox.classList.contains('is-checked')) {
        const inner = node.querySelector('.el-checkbox__inner');
        if (inner) {
          inner.click();
          selected.push(text);
        } else {
          checkbox.click();
          selected.push(text);
        }
      }
    }

    return { success: selected.length > 0, selected, method: '逐项选择' };
  });

  if (result.success) {
    logger.info(`备用方法已选择 (${result.method}): ${result.selected.join(', ')}`);
  } else {
    logger.info(`备用方法未能选择任何仓库: ${result.error || '无可选项'}`);
  }
}

/**
 * Click auto compare button and wait for comparison to complete
 * @param {Object} page - Playwright page
 */
async function clickAutoCompare(page) {
  logger.info('准备点击"自动比价"按钮...');

  // Wait for page to stabilize
  await page.waitForTimeout(1000);

  // Start Playwright network tracker BEFORE clicking so we catch all requests
  const tracker = startNetworkTracker(page);

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

  // Wait for auto compare to complete
  logger.info('等待自动比价完成...');
  await waitForAutoCompareComplete(page, tracker);
}

/**
 * Wait for auto compare request to complete
 * @param {Object} page - Playwright page
 */
/**
 * Start Playwright-level network request tracking (non-invasive, no page injection)
 * @param {Object} page - Playwright page
 * @returns {Object} tracker object with pending/total counts
 */
function startNetworkTracker(page) {
  const tracker = {
    pending: 0,
    total: 0,
    lastResponseTime: 0,
    onRequest: null,
    onResponse: null,
    onRequestFailed: null,
  };

  tracker.onRequest = (request) => {
    tracker.pending++;
    tracker.total++;
  };

  tracker.onResponse = (response) => {
    tracker.pending = Math.max(0, tracker.pending - 1);
    tracker.lastResponseTime = Date.now();
  };

  tracker.onRequestFailed = (request) => {
    tracker.pending = Math.max(0, tracker.pending - 1);
    tracker.lastResponseTime = Date.now();
  };

  page.on('request', tracker.onRequest);
  page.on('response', tracker.onResponse);
  page.on('requestfailed', tracker.onRequestFailed);

  return tracker;
}

function stopNetworkTracker(page, tracker) {
  if (tracker.onRequest) page.removeListener('request', tracker.onRequest);
  if (tracker.onResponse) page.removeListener('response', tracker.onResponse);
  if (tracker.onRequestFailed) page.removeListener('requestfailed', tracker.onRequestFailed);
}

async function waitForAutoCompareComplete(page, tracker) {
  const maxWaitTime = 120000; // 120 seconds max
  const checkInterval = 2000;
  let elapsed = 0;

  // Phase 1: Wait for at least one request to fire (up to 10 seconds)
  logger.info('等待比价请求发出...');
  const phase1Max = 10000;

  while (elapsed < phase1Max) {
    await page.waitForTimeout(1000);
    elapsed += 1000;

    if (tracker.total > 0) {
      logger.info(`检测到比价请求已发出 (total=${tracker.total}, pending=${tracker.pending}, ${elapsed / 1000}秒)`);
      break;
    }
  }

  if (tracker.total === 0) {
    logger.info('未检测到请求，等待5秒后继续...');
    await page.waitForTimeout(5000);
    stopNetworkTracker(page, tracker);
    return;
  }

  // Phase 2: Wait for all requests to complete
  logger.info('等待比价请求完成...');

  while (elapsed < maxWaitTime) {
    await page.waitForTimeout(checkInterval);
    elapsed += checkInterval;

    const idleMs = tracker.lastResponseTime > 0 ? Date.now() - tracker.lastResponseTime : 0;

    logger.info(`比价状态: pending=${tracker.pending}, total=${tracker.total}, idle=${idleMs}ms (${elapsed / 1000}秒)`);

    // Complete when: no pending requests AND idle for 3+ seconds
    if (tracker.pending === 0 && idleMs >= 3000) {
      logger.info(`自动比价完成 (耗时: ${elapsed / 1000}秒, 共${tracker.total}个请求)`);
      stopNetworkTracker(page, tracker);
      await page.waitForTimeout(1000); // UI settle
      return;
    }

    if (elapsed % 10000 === 0) {
      logger.info(`比价仍在进行中... (${elapsed / 1000}秒)`);
    }
  }

  logger.info(`自动比价等待超时 (${maxWaitTime / 1000}秒)，继续执行...`);
  stopNetworkTracker(page, tracker);
}

/**
 * Click save button in the dialog footer
 * @param {Object} page - Playwright page
 */
async function clickSaveButton(page) {
  logger.info('准备点击"保存并下单"按钮...');

  await page.waitForTimeout(500);

  const clickResult = await page.evaluate(() => {
    let dialog = document.querySelector('.batchDisLogisticsDialog');
    if (!dialog) {
      const allWrappers = document.querySelectorAll('.el-dialog__wrapper');
      for (const wrapper of allWrappers) {
        const style = wrapper.getAttribute('style') || '';
        if (!style.includes('display: none') && !style.includes('display:none')) {
          dialog = wrapper;
          break;
        }
      }
    }
    if (!dialog) {
      return { success: false, error: '对话框未找到' };
    }

    const footer = dialog.querySelector('.el-dialog__footer');
    if (!footer) {
      return { success: false, error: '对话框footer未找到' };
    }

    // Find "保存并下单" button
    const buttons = footer.querySelectorAll('button');
    for (const btn of buttons) {
      const text = btn.textContent.trim().replace(/\s+/g, '');
      if (text === '保存并下单') {
        btn.click();
        return { success: true, message: '已点击"保存并下单"按钮' };
      }
    }

    const buttonTexts = Array.from(buttons).map(b => b.textContent.trim());
    return { success: false, error: '未找到"保存并下单"按钮', buttons: buttonTexts };
  });

  if (clickResult.success) {
    logger.info(clickResult.message);
  } else {
    logger.info(`"保存并下单"按钮点击失败: ${clickResult.error}`);
    if (clickResult.buttons) {
      logger.info(`可用按钮: ${clickResult.buttons.join(', ')}`);
    }

    // Try Playwright locator as fallback
    try {
      const saveBtn = page.locator('.batchDisLogisticsDialog .el-dialog__footer button:has-text("保存并下单")').first();
      await saveBtn.click({ force: true });
      logger.info('已点击"保存并下单"按钮 (Playwright)');
    } catch (e) {
      logger.info(`Playwright点击失败: ${e.message}`);
    }
  }

  // Wait for save to complete
  await page.waitForTimeout(2000);
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

    // Step 2: Select orders by checkbox (跳过"未分配渠道"标签点击)
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

    // Step 8: Click save button
    await executeStep('点击"保存并下单"按钮', async () => {
      await clickSaveButton(page);
    });

    // Notify user that automation is complete
    emitEvent('log', {
      type: 'success',
      message: '自动化流程完成！已自动保存。',
      timestamp: Date.now(),
    });

    emitEvent('notification', {
      type: 'success',
      title: '自动化完成',
      message: '物流比价和保存已完成。',
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
