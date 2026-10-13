'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const SDK = require('../src/sdk.js');
const root = path.resolve(__dirname, '..');
async function main() {
  let playwright;
  try { playwright = require(process.env.BOOK_ENGINE_PLAYWRIGHT || 'playwright'); }
  catch (_) { throw new Error('Playwright is needed only for this optional browser test. Set BOOK_ENGINE_PLAYWRIGHT to its installed package directory.'); }
  const options = { headless: true };
  if (process.env.BOOK_ENGINE_BROWSER) options.executablePath = process.env.BOOK_ENGINE_BROWSER;
  const browser = await playwright.chromium.launch(options);
  try {
    const context = await browser.newContext({ viewport: { width: 1440, height: 1050 }, acceptDownloads: true });
    await context.route('**/*', route => route.request().url().startsWith('file:') ? route.continue() : route.abort());
    const page = await context.newPage(), errors = [];
    page.on('pageerror', error => errors.push(error.message));
    page.on('dialog', dialog => dialog.accept());
    const sample = JSON.parse(await fs.readFile(path.join(root, 'data/sample-book.json'), 'utf8'));
    const book = JSON.parse(await fs.readFile(path.join(root, 'books/ai-test/BOOK.json'), 'utf8'));
    await page.goto(pathToFileURL(path.join(root, 'index.html')).href);
    await page.evaluate(p => { p.workflow.notes['1'] = 'legacy note retained'; localStorage.setItem('book-engine-project-v1', JSON.stringify(p)); }, sample);
    await page.reload();
    assert.equal(await page.locator('#title').inputValue(), sample.metadata.title);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('book-engine-project-v1')).workflow.notes['1']), 'legacy note retained');
    for (const name of ['metadata', 'sources', 'chapters', 'workflow', 'preview', 'ai']) await page.locator('[data-view="' + name + '"]').click();
    await page.locator('#aiBrief').fill('یک کتاب کار سه‌فصلی برای معلمان بساز.');
    await page.locator('#aiOutputMode').selectOption('html');
    await page.locator('[data-action="make-book-prompt"]').click();
    assert.match(await page.locator('#fullBookPrompt').inputValue(), /HTML تک‌فایلی/);
    await page.locator('[data-action="open-book-import"]').click();
    const bad = JSON.parse(JSON.stringify(book)); bad.chapters[0].blocks[0].sourceId = 'missing';
    await page.locator('#bookInput').fill(JSON.stringify(bad));
    await page.locator('[data-action="apply-book"]').click();
    assert.match(await page.locator('#bookImportError').innerText(), /منبع/);
    assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('book-engine-project-v1')).metadata.title), sample.metadata.title);
    await page.locator('#bookInput').fill(JSON.stringify(book));
    await page.locator('[data-action="apply-book"]').click();
    assert.equal(await page.locator('#title').inputValue(), book.metadata.title);
    const imported = await page.evaluate(() => JSON.parse(localStorage.getItem('book-engine-project-v1')));
    assert.equal(imported.chapters.length, 3); assert.equal(imported.sources[0].verified, false);
    assert.deepEqual(imported.workflow.completed, []);
    const downloadPromise = page.waitForEvent('download');
    await page.locator('.topActions [data-action="backup"]').click();
    const download = await downloadPromise;
    const backup = JSON.parse(await fs.readFile(await download.path(), 'utf8'));
    assert.deepEqual(backup, imported);
    const editable = await fs.readFile(path.join(root, 'books/ai-test/editable-book.html'), 'utf8');
    await page.locator('#projectFile').setInputFiles({ name: 'book.html', mimeType: 'text/html', buffer: Buffer.from(editable.replace('</body>', '<script>window.BOOK_ATTACK_EXECUTED=true;</script></body>')) });
    assert.equal(await page.evaluate(() => Boolean(window.BOOK_ATTACK_EXECUTED)), false);
    assert.equal(await page.locator('#title').inputValue(), book.metadata.title);
    await page.setViewportSize({ width: 390, height: 844 });
    const widths = [];
    for (const name of ['metadata', 'sources', 'chapters', 'workflow', 'preview', 'ai']) {
      await page.locator('[data-view="' + name + '"]').click();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      widths.push({ name, width }); assert.equal(width, 390);
    }
    if (process.env.BOOK_ENGINE_SCREENSHOTS) {
      const directory = path.resolve(process.env.BOOK_ENGINE_SCREENSHOTS);
      await fs.mkdir(directory, { recursive: true });
      await page.screenshot({ path: path.join(directory, 'ai-mobile.png') });
      await page.setViewportSize({ width: 1440, height: 1050 });
      await page.screenshot({ path: path.join(directory, 'ai-desktop.png') });
    }
    const templatePage = await context.newPage();
    templatePage.on('pageerror', error => errors.push(error.message));
    await templatePage.goto(pathToFileURL(path.join(root, 'books/ai-test/editable-book.html')).href);
    assert.equal(await templatePage.locator('.chapter').count(), 3);
    assert.equal(await templatePage.locator('.quote').count(), 3);
    assert.equal(await templatePage.locator('.response').count(), 16);
    assert.equal(await templatePage.locator('script:not([type="application/json"])').count(), 0);
    assert.equal(SDK.extractHtml(await templatePage.content()).chapters.length, 3);
    const badTemplate = editable.replace('"bookSpecVersion": 1', '"bookSpecVersion": 99');
    await templatePage.setContent(badTemplate);
    assert.match(await templatePage.locator('body').innerText(), /دادهٔ کتاب معتبر نیست/);
    const kitPage = await context.newPage();
    kitPage.on('pageerror', error => errors.push(error.message));
    await kitPage.goto(pathToFileURL(path.join(root, 'ai-kit/01-ai-kit.html')).href);
    await kitPage.locator('#brief').fill('کتاب کار برای معلمان، سه فصل');
    await kitPage.locator('#mode').selectOption('html');
    await kitPage.locator('#generate').click();
    assert.match(await kitPage.locator('#prompt').inputValue(), /HTML تک‌فایلی/);
    const templateDownload = kitPage.waitForEvent('download');
    await kitPage.locator('[data-file="template"]').click();
    const item = await templateDownload;
    assert.equal(SDK.extractHtml(await fs.readFile(await item.path(), 'utf8')).chapters.length, 1);
    assert.deepEqual(errors, []);
    console.log(JSON.stringify({ ok: true, legacyStatePreserved: true, wholeBookImported: true, badBookRejected: true, inputHtmlNotExecuted: true, backupComplete: true, editableTemplateRendered: true, malformedTemplateExplained: true, standaloneKitWorks: true, mobile: widths, pageErrors: errors }, null, 2));
  } finally { await browser.close(); }
}
main().catch(error => { console.error(error.stack); process.exitCode = 1; });
