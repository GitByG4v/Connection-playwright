const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json({ limit: '50kb' }));

const PORT = process.env.PORT || 3000;

let browser = null;

async function getBrowser() {
  if (browser && browser.isConnected()) {
    return browser;
  }

  browser = await chromium.launch({
    headless: true,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-gpu'
    ]
  });

  return browser;
}

function cleanSku(value) {
  return String(value || '').trim();
}

function isValidProductUrl(url) {
  try {
    const u = new URL(url);

    return (
      u.hostname.toLowerCase() === 'www.connection.com' &&
      u.pathname.toLowerCase().startsWith('/product/')
    );
  } catch {
    return false;
  }
}

function skuInUrl(url, sku) {
  try {
    const u = new URL(url);

    const path = decodeURIComponent(u.pathname).toLowerCase();
    const normalizedSku = sku.toLowerCase();

    return (
      path.includes(`/${normalizedSku}/`) ||
      path.endsWith(`/${normalizedSku}`)
    );
  } catch {
    return false;
  }
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

app.post('/lookup', async (req, res) => {
  const sku = cleanSku(req.body?.sku);

  if (!sku) {
    return res.status(400).json({
      success: false,
      error: 'sku is required'
    });
  }

  const searchUrl =
    `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`;

  let context = null;
  let page = null;

  try {
    console.log(`[LOOKUP] SKU: ${sku}`);
    console.log(`[LOOKUP] URL: ${searchUrl}`);

    const browserInstance = await getBrowser();

    context = await browserInstance.newContext({
      viewport: {
        width: 1440,
        height: 900
      },
      locale: 'en-US',
      userAgent:
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
        'AppleWebKit/537.36 (KHTML, like Gecko) ' +
        'Chrome/131.0.0.0 Safari/537.36'
    });

    page = await context.newPage();

    page.on('response', response => {
      const status = response.status();

      if (status >= 400) {
        console.log(
          `[HTTP] ${status} ${response.url()}`
        );
      }
    });

    page.on('requestfailed', request => {
      console.log(
        `[REQUEST FAILED] ${request.url()} - ${request.failure()?.errorText}`
      );
    });

    let gotoError = null;

    try {
      await page.goto(searchUrl, {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      });
    } catch (error) {
      gotoError = error.message;

      console.log(
        `[GOTO ERROR] ${gotoError}`
      );
    }

    // Allow redirects/client-side navigation to settle.
    await page.waitForTimeout(3000).catch(() => {});

    const finalUrl = page.url();

    const title = await page.title().catch(() => '');

    const productPage = isValidProductUrl(finalUrl);

    const skuMatch =
      productPage &&
      skuInUrl(finalUrl, sku);

    console.log(`[FINAL URL] ${finalUrl}`);
    console.log(`[TITLE] ${title}`);
    console.log(`[PRODUCT PAGE] ${productPage}`);
    console.log(`[SKU MATCH] ${skuMatch}`);

    return res.status(200).json({
      success: productPage && skuMatch,
      sku,
      searchUrl,
      finalUrl,
      url: productPage && skuMatch ? finalUrl : null,
      title,
      isProductPage: productPage,
      skuMatch,
      gotoError
    });

  } catch (error) {
    console.error('[LOOKUP ERROR]', error);

    return res.status(200).json({
      success: false,
      sku,
      searchUrl,
      finalUrl: null,
      url: null,
      isProductPage: false,
      skuMatch: false,
      error: error.message
    });

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

process.on('SIGTERM', async () => {
  console.log('SIGTERM received');

  if (browser) {
    await browser.close().catch(() => {});
  }

  process.exit(0);
});

process.on('SIGINT', async () => {
  console.log('SIGINT received');

  if (browser) {
    await browser.close().catch(() => {});
  }

  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(
    `Connection Playwright service listening on ${PORT}`
  );
});
