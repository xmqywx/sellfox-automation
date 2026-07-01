// src/crawler/fallback.js
import { chromium } from 'playwright';

let browserPromise = null;

function getBrowser() {
  if (!browserPromise) browserPromise = chromium.launch({ headless: true });
  return browserPromise;
}

export async function fetchRenderedHtml(url, { waitSelector } = {}) {
  const browser = await getBrowser();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  try {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    if (waitSelector) await page.waitForSelector(waitSelector, { timeout: 10000 }).catch(() => {});
    return await page.content();
  } finally {
    await ctx.close();
  }
}

export async function closeBrowser() {
  if (browserPromise) {
    const b = await browserPromise;
    await b.close();
    browserPromise = null;
  }
}
