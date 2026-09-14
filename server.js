const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  console.log('[BROWSER] Starting Chromium...');

  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu',
      '--no-zygote'
    ]
  });

  console.log('[BROWSER] Chromium started');

  return browser;
}

app.get('/', (req, res) => {
  res.status(200).json({
    service: 'connection-playwright',
    status: 'ok'
  });
});

app.get('/health', (req, res) => {
  res.status(200).json({
    status: 'ok'
  });
});

app.get('/browser-test', async (req, res) => {
  let context = null;

  try {
    console.log('[TEST] Launching browser');

    const browserInstance = await getBrowser();

    context = await browserInstance.newContext();

    const page = await context.newPage();

    await page.goto('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const title = await page.title();

    console.log('[TEST] Browser works');

    return res.status(200).json({
      success: true,
      title,
      url: page.url()
    });

  } catch (error) {

    console.error('[TEST ERROR]', error);

    return res.status(200).json({
      success: false,
      error: error.message,
      stack: error.stack
    });

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

app.post('/lookup', async (req, res) => {

  const sku = String(req.body?.sku || '').trim();

  if (!sku) {
    return res.status(400).json({
      success: false,
      error: 'sku is required'
    });
  }

  const searchUrl =
    `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`;

  let context = null;

  try {

    console.log('==============================');
    console.log(`[LOOKUP] SKU: ${sku}`);
    console.log(`[LOOKUP] URL: ${searchUrl}`);

    const browserInstance = await getBrowser();

    console.log('[LOOKUP] Creating browser context');

    context = await browserInstance.newContext({
      viewport: {
        width: 1440,
        height: 900
      },
      locale: 'en-US'
    });

    const page = await context.newPage();

    page.on('requestfailed', request => {
      console.log(
        '[REQUEST FAILED]',
        request.url(),
        request.failure()
      );
    });

    page.on('response', response => {

      if (response.status() >= 400) {
        console.log(
          '[HTTP ERROR]',
          response.status(),
          response.url()
        );
      }

    });

    console.log('[LOOKUP] Opening Connection...');

    let navigationError = null;

    try {

      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });

    } catch (error) {

      navigationError = error.message;

      console.log(
        '[NAVIGATION ERROR]',
        navigationError
      );

    }

    console.log('[LOOKUP] Waiting for redirect...');

    await page.waitForTimeout(5000);

    const finalUrl = page.url();

    const title = await page.title().catch(() => '');

    console.log('[LOOKUP] Final URL:', finalUrl);
    console.log('[LOOKUP] Title:', title);

    const isProductPage =
      finalUrl
        .toLowerCase()
        .includes('connection.com/product/');

    const decodedUrl =
      decodeURIComponent(finalUrl).toLowerCase();

    const skuMatch =
      decodedUrl.includes(
        `/${sku.toLowerCase()}/`
      ) ||
      decodedUrl.endsWith(
        `/${sku.toLowerCase()}`
      );

    return res.status(200).json({

      success:
        isProductPage &&
        skuMatch,

      sku,

      searchUrl,

      finalUrl,

      url:
        isProductPage && skuMatch
          ? finalUrl
          : null,

      title,

      isProductPage,

      skuMatch,

      navigationError

    });

  } catch (error) {

    console.error(
      '[LOOKUP FATAL ERROR]',
      error
    );

    return res.status(200).json({

      success: false,

      sku,

      searchUrl,

      finalUrl: null,

      url: null,

      isProductPage: false,

      skuMatch: false,

      error: error.message,

      stack: error.stack

    });

  } finally {

    if (context) {
      await context.close().catch(() => {});
    }

  }
});

process.on('SIGTERM', async () => {

  console.log('SIGTERM');

  if (browser) {
    await browser.close().catch(() => {});
  }

  process.exit(0);

});

app.listen(PORT, '0.0.0.0', () => {

  console.log(
    `Server listening on port ${PORT}`
  );

});
