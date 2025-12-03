// src/worker.js
const config = require('./config');
const { setupRequestInterception, setRandomContext } = require('./utils/browser');
const selectors = require('./utils/selectors');
const { normalizePhone, cleanText } = require('./utils/normalizer');
const logger = require('./utils/logger');
const { randomSleep, checkCaptcha, retry } = require('./utils/robustness');

/**
 * Processes a single place link to extract details.
 * @param {import('puppeteer').Browser} browser 
 * @param {object} linkObj - { href, text, ... }
 * @param {object} metadata - { keyword, province }
 */
async function processDetail(browser, linkObj, metadata) {
    const context = await browser.createIncognitoBrowserContext();
    const page = await context.newPage();

    const result = {
        keyword: metadata.keyword,
        province: metadata.province,
        place_id: null, // To be extracted from URL
        maps_url: linkObj.href,
        name: linkObj.text, // Initial name from search
        phones: [],
        raw_phone_strings: [],
        address: null,
        category: null,
        extraction_source: null,
        timestamp: new Date().toISOString(),
        status: 'ok'
    };

    try {
        await setupRequestInterception(page);
        await setRandomContext(page);

        logger.info(`Processing: ${linkObj.href}`);

        // Retry navigation با تنظیمات config (مخصوصاً برای قطع اینترنت)
        await retry(async () => {
            await page.goto(linkObj.href, { waitUntil: 'networkidle2', timeout: config.NAV_TIMEOUT });
        }, config.RETRY_LIMIT, config.RETRY_DELAY_BASE, config.RETRY_DELAY_MAX);

        // Check for Captcha
        if (await checkCaptcha(page)) {
            logger.warn(`Captcha detected for ${linkObj.href}`);
            result.status = 'captcha';
            return result;
        }

        await randomSleep(200, 600); // Human-like pause

        // Extract Place ID from URL
        const url = page.url();
        result.maps_url = url;

        // 1. Extract Name (Confirmation)
        try {
            const nameEl = await page.$(selectors.DETAIL.NAME);
            if (nameEl) {
                result.name = await page.evaluate(el => el.innerText, nameEl);
            }
        } catch (e) { /* ignore */ }

        // 2. Extract Phone
        let phones = await extractPhones(page);

        // Fallback: Open "About" tab if no phone found
        if (phones.length === 0) {
            logger.debug('No phone found, trying About tab...');
            const aboutClicked = await clickAboutTab(page);
            if (aboutClicked) {
                await randomSleep(1000, 2000);
                const newPhones = await extractPhones(page);
                phones = [...phones, ...newPhones];
            }
        }

        // Normalize and dedupe
        const uniquePhones = new Set();
        const uniqueRaw = new Set();

        phones.forEach(p => {
            uniqueRaw.add(p.raw);
            const norm = normalizePhone(p.raw);
            if (norm) uniquePhones.add(norm);
        });

        result.phones = Array.from(uniquePhones);
        result.raw_phone_strings = Array.from(uniqueRaw);
        result.extraction_source = phones.length > 0 ? phones[0].source : 'none';

        if (result.phones.length === 0) {
            result.status = 'no_phone';
        }

        // 3. Extract Address (Optional but good to have)
        try {
            const addrEl = await page.$(selectors.DETAIL.ADDRESS_BUTTON);
            if (addrEl) {
                result.address = await page.evaluate(el => el.getAttribute('aria-label'), addrEl);
                if (result.address) result.address = result.address.replace('Address: ', '').replace('آدرس: ', '');
            }
        } catch (e) { /* ignore */ }

        return result;

    } catch (error) {
        logger.error(`Error processing ${linkObj.href}: ${error.message}`);
        result.status = 'error';
        result.error = error.message;
        return result;
    } finally {
        await page.close();
        await context.close();
    }
}

async function extractPhones(page) {
    const found = [];

    // Strategy 1: Phone Button (data-item-id="phone:...")
    const buttons = await page.$$(selectors.DETAIL.PHONE_BUTTON);
    for (const btn of buttons) {
        const text = await page.evaluate(el => el.getAttribute('aria-label') || el.innerText, btn);
        if (text) found.push({ raw: cleanText(text.replace('Phone: ', '').replace('تلفن: ', '')), source: 'button' });
    }

    // Strategy 2: Tel Links
    const links = await page.$$(selectors.DETAIL.PHONE_LINK);
    for (const link of links) {
        const href = await page.evaluate(el => el.href, link);
        if (href) found.push({ raw: href.replace('tel:', ''), source: 'link' });
    }

    // Strategy 3: Aria Label Search (Fallback)
    if (found.length === 0) {
        // Try English and Persian aria-labels
        const ariaSelectors = [selectors.DETAIL.ARIA_PHONE, selectors.DETAIL.ARIA_PHONE_FA];
        for (const sel of ariaSelectors) {
            const els = await page.$$(sel);
            for (const el of els) {
                const txt = await page.evaluate(el => el.getAttribute('aria-label'), el);
                if (txt) found.push({ raw: cleanText(txt), source: 'aria' });
            }
        }
    }

    return found;
}

async function clickAboutTab(page) {
    try {
        // Try English then Persian
        let tab = await page.$(selectors.DETAIL.ABOUT_TAB);
        if (!tab) tab = await page.$(selectors.DETAIL.ABOUT_TAB_FA);

        if (tab) {
            await tab.click();
            return true;
        }
    } catch (e) {
        return false;
    }
    return false;
}

module.exports = { processDetail };
