const express = require('express');
const { chromium } = require('playwright');

const app = express();

app.use(express.json());

const PORT = process.env.PORT || 3000;

let browser = null;

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) ' +
  'AppleWebKit/537.36 (KHTML, like Gecko) ' +
  'Chrome/131.0.0.0 Safari/537.36';


// ============================================================
// BROWSER
// ============================================================

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


// ============================================================
// BLOCK DETECTION
// ============================================================

function isBlockedPage(title, finalUrl, bodyText, html) {
  const text = `
    ${title || ''}
    ${finalUrl || ''}
    ${bodyText || ''}
    ${html || ''}
  `.toLowerCase();

  const blockIndicators = [
    'access denied',
    "you don't have permission",
    'you do not have permission',
    'reference #',
    'akamai',
    'accessdenied',
    'request blocked',
    'request has been blocked',
    'forbidden',
    'security policy',
    'bot detection',
    'automated access',
    'robot'
  ];

  return blockIndicators.some(indicator =>
    text.includes(indicator)
  );
}


// ============================================================
// PRODUCT URL VALIDATION
// ============================================================

function validateProductUrl(finalUrl, sku) {
  if (!finalUrl || !sku) {
    return {
      isProductPage: false,
      skuMatch: false,
      valid: false
    };
  }

  try {
    const parsed = new URL(finalUrl);

    const hostname = parsed.hostname.toLowerCase();

    const pathname = decodeURIComponent(
      parsed.pathname
    ).toLowerCase();

    const normalizedSku = decodeURIComponent(
      sku
    ).trim().toLowerCase();

    const isConnection =
      hostname === 'www.connection.com' ||
      hostname === 'connection.com';

    const isProductPage =
      isConnection &&
      pathname.startsWith('/product/');

    /*
      Connection product URLs normally look like:

      /product/product-name/SKU/ITEMNUMBER

      Example:

      /product/monoprice-usb-2-a-m-to-micro-m-28-28awg/5137/41897940
    */

    const skuMatch =
      pathname.includes(`/${normalizedSku}/`) ||
      pathname.endsWith(`/${normalizedSku}`);

    return {
      isProductPage,
      skuMatch,
      valid: isProductPage && skuMatch
    };

  } catch (error) {
    return {
      isProductPage: false,
      skuMatch: false,
      valid: false
    };
  }
}


// ============================================================
// SINGLE SKU LOOKUP
// ============================================================

