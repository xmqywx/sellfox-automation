import { runAutomation, setEventCallback } from './server/src/services/sellfox.js';
import { connectToChrome, disconnect, isConnected } from './server/src/services/playwright.js';

// Test order IDs (二级菜单测试)
const orderIds = [
  'PO-211-18204409764471604',
  'PO-211-18225164380792504',
  'PO-211-18066326159991341',
  'PO-211-18369677199992605',
  'PO-211-18064747940471284',
  'PO-211-18274455409272274',
  'PO-211-18461252547193147',
  'PO-211-17999712645750648',
  'PO-211-18351943506552772',
];

// Set event callback for logging
setEventCallback((type, data) => {
  console.log(`[${type}]`, JSON.stringify(data, null, 2));
});

async function main() {
  try {
    console.log('连接到 Chrome (端口 9222)...');
    await connectToChrome();

    if (!isConnected()) {
      throw new Error('无法连接到 Chrome');
    }

    console.log('已连接到 Chrome');
    console.log(`准备处理 ${orderIds.length} 个订单...`);

    // Run automation
    const result = await runAutomation(orderIds, null);

    console.log('自动化结果:', result);

  } catch (error) {
    console.error('错误:', error.message);
    console.error(error.stack);
  } finally {
    // Don't disconnect so user can verify results
    console.log('测试完成，保持连接以便验证结果');
  }
}

main();
