import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['test/**/*.test.js'],
    testTimeout: 20000,
    // Playwright 浏览器装在 node_modules/.local-browsers（本环境默认缓存目录写入被拦），
    // 让测试进程默认走该路径，fallback.test 等无需手动带环境变量。
    env: { PLAYWRIGHT_BROWSERS_PATH: '0' },
  },
});
