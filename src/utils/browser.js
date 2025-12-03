// src/utils/browser.js
const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const config = require('../config');

puppeteer.use(StealthPlugin());

/**
 * Launches a browser instance with optimized settings.
 * @returns {Promise<import('puppeteer').Browser>}
 */
async function launchBrowser() {
    // اگر DEBUG_MODE فعال باشد، headless را override می‌کند
    const shouldBeHeadless = config.DEBUG_MODE === true ? false : config.HEADLESS;
    const headlessMode = typeof shouldBeHeadless === 'boolean'
        ? (shouldBeHeadless ? 'new' : false)
        : 'new';

    const launchOptions = {
        headless: headlessMode,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1920,1080'
        ],
        defaultViewport: null,
    };

    // Try to find local Chrome if Puppeteer's bundled one isn't there
    const possiblePaths = [
        'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
        'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe'
    ];
    
    const fs = require('fs');
    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            launchOptions.executablePath = p;
            break;
        }
    }

    return await puppeteer.launch(launchOptions);
}

/**
 * Sets up request interception to block unnecessary resources.
 * @param {import('puppeteer').Page} page 
 */
async function setupRequestInterception(page) {
    // وقتی headless خاموش است، برای مشاهده کامل UI، همه ریسورس‌ها را اجازه بده
    if (config.HEADLESS === false) {
        return;
    }

    await page.setRequestInterception(true);
    page.on('request', (req) => {
        const resourceType = req.resourceType();

        // Block images, fonts, media, and stylesheets to save bandwidth
        if (['image', 'font', 'media', 'stylesheet'].includes(resourceType)) {
            req.abort();
        } else {
            req.continue();
        }
    });
}

/**
 * Sets a random User Agent and Viewport for the page.
 * @param {import('puppeteer').Page} page 
 */
async function setRandomContext(page) {
    const userAgent = config.USER_AGENTS[Math.floor(Math.random() * config.USER_AGENTS.length)];
    await page.setUserAgent(userAgent);

    // Randomize viewport slightly to avoid fingerprinting
    const width = 1366 + Math.floor(Math.random() * 100);
    const height = 768 + Math.floor(Math.random() * 100);
    await page.setViewport({ width, height });
}

module.exports = {
    launchBrowser,
    setupRequestInterception,
    setRandomContext
};