async function runLookup(sku, attempt) {

  const searchUrl =
    `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`;

  let context = null;

  try {

    console.log('========================================');
    console.log(`[LOOKUP] Attempt ${attempt}`);
    console.log(`[LOOKUP] SKU: ${sku}`);
    console.log(`[LOOKUP] URL: ${searchUrl}`);

    const browserInstance = await getBrowser();

    console.log('[LOOKUP] Creating browser context');

    context = await browserInstance.newContext({

      viewport: {
        width: 1440,
        height: 900
      },

      locale: 'en-US',

      userAgent: USER_AGENT,

      extraHTTPHeaders: {
        'Accept-Language': 'en-US,en;q=0.9'
      }

    });

    const page = await context.newPage();


    // --------------------------------------------------------
    // REQUEST FAILURE LOGGING
    // --------------------------------------------------------

    page.on('requestfailed', request => {

      console.log(
        '[REQUEST FAILED]',
        request.url(),
        request.failure()
      );

    });


    // --------------------------------------------------------
    // HTTP ERROR LOGGING
    // --------------------------------------------------------

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


    // --------------------------------------------------------
    // NAVIGATION
    // --------------------------------------------------------

    let navigationError = null;
    let mainResponse = null;

    try {

      mainResponse = await page.goto(searchUrl, {

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


    // --------------------------------------------------------
    // WAIT
    // --------------------------------------------------------

    console.log(
      '[LOOKUP] Waiting for redirect...'
    );

    await page.waitForTimeout(5000);


    // --------------------------------------------------------
    // BASIC PAGE INFORMATION
    // --------------------------------------------------------

    const finalUrl = page.url();

    const title = await page
      .title()
      .catch(() => '');


    // --------------------------------------------------------
    // BODY
    // --------------------------------------------------------

    const bodyText = await page
      .locator('body')
      .innerText()
      .catch(() => '');


    // --------------------------------------------------------
    // HTML
    // --------------------------------------------------------

    const html = await page
      .content()
      .catch(() => '');


    // --------------------------------------------------------
    // RESPONSE INFORMATION
    // --------------------------------------------------------

    const httpStatus = mainResponse
      ? mainResponse.status()
      : null;

    const contentType = mainResponse
      ? mainResponse.headers()['content-type'] || null
      : null;


    console.log(
      '[LOOKUP] HTTP STATUS:',
      httpStatus
    );

    console.log(
      '[LOOKUP] CONTENT TYPE:',
      contentType
    );

    console.log(
      '[LOOKUP] Final URL:',
      finalUrl
    );

    console.log(
      '[LOOKUP] Title:',
      title
    );


    console.log(
      '[LOOKUP] Body preview:',
      bodyText.substring(0, 1000)
    );


    console.log(
      '[LOOKUP] HTML preview:',
      html.substring(0, 1500)
    );


    // --------------------------------------------------------
    // BLOCK DETECTION
    // --------------------------------------------------------

    const blocked = isBlockedPage(
      title,
      finalUrl,
      bodyText,
      html
    );


    console.log(
      '[LOOKUP] Blocked:',
      blocked
    );


    // --------------------------------------------------------
    // PRODUCT URL VALIDATION
    // --------------------------------------------------------

    const validation = validateProductUrl(
      finalUrl,
      sku
    );


    console.log(
      '[LOOKUP] Product page:',
      validation.isProductPage
    );

    console.log(
      '[LOOKUP] SKU match:',
      validation.skuMatch
    );


    // --------------------------------------------------------
    // FINAL SUCCESS
    // --------------------------------------------------------

    const success =
      !blocked &&
      validation.valid;


    console.log(
      '[LOOKUP] SUCCESS:',
      success
    );


    // --------------------------------------------------------
    // MARKDOWN LINK
    // --------------------------------------------------------

    const markdownLink =
      success && title
        ? `[${title}](${finalUrl})`
        : success
          ? `[Connection Product](${finalUrl})`
          : null;


    // --------------------------------------------------------
    // RETURN RESULT
    // --------------------------------------------------------

    return {

      blocked,

      success,

      sku,

      searchUrl,

      finalUrl,

      url: success
        ? finalUrl
        : null,

      title,

      httpStatus,

      contentType,

      isProductPage:
        validation.isProductPage,

      skuMatch:
        validation.skuMatch,

      markdownLink,

      navigationError,

      bodyPreview:
        bodyText.substring(0, 1000)

    };


  } finally {

    if (context) {

      await context
        .close()
        .catch(() => {});

    }

  }

}


// ============================================================
// ROOT
// ============================================================

app.get('/', (req, res) => {

  res.status(200).json({

    service: 'connection-playwright',

    status: 'ok'

  });

});


// ============================================================
// HEALTH
// ============================================================

app.get('/health', (req, res) => {

  res.status(200).json({

    status: 'ok'

  });

});


// ============================================================
// BROWSER TEST
// ============================================================

app.get('/browser-test', async (req, res) => {

  let context = null;

  try {

    console.log(
      '[TEST] Launching browser'
    );

    const browserInstance =
      await getBrowser();

    context =
      await browserInstance.newContext({

        viewport: {
          width: 1440,
          height: 900
        },

        locale: 'en-US',

        userAgent: USER_AGENT

      });


    const page =
      await context.newPage();


    await page.goto(
      'https://example.com',
      {
        waitUntil: 'domcontentloaded',
        timeout: 30000
      }
    );


    const title =
      await page.title();


    console.log(
      '[TEST] Browser works'
    );


    return res.status(200).json({

      success: true,

      title,

      url: page.url()

    });


  } catch (error) {

    console.error(
      '[TEST ERROR]',
      error
    );


    return res.status(200).json({

      success: false,

      error: error.message,

      stack: error.stack

    });


  } finally {

    if (context) {

      await context
        .close()
        .catch(() => {});

    }

  }

});


// ============================================================
// LOOKUP API
// ============================================================

app.post('/lookup', async (req, res) => {

  const sku =
    String(
      req.body?.sku || ''
    ).trim();


  if (!sku) {

    return res.status(400).json({

      success: false,

      error: 'sku is required'

    });

  }


  try {

    // --------------------------------------------------------
    // ATTEMPT 1
    // --------------------------------------------------------

    let result =
      await runLookup(
        sku,
        1
      );


    // --------------------------------------------------------
    // RETRY ONLY FOR TEMPORARY NAVIGATION FAILURE
    // --------------------------------------------------------

    if (
      !result.success &&
      !result.blocked &&
      result.navigationError
    ) {

      console.log(
        '[LOOKUP] Navigation failed on attempt 1'
      );

      console.log(
        '[LOOKUP] Retrying...'
      );


      await new Promise(
        resolve =>
          setTimeout(
            resolve,
            2000
          )
      );


      result =
        await runLookup(
          sku,
          2
        );

    }


    // --------------------------------------------------------
    // BLOCKED RESPONSE
    // --------------------------------------------------------

    if (result.blocked) {

      console.log(
        '[LOOKUP] Connection returned a blocked response'
      );


      return res.status(200).json({

        success: false,

        sku,

        searchUrl:
          result.searchUrl,

        finalUrl:
          result.finalUrl,

        url: null,

        title:
          result.title,

        httpStatus:
          result.httpStatus,

        contentType:
          result.contentType,

        isProductPage: false,

        skuMatch: false,

        markdownLink: null,

        navigationError:
          result.navigationError,

        bodyPreview:
          result.bodyPreview,

        error:
          'Connection returned a blocked/access-denied response'

      });

    }


    // --------------------------------------------------------
    // NORMAL RESPONSE
    // --------------------------------------------------------

    return res.status(200).json({

      success:
        result.success,

      sku:
        result.sku,

      searchUrl:
        result.searchUrl,

      finalUrl:
        result.finalUrl,

      url:
        result.url,

      title:
        result.title,

      httpStatus:
        result.httpStatus,

      contentType:
        result.contentType,

      isProductPage:
        result.isProductPage,

      skuMatch:
        result.skuMatch,

      markdownLink:
        result.markdownLink,

      navigationError:
        result.navigationError,

      bodyPreview:
        result.bodyPreview,

      error:
        result.success
          ? null
          : 'Connection search did not resolve to a valid product URL'

    });


  } catch (error) {

    console.error(
      '[LOOKUP FATAL ERROR]',
      error
    );


    return res.status(200).json({

      success: false,

      sku,

      searchUrl:
        `https://www.connection.com/IPA/Shop/Product/Search?SearchType=1&term=${encodeURIComponent(sku)}`,

      finalUrl: null,

      url: null,

      title: null,

      httpStatus: null,

      contentType: null,

      isProductPage: false,

      skuMatch: false,

      markdownLink: null,

      error:
        error.message,

      stack:
        error.stack

    });

  }

});


// ============================================================
// SHUTDOWN
// ============================================================

process.on(
  'SIGTERM',
  async () => {

    console.log(
      'SIGTERM'
    );


    if (browser) {

      await browser
        .close()
        .catch(() => {});

    }


    process.exit(0);

  }
);


// ============================================================
// START SERVER
// ============================================================

app.listen(
  PORT,
  '0.0.0.0',
  () => {

    console.log(
      `Server listening on port ${PORT}`
    );

  }
);
