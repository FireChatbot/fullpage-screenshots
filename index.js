const puppeteer = require('puppeteer-core');
const chromium = require('chrome-aws-lambda'); // You can swap to 'puppeteer' if running locally
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');

/**
 * Converts `position: fixed` elements into `position: absolute` to avoid repeated captures.
 * This function is injected into the browser context.
 */
async function convertFixedElementsToAbsolute(page) {
  await page.evaluate(() => {
    const convertToAbsolute = (element) => {
      const style = window.getComputedStyle(element);
      if (style.position === 'fixed') {
        const rect = element.getBoundingClientRect();
        const scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        
        element.style.position = 'absolute';
        element.style.top = `${rect.top + scrollTop}px`;
        element.style.left = `${rect.left}px`;
        element.style.bottom = 'auto';
        element.style.right = 'auto';
      }
      
      Array.from(element.children).forEach(convertToAbsolute);
    };

    convertToAbsolute(document.body);
  });
}

/**
 * Takes multiple screenshots by scrolling through the page and capturing partial chunks.
 * @param {puppeteer.Page} page 
 * @param {number} viewportHeight 
 * @param {number} overlap 
 */
async function takeScreenshotsOfPage(page, viewportHeight, overlap = 100) {
  // Convert all fixed elements to absolute
  await convertFixedElementsToAbsolute(page);

  // Get the full height of the document
  const fullHeight = await page.evaluate(() => {
    return Math.max(
      document.body.scrollHeight,
      document.documentElement.scrollHeight,
      document.body.offsetHeight,
      document.documentElement.offsetHeight,
      document.body.clientHeight,
      document.documentElement.clientHeight
    );
  });

  const positions = [];
  let currentPos = 0;

  // Collect scroll positions from top to (just before) the bottom
  while (true) {
    positions.push(currentPos);
    currentPos += (viewportHeight - overlap);

    if (currentPos + viewportHeight > fullHeight) {
      break;
    }
  }

  // Snap the last screenshot to the very bottom
  const finalPos = Math.max(0, fullHeight - viewportHeight);
  if (finalPos > positions[positions.length - 1] + overlap / 2) {
    positions.push(finalPos);
  }

  const screenshots = [];
  let counter = 0;
  for (const scrollPos of positions) {
    await page.evaluate((pos) => {
      window.scrollTo(0, pos);
    }, scrollPos);

    // Wait for content to load
    if (counter === 0) {
      await page.waitForTimeout(2000);
    } else {
      await page.waitForTimeout(500);
    }

    counter += 1;

    const screenshot = await page.screenshot({
      type: 'png',
      fullPage: false
    });

    screenshots.push({
      image: screenshot,
      position: scrollPos
    });
  }

  return {
    screenshots,
    fullHeight
  };
}

/**
 * Stitches the screenshots into one tall image using sharp.
 * @param {Array<{image: Buffer, position: number}>} screenshots 
 * @param {number} fullHeight 
 * @param {number} viewportWidth 
 * @param {number} viewportHeight 
 */
async function stitchScreenshots(screenshots, fullHeight, viewportWidth, viewportHeight) {
  const finalImage = sharp({
    create: {
      width: viewportWidth,
      height: fullHeight,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 }
    }
  });

  const compositeOperations = screenshots.map(shot => ({
    input: shot.image,
    top: shot.position,
    left: 0
  }));

  return finalImage
    .composite(compositeOperations)
    .png()
    .toBuffer();
}

/**
 * Helper to ensure the directory for the file path exists.
 * @param {string} filePath 
 */
async function ensureDirectoryExists(filePath) {
  const directory = path.dirname(filePath);
  try {
    await fs.promises.mkdir(directory, { recursive: true });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
  }
}

/**
 * Main function that captures a full-page screenshot with the scrolling approach.
 * 
 * @param {string} url - The URL to capture.
 * @param {object} options - Configuration options.
 * @param {number} [options.viewportWidth=1366] - The viewport width.
 * @param {number} [options.viewportHeight=768] - The viewport height.
 * @param {number} [options.overlap=100] - Overlap between screenshots for stitching.
 * @param {boolean} [options.useScraperApi=false] - Whether to use a rotating proxy.
 * @param {string} [options.proxyUsername] - Proxy username (if using ScraperAPI or other).
 * @param {string} [options.proxyPassword] - Proxy password (if using ScraperAPI or other).
 * @param {string} [options.executablePathOverride] - Override path for Chrome (useful locally).
 * @returns {Promise<Buffer>} - A Promise that resolves to the final PNG Buffer.
 */
async function captureFullPageScreenshot(url, {
  viewportWidth = 1366,
  viewportHeight = 768,
  overlap = 100,
  useScraperApi = false,
  proxyUsername,
  proxyPassword,
  executablePathOverride
} = {}) {
  let browser;

  try {
    // Validate URL
    new URL(url);

    // Launch puppeteer
    browser = await puppeteer.launch({
      args: [
        ...chromium.args,
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-gpu'
      ],
      defaultViewport: { 
        width: viewportWidth, 
        height: viewportHeight 
      },
      executablePath: executablePathOverride || await chromium.executablePath,
      headless: chromium.headless,
      ignoreHTTPSErrors: true,
    });

    const page = await browser.newPage();
    page.setDefaultNavigationTimeout(120000); // 2 minutes

    const processPage = async () => {
      // Wait a bit for the content to stabilize
      await page.waitForTimeout(4000);
      const { screenshots, fullHeight } = await takeScreenshotsOfPage(page, viewportHeight, overlap);
      return stitchScreenshots(screenshots, fullHeight, viewportWidth, viewportHeight);
    };

    let finalBuffer;

    try {
      await page.goto(url, {
        waitUntil: ['networkidle0', 'domcontentloaded', 'load'],
        timeout: 120000
      });
      finalBuffer = await processPage();
    } catch (navigationError) {
      console.error('Navigation error on first attempt:', navigationError);
      if (useScraperApi && proxyUsername && proxyPassword) {
        // Example: Using ScraperAPI credentials
        await page.authenticate({
          username: proxyUsername,
          password: proxyPassword
        });

        await page.goto(url, {
          waitUntil: ['networkidle0', 'domcontentloaded', 'load'],
          timeout: 120000
        });
        finalBuffer = await processPage();
      } else {
        throw navigationError;
      }
    }

    return finalBuffer;
  } finally {
    if (browser) {
      await browser.close().catch(console.error);
    }
  }
}

/**
 * Example usage that writes the final PNG to local temp dir.
 * 
 * @param {string} url 
 * @param {string} outputFile 
 */
async function saveScreenshotToFile(url, outputFile) {
  const buffer = await captureFullPageScreenshot(url, {
    viewportWidth: 1770,
    viewportHeight: 1000,
    overlap: 100,
    useScraperApi: true,  // if you want to use ScraperAPI or some rotating proxy
    proxyUsername: 'scraperapi.autoparse=true.retry_404=true.country_code=eu.device_type=desktop',
    proxyPassword: '140fc0c3c72da4f26bb7efd5df866b15'
  });

  await ensureDirectoryExists(outputFile);
  await fs.promises.writeFile(outputFile, buffer);
  console.log(`Saved screenshot to ${outputFile}`);
}

module.exports = {
  captureFullPageScreenshot,
  saveScreenshotToFile,
  convertFixedElementsToAbsolute,
  takeScreenshotsOfPage,
  stitchScreenshots
};
