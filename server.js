const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json({ limit: '50kb' }));

const PORT = process.env.PORT || 3000;

let browser = null;

async function getBrowser() {
  if (!browser || !browser.isConnected()) {
    browser = await chromium.launch({
      headless: true,
      args: [
        '--disable-dev-shm-usage'
      ]
    });
  }

  return browser;
}

function cleanSku(value) {
  return String(value || '').trim();
}

function isValidConnectionProductUrl(url) {
  try {
    const parsed = new URL(url);

    return (
      parsed.hostname === 'www.connection.com' &&
      parsed.pathname.toLowerCase().startsWith('/product/')
    );
  } catch {
    return false;
  }
}

function skuAppearsInProductUrl(url, sku) {
  try {
    const parsed = new URL(url);

    const path = decodeURIComponent(parsed.pathname).toLowerCase();
    const normalizedSku = sku.toLowerCase();

    return path.includes(`/${normalizedSku}/`);
  } catch {
    return false;
  }
}

app.get('/', (req, res) => {
  res.json({
    service: 'connection-playwright',
    status: 'ok'
  });
});

app.get('/health', (req, res) => {
  res.json({
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

  if (sku.length > 100) {
    return res.status(400).json({
      success: false,
      error: 'sku is too long'
    });
  }

  let context = null;
  let page = null;

  try {
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

    const searchUrl =
      `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`;

    await page.goto(searchUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    // Give the redirect/client-side navigation a little time to complete.
    await page.waitForTimeout(2500);

    const finalUrl = page.url();

    const validProductPage =
      isValidConnectionProductUrl(finalUrl);

    const skuMatch =
      validProductPage &&
      skuAppearsInProductUrl(finalUrl, sku);

    const title = await page.title().catch(() => '');

    return res.json({
      success: validProductPage && skuMatch,
      sku,
      searchUrl,
      finalUrl,
      url: validProductPage && skuMatch ? finalUrl : null,
      isProductPage: validProductPage,
      skuMatch,
      title
    });

  } catch (error) {
    return res.status(502).json({
      success: false,
      sku,
      error: error.message
    });

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

process.on('SIGTERM', async () => {
  if (browser) {
    await browser.close().catch(() => {});
  }

  process.exit(0);
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`Connection Playwright service running on port ${PORT}`);
});
