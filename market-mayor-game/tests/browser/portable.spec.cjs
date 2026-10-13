const { test, expect } = require('@playwright/test');
const fs = require('node:fs');
const path = require('node:path');
const html = fs.readFileSync(path.resolve(__dirname, '../../public/index.html'), 'utf8');

async function standalone(page) {
  const requests = [], errors = [];
  page.on('request', request => requests.push(request.url()));
  page.on('pageerror', error => errors.push(error.message));
  await page.route('http://preview.invalid/**', route => {
    if (route.request().url() === 'http://preview.invalid/index.html') return route.fulfill({ contentType: 'text/html', body: html });
    return route.abort(); // The preview has exactly one file and no server.
  });
  await page.goto('http://preview.invalid/index.html');
  return { requests, errors };
}

test('HTML 파일만 제공하는 미리보기: 스타일·일러스트·설정과 서버 안내', async ({ page }, testInfo) => {
  const { requests, errors } = await standalone(page);
  await expect(page.locator('.entry')).toHaveCSS('display', 'grid');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 24, 39)');
  await expect(page.locator('#entryCity svg')).toHaveCount(1);
  await expect(page.locator('#serverNotice')).toBeVisible();
  await expect(page.locator('#connection')).toHaveText('화면 미리보기');
  await expect(page.locator('#createBtn')).toBeDisabled();
  await expect(page.locator('#joinBtn')).toBeDisabled();
  await page.locator('[data-dialog=rulesDialog]').click();
  await expect(page.locator('#rulesDialog')).toBeVisible(); await page.keyboard.press('Escape');
  await page.locator('[data-dialog=settingsDialog]').click(); await page.locator('#reduceMotion').check();
  await expect(page.locator('body')).toHaveClass(/reduce-motion/); await page.keyboard.press('Escape');
  expect(requests.some(url => /\/(styles\.css|app\.js|ui\.js)$/.test(url))).toBe(false);
  expect(errors).toEqual([]);
  await page.evaluate(()=>{document.activeElement.blur();window.scrollTo(0,0)});
  await page.screenshot({ path: testInfo.outputPath('standalone-preview.png'), fullPage: true });
});

test('스크립트를 허용하지 않는 HTML 미리보기에서도 디자인 유지', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage(); await standalone(page);
  await expect(page.locator('.entry')).toHaveCSS('display', 'grid');
  await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(16, 24, 39)');
  await expect(page.locator('noscript .server-notice')).toBeVisible();
  await context.close();
});
