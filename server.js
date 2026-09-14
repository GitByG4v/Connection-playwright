const express = require('express');

// playwright-extra wraps Playwright's chromium launcher so puppeteer-extra
// style plugins (like the stealth plugin) can be applied to it. This patches
// the tell-tale signs of automation that bot-mitigation WAFs (Akamai/PerimeterX/etc.)
// check for: navigator.webdriver, missing chrome.runtime, plugin/mimeType
// arrays, WebGL vendor strings, permissions.query behavior, iframe.contentWindow,
// and a handful of others. Without this, connection.com serves an
// "Access Denied" block page instead of the real search redirect.
const { chromium } = require('playwright-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');

chromium.use(StealthPlugin());

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

let browser = null;

// A realistic, current desktop Chrome UA. Playwright's default UA string is
// fine on its own, but pinning it explicitly means it always matches the
// Chromium version we actually launch (mismatches here are another common
// bot-detection signal).
const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

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
      '--no-zygote',
      // Removes the "Chrome is being controlled by automated test software"
      // banner and the associated automation flag some detectors check for.
      '--disable-blink-features=AutomationControlled'
    ]
  });

  console.log('[BROWSER] Chromium started');

  return browser;
}

function isBlockedPage(title, finalUrl) {
  const t = (title || '').toLowerCase();
  return (
    t.includes('access denied') ||
    t.includes('are you a human') ||
    t.includes('attention required') ||
    t.includes('just a moment') || // Cloudflare interstitial
    t.includes('robot') ||
    (finalUrl || '').toLowerCase().includes('/error/')
  );
}

async function runLookup(sku, attempt) {
  const searchUrl =
    `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`;

  let context = null;

  try {
    console.log('==============================');
    console.log(`[LOOKUP] Attempt ${attempt} — SKU: ${sku}`);
    console.log(`[LOOKUP] URL: ${searchUrl}`);

    const browserInstance = await getBrowser();

    console.log('[LOOKUP] Creating browser context');

    context = await browserInstance.newContext({
      viewport: { width: 1440, height: 900 },
      locale: 'en-US',
      timezoneId: 'America/New_York',
      userAgent: USER_AGENT,
      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }
    });

    const page = await context.newPage();

    page.on('requestfailed', request => {
      console.log('[REQUEST FAILED]', request.url(), request.failure());
    });

    page.on('response', response => {
      if (response.status() >= 400) {
        console.log('[HTTP ERROR]', response.status(), response.url());
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
      console.log('[NAVIGATION ERROR]', navigationError);
    }

    console.log('[LOOKUP] Waiting for redirect...');

    // A small human-like interaction before the wait — some bot checks key
    // off zero mouse/scroll activity between navigation and read.
    await page.mouse.move(200, 300);
    await page.waitForTimeout(5000);

    let finalUrl = page.url();
    let title = await page.title().catch(() => '');

    console.log('[LOOKUP] Final URL:', finalUrl);
    console.log('[LOOKUP] Title:', title);

    const blocked = isBlockedPage(title, finalUrl);

    if (blocked) {
      return {
        blocked: true,
        sku,
        searchUrl,
        finalUrl,
        title,
        navigationError
      };
    }

    const isProductPage =
      finalUrl.toLowerCase().includes('connection.com/product/');

    const decodedUrl = decodeURIComponent(finalUrl).toLowerCase();

    const skuMatch =
      decodedUrl.includes(`/${sku.toLowerCase()}/`) ||
      decodedUrl.endsWith(`/${sku.toLowerCase()}`);

    const success = isProductPage && skuMatch;

    return {
      blocked: false,
      success,
      sku,
      searchUrl,
      finalUrl,
      url: success ? finalUrl : null,
      title,
      isProductPage,
      skuMatch,
      navigationError,
      // e.g. "[Monoprice USB 2 A M TO MICRO M 28 28AWG (5137 )](https://www.connection.com/product/.../5137/41897940?cac=Result)"
      markdownLink: success && title ? `[${title}](${finalUrl})` : null
    };

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

app.get('/', (req, res) => {
  res.status(200).json({ service: 'connection-playwright', status: 'ok' });
});

app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get('/browser-test', async (req, res) => {
  let context = null;

  try {
    const browserInstance = await getBrowser();
    context = await browserInstance.newContext({ userAgent: USER_AGENT });
    const page = await context.newPage();

    await page.goto('https://example.com', {
      waitUntil: 'domcontentloaded',
      timeout: 30000
    });

    const title = await page.title();

    return res.status(200).json({ success: true, title, url: page.url() });

  } catch (error) {
    console.error('[TEST ERROR]', error);
    return res
      .status(200)
      .json({ success: false, error: error.message, stack: error.stack });

  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
});

app.post('/lookup', async (req, res) => {

  const sku = String(req.body?.sku || '').trim();

  if (!sku) {
    return res.status(400).json({ success: false, error: 'sku is required' });
  }

  try {
    let result = await runLookup(sku, 1);

    // If the WAF blocked the first attempt, retry once with a brand-new
    // context (fresh cookies/fingerprint) rather than immediately failing.
    if (result.blocked) {
      console.log('[LOOKUP] Blocked on attempt 1, retrying...');
      await new Promise(r => setTimeout(r, 2000));
      result = await runLookup(sku, 2);
    }

    if (result.blocked) {
      return res.status(200).json({
        success: false,
        sku,
        searchUrl: result.searchUrl,
        finalUrl: result.finalUrl,
        url: null,
        title: result.title,
        isProductPage: false,
        skuMatch: false,
        markdownLink: null,
        navigationError: result.navigationError,
        error: 'Blocked by site bot-protection after retry'
      });
    }

    const { blocked, ...payload } = result;
    return res.status(200).json(payload);

  } catch (error) {
    console.error('[LOOKUP FATAL ERROR]', error);

    return res.status(200).json({
      success: false,
      sku,
      searchUrl:
        `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`,
      finalUrl: null,
      url: null,
      isProductPage: false,
      skuMatch: false,
      markdownLink: null,
      error: error.message,
      stack: error.stack
    });
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
  console.log(`Server listening on port ${PORT}`);
});
