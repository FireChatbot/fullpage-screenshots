# Full-Page Screenshot Tool with Puppeteer

_A Node.js module for capturing full-page website screenshots by scrolling and stitching, handling fixed elements, and supporting proxy integration._

This repository provides a **minimal** Node.js module for capturing full-page screenshots using a scrolling-and-stitching method. It is inspired by a Cloud Function originally developed at [Chatbot Company FireChatbot](https://firechatbot.com). The code scrolls through the page in increments, takes screenshots of each segment, and stitches them together using [sharp](https://github.com/lovell/sharp).

## Key Features

1. **Scrolling Approach**  
   - Scrolls through a page in multiple steps to ensure elements using `height: 100vh` do not block the entire screenshot.

2. **Fixed to Absolute Conversion**  
   - Automatically converts `position: fixed` elements to `position: absolute`, ensuring they appear only once in the final image instead of repeating at each scrolling step.

3. **Proxy Support**  
   - Optionally integrates with a proxy (e.g., [ScraperAPI](https://www.scraperapi.com/)) for rotating IPs, making it easier to capture screenshots of sites that may block repeated requests or certain IP ranges.

4. **Configurable Viewport & Overlap**  
   - Manually set the viewport size (`viewportWidth`, `viewportHeight`) and the scrolling overlap to fine-tune how screenshots line up.

5. **Lightweight Implementation**  
   - Uses `puppeteer-core` and `chrome-aws-lambda`, allowing easy deployment in serverless environments like AWS Lambda or Google Cloud Functions.
   - Swap out `chrome-aws-lambda` for `puppeteer` if running locally or in a non-serverless environment.

## Installation

```bash
# Using npm
npm install puppeteer-core chrome-aws-lambda sharp

# Or if running locally (non-serverless), you can use:
npm install puppeteer sharp
```

## Usage
```javascript
const {
  captureFullPageScreenshot,
  saveScreenshotToFile
} = require('./index');

(async () => {
  const url = 'https://example.com';
  
  // Option 1: Get a Buffer directly
  try {
    const buffer = await captureFullPageScreenshot(url, {
      viewportWidth: 1600,
      viewportHeight: 900,
      overlap: 100,
      useScraperApi: true,
      proxyUsername: 'scraperapi.autoparse=true.retry_404=true.country_code=eu.device_type=desktop',
      proxyPassword: 'YOUR_SCRAPERAPI_KEY'
    });
    
    // Do something with the buffer (e.g., upload to S3, serve as a response, etc.)
    console.log('Screenshot captured, buffer length:', buffer.length);
  } catch (err) {
    console.error('Failed to capture screenshot:', err);
  }

  // Option 2: Save to file with a helper function
  try {
    const outputFile = './output/example.png';
    await saveScreenshotToFile(url, outputFile);
    console.log(`Saved screenshot to ${outputFile}`);
  } catch (err) {
    console.error('Failed to save screenshot:', err);
  }
})();
```


